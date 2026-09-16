#!/usr/bin/env node
// 자정 마감 실행기 (M7 · 결정 45 ③ · chief.md "하루 마감 — 자정"). 계약은 docs/event-schema.md 3절 "자정 마감".
//
// 서버 틱이 runNightly() 를 부른다. 우리 시각 날짜가 바뀌어 있으면 **지난 하루**를 마감한다 —
//   ① 팀마다 한 장 teams/<팀>/out/nightly/<날짜>.md (bus/nightly.mjs nightlyOf, 비서실은 뺀다)
//   ② 톰의 자정 일지 한 문단 → teams/hq/journal/chief.md (총괄실은 라운드가 없어 일지가 한 번도 안 걷혔다)
//   ③ 총괄실 한 장 teams/hq/out/nightly/<날짜>.md = 대표용 (nightlyHqOf)
//   ④ 총괄실에 note 한 줄(meta.nightly) — 문제가 있으면 톰에게 차례: 대표께 한 문장으로 묻는다(물음이어야 종이 울린다, 결정 52)
// 한 날 한 번 — 총괄실 파일이 있으면 다시 쓰지 않는다(파일이 진실, state/nightly.json 은 흔적). 서버가 자정에 죽어 있었으면 뜬 뒤 첫 틱에 늦게 쓴다(late).
// 자정에 열린 라운드는 닫지 않는다 — "아직 열림" 으로 적는다.
//
//   node server/nightly.mjs --dry [--day 2026-09-15]    파일·note·톰 호출 없이 그 날의 장을 찍어 본다(서버 밖에서, 레오가 돌려볼 것)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, listTeams, roomRules, isOffice, readLog, listRounds, listApprovals, readProgress, readState, readCast, paths, emit, appendJournal, quiet, readDelegation } from '../bus/bus.mjs';
import { nightlyOf, nightlyHqOf, proxyLinesOf, nightlyJournalPrompt, dayKeySeoul, dayStartOf } from '../bus/nightly.mjs';
import { bossOk, NOT_YET } from './public/bosswords.js';
import { clockWord } from './public/when.js';

const STORE = path.join(ROOT, 'state', 'nightly.json');
const JOURNAL_TIMEOUT = Number(process.env.PPANAM_JOURNAL_TIMEOUT || 3 * 60_000);
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; } };
const writeStore = (s) => { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + '\n'); };
let onCheckedAt = 0, onCache = false;
/** 스위치 — state/nightly.json 의 on === true. 틱마다(250ms) 파일을 안 열게 10초에 한 번만 본다. */
export function nightlyOn(now = Date.now()) {
  if (now - onCheckedAt > 10_000) { onCheckedAt = now; onCache = readStore().on === true; }
  return onCache;
}

/** 마감할 방 — 팀 방 전부. 비서실(speakers 규칙)은 대화록이 보고뿐이라 뺀다. 총괄실은 팀 장이 아니라 대표 장이다. */
const rooms = () => listTeams().filter((t) => !isOffice(t.id) && !roomRules(t.id).speakers);
const hqFileOf = (day) => path.join(paths('hq').out, 'nightly', `${day}.md`);
const rel = (file) => path.relative(ROOT, file);

/** 팀 장 다섯과 총괄 장 — 파일을 읽어 순수 함수에 넣는다. 쓰지 않는다. */
export function buildNightly(day, { now = Date.now(), journal = null, late = false } = {}) {
  const teams = rooms().map((t) => {
    const r = nightlyOf({ team: t.id, name: t.name, day, log: readLog(t.id), rounds: listRounds(t.id), approvals: listApprovals({ team: t.id }), progress: readProgress(t.id), state: readState(t.id), cast: readCast(t.id).agents ?? {}, now });
    return { team: t.id, name: t.name, file: `teams/${t.id}/out/nightly/${day}.md`, ...r };
  });
  let proxyMd = ''; try { proxyMd = fs.readFileSync(path.join(paths('hq').out, 'proxy-decisions.md'), 'utf8'); } catch { /* 대리 결정이 없던 세계 */ }
  const hq = nightlyHqOf({ day, teams, proxy: proxyLinesOf(proxyMd, day), journal, now, late });
  return { day, teams, hq };
}

