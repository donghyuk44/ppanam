// 알림 목록 (대표 결정 68 — "배지만 있고 내용이 없으면 대충 구현"). 종을 누르면 이 목록이 패널로 열린다.
// DOM 없이 값만 다룬다. 화면(app.js)과 자가 시험(bus/round.mjs check)이 같은 것을 쓴다. 새 저장소는 없다 —
// 부팅·방송으로 이미 온 팀 요약(bossCall·needsBoss·people·bossNotes)과 승인 대기 목록에서 만든다. 계약은 docs/event-schema.md 3절 "알림 패널".

import { findOutPaths } from './outlink.js';

/** 종류 순서 — 대표 차례(빨강) → 승인 대기 → 막힘 → 보고. */
export const KIND_ORDER = ['boss', 'approval', 'blocked', 'report'];
/** 급한 종류 — 안 읽은 것이 하나라도 있으면 종이 빨갛다. 보고는 아니다. */
export const URGENT = new Set(['boss', 'approval', 'blocked']);
// 글자는 하영 사전 3-1 "왜 멈췄나" 표 그대로(app.js BOSS_WHY 와 같은 글자) — 결정 43 ⑥.
export const BOSS_WHY = { blocked: '대표님 답을 기다려요 — 검토에서 멈춤이 났어요', attempts: '대표님 답을 기다려요 — 세 번 고쳐도 안 돼서요', silent: '하루 넘게 아무 말이 없어요' };

const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const firstImage = (text, team) => findOutPaths(text, team).find((f) => f.kind === 'image')?.url ?? null;

/**
 * @param teams      [{ id, name, room }]
 * @param summaries  { [팀]: 팀 요약 } — bossCall { id, ts, by } · needsBoss · needsBossWhy · people[자리].bossCall { id, ts, text } · bossNotes[] · cast
 * @param approvals  대기 중인 승인 [{ id, grade, team, by, what, ts }]
 * @param read       읽은 항목 id 집합 (브라우저 localStorage)
 * @returns { items, unread, urgent } — items 는 종류 순, 같은 종류 안은 최근 것부터
 */
