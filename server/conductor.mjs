// 사회자 — 누가 언제 말하는지는 인격 문장이 아니라 여기가 정한다.
//
// 방 = 대화록, 참여자 = 각자의 세션(claude 자리는 server/session.mjs, 외부감사는 bus/outside.mjs 가 턴마다 띄우는 codex).
// 서버가 대화록을 250ms 마다 tail 하고 새 이벤트를 여기에 넘긴다. 사회자는 차례를 줄 사람을 정해 "턴" 을 보낸다.
// 턴 = 그 자리가 지난 차례 이후 못 들은 말(커서 뒤) + 이번 차례의 종류를 말하는 지시문 한 줄. 듣기는 공짜다 —
// 차례가 올 때 새 말을 한꺼번에 읽는다. 말하기만 비용이다.
//
// 차례 규칙 (우선순위 순)
//   1. 호명   — 첫머리가 X 의 이름이면 X 차례 (bus.addressee). 대표가 부르면 대표가 부른 사람이.
//   2. 판정   — ⟦판정 요청⟧ 턴은 서버가 만든다 (B3, /api/verdict).
//   3. 대표   — 대표 발언은 /api/say 가 주인(또는 대표가 부른 사람)에게 바로 넣는다. 여기서 다시 주지 않는다.
//   4. 침묵   — LULL_MS 동안 message·tool 이 없고 아무도 busy 아니면, 가장 오래 침묵한 참여자 한 명. (패스) 가능.
//               방당 시간당 MAX_LULL_PER_HOUR. 호명·판정·대표는 상한과 무관하다.
//   5. 잡담 브레이크 — 같은 둘이 **침묵 차례로만** MAX_CHAT 회씩 오가면 누가 부르거나 다른 사람이 말할 때까지 침묵 차례를 안 준다(결정 121).
//               호명·판정·요청 블록 안의 왕복은 일이라 안 센다 — 100번 오가도 안 끊는다(결정 120 "대화로 풀어가라"). 'third' 종류는 옛 저장 차례 호환으로만.
//               한 자리에 한 번에 한 턴. 일하는 중이면 큐에 쌓이고, 쌓인 차례는 합쳐서 한 턴이 된다.
//   6. 문 닫힘 — 라운드가 idle 이면 차례 없음(총괄실 예외). blocked 면 대표만(호명도 안 준다).
//               세상의 시계(world.mjs, C)가 오면 근무 시간 밖의 침묵 차례를 끈다.
//
// 이 규칙들은 남들이 깨진 자리다 — 작별 인사 20회 루프(AI Town), 쳇바퀴(순순빌리지), 감사 인사 무한(CAMEL).
// docs/cases.md 1·11·17·20·33.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addressee, addressees, readCast, readState, isOffice, emit, readLog, readTail, quiet, TURN_VERDICT, listTeams, isForeign, allowIdleChat, CAPS, takeLull, lullUsed } from '../bus/bus.mjs';
import * as session from './session.mjs';
import { ga, eul } from './public/toollabel.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTSIDE = path.join(REPO, 'bus', 'outside.mjs');
const STORE = path.join(REPO, 'state', 'conductor.json');

export const LULL_MS = Number(process.env.PPANAM_LULL_MS || 90_000);
export const MAX_LULL_PER_HOUR = CAPS.lullPerHour;   // 결정 6 — 장부는 bus(state/budget.json), 재시작을 넘긴다(8단계 ④)
// (MAX_EXCHANGE — 두 사람 왕복 브레이크 — 는 결정 120 으로 뺐다.) recent 는 관제탑 snapshot 이 보여 주는 최근 발언자 열둘.
const RECENT_KEEP = 12;
const HOUR = 3_600_000;
const HEAR_LINES = 40;    // 한 턴에 들려주는 최대 줄
const HEAR_CHARS = 600;   // 한 줄 최대 길이

const rooms = new Map();
session.onTurnEnd((team, actor) => { room(team).inflight.delete(actor); persist(team); dispatch(team); });
function room(team) {
  if (!rooms.has(team)) {
    rooms.set(team, {
      pending: new Map(),   // actor → { kind, from: [] }
      inflight: new Map(),  // actor → { kind, cursor } — 지금 나가 있는 차례. 서버가 죽으면 세션도 죽으니 이것도 되살린다 (결정 104)
      recent: [],           // 최근 발언자 (관제탑 snapshot)
      chat: [],             // 침묵 차례에서 나온 발언자 줄 — 잡담 브레이크(결정 121). 호명·판정·대표 말이 오면 비운다
      chatNoted: false,
      lastGiven: new Map(), // 자리 → 마지막으로 준 차례 종류
      lullTimer: null,
      lastLull: 0,          // 침묵 차례 수(시간당 상한)는 여기 없다 — bus 장부 state/budget.json (8단계 ④, 재시작을 넘긴다)
      capNoted: 0,
      retryTimer: null,     // 큐에 남긴 외부 자리 재시도(8단계 ①) — notBefore 가 되면 dispatch
      retryAt: null,
      outsideBusy: false,
      outsideAgain: null,
      // 마지막으로 본 라운드 번호 — 바뀌면 상태를 비운다. 서버가 막 떴을 때는 null 이 아니라
      // 지금 라운드로 시작한다. null 이면 첫 폴링이 "라운드가 바뀌었다"로 읽고 방금 만든 flow 를
      // 지운다 (레오 감사, 2026-09-12).
      round: readState(team).round,
      flow: null,           // 판정 흐름 { target, step: 'review'|'outside', asked: n }
      carry: null,          // 닫히는 중에 쌓인 차례 { round, items: [[actor, kind]] } — 다음 라운드 첫 턴으로 (결정 25)
    });
  }
  return rooms.get(team);
}

/* ── 커서: 자리마다 "여기까지 들었다" ── */

