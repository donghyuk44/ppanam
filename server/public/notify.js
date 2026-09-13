// 알림 목록 (대표 결정 68 — "배지만 있고 내용이 없으면 대충 구현"). 종을 누르면 이 목록이 패널로 열린다.
// DOM 없이 값만 다룬다. 화면(app.js)과 자가 시험(bus/round.mjs check)이 같은 것을 쓴다. 새 저장소는 없다 —
// 부팅·방송으로 이미 온 팀 요약(bossCall·needsBoss·people·bossNotes)과 승인 대기 목록에서 만든다. 계약은 docs/event-schema.md 3절 "알림 패널".

import { findOutPaths } from './outlink.js';

/** 종류 순서 — 대표 차례(빨강) → 승인 대기 → 막힘 → 보고. */
export const KIND_ORDER = ['boss', 'approval', 'blocked', 'report'];
/** 급한 종류 — 안 읽은 것이 하나라도 있으면 종이 빨갛다. 보고는 아니다. */
export const URGENT = new Set(['boss', 'approval', 'blocked']);
export const BOSS_WHY = { blocked: '대표 결정 기다리는 중 (FAIL)', attempts: '고쳐 오기 3번 다 씀', silent: '하루 넘게 말이 없음' };

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
        text: BOSS_WHY[s.needsBossWhy] ?? '대표 판단', ts: s.lastSpokeAt ?? s.lastAt ?? null, thumb: null,
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
  for (const it of items) { it.unread = !read.has(it.id); it.teamName = byTeam.get(it.team)?.name ?? it.team; }
  const unread = items.filter((it) => it.unread).length;
  const urgent = items.some((it) => it.unread && URGENT.has(it.kind));
  return { items, unread, urgent };
}
