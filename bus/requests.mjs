// 요청 블록 — 팀이 팀에게 직접 (대표 결정 45 ①·49·51·47). 계약은 docs/event-schema.md 6-1절.
//
// 요청 하나 = 블록 하나 = state/requests/<id>.jsonl 한 파일. 대화록·승인 큐처럼 append-only 다 — 줄을 쌓고 읽을 때 접는다.
// 블록은 승인(B, --to) 이 통과할 때 서버(notifier)가 연다. 그 뒤로는 세 자리(요청 작업자·받는 작업자·톰)만 줄을 쓴다.
// 접기(foldRequest)는 파일을 안 읽는 순수 함수라 `round.mjs check` 가 돌려본다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, emit, readState, parseJSONL, roomRules } from './bus.mjs';

export const REQUESTS_DIR = path.join(ROOT, 'state', 'requests');

/** 줄의 kind — 누가 쓸 수 있나. 서버 몫(open·close)은 CLI 로 못 쓴다. */
export const LINE_KINDS = {
  open:    { who: 'server' },
  goal:    { who: 'chief' },
  say:     { who: 'any' },
  done:    { who: 'to' },
  ack:     { who: 'from' },
  confirm: { who: 'chief' },
  stop:    { who: 'chief' },
  close:   { who: 'server' },
};
export const CLOSERS = new Set(['confirm', 'stop', 'close']);

const idOf = () => 'req_' + crypto.randomBytes(4).toString('hex');
const fileOf = (id) => path.join(REQUESTS_DIR, `${id}.jsonl`);
const same = (a, b) => !!a && !!b && a.team === b.team && a.actor === b.actor;

/**
 * 줄들을 접어 블록 하나로. 순수 함수.
 * status: open → (done 뒤) done → (ack 뒤) acked → (confirm·stop·close 뒤) closed.
 * milestone 모드는 done·ack 이 와도 closed 가 아니다 — 마일스톤이 닫히거나 톰이 확인·끊을 때만.
 */
export function foldRequest(lines) {
  const open = lines.find((l) => l.kind === 'open');
  if (!open) return null;
  const r = {
    id: open.id, ts: open.ts, approval: open.approval ?? null,
    from: open.from, to: open.to, what: open.what, why: open.why ?? '', due: open.due ?? null,
    mode: open.mode ?? 'once', until: open.until ?? null,
    goal: null, status: 'open', closedBy: null, closedAt: null, updatedAt: open.ts,
    thread: [],   // goal·say·done·ack·confirm·stop·close — 시간순, { kind, ts, by, text }
    lines: 0,
  };
  for (const l of lines) {
    r.lines += 1;
    if (l.kind === 'open') continue;
    if (!LINE_KINDS[l.kind]) continue;
    r.thread.push({ kind: l.kind, ts: l.ts, by: l.by ?? null, text: l.text ?? '' });
    r.updatedAt = l.ts;
    if (r.status === 'closed') continue;   // 닫힌 뒤의 줄은 남지만 상태를 안 바꾼다
    if (l.kind === 'goal') r.goal = l.text ?? '';
    else if (l.kind === 'done' && r.status === 'open') r.status = 'done';
    else if (l.kind === 'ack' && r.status === 'done') r.status = 'acked';
    else if (CLOSERS.has(l.kind)) { r.status = 'closed'; r.closedBy = l.kind; r.closedAt = l.ts; }
  }
  return r;
}

/**
 * 자리가 블록의 어느 쪽들인가 — 'from' · 'to' · 'chief' 의 집합(빈 집합 = 바깥). 톰은 hq 의 chief 이면서 총괄실이 받는 부탁(to: hq/chief)의 받는 쪽이기도 하다 —
 * 전엔 chief 하나만 돌려줘 톰이 자기 앞으로 온 부탁에 '됐다'(done) 를 못 쓰고 블록을 못 닫았다(나리 9단계 ④ "총괄실이 받는 부탁을 실장이 닫을 수 있게").
 */