/** 톰에게 자정 일지 한 문단 — 3분 안에 못 받으면 null. session 은 호출부가 준다(서버 밖 --dry 는 안 부른다). */
async function askChiefJournal(day, session) {
  if (!session) return null;
  const text = await Promise.race([
    session.sendAndWait('hq', quiet(nightlyJournalPrompt(day)), 'chief', { kind: 'journal', internal: true }),
    new Promise((r) => setTimeout(() => r(null), JOURNAL_TIMEOUT)),
  ]);
  const body = String(text ?? '').trim();
  if (!body || /^\(?패스\)?[.·\s]*$/.test(body)) return null;
  const name = readCast('hq').agents?.chief?.name ?? '톰';
  const para = body.startsWith('## ') ? body : `## ${day} · 자정 · ${name}\n\n${body}`;
  return appendJournal('hq', 'chief', para) ? para.replace(/^## [^\n]*\n\n?/, '') : null;
}

let running = false;
let closedFor = null;   // 이 프로세스가 이미 마감한 날 — 틱마다 파일을 안 열게
let retryAt = 0;        // 쓰다 실패했으면 10분 뒤에 — 틱마다(250ms) note 를 찍지 않게
const RETRY_MS = 10 * 60_000;

/**
 * 틱마다. 지난 하루(어제)가 아직 안 닫혔으면 닫는다. 돌아가는 중이면 겹치지 않는다.
 * @param session  server/session.mjs — 톰의 일지·차례. 없으면(시험) 톰을 안 부른다
 */
export async function runNightly({ now = Date.now(), session = null } = {}) {
  const day = dayKeySeoul(dayStartOf(dayKeySeoul(now)) - 1);   // 오늘 0시 직전 = 어제
  if (running || closedFor === day || now < retryAt) return null;
  // 기본은 꺼짐 — 나리 결정(09-15, 위임 136): 세라 아침 한 장·톰 일일보고서와 같은 것을 세 번째로 만드는 셈이라 코드는 두되 켜지 않는다.
  // 켜려면 state/nightly.json 에 { "on": true } — 파일 스위치라 재시작 없이 다음 틱부터.
  if (!nightlyOn()) return null;
  const hqFile = hqFileOf(day);
  if (fs.existsSync(hqFile)) { closedFor = day; return null; }   // 파일이 진실
  running = true;
  try {
    // 자정(어제 24시) 에서 얼마나 지났나 — 첫 틱(POLL 250ms) 안이면 제때, 그보다 늦으면 서버가 없었던 것
    const late = now - (dayStartOf(day) + 86_400_000) > 5 * 60_000;
    const journal = await askChiefJournal(day, session);
    const out = buildNightly(day, { now, journal, late });
    for (const t of out.teams) {
      const file = path.join(paths(t.team).out, 'nightly', `${day}.md`);
      if (fs.existsSync(file)) continue;   // 팀 장은 있고 총괄 장만 없던 경우(전에 죽었다) — 팀 장은 그대로
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, out.teams.find((x) => x.team === t.team).md);
    }
    fs.mkdirSync(path.dirname(hqFile), { recursive: true });
    fs.writeFileSync(hqFile, out.hq.md);
    writeStore({ ...readStore(), lastDay: day, at: new Date(now).toISOString(), problems: out.hq.problems.length, late });
    closedFor = day;

    const n = out.hq.problems.length;
    const file = rel(hqFile);
    emit('hq', {
      actor: 'system', type: 'note',
      text: n ? `자정 마감 ${day} — 문제 ${n}건: ${out.hq.problems.map((p) => `${p.name} ${p.text}`).join(' / ').slice(0, 300)} · ${file}` : `자정 마감 ${day} — 문제 없음. 읽고 넘기셔도 됩니다 · ${file}${journal ? '' : ' (톰 일지 없음)'}${late ? ' (늦게 씀)' : ''}`,
      meta: { nightly: { day, problems: n, file, late, journal: !!journal } },
    });
    // 문제가 있으면 톰이 대표께 묻는다 — 종은 그의 물음에 울린다(결정 52). 없으면 note 로 끝 — 대표는 읽고 넘긴다(결정 45 ③).
    if (n && session) {
      session.send('hq', quiet(`너는 톰이다. 자정 마감 한 장이 나왔다 — ${file}. 대표 손이 필요한 문제 ${n}건: ${out.hq.problems.map((p) => `${p.name} — ${p.text}`).join(' / ')}. 대표님께 "대표님," 으로 시작해 한두 문장으로 무엇을 정해 주셔야 하는지 **물어라** — 물음표로 끝내라(종이 울린다). 보고서·목록 말고 사람에게 말하듯.`), 'chief');
    }
    return { day, problems: n, file, late, journal: !!journal };
  } catch (e) {
    retryAt = now + RETRY_MS;
    try { emit('hq', { actor: 'system', type: 'note', text: `자정 마감 ${day} 을 쓰지 못했습니다 — ${String(e.message).slice(0, 200)}. 10분 뒤 다시 봅니다.` }); } catch { /* 삼킨다 */ }
    return null;
  } finally {
    running = false;
  }
}

