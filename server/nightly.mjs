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
import { ROOT, listTeams, roomRules, isOffice, readLog, listRounds, listApprovals, readProgress, readState, readCast, paths, emit, appendJournal, quiet } from '../bus/bus.mjs';
import { nightlyOf, nightlyHqOf, proxyLinesOf, nightlyJournalPrompt, dayKeySeoul, dayStartOf } from '../bus/nightly.mjs';

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