export function notificationsOf({ teams = [], summaries = {}, approvals = [] } = {}, { read = new Set() } = {}) {
  const items = [];
  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (team, actor) => summaries[team]?.cast?.[actor]?.name ?? actor;

  for (const t of teams) {
    const s = summaries[t.id];
    if (!s) continue;
    // 대표 차례 — 결정을 청했는데 대표가 아직 답하지 않은 말 (결정 52·66). 인용문은 people 쪽에 있다.
    if (s.bossCall) {
      const quote = s.people?.[s.bossCall.by]?.bossCall?.text ?? '';
      items.push({ id: `boss:${s.bossCall.id}`, kind: 'boss', team: t.id, by: s.bossCall.by, name: nameOf(t.id, s.bossCall.by),
        text: oneLine(quote, 80) || `${nameOf(t.id, s.bossCall.by)} 불렀습니다`, ts: s.bossCall.ts, thumb: firstImage(quote, t.id),
        target: { view: 'room', team: t.id, event: s.bossCall.id } });
    }
    // 막힘 — 상태라 이벤트 id 가 없다. 팀당 하나, 시각은 마지막 발언.
    if (s.needsBoss) {
      items.push({ id: `blocked:${t.id}`, kind: 'blocked', team: t.id, by: null, name: t.room ?? t.name,
        text: BOSS_WHY[s.needsBossWhy] ?? '대표님 답을 기다려요', ts: s.lastSpokeAt ?? s.lastAt ?? null, thumb: null,
        target: { view: 'room', team: t.id, event: null } });
    }
    // 보고 — 오늘 대표를 불렀지만 결정을 청한 건 아닌 말.
    for (const n of s.bossNotes ?? []) {
      if (n.ask) continue;
      items.push({ id: `report:${n.id}`, kind: 'report', team: t.id, by: n.by, name: nameOf(t.id, n.by),
        text: oneLine(n.text, 160), ts: n.ts, thumb: firstImage(n.text, t.id), target: { view: 'room', team: t.id, event: n.id } });
    }
  }
  // 승인 대기 — 대표가 판정할 C 만. B 는 톰·제리 몫이라 관제탑 요청 탭에 있다.
  for (const r of approvals) {
    if (r.grade !== 'C') continue;
    items.push({ id: `approval:${r.id}`, kind: 'approval', team: r.team, by: r.by, name: nameOf(r.team, r.by),
      text: `승인 [C] ${oneLine(r.what, 120)}`, ts: r.ts, thumb: firstImage(r.what, r.team), target: { view: 'tower', team: r.team, approval: r.id } });
  }

  const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  items.sort((a, b) => rank(a.kind) - rank(b.kind) || String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
  for (const it of items) { it.unread = !read.has(it.id); it.teamName = byTeam.get(it.team)?.name ?? it.team; it.teams = [it.team]; }
  // 총괄실에서 다른 방 사람을 부른 말은 그 방에도 같은 글로 남는다(conductor.crossPost) — 대표 눈엔 같은 알림 둘. 같은 사람의 같은 글은 한 줄로,
  // 방 이름은 "개발·총괄" 처럼 나란히(하네스 실측 R23 ①). 먼저 온 것(정렬상 앞)이 남고 읽음은 남은 id 기준.
  const seen = new Map();
  const merged = [];
  for (const it of items) {
    const key = it.kind === 'boss' || it.kind === 'report' ? `${it.kind}|${it.by}|${it.text}` : null;
    const first = key && seen.get(key);
    if (first) { if (!first.teams.includes(it.team)) { first.teams.push(it.team); first.teamName = first.teams.map((t) => byTeam.get(t)?.name ?? t).join('·'); } continue; }
    if (key) seen.set(key, it);
    merged.push(it);
  }
  items.length = 0; items.push(...merged);
  const unread = items.filter((it) => it.unread).length;
  const urgent = items.some((it) => it.unread && URGENT.has(it.kind));
  return { items, unread, urgent };
}

/** 밑바닥 항목의 이름 — infra 키 → 사람 말. */
export const INFRA_LABEL = { server: '서버', codex: '외부 감사(codex) 연결', sessions: '세션', disk: '디스크' };
/** 잰 시각이 지금보다 이만큼 넘게 앞서면 시계가 틀린 것 — unknown. */
export const INFRA_SKEW_MS = 60_000;

/**
 * 막힌 것 — 한 목록 (결정 92 "뭐가 막혔나", M6 준비). 계약은 docs/event-schema.md 3절 "막힌 것 — 한 목록".
 * "대표 차례" 를 세는 코드가 셋(bossTurns · notificationsOf · 팀 줄 알약)이라 3 이냐 5 냐가 갈렸다(findings #6) — 새 화면·보고서 탭은 이것 하나를 자른다.
 * 값만 받는다 — 서버가 밖에서 재서 넘긴다(peopleOf 와 같은 경계). 화면과 round.mjs check 가 같은 함수를 쓴다.
 *
 * @param teams      [{ id, name, room }]
 * @param summaries  { [팀]: 팀 요약 } — bossCall · needsBoss · needsBossWhy · lastSpokeAt · people[자리].bossCall · progress · cast
 * @param approvals  대기 중인 승인 [{ id, grade, team, by, what, ts }] — C 는 대표, B 는 톰·제리
 * @param requests   요청 블록 [{ id, from:{team,actor}, to:{team,actor}, what, status, updatedAt }] — 닫힌 것은 건너뛴다
 * @param infra      { server, codex, sessions, disk } — 각 { ok, at, timeout(ms), detail }. 없으면 항목 없음(안 잰 것은 막힘이 아니다)
 * @returns 항목 [{ id, kind, where, team, teamName, by, waitOn, text, since, wait, state, target }] — since 오름차순(오래 기다린 것이 위)
 */
export function blockedOf({ teams = [], summaries = {}, approvals = [], requests = [], infra = null } = {}, { now = Date.now() } = {}) {
  const items = [];
  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const teamName = (id) => byTeam.get(id)?.name ?? id ?? '';
  const nameOf = (team, actor) => summaries[team]?.cast?.[actor]?.name ?? actor;
  const push = (it) => items.push({ ...it, teamName: teamName(it.team), since: it.since ?? null, wait: it.since ? Math.max(0, now - new Date(it.since).getTime()) : null });

  for (const t of teams) {
    const s = summaries[t.id];
    if (!s) continue;
    if (s.bossCall) {
      const quote = s.people?.[s.bossCall.by]?.bossCall?.text ?? '';
      push({ id: `boss:${s.bossCall.id}`, kind: 'boss', where: 'room', team: t.id, by: s.bossCall.by, waitOn: 'boss', state: null,
        text: oneLine(quote, 80) || `${nameOf(t.id, s.bossCall.by)} 불렀습니다`, since: s.bossCall.ts,
        target: { view: 'room', team: t.id, event: s.bossCall.id } });
    }
    if (s.needsBoss) {
      push({ id: `blocked:${t.id}`, kind: 'blocked', where: 'room', team: t.id, by: null, waitOn: 'boss', state: s.needsBossWhy ?? null,
        text: BOSS_WHY[s.needsBossWhy] ?? '대표님 답을 기다려요', since: s.lastSpokeAt ?? s.lastAt ?? null,
        target: { view: 'room', team: t.id, event: null } });
    }
    for (const [i, line] of (s.progress?.blocked ?? []).entries()) {
      push({ id: `board:${t.id}:${i}`, kind: 'board', where: 'board', team: t.id, by: 'guide', waitOn: { team: t.id, actor: 'guide' }, state: null,
        text: oneLine(line, 160), since: s.progress?.at ?? null, target: { view: 'room', team: t.id, event: null } });
    }
  }
  for (const r of approvals) {
    if (r.grade !== 'C' && r.grade !== 'B') continue;
    push({ id: `approval:${r.id}`, kind: 'approval', where: 'approval', team: r.team, by: r.by, waitOn: r.grade === 'C' ? 'boss' : 'chief', state: r.grade,
      text: `승인 [${r.grade}] ${oneLine(r.what, 120)}`, since: r.ts, target: { view: 'tower', team: r.team, approval: r.id } });
  }
  // 요청 블록 — 상태가 곧 누구 차례인지다(bus/requests.mjs foldRequest): open 은 받는 쪽(done 을 내야), done 은 요청한 쪽(ack), acked 는 톰(confirm).
  for (const r of requests) {
    if (!r || r.status === 'closed') continue;
    const waitOn = r.status === 'open' ? r.to : r.status === 'done' ? r.from : 'chief';
    const who = waitOn === 'chief' ? '톰' : nameOf(waitOn?.team, waitOn?.actor);
    push({ id: `request:${r.id}`, kind: 'request', where: 'request', team: r.status === 'done' ? r.from?.team : r.to?.team, by: r.from?.actor ?? null, waitOn, state: r.status,
      text: `${who} 차례 — ${oneLine(r.what, 100)}`, since: r.updatedAt ?? r.ts ?? null, target: { view: 'tower', team: r.to?.team, request: r.id } });
  }
  // 밑바닥 — 잰 값이 없으면 항목도 없다. 시각이 timeout 보다 오래되면 ok 가 무엇이든 '모름'(마지막 성공값이 산 것처럼 남지 않게, 레오 R25).
  for (const key of Object.keys(INFRA_LABEL)) {
    const m = infra?.[key];
    if (!m) continue;
    const at = m.at ? new Date(m.at).getTime() : NaN;
    // 미래 시각도 unknown — 시계가 크게 틀린 뒤 영원히 살아 있는 값이 된다(레오). 허용 시차는 INFRA_SKEW_MS 하나.
    const stale = !Number.isFinite(at) || !(m.timeout > 0) || now - at > m.timeout || at - now > INFRA_SKEW_MS;
    if (!stale && m.ok === true) continue;
    const state = stale ? 'unknown' : 'down';
    const ago = Number.isFinite(at) ? `${Math.max(1, Math.round((now - at) / 60_000))}분째` : '시각 없음';
    push({ id: `infra:${key}`, kind: 'infra', where: 'infra', team: null, by: null, waitOn: 'ops', state,
      text: state === 'unknown' ? `${INFRA_LABEL[key]} — 못 잼 (${ago})${m.detail ? ' · ' + oneLine(m.detail, 80) : ''}` : `${INFRA_LABEL[key]} 죽음${m.detail ? ' — ' + oneLine(m.detail, 80) : ''}`,
      since: Number.isFinite(at) ? new Date(at).toISOString() : null, target: { view: 'tower', team: null } });
  }
  items.sort((a, b) => String(a.since ?? '9').localeCompare(String(b.since ?? '9')));   // since 없는 것은 맨 뒤
  return items;
}
