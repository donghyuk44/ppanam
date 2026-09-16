// 알림 목록 (대표 결정 68 — "배지만 있고 내용이 없으면 대충 구현"). 종을 누르면 이 목록이 패널로 열린다.
// DOM 없이 값만 다룬다. 화면(app.js)과 자가 시험(bus/round.mjs check)이 같은 것을 쓴다. 새 저장소는 없다 —
// 부팅·방송으로 이미 온 팀 요약(bossCall·needsBoss·people·bossNotes)과 승인 대기 목록에서 만든다. 계약은 docs/event-schema.md 3절 "알림 패널".

import { findOutPaths } from './outlink.js';
import { bossOk } from './bosswords.js';   // 종 목록 글도 결정 140 자를 지난다(사용성-0916 표 6, 34회차)

/** 종류 순서 — 대표 차례(빨강) → 승인 대기 → 막힘 → 보고. */
export const KIND_ORDER = ['boss', 'approval', 'blocked', 'report'];
/** 급한 종류 — 안 읽은 것이 하나라도 있으면 종이 빨갛다. 보고는 아니다. */
export const URGENT = new Set(['boss', 'approval', 'blocked']);
// 글자는 하영 사전 3-1 "왜 멈췄나" 표 그대로(app.js BOSS_WHY 와 같은 글자) — 결정 43 ⑥.
export const BOSS_WHY = { blocked: '대표님 답을 기다려요 — 검토에서 멈춤이 났어요', attempts: '대표님 답을 기다려요 — 세 번 고쳐도 안 돼서요', silent: '하루 넘게 아무 말이 없어요' };

const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const firstImage = (text, team) => findOutPaths(text, team).find((f) => f.kind === 'image')?.url ?? null;

/** 위임(state/delegation.json, 결정 136)이 지금 살아 있나 — bus.delegationActive 와 같은 식(브라우저 파일). until 이 지나면 파일이 있어도 아니다. */
// until 이 없으면 끝 시각 없는 위임(결정 188 — "내가 멈추라고 하기 전까지는 나리 대리 승인 유지"). 있으면 그때까지(옛 12시간 창·안전핀).
export const delegated = (d, now = Date.now()) => !!d?.to && (d.until == null || (Number.isFinite(Date.parse(d.until)) && now < Date.parse(d.until)));
/** 결재를 보는 둘의 이름 — 평소 톰·제리, 위임 중(to:'system', 대표 09-16 "대리 판단은 나리")엔 나리·제리. 띠·패널·팝업이 같은 말을 쓴다. */
export const deciders = (d, now = Date.now()) => (delegated(d, now) && d.to === 'system' ? '나리·제리' : '톰·제리');

/**
 * @param teams      [{ id, name, room }]
 * @param summaries  { [팀]: 팀 요약 } — bossCall { id, ts, by, forbidden } · needsBoss · needsBossWhy · people[자리].bossCall { id, ts, text } · bossNotes[] · cast
 * @param approvals  대기 중인 승인 [{ id, grade, team, by, what, ts, proxyable }] — proxyable 은 서버가 bus.proxyEligible 로 잰 것(돈·바깥이 아니라 대리 가능)
 * @param read       읽은 항목 id 집합 (브라우저 localStorage)
 * @param delegation boot 의 위임 { to, until, decision } 또는 null
 * @returns { items, unread, urgent } — items 는 종류 순, 같은 종류 안은 최근 것부터. 항목마다 `mine` = 대표 손이 필요한 것.
 *   배지 숫자(unread)와 빨강(urgent)은 **mine 인 것만 센다**(나리 결정 ②, 09-15 — "배지 숫자는 대표님이 눌러야 하는 것만"): 보고·B 카드는 패널에 두되
 *   숫자에서 빼고, 위임 중이면 돈·바깥(대리 못 하는 C·물음)만 남는다 — 나머지 C·물음·FAIL 은 톰·제리가 대리한다(결정 85·136).
 */