// 반쯤 깨진 파일은 조용히 빈 것으로 읽지 않는다 (솔라 R24) — 커서와 차례가 소리 없이 다 사라지는 자리다. 없는 파일만 빈 것이다.
// 쓰기는 임시 파일에 쓰고 rename 한다 — 쓰다가 죽어도 옛 파일이 온전히 남는다.
let storeBroken = null;
function readStore() {
  let raw;
  try { raw = fs.readFileSync(STORE, 'utf8'); } catch { return {}; }
  try { const all = JSON.parse(raw); storeBroken = null; return all; }
  catch (e) {
    if (storeBroken !== raw) {   // 같은 깨진 내용으로 매 턴 떠들지 않는다 — 한 번, 그리고 내용이 바뀌면 또 한 번
      storeBroken = raw;
      console.error(`conductor: ${STORE} 이 깨져 있습니다 — ${e.message}. 커서·차례를 빈 것으로 읽습니다.`);
      note('hq', `state/conductor.json 이 깨져 있어 커서·저장된 차례를 빈 것으로 읽었습니다 — ${String(e.message).slice(0, 100)}. 다음 저장이 덮어씁니다.`);
    }
    return {};
  }
}
function writeStore(all) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  const tmp = `${STORE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  fs.renameSync(tmp, STORE);
}
function cursorOf(team, actor) { return readStore()[team]?.[actor] ?? null; }
function setCursor(team, actor, id) {
  const all = readStore();
  (all[team] ??= {})[actor] = id;
  writeStore(all);
}

/* ── 차례 저장 (결정 104) — 서버가 꺼져도 기다리던 차례가 살아남는다 ──
 * 전에는 pending 이 메모리에만 있어 재시작마다 방이 멈췄다("마케팅팀 왜 멈췄어"). 같은 파일(state/conductor.json)의 `_queue` 칸에
 * 방마다 { round, pending, inflight, carry, carryFrom } 을 쓴다 — enqueue·stash·dispatch·giveTurn 으로 바뀔 때마다. 작은 파일이라 매번 써도 된다.
 * 나가 있던 차례(inflight)는 커서를 주기 전 값으로 되돌려 되살린다 — 안 그러면 죽은 턴이 들은 말을 다음 턴이 못 듣는다. */
const QUEUE_KEY = '_queue';
function persist(team) {
  const r = room(team);
  const all = readStore();
  (all[QUEUE_KEY] ??= {})[team] = {
    round: r.round, savedAt: new Date().toISOString(),
    pending: [...r.pending].map(([a, p]) => [a, p.kind]),   // 재시도 표시(tries·notBefore)는 안 남긴다 — 재시작 뒤엔 바로, 처음처럼 준다

    inflight: [...r.inflight].map(([a, p]) => [a, p.kind, p.cursor ?? null]),
    carry: r.carry, carryFrom: r.carryFrom ?? null,
    flow: r.flow ?? null,   // 판정 흐름도 살아남는다(결정 118 곁다리) — 전엔 메모리에만 있어 재시작에 흐름이 사라지고 verdict 차례만 남았다
  };
  try { writeStore(all); }
  catch (e) { note(team, `차례를 저장하지 못했습니다 — ${String(e.message).slice(0, 120)}. 서버가 꺼지면 이 방의 대기 차례가 사라질 수 있습니다.`); }
}
/**
 * 서버가 켜질 때 — 저장해 둔 차례를 되살린다. 순수한 부분(어느 것을 살리고 어느 것을 넘기나)은 restoreQueue 로 갈라 둔다 — round.mjs check 가 돌려본다.
 * 같은 라운드면 pending·inflight 를 그대로 pending 으로. 라운드가 바뀌었으면(닫혔다 열림) pickCarry 규칙(결정 25)으로 carry 에 넘긴다.
 * 조용히 살아나지 않는다 — 그 방에 한 줄 남긴다. 되살린 차례는 send 가 그 자리 세션을 띄운 뒤 쓴다(session.enqueue 가 없으면 spawn).
 */
export function restoreQueue(saved, round) {
  if (!saved) return { pending: [], carry: null, carryFrom: null, cursors: [] };
  const items = [...(saved.pending ?? []), ...(saved.inflight ?? []).map(([a, k]) => [a, k])];
  const cursors = (saved.inflight ?? []).filter(([, , c]) => c != null).map(([a, , c]) => [a, c]);
  if (saved.round === round) return { pending: items, carry: saved.carry ?? null, carryFrom: saved.carryFrom ?? null, cursors };
  const carried = pickCarry(new Map(items.map(([a, k]) => [a, { kind: k }])));
  const prev = saved.carry?.items ?? [];
  const merged = [...prev, ...carried.filter(([a]) => !prev.some(([b]) => b === a))];
  return { pending: [], carry: merged.length ? { round: saved.carry?.round ?? saved.round, items: merged } : null, carryFrom: null, cursors };
}
export function restoreQueues() {
  const all = readStore()[QUEUE_KEY] ?? {};
  for (const [team, saved] of Object.entries(all)) {
    let state; try { state = readState(team); } catch { continue; }
    const r = room(team);
    const got = restoreQueue(saved, state.round);
    for (const [actor, cursor] of got.cursors) setCursor(team, actor, cursor);   // 죽은 턴이 들은 말을 다시 듣게
    for (const [actor, kind] of got.pending) { const cur = r.pending.get(actor); if (!cur || (RANK[kind] ?? 0) > (RANK[cur.kind] ?? 0)) r.pending.set(actor, { kind }); }
    if (got.carry) r.carry = got.carry;
    if (got.carryFrom) r.carryFrom = got.carryFrom;
    // 판정 흐름 — 같은 라운드면 그대로(기다리던 자리의 verdict 차례도 위에서 되살아났다), 라운드가 바뀌었으면 버린다. 시간 제한은 expireFlows 가 이어서 잰다.
    if (saved.flow && saved.round === state.round && state.phase === 'running') r.flow = { ...saved.flow, since: saved.flow.since ?? Date.now() };
    const n = got.pending.length + (got.carry?.items.length ?? 0);
    if (n) {
      const names = [...got.pending.map(([a]) => a), ...(got.carry?.items ?? []).map(([a]) => a)].map((a) => nameOf(team, a));
      note(team, `서버가 다시 떴습니다 — 기다리던 차례 ${n}건(${names.join('·')})을 이어갑니다.${got.carry ? ' 라운드가 바뀌어 다음 라운드 첫 턴으로 넘깁니다.' : ''}`);
    }
    persist(team);
    if (got.carry && !isOffice(team) && state.phase === 'running') restoreCarry(team, [], state.round);   // 이미 새 라운드가 열려 있으면 바로 첫 턴으로
    dispatch(team);
  }
}

function note(team, text) { try { emit(team, { actor: 'system', type: 'note', text }); } catch { /* 삼킨다 */ } }

/* ── 참여자 ── */

/** 이 방에서 차례를 받을 수 있는 자리. claude 자리 + 외부감사. */
function participants(team) {
  const agents = readCast(team).agents ?? {};
  return Object.keys(agents).filter((a) => agents[a]?.model === 'claude' || isForeign(agents[a]?.model));
}
// 다른 회사 엔진 자리(codex·gemini) — 프로세스가 턴마다 뜨는 자리. 'gpt' 를 직접 비교하지 않는다(bus.isForeign — 결정 77 의 그 버그).
const isOutside = (team, actor) => isForeign(readCast(team).agents?.[actor]?.model);
// 이 방에 없는 자리는 총괄실 것이다 — 총괄실에서 옮겨온 발언(meta.from)의 화자.
const nameOf = (team, actor) => readCast(team).agents?.[actor]?.name ?? readCast('hq').agents?.[actor]?.name ?? actor;

function busy(team, actor) {
  if (isOutside(team, actor)) return room(team).outsideBusy;
  return session.status(team, actor).busy;
}
function anyBusy(team) {
  return session.anyBusy(team) || room(team).outsideBusy;
}

/* ── 들려줄 말 ── */

/**
 * 이 자리가 지난 차례 이후 못 들은 말. 작전실은 이번 라운드 안에서만(라운드마다 컨텍스트를 비운다),
 * 총괄실은 최근 것. 자기 말·도구 줄·시스템 등장은 뺀다. 자기 세션이 앞의 대화는 기억하고 있다.
 */
function unheard(team, actor, { fromRound = null } = {}) {
  const since = cursorOf(team, actor);
  const state = readState(team);
  // 넘어온 차례(carried)는 닫힌 라운드의 못 들은 말부터 — 세션이 비워졌으니 무엇에 답하는지 귀에 있어야 한다 (결정 25).
  const from = fromRound ?? state.round;
  let events = isOffice(team) ? readTail(team, { limit: 60 }).events : readLog(team).filter((e) => e.round >= from && e.round <= state.round);
  if (since) {
    const i = events.findIndex((e) => e.id === since);
    events = i >= 0 ? events.slice(i + 1) : events.slice(-HEAR_LINES);
  }
  const cast = readCast(team).agents ?? {};
  const lines = [];
  let last = null;
  for (const e of events) {
    last = e.id;
    if (e.type === 'tool' || e.type === 'enter') continue;
    if (e.meta?.alive) continue;   // 생존 알림은 대표 화면용 — 5분마다 한 줄씩 참여자 귀에 넣지 않는다 (결정 31 ②)
    if (e.actor === actor && e.type !== 'verdict') continue;
    if (e.actor === 'boss') {
      // /api/say 가 대표의 말을 주인(또는 대표가 부른 사람)에게 바로 넣었다. 그에게는 다시 들려주지 않는다.
      const to = addressee(e.text, cast);
      const got = to && cast[to]?.model === 'claude' ? to : session.ownerOf(team);
      if (got === actor) continue;
    }
    if (e.type === 'round_start' || e.type === 'round_end' || e.type === 'milestone') { lines.push(`[${e.text}]`); continue; }
    const who = nameOf(team, e.actor) + (e.meta?.from ? '(총괄실에서)' : '');
    const tag = e.type === 'verdict' ? ` [${e.meta?.verdict ?? ''}]` : e.type === 'note' ? ' (안내)' : '';
    lines.push(`${who}${tag}: ${String(e.text).replace(/\s+/g, ' ').slice(0, HEAR_CHARS)}`);
  }
  return { lines: lines.slice(-HEAR_LINES), last };
}

/** 판정 차례의 지시문. ⟦판정 요청⟧ 마커를 훅이 보고 첫 줄을 판정으로 남긴다 — 모든 엔진이 같은 규약. */
const VERDICT_INSTRUCTION = (target, guideName) => `${TURN_VERDICT} ${target}\n판정 대상: ${target} (만든 사람: ${guideName}). 산출물 파일을 열어 확인해라. 첫 줄에 PASS 또는 REVISE 한 단어만, 그다음 줄부터 근거(경로·줄 번호). 같은 지적을 다시 내지 마라 — 새 근거가 없으면 PASS. 통과 기준은 완벽함이 아니라 이번 마일스톤의 산출물 조건이다.`;

const INSTRUCTION = {
  called: '방에서 너에게 한 말이다. 상대 이름으로 시작해 네 말투로 한두 문장 — 사람에게 말하듯, 보고서·목록 말고. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라. 남길 말이 없으면 (패스) 한 마디만.',
  lull: '방이 잠시 조용하다. 아무도 너에게 말한 건 아니다. 오간 말에 보탤 것이 있거나 누군가에게 한마디 걸고 싶으면 네 말투로 한두 문장 — 없으면 (패스) 한 마디만. 첫 줄에 PASS·REVISE 를 쓰지 마라.',
  third: '두 사람 사이에서 같은 얘기가 세 번 오갔다. 너는 제3자다. 정리하거나 다른 각도를 하나만, 네 말투로 한두 문장. 없으면 (패스).',
  lunch: '점심시간이다. 일 얘기는 잠시 두고 네 말투로 한마디 툭 — 한 문장. 없으면 (패스).',
  carried: '지난 라운드가 닫히면서 못 받은 차례다 — 위 말 끝에 누가 너에게 한 말이 있다. 새 라운드가 열렸으니 그 말에 지금 답해라. 상대 이름으로 시작해 네 말투로 한두 문장. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라. 남길 말이 없으면 (패스) 한 마디만.',
};

/* ── 턴 보내기 ── */

function giveTurn(team, actor, kind, tries = 1) {
  const r = room(team);
  const target = r.flow?.target ?? '';
  (r.lastGiven ??= new Map()).set(actor, kind);   // 이 자리의 다음 말이 어떤 차례에서 나왔나 — 잡담 브레이크(결정 121)가 본다

  if (isOutside(team, actor)) {
    // codex 는 프로세스가 턴마다 뜬다. outside.mjs 가 자기 커서(lastSeen)로 못 들은 말을 붙이므로 여기선 종류만 넘긴다.
    r.outsideBusy = true;
    r.inflight.set(actor, { kind, cursor: null, tries }); persist(team);   // codex 도 서버의 자식이라 같이 죽는다 — 되살릴 수 있게 적어 둔다
    const args = [OUTSIDE, '--team', team, '--actor', actor, '--turn', kind];   // 자리 이름으로 띄운다 — outside 가 아닌 codex 자리도 (결정 69 ①)
    if (kind === 'verdict') args.push('--text', target);
    if (kind === 'carried' && r.carryFrom) args.push('--from-round', String(r.carryFrom));   // 닫힌 라운드의 못 들은 말부터 (결정 25)
    let child;
    try {
      child = spawn('node', args, { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env } });
    } catch (e) {
      r.outsideBusy = false; r.inflight.delete(actor); persist(team);
      note(team, `${nameOf(team, actor)}을 깨우지 못했습니다 — ${String(e.message).slice(0, 160)}`);
      return;
    }
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    child.on('error', (e) => { r.outsideBusy = false; r.inflight.delete(actor); persist(team); note(team, `${nameOf(team, actor)}을 깨우지 못했습니다 — ${String(e.message).slice(0, 160)}`); });
    child.on('close', (code, signal) => {
      r.outsideBusy = false; r.inflight.delete(actor); persist(team);
      // 종료 코드는 outside.mjs 와 약속 — 0 됨 · 1 엔진 실패(안에서 1회 재시도까지 하고 못 냄, 사유는 그가 남겼다) · 2 사용법 · 3 일지 없음 ·
      // 4 건너뜀(쿨다운·엔진 없음 — 다시 불러도 같다). signal 은 프로세스 자체가 죽은 것(kill -9) — 그는 아무것도 못 남겼다.
      const lastLine = err.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
      if (code === 0 || code === OUTSIDE_EXIT_SKIPPED) { dispatch(team); return; }
      if (code === 1 || signal) outsideFailed(team, actor, kind, tries, signal ? `${signal} 로 죽음` : (lastLine.slice(0, 160) || 'exit 1'));
      else note(team, `${nameOf(team, actor)} 호출이 비정상 종료했습니다 (code ${code})${lastLine ? ' — ' + lastLine.slice(0, 160) : ''}`);
      dispatch(team);
    });
    return;
  }

  const { lines, last } = unheard(team, actor, kind === 'carried' ? { fromRound: r.carryFrom } : {});
  const instruction = kind === 'verdict' ? VERDICT_INSTRUCTION(target, nameOf(team, session.ownerOf(team))) : INSTRUCTION[kind];
  // 턴마다 이름을 한 번 불러 준다 — 긴 세션에서 말투가 모델 기본값으로 흘러가는 것을 막는 닻 (docs/cases.md 24·25).
  const anchor = kind === 'verdict' ? '' : `너는 ${nameOf(team, actor)}다. `;
  const body = (lines.length ? `그동안 이 방에서 오간 말:\n\n${lines.join('\n')}\n\n---\n` : '') + anchor + instruction;
  const before = cursorOf(team, actor);               // 서버가 이 턴 중에 죽으면 여기로 되돌린다 (결정 104)
  if (last) setCursor(team, actor, last);
  r.inflight.set(actor, { kind, cursor: before }); persist(team);
  const sent = session.send(team, quiet(body), actor, kind === 'verdict' ? { kind: 'verdict', extra: target.slice(0, 200) } : {});
  if (sent?.refused) { r.inflight.delete(actor); persist(team); note(team, `${nameOf(team, actor)}의 차례를 주지 못했습니다 — ${sent.reason}`); }
}

/* ── 다른 회사 엔진 자리의 실패(8단계 ①) — outside.mjs 가 안에서 한 번 더 부르고도 못 냈거나(exit 1), 프로세스 자체가 죽었다(signal). ──
 * 조용히 버리지 않는다: note 를 남기고 그 차례를 **큐에 남겨** OUTSIDE_RETRY_MS 뒤 다시 준다. 큐에서 준 것도 실패하면(OUTSIDE_MAX_TRIES) 그때 버리고,
 * 판정 흐름이 그를 기다리던 중이면 흐름도 멈춘다(verdictFlow:'abort') — 안 그러면 flow 가 굳어 다음 /verdict 가 "이미 돌고 있습니다" 로 거부된다.
 * 순수한 판단(retryPlan)은 갈라 둔다 — round.mjs check 가 돌려본다. 종료 코드 4 는 outside.mjs 의 EXIT_SKIPPED 와 같은 숫자(그 파일은 CLI 라 import 못 한다). */
export const OUTSIDE_EXIT_SKIPPED = 4;
export const OUTSIDE_RETRY_MS = Number(process.env.PPANAM_OUTSIDE_RETRY_MS || 3 * 60_000);
export const OUTSIDE_MAX_TRIES = Number(process.env.PPANAM_OUTSIDE_MAX_TRIES || 2);   // 프로세스를 몇 번 띄우나 — 처음 + 큐에서 한 번
/** @returns { action: 'queue', notBefore } | { action: 'drop' } */
export function retryPlan(tries, now = Date.now(), { max = OUTSIDE_MAX_TRIES, delay = OUTSIDE_RETRY_MS } = {}) {
  return tries < max ? { action: 'queue', notBefore: now + delay } : { action: 'drop' };
}
function outsideFailed(team, actor, kind, tries, why) {
  const r = room(team);
  const plan = retryPlan(tries);
  const who = nameOf(team, actor);
  if (plan.action === 'queue') {
    r.pending.set(actor, { kind, tries: tries + 1, notBefore: plan.notBefore });   // 있던 예약보다 우선 — 못 낸 차례가 그 자리의 가장 급한 것
    persist(team);
    emit(team, { actor: 'system', type: 'note', text: `${ga(who)} 답을 못 냈습니다 — ${why}. 이 차례(${kind})를 큐에 남기고 ${Math.round(OUTSIDE_RETRY_MS / 60_000)}분 뒤 다시 줍니다 (${tries}/${OUTSIDE_MAX_TRIES}).`, meta: { outsideRetry: { actor, kind, tries, of: OUTSIDE_MAX_TRIES, notBefore: new Date(plan.notBefore).toISOString(), why } } });
    armRetry(team, plan.notBefore);
    return;
  }
  const waiting = r.flow?.waiting === actor;
  if (waiting) { r.flow = null; persist(team); }
  emit(team, { actor: 'system', type: 'note', text: `${eul(who)} ${OUTSIDE_MAX_TRIES}번 띄워도 답이 없습니다 — ${why}. 이 차례(${kind})를 버립니다.${waiting ? ' 판정 흐름도 멈춥니다 — 다시 부르세요 (node bus/round.mjs verdict).' : ''}`, meta: { outsideRetry: { actor, kind, tries, of: OUTSIDE_MAX_TRIES, gaveUp: true, why }, ...(waiting ? { verdictFlow: 'abort', waiting: actor } : {}) } });
}
/** 큐에 남긴 차례의 시각이 되면 dispatch — 방마다 타이머 하나, 더 이른 시각이 오면 당긴다. */
function armRetry(team, at) {
  const r = room(team);
  if (r.retryTimer && r.retryAt <= at) return;
  clearTimeout(r.retryTimer);
  r.retryAt = at;
  r.retryTimer = setTimeout(() => { r.retryTimer = null; r.retryAt = null; dispatch(team); }, Math.max(0, at - Date.now()));
  r.retryTimer.unref?.();
}

/** 차례를 예약한다. 같은 자리에 쌓이면 더 센 종류로 합친다. */
const RANK = { verdict: 4, third: 3, called: 2, carried: 2, lull: 1, lunch: 1 };
function enqueue(team, actor, kind) {
  const r = room(team);
  const cur = r.pending.get(actor);
  if (!cur || (RANK[kind] ?? 0) > (RANK[cur.kind] ?? 0)) r.pending.set(actor, { kind });
  persist(team);
  dispatch(team);
}

/**
 * 닫히는 중에 쌓인 차례를 다음 라운드로 넘긴다 (결정 25). 전에는 note 만 남기고 버렸다 — 마케팅 R22 가 닫히며 안젤의 차례 1건이
 * 사라졌다. 판정 차례는 안 넘긴다 — 닫힌 라운드의 판정 흐름은 끝난 것이다. 침묵·점심 차례도 넘길 것이 아니다.
 * 순수하게 갈라 둔다(pickCarry) — round.mjs check 가 돌려본다.
 */
export function pickCarry(pending) {
  return [...pending].filter(([, p]) => p.kind === 'called' || p.kind === 'third' || p.kind === 'carried').map(([a, p]) => [a, p.kind]);
}
function stash(team, why, round = readState(team).round) {
  const r = room(team);
  if (!r.pending.size) return;
  const items = pickCarry(r.pending);
  const dropped = [...r.pending.keys()].filter((a) => !items.some(([b]) => b === a));
  r.pending.clear();
  if (items.length) {
    // 닫히는 동안 두 번 쌓이면 합친다 — 같은 자리는 한 번.
    const prev = r.carry?.items ?? [];
    r.carry = { round: r.carry?.round ?? round, items: [...prev, ...items.filter(([a]) => !prev.some(([b]) => b === a))] };
    note(team, `${why} 차례 ${items.length}건(${items.map(([a]) => nameOf(team, a)).join('·')})을 다음 라운드 첫 턴에 넘깁니다.${dropped.length ? ` 침묵·판정 차례 ${dropped.length}건은 버립니다.` : ''}`);
  } else {
    note(team, `${why} 차례 ${dropped.length}건(${dropped.map((a) => nameOf(team, a)).join('·')})을 버립니다 — 침묵·판정 차례는 넘기지 않습니다.`);
  }
  persist(team);
}
/** 닫힌 라운드의 이벤트인가 — round_end·round_start 와 한 묶음으로 온 지난 라운드의 말. */
const isStale = (e, round) => e.round != null && round != null && e.round < round;
/**
 * 닫힌 라운드의 말에서 호명된 참여자 — [[자리, 그 말의 라운드]]. 같은 자리는 가장 이른 라운드 한 번. 순수 — round.mjs check 가 돌려본다.
 * 자기 자신·대표·참여자 아닌 자리는 뺀다(보통 호명과 같은 규칙).
 */
export function staleCalls(events, round, cast, isParticipant) {
  const out = new Map();
  for (const e of events) {
    if (!isStale(e, round) || (e.type !== 'message' && e.type !== 'verdict')) continue;
    for (const to of addressees(e.text, cast)) {
      if (to === e.actor || to === 'boss' || !isParticipant(to)) continue;
      out.set(to, Math.min(out.get(to) ?? e.round, e.round));
    }
  }
  return [...out];
}
/** 넘어온 차례 하나 — 들려주기는 그 말이 있던 라운드부터(가장 이른 것). 새 라운드가 열린 뒤 차례를 받는다. */
function carryTurn(team, actor, fromRound) {
  const r = room(team);
  r.carryFrom = r.carryFrom ? Math.min(r.carryFrom, fromRound) : fromRound;
  enqueue(team, actor, 'carried');
}
/** 새 라운드가 열렸다 — 넘겨 둔 차례를 첫 턴으로 준다. 들려주기는 닫힌 라운드의 못 들은 말부터(giveTurn 의 carried). */
/**
 * 넘어온 차례를 한 집합으로 — 닫힐 때 넘겨 둔 것(carry)과 이 묶음에 섞여 온 닫힌 라운드의 호명(staleCalls)을 합쳐 자리당 하나,
 * 라운드는 가장 이른 것. 따로 주면 같은 사람이 두 차례를 받는다 — 복원한 차례가 바로 나가 busy 라 stale 쪽이 또 쌓였다(레오 FAIL R23).
 * 순수 — round.mjs check 가 돌려본다.
 */
export function mergeCarry(carry, stale) {
  const out = new Map();
  for (const [a] of carry?.items ?? []) out.set(a, carry.round);
  for (const [a, from] of stale) out.set(a, Math.min(out.get(a) ?? from, from));
  return [...out];
}
/** 새 라운드가 열렸다(또는 닫힌 라운드의 호명이 섞여 왔다) — 넘어온 차례를 첫 턴으로 준다. 자리당 한 번. */
function restoreCarry(team, stale, round) {
  const r = room(team);
  // 닫히는 중(아직 같은 라운드)에 넘겨 둔 것은 새 라운드가 열린 뒤에만 꺼낸다 — 닫히는 라운드에 도로 주면 안 된다.
  const carry = r.carry && r.carry.round !== round ? r.carry : null;
  if (carry) r.carry = null;
  const items = mergeCarry(carry, stale);
  if (!items.length) return;
  const from = Math.min(...items.map(([, n]) => n));
  note(team, `라운드 ${from} 이 닫히며 넘어온 차례 ${items.length}건(${items.map(([a]) => nameOf(team, a)).join('·')}) — 이 라운드 첫 턴으로 줍니다.`);
  for (const [actor, n] of items) carryTurn(team, actor, n);
}

/** 예약된 차례 중 지금 줄 수 있는 것을 준다. 한 자리에 한 번에 하나, 놀고 있을 때만. */
function dispatch(team) {
  const r = room(team);
  const state = readState(team);
  if (!isOffice(team) && state.phase !== 'running') {
    // 막 닫혔다(idle) — 닫히는 동안 dispatch 가 안 돌았으면 여기서 넘긴다. blocked 는 대표 차례라 버린다.
    if (state.phase === 'idle') stash(team, '라운드가 닫혀'); else { r.pending.clear(); persist(team); }
    return;
  }
  // 라운드가 닫히는 중이다(일지를 받는 동안). 쌓인 차례는 닫히는 라운드의 것 — 버리지 않고 다음 라운드 첫 턴으로 (결정 25).
  if (session.isClosing(team)) { stash(team, '라운드가 닫히는 중이라'); return; }
  let gave = false;
  for (const [actor, p] of [...r.pending]) {
    if (p.notBefore && p.notBefore > Date.now()) { armRetry(team, p.notBefore); continue; }   // 큐에 남긴 재시도(8단계 ①) — 시각 전엔 안 준다
    if (busy(team, actor)) continue;
    r.pending.delete(actor); gave = true;
    giveTurn(team, actor, p.kind, p.tries ?? 1);
  }
  if (gave) persist(team);
}

/* ── 판정 흐름 ── */

/**
 * /verdict. 내부감사 → (PASS 면) 외부감사 순서로 판정 차례를 준다. 내부감사가 없는 방(개발)은 외부감사만.
 * REVISE 가 나오면 흐름은 끝나고 실무가 호명 차례를 받는다(판정 카드는 어차피 그가 듣는다). FAIL 이면 방이 막힌다.
 * 둘 다 PASS 면 note — 라운드를 PASS 로 닫는 것은 실무나 대표가 한다(자동으로 닫지 않는다).
 */
export function startVerdict(team, target) {
  const r = room(team);
  const state = readState(team);
  if (isOffice(team)) throw new Error('총괄실에는 판정이 없습니다.');
  if (state.phase !== 'running') throw new Error(state.phase === 'blocked' ? '대표 판단 대기 중입니다.' : '라운드를 먼저 여세요.');
  if (r.flow) throw new Error(`이미 판정이 돌고 있습니다 (${r.flow.waiting ?? r.flow.steps?.[r.flow.i] ?? '?'} 차례).`);
  const cast = readCast(team).agents ?? {};
  // 내부감사는 엔진이 무엇이든(대표가 codex 로 바꿨을 수도, 결정 69 ①) 그 자리가 있으면 한 걸음. 외부감사는 다른 회사 엔진이어야 한다(CLAUDE.md — codex 든 gemini 든).
  // 외부감사 걸음을 건너뛸 때는 **조용히 빠지지 않는다**(결정 118 ②) — 왜 건너뛰는지 flow 에 적고 방에 note. 전에는 경고 한 줄 없이 버렸다.
  const out = cast.outside ?? null;
  const outsideWhy = !out ? 'no-seat' : out.suspended ? 'suspended' : !isForeign(out.model) ? 'not-foreign' : null;
  // 안 걸음은 이 회차의 감사 자리(round.json auditor, 결정 125 — 개발처럼 review 가 없는 방도 둘이 서로 본다), 없으면 review 자리.
  const inside = state.auditor && cast[state.auditor] ? state.auditor : cast.review?.model ? 'review' : null;
  const steps = [inside, outsideWhy ? null : 'outside'].filter(Boolean);
  if (!steps.length) throw new Error('이 방에는 감사역이 없습니다.');
  r.round = state.round;
  r.flow = { target: String(target ?? '').trim() || '이번 라운드 산출물', steps, i: 0, asked: 0, skipped: outsideWhy && out ? ['outside'] : [], reason: outsideWhy };
  // meta.target — 판정 대상 글 그대로. 닫을 때 bus.artifactsOf 가 여기서 out/ 경로를 읽어 산출물이 비었는지 본다(8단계).
  emit(team, { actor: 'system', type: 'note', text: `판정 시작 — ${r.flow.target}. ${steps.map((s) => nameOf(team, s)).join(' → ')} 순서.`, meta: { verdictFlow: 'start', steps, skipped: r.flow.skipped, reason: outsideWhy, target: r.flow.target } });
  if (out && outsideWhy) {
    const why = outsideWhy === 'suspended' ? `중단 중 — ${out.suspended} 복귀 예정` : outsideWhy === 'not-foreign' ? `자리 엔진이 ${out.model ?? '없음'} 이라 외부 감사가 아님` : '자리 없음';
    emit(team, { actor: 'system', type: 'note', text: `외부 감사 없이 판정합니다 — ${nameOf(team, 'outside')} ${why}. 이 라운드는 기록에 '외부 감사 안 봄' 으로 남고, 돌아오면 다시 봅니다 (결정 118).`, meta: { verdictFlow: 'skip', skipped: ['outside'], reason: outsideWhy } });
  }
  askStep(team);
  return r.flow;
}

function askStep(team) {
  const r = room(team);
  const actor = r.flow.steps[r.flow.i];
  r.flow.asked = 0;
  r.flow.waiting = actor;
  r.flow.since = Date.now();
  persist(team);
  enqueue(team, actor, 'verdict');
}

/**
 * 판정 흐름 시간 제한(결정 118 곁다리) — 외부감사가 답을 못 내면 flow 가 waiting 으로 굳고 다음 /verdict 가 "이미 돌고 있습니다" 로 거부됐다(오늘 아침 실제로).
 * codex·gemini 호출 상한(PPANAM_OUTSIDE_TIMEOUT 5분)의 두 배를 넘으면 흐름을 놓고 방에 남긴다. 다시 부르면 된다.
 */
export const FLOW_TIMEOUT_MS = 2 * Number(process.env.PPANAM_OUTSIDE_TIMEOUT || 300_000);
export function expireFlows(now = Date.now()) {
  for (const [team, r] of rooms) {
    const f = r.flow;
    if (!f?.waiting || !f.since || now - f.since < FLOW_TIMEOUT_MS) continue;
    const who = f.waiting;
    r.flow = null; r.pending.delete(who); persist(team);
    emit(team, { actor: 'system', type: 'note', text: `판정 흐름을 멈춥니다 — ${nameOf(team, who)}이 ${Math.round(FLOW_TIMEOUT_MS / 60_000)}분 안에 판정을 내지 않았습니다. 다시 부르세요 (node bus/round.mjs verdict).`, meta: { verdictFlow: 'timeout', waiting: who } });
  }
}

/** 판정 흐름 중에 온 이벤트. 기다리던 자리의 판정 카드면 다음 단계로, 판정 없는 말이면 한 번 더 묻는다. */
function onFlowEvent(team, e) {
  const r = room(team);
  const f = r.flow;
  if (!f || e.actor !== f.waiting) return;
  if (e.type === 'verdict') {
    // 옛 라운드의 늦은 답이다(recordVerdict 가 stale 로 찍음). 이 흐름은 지금 라운드의 것이라 그 카드로 진행하면
    // 지난 라운드의 PASS 가 이번 판정 완료 note 를 만든다 (레오 감사, 2026-09-13). 세지 않고 계속 기다린다.
    if (e.meta?.stale) { note(team, `${nameOf(team, e.actor)}의 옛 라운드 판정(stale)은 이번 판정 흐름에 세지 않습니다 — 계속 기다립니다.`); return; }
    const v = e.meta?.verdict;
    f.waiting = null;
    if (v === 'PASS' && f.i + 1 < f.steps.length) { f.i += 1; askStep(team); return; }
    r.flow = null; persist(team);
    if (v === 'PASS') {
      // 검수 #7 — 이 note 는 대표 화면에 게시된다. CLI 문장은 실무가 안다. 사람 말로. meta 에는 기계가 읽을 걸음(결정 118 ①) — 누가 봤고 누구를 왜 건너뛰었나.
      const skipNote = f.skipped?.length ? ` (${f.skipped.map((s) => nameOf(team, s)).join('·')} 없이 — ${f.reason})` : '';
      emit(team, { actor: 'system', type: 'note', text: `판정 완료 — ${f.steps.map((s) => nameOf(team, s)).join('·')} 모두 통과${skipNote}. 이제 ${ga(nameOf(team, session.ownerOf(team)))} 이 회의를 통과로 닫을 수 있습니다.`,
        meta: { verdictFlow: 'pass', steps: f.steps, skipped: f.skipped ?? [], reason: f.reason ?? null } });
    } else if (v === 'REVISE') {
      enqueue(team, session.ownerOf(team), 'called');   // 판정 카드를 듣고 고친다
    }
    // FAIL: recordVerdict 가 방을 막았다. 여기서 할 일 없음.
    return;
  }
  if (e.type === 'message' && e.meta?.noVerdict) {
    if (f.asked < 1) { f.asked += 1; f.since = Date.now(); persist(team); enqueue(team, e.actor, 'verdict'); return; }
    r.flow = null; persist(team);
    emit(team, { actor: 'system', type: 'note', text: `${nameOf(team, e.actor)}이 두 번 물어도 첫 줄에 판정을 쓰지 않았습니다. 판정 흐름을 멈춥니다.`, meta: { verdictFlow: 'abort' } });
  }
}

/* ── 침묵 ── */

/** 침묵 차례 하나를 장부에서 쓴다(결정 6 · 8단계 ④). 상한이면 안 쓰고 false — 한 시간에 한 번만 알린다. 장부는 파일이라 재시작에도 0 이 안 된다. */
function underCap(team) {
  const r = room(team);
  const now = Date.now();
  const b = takeLull(team, now);
  if (b.ok) return true;
  if (now - r.capNoted > HOUR) {
    r.capNoted = now;
    emit(team, { actor: 'system', type: 'note', text: `침묵 차례가 시간당 상한(${b.cap}회)에 닿았습니다. 한 시간 동안은 호명·판정·대표 지시에만 답합니다 (결정 6).`, meta: { cap: { kind: 'lull', used: b.used, cap: b.cap } } });
  }
  return false;
}

/** 가장 오래 침묵한 참여자 — 마지막 발언자는 빼고. */
function quietest(team) {
  const state = readState(team);
  const log = readLog(team).filter((e) => (isOffice(team) || e.round === state.round) && (e.type === 'message' || e.type === 'verdict'));
  const lastSpoke = new Map();
  for (const e of log) lastSpoke.set(e.actor, e.ts);
  const lastActor = log.length ? log[log.length - 1].actor : null;
  // 다른 회사 엔진 자리(codex·gemini)는 침묵 차례를 안 받는다 — 판정과 이름 불린 말에만 온다(대표 지적 09-14: "(패스) 한 마디 받자고 17,000자").
  // codex 때도 낭비였다. 호명·판정은 그대로. (전에는 쿨다운 중에만 뺐다 — R25)
  const cands = participants(team).filter((a) => a !== lastActor && !busy(team, a) && !isOutside(team, a));
  if (!cands.length) return null;
  cands.sort((a, b) => (lastSpoke.get(a) ?? '') < (lastSpoke.get(b) ?? '') ? -1 : 1);
  return cands[0];
}

/** 세상의 시계 (C 에서 world.mjs 가 끼운다). 없으면 늘 근무 시간. */
let clock = () => 'work';
export function setClock(fn) { clock = fn; }

function armLull(team) {
  const r = room(team);
  clearTimeout(r.lullTimer);
  r.lullTimer = setTimeout(() => {
    r.lullTimer = null;
    const mode = clock(team);
    if (mode !== 'work' && mode !== 'lunch') return;                 // 밤·휴식엔 아무도 깨우지 않는다
    if (anyBusy(team)) { armLull(team); return; }                     // 일하는 중은 조용한 게 아니다
    if (!isOffice(team) && readState(team).phase !== 'running') return;
    // 잡담 브레이크(결정 121) — 같은 둘이 침묵 차례로만 오가고 있으면 침묵 차례를 안 준다. 호명·판정·대표 말은 그대로 온다.
    if (chatLoop(r.chat)) {
      if (!r.chatNoted) { r.chatNoted = true; const [a, b] = [...new Set(r.chat.slice(-MAX_CHAT * 2))]; note(team, `${nameOf(team, a)}·${nameOf(team, b)} 잡담이 길어져 잠시 쉽니다 — 누가 이름을 부르거나 다른 사람이 말하면 이어갑니다.`); }
      return;
    }
    const who = quietest(team);
    if (!who) return;
    if (!underCap(team)) return;   // 맨 마지막에 — 줄 사람이 정해진 뒤에야 장부(state/budget.json)에서 하나를 쓴다
    r.lastLull = Date.now();
    enqueue(team, who, mode === 'lunch' ? 'lunch' : 'lull');
  }, LULL_MS);
}

/* ── 잡담 브레이크 (결정 121, 09-14 — 120 을 대표가 고침: "몇 번 제한을 둔다는 아이디어는 괜찮은데, 그게 일을 망치면 안 되지") ──
 * 일하는 대화는 안 끊는다 — 이름을 불러 오간 차례(호명)·판정·요청 블록 안의 왕복은 세지 않는다. 헨리↔클레멘타인이 색표 고치던 그것.
 * 세는 건 **아무도 안 부른 침묵 차례(자동 응답)** 뿐 — 같은 둘이 침묵 차례로만 MAX_CHAT 회씩 오가면 누가 부르거나 다른 사람이 말할 때까지 침묵 차례를 안 준다.
 * 어느 말이 침문 차례에서 나왔는지는 giveTurn 이 자리마다 마지막으로 준 종류(lastGiven)로 안다. 호명·판정·대표·다른 사람 말이 오면 잡담 줄은 비워진다.
 */
export const MAX_CHAT = Number(process.env.PPANAM_MAX_CHAT || 3);
/** 순수 — 침묵 차례 발언자 줄(chat)이 같은 둘로 MAX_CHAT 회씩 채워졌나. round.mjs check 가 돌린다. */
export function chatLoop(chat, max = MAX_CHAT) {
  const r = chat.slice(-max * 2);
  if (r.length < max * 2) return false;
  const two = new Set(r);
  if (two.size !== 2) return false;
  const [a, b] = [...two];
  return r.filter((x) => x === a).length >= max && r.filter((x) => x === b).length >= max;
}
function noteChat(team, e) {
  const r = room(team);
  const kind = r.lastGiven?.get(e.actor) ?? null;
  if (e.actor === 'boss' || (kind !== 'lull' && kind !== 'lunch')) { r.chat = []; r.chatNoted = false; return; }   // 일하는 말 — 잡담 줄을 비운다
  r.chat.push(e.actor); r.chat = r.chat.slice(-MAX_CHAT * 4);
}

/* ── 입구 ── */

/** 폴링이 새 이벤트를 넘겨준다. 여기서 차례를 정한다. */
export function noticeEvents(team, events) {
  const cast = readCast(team).agents ?? {};
  const r = room(team);
  const state = readState(team);

  if (!isOffice(team)) {
    if (state.round !== r.round) {
      // --next 로 닫고 바로 열리면 round_end·round_start 가 한 묶음으로 와서 idle 을 못 본다 — 남은 차례는 지난 라운드 것이라 여기서 넘긴다.
      if (r.pending.size) stash(team, `라운드 ${r.round} 이 닫혀`, r.round);
      r.round = state.round; r.recent = []; r.flow = null; r.carryFrom = null;
      persist(team);
    }
    if (state.phase !== 'running') {   // idle·blocked: 차례 없음. 막 닫혔으면(idle) 쌓인 차례는 버리지 않고 넘긴다.
      clearTimeout(r.lullTimer); r.lullTimer = null;
      if (state.phase === 'idle') stash(team, '라운드가 닫혀'); else if (r.pending.size) { r.pending.clear(); persist(team); }
      return;
    }
    // 넘어온 차례 (결정 25) — 지난 라운드가 닫히며 넘겨 둔 것(carry)과, 닫힌 라운드의 말이 round_end·round_start 와 한 폴링에
    // 섞여 온 호명(staleCalls — 새 라운드의 보통 호명으로 주면 unheard 가 새 라운드만 읽어 그 말을 못 듣는다, 레오 REVISE R23)을
    // **한 집합으로 한 번에** 준다 — 따로 주거나 이벤트마다 주면 같은 사람이 두 차례를 받는다(레오 두 번째 REVISE·FAIL R23).
    restoreCarry(team, staleCalls(events, state.round, cast, (a) => participants(team).includes(a)), state.round);
  }

  for (const e of events) {
    if (e.type === 'tool') { if (r.lullTimer) armLull(team); continue; }     // 누가 일하는 중 — 조용함이 아니다
    if (e.type !== 'message' && e.type !== 'verdict') continue;
    if (!isOffice(team) && isStale(e, state.round)) continue;   // 위에서 넘어온 차례로 줬다
    if (e.actor === 'system') {
      // 시스템 발언은 차례 계산에서 빠지되, 첫머리에 이름을 불렀으면 그 사람을 깨운다 — 하네스가 "결과 도착" 을
      // 시스템 화자로 남겼는데 아무도 안 깨어 20분 멈춘 일(2026-09-12). codex 자리도 같다.
      for (const to of addressees(e.text, cast)) {
        if (to !== 'boss' && participants(team).includes(to)) { enqueue(team, to, 'called'); armLull(team); }
      }
      continue;
    }

    // 총괄실에서 다른 방 사람을 불렀다 — 그 방에도 같은 말을 게시한다 (아래 crossPost). 총괄실 세션의 훅은 자기 방에만
    // 남기므로 톰의 "하영, …" 이 하영 없는 방에만 떴다 (대표 원문 09-13 13:08, 결정 21).
    if (isOffice(team) && e.type === 'message' && !e.meta?.from) crossPost(team, e);

    r.recent.push(e.actor);
    r.recent = r.recent.slice(-RECENT_KEEP);
    if (e.type === 'message') noteChat(team, e);   // 잡담인가 일인가 — 결정 121

    onFlowEvent(team, e);

    // 부른 사람 전부, 부른 순서대로 차례 (결정 22). 두 사람 왕복 브레이크(3회면 제3자·쉼)는 **결정 120 으로 철회** — 대표 09-14 "3번 넘으면 대화 못하게 하는 거 철회해",
    // 09-02 "대화로 풀어가라고 했잖아". 그 브레이크는 대표가 만든 게 아니라 09-02 하네스가 Fable 감사 뒤 넣은 것(bf81ead)이었다.
    const called = addressees(e.text, cast).filter((to) => to !== e.actor && participants(team).includes(to));
    for (const [k, to] of called.entries()) {
      // 대표가 부른 사람이 claude 자리면 /api/say 가 이미 그에게 넣었다(첫 사람) — 다시 주지 않는다.
      // codex 자리면 넣을 세션이 없어 서버가 말풍선만 남겼다 — 여기서 깨운다 (레오 감사, 2026-09-12).
      if (e.actor === 'boss' && k === 0 && !isOutside(team, to)) continue;
      enqueue(team, to, 'called');
    }
    armLull(team);
  }
}

/**
 * 총괄실 발언이 다른 방 사람을 첫머리에 불렀으면 그 방에 같은 말을 남긴다 — 화자는 그대로(chief), 출처는 meta.from.
 * 그 방의 사회자가 이 사본을 보고 불린 사람을 깨운다. 사본은 meta.from 이 있어 다시 옮기지 않는다.
 * 대표 발언은 옮기지 않는다 — 대표의 지시는 총괄이 배달(dispatch)로 옮긴다.
 *
 * 닫힌 방(idle)에도 간다 (결정 127 ② — 09-15 밤에도 "옮기지 못했습니다" 가 두 번: 12:22 하영 · 12:32 테라). /api/say 와 같은 길이다:
 * 훅에 "이번 턴은 적어라" 표시(allowIdleChat)를 켜고 사본을 남긴 뒤, 사회자는 idle 이면 차례를 안 돌리니(noticeEvents 가 idle 에서 돌아간다)
 * 여기서 불린 사람에게 직접 준다. 전엔 note 한 줄 남기고 버렸다. 막힌 방(blocked)은 그대로 — 대표 판단 대기는 총괄 말로 풀지 않는다.
 */
function crossPost(team, e) {
  if (e.actor === 'boss' || e.actor === 'system') return;
  for (const t of listTeams()) {
    if (t.id === team || isOffice(t.id)) continue;
    // 호명은 이름으로 맞춘다 — 자리 이름(outside)이 방마다 있어도 제리와 다니엘은 다른 이름이다.
    const cast = readCast(t.id).agents ?? {};
    const there = addressees(e.text, cast).filter((to) => to !== 'boss');
    if (!there.length) continue;
    const idle = readState(t.id).phase === 'idle';
    if (idle) allowIdleChat(t.id);
    emit(t.id, { actor: e.actor, type: 'message', text: e.text, meta: { from: team, origin: e.id } });
    if (!idle) continue;
    for (const to of there) {
      if (!participants(t.id).includes(to)) continue;
      // codex 자리가 도는 중이면 또 띄우지 않는다(한 자리에 프로세스 하나) — claude 자리는 세션 큐가 받는다.
      if (isOutside(t.id, to) && busy(t.id, to)) { note(t.id, `${nameOf(t.id, to)}이 지금 답하는 중이라 이 말은 다음 차례에 듣습니다.`); continue; }
      giveTurn(t.id, to, 'called');
    }
  }
}

/** 서버가 자리 하나를 깨운다 — 대표가 이름 없이 말했는데 주인이 codex 자리일 때(/api/say, 결정 69 ①). 호명 차례와 같다. */
export function wake(team, actor) {
  if (!participants(team).includes(actor)) return false;
  enqueue(team, actor, 'called');
  return true;
}

/** 화면·시험용. */
export function snapshot(team) {
  const r = room(team);
  return { pending: [...r.pending.entries()].map(([a, p]) => `${a}:${p.kind}${p.notBefore ? '@' + new Date(p.notBefore).toISOString().slice(11, 19) : ''}`), recent: r.recent, lulls: lullUsed(team), outsideBusy: r.outsideBusy, flow: r.flow ? { step: r.flow.steps[r.flow.i], waiting: r.flow.waiting, asked: r.flow.asked } : null };
}