/** 어제 날짜 열쇠 — 서버 틱과 `round.mjs nightly` 미리보기가 같은 식으로 센다. */
export const yesterdayKey = (now = Date.now()) => dayKeySeoul(dayStartOf(dayKeySeoul(now)) - 1);

// ── 아침 한 장 (M4 · 결정 140 ④ · 경영 req_e27af3c5, 유진 틀 teams/finance/out/daily-template.md) ──────────────
//
// 자정 마감과 짝 — 자정은 "지난 하루", 이건 "지난 아침(06:30) 이후". 같은 겹침·중복 방지 뼈대를 그대로 본떴다:
//   시각이 지났으면 하루 한 번만, 파일이 있으면(파일이 진실) 안 쓴다. 다만 손 글을 밀어내지 않는다 —
//   그날 파일이 이미 있으면(사람이 먼저 썼다) `<날짜>-자동.md` 로 내고 총괄실에 알린다(유진 틀 2절 끝).
//
// 내용은 서버가 가진 재료만: rounds.jsonl PASS · progress.json(blocked·boss·done) · 대기 C 카드 · 대리 결정 로그.
// 사람 말 한 줄(결정 140, server/public/bosswords.js bossOk)에 안 맞는 재료는 지어 쓰지 않고 NOT_YET 으로 낸다 —
// 자동이 "사람 말을 만들어내는" 게 아니라 "이미 사람이 사람 말로 써 둔 것만 고른다"가 이 장의 계약이다.

const dailyDir = () => path.join(paths('hq').out, 'daily');
const dailyFileOf = (day) => path.join(dailyDir(), `${day}.md`);
const dailyAutoFileOf = (day) => path.join(dailyDir(), `${day}-자동.md`);
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 가장 최근 회차 닫힘 또는 판정 시각 — "지금 다시 만들 이유가 있나"의 재료(결정 188, 대표 09-16 17:0x
 * "몇 시에 한다고 정해진 거 다 파기해라" — 06:30 이 아니라 회차가 닫히거나 결정이 나면 다시 만드는 한 장).
 * 사건이 없으면 0.
 */
function latestActivityAt() {
  let latest = 0;
  for (const t of rooms()) {
    for (const r of listRounds(t.id)) { const e = Date.parse(r.endedAt ?? ''); if (Number.isFinite(e) && e > latest) latest = e; }
    for (const a of listApprovals({ team: t.id })) { const d = Date.parse(a.decidedAt ?? ''); if (Number.isFinite(d) && d > latest) latest = d; }
  }
  return latest;
}

/** 대표 화면에 낼 수 있으면 그 줄, 아니면 null(자에 안 맞음 — 지어 쓰지 않는다). */
const line = (s) => { const v = String(s ?? '').trim(); return v && bossOk(v) ? v : null; };

/**
 * 아침 한 장 — 팀당 한 줄 셋(된 것 · 막힌 것 · 대표님 손) + 조건부 대리 결정. 읽기만, 쓰지 않는다.
 * @param day    'YYYY-MM-DD'(우리 시각, 파일 이름·머리글만 — 창 경계가 아니다)
 * @param now    지금(ms)
 * @param since  창의 시작(ms) — **지난 장을 만든 뒤부터**(유진 daily-template.md 2절 "때": 기간 고정 없음).
 *   null 이면 지난 장이 없다는 뜻 — 팀당 마지막 PASS 하나를 기간 조건 없이 그냥 쓴다. runMorning 이 target
 *   파일의 mtime 을 넘긴다.
 * @returns { day, md, counts: { blocked, boss }, skipped: [{ team, text }] }  skipped = 자에 안 맞아 뺀 재료(규칙 4, 팀 방에 알릴 것)
 */
