// 자정 마감 — 하루 한 장 (M7 · 결정 45 ③ · chief.md "하루 마감 — 자정"). 계약은 docs/event-schema.md 3절 "자정 마감".
//
// 여기는 **순수 함수**만 — 파일을 안 읽고 세션을 모른다. round.mjs check 가 돌린다. 파일을 읽고 쓰고 톰을 깨우는 것은 server/nightly.mjs.
// doneOf·blockedOf 와 같은 경계: 평평한 재료(대화록·rounds·승인·상황판·round.json)를 받아 글 한 장과 "대표 손이 필요한 것" 목록을 낸다.

import { SEOUL_OFFSET_MS, MAX_ATTEMPTS, APPROVAL_GRADES, TURN_JOURNAL, bossCallOf, bossParagraph } from './bus.mjs';

/** 우리 시각 'YYYY-MM-DD'. */
export const dayKeySeoul = (ms = Date.now()) => new Date(ms + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
/** 'YYYY-MM-DD'(우리 시각) 의 0시 → UTC ms. */
export const dayStartOf = (day) => Date.parse(`${day}T00:00:00+09:00`);
const ms = (ts) => (typeof ts === 'number' ? ts : Date.parse(ts ?? ''));
const hmSeoul = (ts) => { const t = ms(ts); if (!Number.isFinite(t)) return '?'; const d = new Date(t + SEOUL_OFFSET_MS); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
/** 그날 안이면 "21:33", 다른 날이면 "09-14 22:38" — 자정을 넘긴 라운드의 시작이 그날 것처럼 안 보이게. */
const whenSeoul = (ts, day) => { const t = ms(ts); if (!Number.isFinite(t)) return '?'; const k = dayKeySeoul(t); return k === day ? hmSeoul(t) : `${k.slice(5)} ${hmSeoul(t)}`; };
const oneLine = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const APPROVAL_WORD = { passed: '통과', revised: '반려', void: '무효', pending: '대기' };
const JUDGE_NAME = { chief: '톰', outside: '제리', boss: '대표' };

/**
 * 한 팀의 하루 한 장.
 *
 * @param day        'YYYY-MM-DD'(우리 시각) — 창은 그날 0시 ≤ ts < 다음 날 0시
 * @param log        대화록(시간순)
 * @param rounds     rounds.jsonl 항목들(순서 무관) — { round, milestone, topic, verdict, startedAt, endedAt }
 * @param approvals  listApprovals({ team }) — { id, grade, what, status, ts, decidedAt, decisions:[{ by, decision, ts }] }
 * @param progress   readProgress(team) 또는 null
 * @param state      round.json — { round, milestone, phase, topic, attempt, startedAt }
 * @param cast       cast.json 의 agents
 * @param now        마감 시각(ms) — 막힌 것은 이 시점의 상태
 * @returns { problems: [{ kind, text, ref? }], counts: { rounds, verdicts, approvals, blocked }, md }
 *   problems 는 대표 손이 필요한 것만 — blocked(FAIL 방) · attempts(반박 상한) · approval(C 대기) · bossCall(답 없는 호출).
 *   B 대기·상황판 blocked[] 는 팀·톰 몫이라 "막힌 것" 절에만 선다.
 */
export function nightlyOf({ team, name = team, day, log = [], rounds = [], approvals = [], progress = null, state = {}, cast = {}, now = Date.now() } = {}) {
  const s = dayStartOf(day), u = s + 86_400_000;
  const inWin = (ts) => { const t = ms(ts); return Number.isFinite(t) && t >= s && t < u; };
  const nameOf = (a) => (a === 'boss' ? '대표' : cast[a]?.name ?? JUDGE_NAME[a] ?? a);

  // 라운드 — 그날 시작했거나 닫힌 것 + 마감 시점에 열려 있는 것("아직 열림" — 닫지 않는다, 7절)
  const rs = [...rounds].filter((r) => inWin(r.startedAt) || inWin(r.endedAt)).sort((a, b) => (a.round ?? 0) - (b.round ?? 0))
    .map((r) => `- ${r.round} · ${oneLine(r.topic, 60) || '(주제 없음)'}${r.milestone != null ? ` (${r.milestone}단계)` : ''} · ${r.verdict ?? '판정 없음'} · ${whenSeoul(r.startedAt, day)} ~ ${whenSeoul(r.endedAt, day)}`);
  const open = state?.phase && state.phase !== 'idle' && state.round && Number.isFinite(ms(state.startedAt)) && ms(state.startedAt) < u && !rounds.some((r) => r.round === state.round && r.endedAt);
  if (open) rs.push(`- ${state.round} · ${oneLine(state.topic, 60) || '(주제 없음)'}${state.milestone != null ? ` (${state.milestone}단계)` : ''} · 아직 열림 · ${whenSeoul(state.startedAt, day)} ~${state.phase === 'blocked' ? ' (FAIL 로 막힘)' : ''}`);

  // 판정 — 그날 판정 카드. 늦게 온 것(stale)은 라운드가 안 받았다
  // meta.target 은 판정받은 자리(guide) — 이름으로. 그 뒤는 판정문 첫 80자
  const vs = log.filter((e) => e.type === 'verdict' && inWin(e.ts) && !e.meta?.stale)
    .map((e) => `- ${hmSeoul(e.ts)} ${nameOf(e.actor)} ${e.meta?.verdict ?? '판정'}${e.meta?.engine ? ` (${e.meta.engine})` : ''}${e.meta?.target ? ` → ${nameOf(e.meta.target)}` : ''} — ${oneLine(e.text, 80)}`);

  // 승인 — 그날 올렸거나 판정된 것
  const as = approvals.filter((r) => inWin(r.ts) || inWin(r.decidedAt) || (r.decisions ?? []).some((d) => inWin(d.ts))).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    .map((r) => {
      const who = (r.decisions ?? []).map((d) => `${nameOf(d.by)} ${d.decision}`).join(' · ');
      const left = (APPROVAL_GRADES[r.grade]?.needs ?? []).filter((w) => !(r.decisions ?? []).some((d) => d.by === w)).map((w) => JUDGE_NAME[w] ?? w);
      const turn = r.status !== 'pending' ? '' : r.grade === 'C' ? '대표 차례' : `${left.join('·') || '톰·제리'} 차례`;
      return `- ${r.id} [${r.grade}] ${oneLine(r.what, 70)} — ${APPROVAL_WORD[r.status] ?? r.status}${turn ? ` (${turn})` : ''}${who ? ` (${who})` : ''}`;
    });

  // 막힌 것 — 마감 시점. 대표 손이 필요한 것만 problems 로
  const problems = [], blocked = [];
  const add = (text, kind = null, ref = null) => { blocked.push(text); if (kind) problems.push({ kind, text, ...(ref ? { ref } : {}) }); };
  if (state?.phase === 'blocked') add(`FAIL 로 막힘 — 라운드 ${state.round} 대표 판단 대기`, 'blocked');
  else if (state?.phase === 'running' && (state.attempt ?? 0) >= MAX_ATTEMPTS) add(`반박 ${MAX_ATTEMPTS}회 — 라운드 ${state.round} 대표 판단 대기`, 'attempts');
  for (const r of approvals) if (r.status === 'pending' && r.grade === 'C') add(`승인 [C] ${r.id} ${oneLine(r.what, 60)} — 대표 차례`, 'approval', r.id);
  const call = bossCallOf(log, cast);
  if (call && ms(call.ts) < u) { const e = log.find((x) => x.id === call.id); add(`${nameOf(call.by)}이 ${whenSeoul(call.ts, day)} 에 대표를 불렀는데 답이 없음 — "${oneLine(bossParagraph(e?.text, cast), 80)}"`, 'bossCall', call.id); }
  for (const r of approvals) if (r.status === 'pending' && r.grade === 'B') add(`승인 [B] ${r.id} ${oneLine(r.what, 60)} — 톰·제리 차례`);
  for (const l of progress?.blocked ?? []) add(`상황판 — ${oneLine(l, 120)}`);

  const next = (progress?.next ?? []).map((l) => `- ${oneLine(l, 160)}`);
  const head = problems.length ? [`문제 ${problems.length}건`, ...problems.map((p) => `- ${p.text}`)] : ['문제 없음 — 읽고 넘기셔도 됩니다.'];
  const md = [
    `# ${name} — ${day} 자정 마감`, '',
    `씀 ${dayKeySeoul(now)} ${hmSeoul(now)} · 기계가 모은 것만(대화록·rounds.jsonl·승인 큐·상황판). 사람 글은 없다.`, '',
    ...head, '',
    `## 라운드 ${rs.length}`, '', ...(rs.length ? rs : ['없음']), '',
    `## 판정 ${vs.length}`, '', ...(vs.length ? vs : ['없음']), '',
    `## 승인 ${as.length}`, '', ...(as.length ? as : ['없음']), '',
    `## 막힌 것 ${blocked.length}`, '', ...(blocked.length ? blocked.map((b) => `- ${b}`) : ['없음']), '',
    '## 다음', '', ...(next.length ? next : ['상황판에 다음이 없다']), '',
  ].join('\n');
  return { problems, counts: { rounds: rs.length, verdicts: vs.length, approvals: as.length, blocked: blocked.length }, md };
}

/**
 * 총괄실 한 장 = 대표용 (결정 45 ③ — 문제 없으면 읽고 넘기고, 문제면 그때 개입).
 * @param teams   [{ team, name, file, counts, problems }] — nightlyOf 결과에 파일 경로를 붙인 것
 * @param proxy   그날 대리 결정 줄(teams/hq/out/proxy-decisions.md 에서 날짜로 고른 것)
 * @param journal 톰의 자정 일지 문단(없으면 null)
 * @param late    자정에 못 쓰고 늦게 썼나(서버가 자정에 없었다)
 */
export function nightlyHqOf({ day, teams = [], proxy = [], journal = null, now = Date.now(), late = false } = {}) {
  const problems = teams.flatMap((t) => (t.problems ?? []).map((p) => ({ ...p, team: t.team, name: t.name, file: t.file ?? null })));
  const head = problems.length
    ? [`문제 ${problems.length}건 — 대표님 손이 필요합니다.`, ...problems.map((p) => `- ${p.name} — ${p.text}${p.file ? ` (${p.file})` : ''}`)]
    : ['문제 없음 — 읽고 넘기셔도 됩니다.'];
  const rows = teams.map((t) => `- ${t.name} — 라운드 ${t.counts?.rounds ?? 0} · 판정 ${t.counts?.verdicts ?? 0} · 승인 ${t.counts?.approvals ?? 0} · 막힌 것 ${t.counts?.blocked ?? 0}${t.file ? ` → ${t.file}` : ''}`);
  const md = [
    `# 자정 마감 — ${day}`, '',
    `대표님께 한 장. 씀 ${dayKeySeoul(now)} ${hmSeoul(now)}${late ? ' — 자정에 서버가 없어 늦게 썼습니다(막힌 것은 쓴 시점 기준)' : ''}. 팀 장은 각 팀 out/nightly/${day}.md.`, '',
    ...head, '',
    '## 대표님 대신 정한 것', '', ...(proxy.length ? proxy : ['없음']), '',
    '## 팀마다', '', ...(rows.length ? rows : ['없음']), '',
    '## 톰의 자정 일지', '', journal ? String(journal).trim() : '없음 — 톰이 답하지 않았습니다(총괄실 안내 참고)', '',
  ].join('\n');
  return { problems, md };
}

/** proxy-decisions.md 에서 그날 줄만 — "- 2026-09-14 04:04 · …" 꼴. 순수. */
export function proxyLinesOf(md, day) {
  return String(md ?? '').split('\n').filter((l) => l.startsWith(`- ${day} `));
}

/** 총괄실 자정 일지 지시문 — bus.journalPrompt 와 같은 문장, 라운드 대신 날짜. 총괄실은 라운드가 없어 일지가 한 번도 안 걷혔다. */
export const nightlyJournalPrompt = (day) => `${TURN_JOURNAL} ${day} 하루가 끝난다. 네 말투로 한 문단(3~6줄)을 써라. 첫 문장은 네가 누구인지 한 줄("나는 …" — 이름·기질·지금 마음가짐), 그다음 오늘 배운 것·판단한 이유·버린 시도·막힌 곳·사람들과 있었던 일. 파일 이름·완료율·다음 할 일 목록은 쓰지 마라 — 그건 git 이 안다. 남길 일이 없어도 첫 문장은 쓴다.`;