export function rolesOf(r, who) {
  const out = new Set();
  if (!who) return out;
  if (who.team === 'hq' && who.actor === 'chief') out.add('chief');
  if (same(r.from, who)) out.add('from');
  if (same(r.to, who)) out.add('to');
  return out;
}
/** 대표 자리 하나 — from · to · chief · null. 글에 쓸 때(누구로서 말했나). */
export function roleOf(r, who) {
  const s = rolesOf(r, who);
  return s.has('from') ? 'from' : s.has('to') ? 'to' : s.has('chief') ? 'chief' : null;
}

/** 이 줄을 이 자리가 쓸 수 있나 — 못 쓰면 이유 문장, 되면 null. 순수 함수. */
export function lineError(r, kind, who) {
  const k = LINE_KINDS[kind];
  if (!k) return `모르는 줄: ${kind}`;
  if (k.who === 'server') return `${kind} 는 서버가 쓰는 줄입니다.`;
  if (r.status === 'closed') return `${r.id} 는 닫힌 블록입니다 (${r.closedBy}).`;
  const roles = rolesOf(r, who);
  if (!roles.size) return `${who?.team ?? '?'}/${who?.actor ?? '?'} 는 이 블록의 세 자리(${r.from.team}/${r.from.actor} · ${r.to.team}/${r.to.actor} · hq/chief) 밖입니다.`;
  if (k.who !== 'any' && !roles.has(k.who)) return `${kind} 는 ${{ chief: '톰(총괄)', from: '요청한 작업자', to: '받는 작업자' }[k.who]}만 씁니다. 너는 ${roleOf(r, who)} 이다.`;
  if (kind === 'ack' && r.status !== 'done') return `아직 '됐다'(done) 가 없습니다 — 받는 쪽이 먼저 냅니다.`;
  if (kind === 'confirm' && r.mode === 'once' && r.status !== 'acked') return `됐다·받았다 뒤에 확인합니다 (지금 ${r.status}).`;
  return null;
}

/* ── 파일 ── */

function readLines(id) {
  try { return parseJSONL(fs.readFileSync(fileOf(id), 'utf8')); } catch { return []; }
}
function appendLine(id, line) {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
  fs.appendFileSync(fileOf(id), JSON.stringify(line) + '\n');
}

export function readRequest(id) {
  if (!/^req_[0-9a-f]{8}$/.test(String(id ?? ''))) return null;
  return foldRequest(readLines(id));
}

/** 접은 블록 목록 — 최근에 움직인 것부터. team 을 주면 그 팀이 요청했거나 받은 것만. */
export function listRequests({ team = null, status = null } = {}) {
  let ids = [];
  try { ids = fs.readdirSync(REQUESTS_DIR).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)); } catch { return []; }
  let out = ids.map(readRequest).filter(Boolean);
  if (team) out = out.filter((r) => r.from.team === team || r.to.team === team);
  if (status) out = out.filter((r) => r.status === status);
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 팀 요약에 싣는 두 수 — 그 팀이 요청했거나 받은 블록 중 열린 것·닫힌 것. */
export function requestCounts(team) {
  const rows = listRequests({ team });
  return { open: rows.filter((r) => r.status !== 'closed').length, closed: rows.filter((r) => r.status === 'closed').length };
}

/**
 * 블록 열기 — 통과한 승인(action.type 'request') 에서. 서버(notifier)만 부른다.
 * 두 방에 시작 note 한 줄씩. 같은 승인으로 두 번 열지 않는다.
 */