export function buildMorning(day, { now = Date.now(), since = null } = {}) {
  const inWin = (ts) => { if (since == null) return true; const t = typeof ts === 'number' ? ts : Date.parse(ts ?? ''); return Number.isFinite(t) && t >= since; };
  // rooms() 는 총괄실(hq)을 뺀다(자정 마감이 따로 총괄 장을 낸다) — 아침 한 장은 총괄도 다섯 팀과 같은 줄이 필요해서
  // (유진 실측 — 총괄 줄이 절대 안 남았다) 비서실(speakers 방)만 뺀 목록을 따로 쓴다.
  const teams = listTeams().filter((t) => !roomRules(t.id).speakers);
  const delegating = !!readDelegation(now);   // 위임 중이면 C 카드 줄은 안 낸다(유진 틀 2절 표 4행) — 톰·제리가 대리한다
  const skipped = [];

  const doneLines = teams.map((t) => {
    const owner = roomRules(t.id).owner;
    const name = readCast(t.id).agents?.[owner]?.name ?? t.name;
    const rs = [...listRounds(t.id)].filter((r) => r.verdict === 'PASS' && inWin(r.endedAt)).sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
    const raw = rs.at(-1)?.topic ?? (readProgress(t.id)?.done ?? [])[0] ?? null;
    if (!raw) return `- ${t.name} · 어제는 낸 게 없어요`;   // 유진 daily-template.md 1절 표기 그대로 — 창이 하루가 아니어도 이 문구
    const ok = line(raw);
    if (!ok) skipped.push({ team: t.id, text: raw });
    return ok ? `- ${name} · ${ok}` : `- ${t.name} · ${NOT_YET}`;
  });

  const blockedLines = teams.flatMap((t) => (readProgress(t.id)?.blocked ?? []).map((b) => {
    const ok = line(b);
    if (!ok) { skipped.push({ team: t.id, text: b }); return null; }
    return `- ${t.name} · ${ok}`;
  }).filter(Boolean));

  const bossLines = teams.flatMap((t) => {
    // 상황판(progress.json boss[])은 그대로(유진 daily-template.md 2절 "상황판은 그대로") — 카드만 {팀} · {--boss} 로 묶는다.
    const board = (readProgress(t.id)?.boss ?? []).map((b) => { const ok = line(b); if (!ok) skipped.push({ team: t.id, text: b }); return ok ? `- ${ok}` : null; }).filter(Boolean);
    const cards = delegating ? [] : listApprovals({ team: t.id, status: 'pending' }).filter((r) => r.grade === 'C').map((r) => {
      const title = bossOk(r.boss) ? r.boss : r.what;
      const ok = line(title);
      return ok ? `- ${t.name} · ${ok}` : null;
    }).filter(Boolean);
    return [...cards, ...board];
  });

  // 대표님 대신 정한 것 — proxy-decisions.md 에서 이 창 안 줄만. 줄 꼴은 "- 날짜 시각 · 종류 · 팀 · 내용 — 꼬리" —
  // 마지막 · 뒤부터 첫 — 앞까지를 내용으로 뽑아 자를 먹인다(유진 daily-template.md 2절 "{정한 사람} · {what 의
  // 사람 말 한 줄}"). 꼴이 안 맞거나(옛 줄·손으로 쓴 줄) 결정 번호·파일 이름이 섞여 자를 못 넘으면 NOT_YET.
  let proxyMd = ''; try { proxyMd = fs.readFileSync(path.join(paths('hq').out, 'proxy-decisions.md'), 'utf8'); } catch { /* 없던 세계 */ }
  const proxyLines = proxyMd.split('\n').filter((l) => l.startsWith('- ')).flatMap((l) => {
    const m = l.match(/^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
    if (!m) return [];
    const t = Date.parse(`${m[1]}T${m[2]}:00+09:00`);
    if (!Number.isFinite(t) || !inWin(t)) return [];
    const who = (l.match(/(나리|톰|제리)\s*(?:대리|위임)/g) ?? []).at(-1)?.match(/나리|톰|제리/)?.[0] ?? '나리';
    const parts = l.split(' — ')[0].split(' · ');
    const raw = parts.length > 3 ? parts.slice(3).join(' · ').trim() : null;
    const ok = raw ? line(raw) : null;
    if (raw && !ok) skipped.push({ team: 'hq', text: raw });
    return [`- ${who} · ${ok ?? NOT_YET}`];
  });

  // day 는 이미 우리 시각 날짜 문자열이라 그대로 UTC 로 읽는다 — +09:00 을 또 붙이면 자정 근처(00~09시)에 그 인스턴트가
  // 전날 UTC 로 넘어가 getUTCDay() 가 하루 전 요일을 냈다(예: 수요일이 화요일로, 유진 실측).
  const wd = WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()];
  // 결정 188 뒤로 06:30 기준이 아니다 — 만든 그때가 기준(유진 daily-template.md 1절 "시각은 만든 그때").
  const md = [
    `# 아침 한 장 — ${day}`,
    `${wd}요일 ${clockWord(now)} 기준 · 서버가 상황판에서 만듦`, '',
    ...(proxyLines.length ? ['## 대표님 대신 정한 것', '', ...proxyLines, '되돌리시려면 방에 한마디.', ''] : []),
    '## 된 것', '', ...doneLines, '',
    `## 막힌 것 ${blockedLines.length}`, '', ...(blockedLines.length ? blockedLines : []), '',
    bossLines.length ? `## 대표님 손 ${bossLines.length}` : '## 대표님 손 0 — 오늘은 없어요', '', ...bossLines, '',
  ].join('\n');
  return { day, md, counts: { blocked: blockedLines.length, boss: bossLines.length }, skipped };
}