export function notificationsOf({ teams = [], summaries = {}, approvals = [] } = {}, { read = new Set(), delegation = null, now = Date.now() } = {}) {
  const items = [];
  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (team, actor) => summaries[team]?.cast?.[actor]?.name ?? actor;
  const dg = delegated(delegation, now);

  for (const t of teams) {
    const s = summaries[t.id];
    if (!s) continue;
    // 대표 차례 — 결정을 청했는데 대표가 아직 답하지 않은 말 (결정 52·66). 인용문은 people 쪽에 있다. 위임 중엔 돈·바깥(forbidden)만 대표 손.
    if (s.bossCall) {
      const quote = s.people?.[s.bossCall.by]?.bossCall?.text ?? '';
      items.push({ id: `boss:${s.bossCall.id}`, kind: 'boss', team: t.id, by: s.bossCall.by, name: nameOf(t.id, s.bossCall.by), mine: !dg || !!s.bossCall.forbidden,
        text: (bossOk(oneLine(quote, 80)) ? oneLine(quote, 80) : '') || `${nameOf(t.id, s.bossCall.by)} 불렀습니다`, ts: s.bossCall.ts, thumb: firstImage(quote, t.id),   // 인용이 자에 안 맞으면 "누가 불렀습니다" 만(표 6)
        target: { view: 'room', team: t.id, event: s.bossCall.id } });
    }
    // 막힘 — 상태라 이벤트 id 가 없다. 팀당 하나, 시각은 마지막 발언. 위임 중엔 톰·제리가 푼다(FAIL 풀기 10분 규칙).
    if (s.needsBoss) {
      items.push({ id: `blocked:${t.id}`, kind: 'blocked', team: t.id, by: null, name: t.room ?? t.name, mine: !dg,
        text: BOSS_WHY[s.needsBossWhy] ?? '대표님 답을 기다려요', ts: s.lastSpokeAt ?? s.lastAt ?? null, thumb: null,
        target: { view: 'room', team: t.id, event: null } });
    }
    // 보고 — 오늘 대표를 불렀지만 결정을 청한 건 아닌 말. 읽을 것이지 누를 것이 아니다 — 숫자엔 안 든다.
    for (const n of s.bossNotes ?? []) {
      if (n.ask) continue;
      items.push({ id: `report:${n.id}`, kind: 'report', team: t.id, by: n.by, name: nameOf(t.id, n.by), mine: false,
        text: oneLine(n.text, 160), ts: n.ts, thumb: firstImage(n.text, t.id), target: { view: 'room', team: t.id, event: n.id } });
    }
  }
  // 승인 대기 — C 는 대표(위임 중엔 대리 못 하는 돈·바깥만), B 는 톰·제리 몫이라 패널엔 두되 숫자엔 안 든다.
  // 패널도 배지와 같은 잣대(나리 usability-0916 U4): 대표 손이 필요한 카드(mine)만 한 줄씩 — 무엇 · 누가(name) · 언제까지(10분 안 / 대표님만).
  // 나머지(B, 위임 중 대리될 C)는 원문째 늘어놓지 않고 "톰·제리가 보는 중 N건" 한 줄로 접는다 — 누르면 결재 띠로(첫 화면 띠도 같은 한 줄, U3).
  const theirs = [];
  for (const r of approvals) {
    if (r.grade !== 'C' && r.grade !== 'B') continue;
    const mine = r.grade === 'C' && (!dg || r.proxyable === false);
    if (!mine) { theirs.push(r); continue; }
    const until = r.proxyable === false ? ' · 대표님만' : '';   // 대리 못 하는 돈·바깥은 대표만. '10분 안' 은 뺐다(결정 188 — 시간 약속은 없다)
    // 무엇 — --boss 한 줄이 자에 맞으면 그것, 아니면 원문을 재고, 둘 다 아니면 '{팀} 결재'(카드 제목과 같은 규칙, opus ④)
    const what = [r.boss, oneLine(r.what, 100)].map((v) => String(v ?? '').trim()).find((v) => v && bossOk(v)) ?? `${byTeam.get(r.team)?.name ?? r.team} 결재`;
    items.push({ id: `approval:${r.id}`, kind: 'approval', team: r.team, by: r.by, name: nameOf(r.team, r.by), mine: true,
      text: `${what}${until}`, ts: r.ts, thumb: firstImage(r.what, r.team), target: { view: 'tower', team: r.team, approval: r.id } });
  }
  if (theirs.length) {
    const office = byTeam.has('hq') ? 'hq' : theirs[0].team;   // 보는 사람은 총괄실
    const pair = deciders(delegation, now);
    items.push({ id: 'approval:theirs', kind: 'approval', team: office, by: null, name: pair, mine: false,
      text: `${pair}가 보는 중 ${theirs.length}건`, ts: theirs.map((r) => r.ts).sort().at(-1) ?? null, thumb: null, target: { view: 'tower', team: office, approval: null } });
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
  // 숫자·빨강은 대표 손이 필요한 것(mine)만 — 보고·B·대리될 것은 패널에만(나리 결정 ②)
  const unread = items.filter((it) => it.unread && it.mine).length;
  const urgent = items.some((it) => it.unread && it.mine && URGENT.has(it.kind));
  return { items, unread, urgent };
}

/** 밑바닥 항목의 이름 — infra 키 → 사람 말. */
export const INFRA_LABEL = { server: '서버', codex: '외부 감사(codex) 연결', sessions: '세션', disk: '디스크' };
/** 잰 시각이 지금보다 이만큼 넘게 앞서면 시계가 틀린 것 — unknown. */
export const INFRA_SKEW_MS = 60_000;
/** 자리표시 줄 — bus.isPlaceholderLine 과 같은 식(브라우저 파일이라 못 불러온다). 바꾸면 둘 다. */
export const PLACEHOLDER_RE = /^\s*[(（]?\s*(없음|없어요|없다|n\/a|none|-|—|·)\s*[)）]?\s*[.。]?(\s*[—\-–:·,].*)?\s*$/i;

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
/** a~b 사이 멈춰 있던 ms — bus.pausedMs 와 같은 식(브라우저 파일). pauses = state/pauses.json (boot.pauses). */
/** ms 또는 ISO — boot.pauses 는 서버 readPauses 가 이미 ms 로 바꾼 것이라 Date.parse(숫자) 는 NaN 이 된다(나리 실측 09-15 23:22: 보고서에 "쉰 시간" 줄이 안 섰다). */
const msOf = (v) => (typeof v === 'number' ? v : Date.parse(v));
export function pausedMs(a, b, pauses = []) {
  const s = msOf(a), e = msOf(b);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  let sum = 0;
  for (const p of pauses) { const f = msOf(p.from), t = msOf(p.to); if (Number.isFinite(f) && Number.isFinite(t)) sum += Math.max(0, Math.min(e, t) - Math.max(s, f)); }
  return sum;
}

export function blockedOf({ teams = [], summaries = {}, approvals = [], requests = [], infra = null } = {}, { now = Date.now(), pauses = [] } = {}) {
  const items = [];
  const byTeam = new Map(teams.map((t) => [t.id, t]));
  const teamName = (id) => byTeam.get(id)?.name ?? id ?? '';
  const nameOf = (team, actor) => summaries[team]?.cast?.[actor]?.name ?? actor;
  // wait 는 멈춘 구간(대표가 쉬어라 한 시간)을 뺀 것 — 하루 멈춤이 '33시간째' 로 섰다(톰 09-15)
  const push = (it) => items.push({ ...it, teamName: teamName(it.team), since: it.since ?? null, wait: it.since ? Math.max(0, now - new Date(it.since).getTime() - pausedMs(it.since, now, pauses)) : null });

  for (const t of teams) {
    const s = summaries[t.id];
    if (!s) continue;
    // 총괄실·비서실(office)은 대표와 1:1 이라 거기서 대표를 부르는 건 대화지 "기다림" 이 아니다 — 톰이 대표께 나리 얘기 한 것이 46분째 막힘으로 섰다(나리 실측 R25). 결정이 필요한 건 승인 큐에 있다.
    if (s.bossCall && t.kind !== 'office') {
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
      if (PLACEHOLDER_RE.test(String(line))) continue;   // "(없음)" 은 막힌 것이 아니다(서버도 normalizeProgress 에서 거른다 — 옛 요약이 올 때를 위해 여기서도)
      push({ id: `board:${t.id}:${i}`, kind: 'board', where: 'board', team: t.id, by: 'guide', waitOn: { team: t.id, actor: 'guide' }, state: null,
        text: oneLine(line, 160), since: s.progress?.at ?? null, target: { view: 'room', team: t.id, event: null } });
    }
  }
  for (const r of approvals) {
    if (r.grade !== 'C' && r.grade !== 'B') continue;
    push({ id: `approval:${r.id}`, kind: 'approval', where: 'approval', team: r.team, by: r.by, waitOn: r.grade === 'C' ? 'boss' : 'chief', state: r.grade,
      text: `${r.grade === 'C' ? '결재 대기' : '총괄이 봄'} · ${oneLine(r.what, 120)}`, since: r.ts, target: { view: 'tower', team: r.team, approval: r.id } });   // 사전 1절 120행·0-3 폴드7 QA 표(#20): 등급 글자 [B] 대신 사람 말
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