export function openRequest(approval) {
  const a = approval.action ?? {};
  if (a.type !== 'request' || !a.to?.team) throw new Error('요청 블록 행동이 아닙니다.');
  const dup = listRequests().find((r) => r.approval === approval.id);
  if (dup) return dup;
  const id = idOf();
  const line = {
    kind: 'open', id, ts: new Date().toISOString(), approval: approval.id,
    from: { team: approval.team, actor: approval.by ?? 'guide' },
    to: { team: a.to.team, actor: a.to.actor ?? 'guide' },
    what: approval.what, why: a.why ?? '', due: a.due ?? null,
    mode: a.mode === 'milestone' ? 'milestone' : 'once',
    ...(a.mode === 'milestone' && a.until ? { until: a.until } : {}),
  };
  appendLine(id, line);
  const text = `요청 블록 ${id} 열림 — ${line.from.team}/${line.from.actor} → ${line.to.team}/${line.to.actor}: ${line.what}` +
    (line.mode === 'milestone' ? ` (마일스톤 ${line.until?.milestone ?? '?'} 끝까지 — 공동 프로젝트)` : '');
  const meta = { request: id, status: 'open', approval: approval.id };
  for (const team of new Set([line.from.team, line.to.team])) emit(team, { actor: 'system', type: 'note', text, meta });
  return readRequest(id);
}

/**
 * 줄 쓰기 — CLI(request.mjs) 가 부른다. 누가 쓰는지는 환경이 정한다(who). 자리·순서 검사는 lineError.
 * 닫히는 줄(confirm·stop)이면 두 방에 완료 note 한 줄씩.
 */
export function appendRequest(id, kind, { who, text = '' }) {
  const r = readRequest(id);
  if (!r) throw new Error(`없는 블록: ${id}`);
  const bad = lineError(r, kind, who);
  if (bad) throw new Error(bad);
  const t = String(text ?? '').trim();
  if (['say', 'goal', 'done', 'stop'].includes(kind) && !t) throw new Error(`${kind} 에는 한 줄이 필요합니다.`);
  const line = { kind, ts: new Date().toISOString(), by: who, text: t };
  appendLine(id, line);
  const after = readRequest(id);
  if (after.status === 'closed') noteClosed(after);
  return after;
}

/** milestone 모드 블록을 서버가 닫는다 — until 의 마일스톤이 pass 가 됐을 때 (notifier 가 틱마다 본다). */
export function closeByMilestone(r, round = null) {
  if (r.status === 'closed' || r.mode !== 'milestone') return r;
  appendLine(r.id, { kind: 'close', ts: new Date().toISOString(), by: null, text: round ? `라운드 ${round} 에서 마일스톤 ${r.until?.milestone ?? '?'} 이 닫혔다` : `마일스톤 ${r.until?.milestone ?? '?'} 이 닫혔다` });
  const after = readRequest(r.id);
  noteClosed(after);
  return after;
}

function noteClosed(r) {
  const how = { confirm: '톰 확인', stop: '톰이 끊음', close: '마일스톤 닫힘' }[r.closedBy] ?? r.closedBy;
  const text = `요청 블록 ${r.id} 닫힘 — ${how}: ${r.what}`;
  const meta = { request: r.id, status: 'closed' };
  for (const team of new Set([r.from.team, r.to.team])) emit(team, { actor: 'system', type: 'note', text, meta });
}

/** 지금 셸의 자리 — 승인(approve.mjs whoAmI)과 같은 규칙. 환경이 없으면 null. */
export function whoAmI() {
  const actor = process.env.PPANAM_ACTOR;
  const team = process.env.PPANAM_TEAM;
  if (actor && team) return { team, actor };
  if (team) return { team, actor: roomRules(team).owner };
  return null;
}

/** milestone 모드의 until — 요청한 팀의 지금 마일스톤. 라운드가 없으면 로드맵 now 를 못 알아 거부. */
export function untilOf(team) {
  const st = readState(team);
  if (!st.milestone) throw new Error('--until-milestone 은 지금 마일스톤이 있어야 합니다 — 라운드를 열고 요청하세요.');
  return { team, milestone: st.milestone };
}