let morningRunning = false;
let morningRetryAt = 0;

/**
 * 틱마다. 06:30 같은 시각이 아니라 **회차가 닫히거나 결정이 나면** 다시 만든다(결정 188) — 마지막으로 쓴
 * 파일보다 더 최근 사건(latestActivityAt)이 있을 때만. 사건이 없으면(마감 뒤 아무 일도 없으면) 안 쓴다 —
 * "대표님이 열 때 최신이면 된다"(계약 371~373행)와 같은 원칙, 다만 여긴 열기 전에 미리 준비해 둔다.
 * 자정 마감과 같은 스위치(state/nightly.json.on)를 쓴다 — 나리 결정(09-15, 위임 136): "코드는 두되 켜지
 * 않는다" 는 자정만이 아니라 서버가 자동으로 내는 장 전체에 건 스위치다.
 * @param session  자리 채우기용(runNightly 와 자리 맞춤) — 정적 요약이라 실제로는 안 부른다.
 */
export async function runMorning({ now = Date.now(), session = null } = {}) {
  if (morningRunning || now < morningRetryAt) return null;
  if (!nightlyOn()) return null;
  const activity = latestActivityAt();
  if (!activity) return null;   // 회차도 결정도 아직 없으면 만들 이유가 없다
  const day = dayKeySeoul(now);
  const file = dailyFileOf(day);
  let target = file, auto = false;
  if (fs.existsSync(file)) { target = dailyAutoFileOf(day); auto = true; }   // 손 글이 있으면 자동 판은 따로 — 손 글을 덮지 않는다
  let mtime = 0; try { mtime = fs.statSync(target).mtimeMs; } catch { /* 아직 없음 */ }
  if (mtime >= activity) return null;   // 마지막으로 쓴 뒤로 새 사건이 없다 — 이미 최신
  morningRunning = true;
  try {
    // 창은 "지난 장을 만든 뒤 → 지금" 하나(유진 daily-template.md 2절) — 지난 장이 없으면(mtime 0) 기간 조건 없이.
    const out = buildMorning(day, { now, since: mtime || null });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out.md);
    writeStore({ ...readStore(), morning: { day, at: new Date(now).toISOString(), auto, blocked: out.counts.blocked, boss: out.counts.boss } });

    for (const s of out.skipped) emit(s.team, { actor: 'system', type: 'note', text: `아침 한 장 자에 안 맞아 뺀 줄 — 다시 쓰면 다음 장에 실립니다: ${s.text}`.slice(0, 200) });
    emit('hq', {
      actor: 'system', type: 'note',
      text: `아침 한 장 ${day} 다시 만듦 — 막힌 것 ${out.counts.blocked} · 대표님 손 ${out.counts.boss} · ${rel(target)}${auto ? ' (손 글이 있어 자동 판을 따로 냄)' : ''}`,
      meta: { morning: { day, file: rel(target), auto, blocked: out.counts.blocked, boss: out.counts.boss } },
    });
    return { day, file: rel(target), auto, ...out.counts };
  } catch (e) {
    morningRetryAt = now + RETRY_MS;
    try { emit('hq', { actor: 'system', type: 'note', text: `아침 한 장 ${day} 을 쓰지 못했습니다 — ${String(e.message).slice(0, 200)}. 10분 뒤 다시 봅니다.` }); } catch { /* 삼킨다 */ }
    return null;
  } finally {
    morningRunning = false;
  }
}
