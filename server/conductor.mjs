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
import { addressee, addressees, readCast, readState, isOffice, emit, readLog, readTail, quiet, verdictInstruction, verdictTargetActor, withVerdictTarget, roundLineOf, listTeams, isForeign, allowIdleChat, CAPS, takeLull, lullUsed, readRoadmap, listApprovals, readWork, delegateOverdueCards, readDelegation, roundWaitActive } from '../bus/bus.mjs';
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
      verdictAsk: null,     // 말로 외부감사를 판정으로 부른 것 { at, by, text, round } — 카드 없이 AUTO_VERDICT_MS 지나면 서버가 흐름을 돌린다(autoVerdicts)
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
    verdictAsk: r.verdictAsk ?? null,
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
    if (saved.verdictAsk && saved.verdictAsk.round === state.round && state.phase === 'running') r.verdictAsk = saved.verdictAsk;   // 시간은 autoVerdicts 가 이어서 잰다
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
      // 단, /api/say 가 실제로 세션에 바로 넣는 건 **이 방의 로컬 claude 자리**를 불렀을 때뿐이다 — 외부
      // 자리(codex)나 로밍 자리(집이 아닌 방의 나리·세라)를 불렀을 땐 말풍선만 남기고 아무 세션에도 안
      // 넣는다(server/index.mjs /api/say). 그런데도 got 을 방 주인으로 잡으면 주인마저 못 듣는다 —
      // 대표가 레오·다니엘에게 한 말이 팀 누구에게도 안 들리던 것(점검-코드리뷰-0916 #6).
      const to = addressee(e.text, cast);
      const got = to ? (cast[to]?.model === 'claude' ? to : null) : session.ownerOf(team);
      if (got && got === actor) continue;
    }
    if (e.type === 'round_start' || e.type === 'round_end' || e.type === 'milestone') { lines.push(`[${e.text}]`); continue; }
    const who = nameOf(team, e.actor) + (e.meta?.from ? '(총괄실에서)' : '');
    const tag = e.type === 'verdict' ? ` [${e.meta?.verdict ?? ''}]` : e.type === 'note' ? ' (안내)' : '';
    lines.push(`${who}${tag}: ${String(e.text).replace(/\s+/g, ' ').slice(0, HEAR_CHARS)}`);
  }
  return { lines: lines.slice(-HEAR_LINES), last };
}

/** 판정 차례의 지시문. ⟦판정 요청⟧ 마커를 훅이 보고 첫 줄을 판정으로 남긴다 — 모든 엔진이 같은 규약. 글은 bus.verdictInstruction 하나(outside.mjs 도 같은 것) — 떨어뜨릴 이유 셋 먼저(점검-0916 3-9 ⑥). */
const VERDICT_INSTRUCTION = (target, guideName) => verdictInstruction(target, guideName);

const INSTRUCTION = {
  called: '방에서 너에게 한 말이다. 상대 이름으로 시작해 네 말투로 한두 문장 — 사람에게 말하듯, 보고서·목록 말고. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라. 남길 말이 없으면 (패스) 한 마디만.',
  lull: '방이 잠시 조용하다. 아무도 너에게 말한 건 아니다. 오간 말에 보탤 것이 있거나 누군가에게 한마디 걸고 싶으면 네 말투로 한두 문장 — 없으면 (패스) 한 마디만. 첫 줄에 PASS·REVISE 를 쓰지 마라.',
  third: '두 사람 사이에서 같은 얘기가 세 번 오갔다. 너는 제3자다. 정리하거나 다른 각도를 하나만, 네 말투로 한두 문장. 없으면 (패스).',
  lunch: '점심시간이다. 일 얘기는 잠시 두고 네 말투로 한마디 툭 — 한 문장. 없으면 (패스).',
  carried: '지난 라운드가 닫히면서 못 받은 차례다 — 위 말 끝에 누가 너에게 한 말이 있다. 새 라운드가 열렸으니 그 말에 지금 답해라. 상대 이름으로 시작해 네 말투로 한두 문장. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라. 남길 말이 없으면 (패스) 한 마디만.',
  // 멈춤 감시(㉡~㉣, checkStalls) 가 주는 차례 둘 — 사람이 부른 게 아니라 서버가 조용함을 보고 불렀다.
  roadmap: '이 방의 로드맵 마일스톤이 모두 pass 다. 다음 단계를 제안해라 — 제안 파일을 teams/<이 팀>/out/ 에 쓰고, node bus/approve.mjs --request C --roadmap out/<파일명> "무엇" 으로 카드를 올려라. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라.',
  status: '방이 한동안 조용하다(20분 동안 사건 없음). 지금 뭐 하고 있는지 한 줄만 남겨라 — 막힌 게 있으면 그것도 같이. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라.',
  close: '판정이 끝났는데 회차가 안 닫혔다(20분 넘게). node bus/round.mjs end 로 지금 닫아라 — 판정이 아니다.',
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
  // 만든 사람 — 예전엔 늘 방 주인이었다(테라). 서로 감사(결정 125)로 ops 등이 평가받을 땐 틀린 이름이었다 —
  // target 글에 이미 박힌 '대상:' 표시(startVerdict)를 그대로 읽으면 맞는 자리가 나온다.
  const instruction = kind === 'verdict' ? VERDICT_INSTRUCTION(target, nameOf(team, verdictTargetActor(team, target))) : INSTRUCTION[kind];
  // 턴마다 이름을 한 번 불러 준다 — 긴 세션에서 말투가 모델 기본값으로 흘러가는 것을 막는 닻 (docs/cases.md 24·25).
  const anchor = kind === 'verdict' ? '' : `너는 ${nameOf(team, actor)}다. `;
  // 라운드 한 줄도 턴마다 다시 준다 — 브리프(라운드 번호·마일스톤)는 세션이 새로 뜰 때만 실리는데, T2 뒤로
  // 같은 단계 안이면 세션이 여러 회차를 산다. 새로 안 주면 옛 번호를 계속 붙들고 답한다(2판 코드 점검 #11).
  const roundLine = isOffice(team) ? '' : `지금: ${roundLineOf(team)}\n`;
  const body = (lines.length ? `그동안 이 방에서 오간 말:\n\n${lines.join('\n')}\n\n---\n` : '') + roundLine + anchor + instruction;
  const before = cursorOf(team, actor);               // 서버가 이 턴 중에 죽으면 여기로 되돌린다 (결정 104)
  if (last) setCursor(team, actor, last);
  // since — 이 턴을 준 시각(메모리에만, persist 는 안 한다). checkStalls(㉣) 가 이 값으로 "세션이 꺼진 채 답이 없다" 를 잰다.
  r.inflight.set(actor, { kind, cursor: before, since: Date.now() }); persist(team);
  const sent = session.send(team, quiet(body), actor, kind === 'verdict' ? { kind: 'verdict', extra: target.slice(0, 200) } : {});
  if (sent?.refused) { r.inflight.delete(actor); persist(team); note(team, `${nameOf(team, actor)}의 차례를 주지 못했습니다 — ${sent.reason}`); }
}

/**
 * 세션이 집 방 하나뿐인 자리들(N1 — 나리 system 은 hq, 세라 secretary 는 sera. 나리 지적 09-16 10:5x —
 * 팀마다 세션이 생기면 대표가 막은 이중 소모다). 집이 아닌 방에서 불리면 그 방 사정을 들려줘 집 세션에게
 * 묻고, 답이 오면 그 방에 옮겨 적는다 — 전화를 대신 받아 적는 것과 같다.
 */
export const ROAM_HOME = { system: 'hq', secretary: 'sera' };

/**
 * 집이 아닌 방에서 로밍 자리(system·secretary)가 불렸다. 진짜 기록(그의 진짜 대화)은 집 대화록에 남고,
 * 부른 방에는 meta.via:<집>·meta.hand:'server' 사본이 선다(hand — C16, 서버 세션이 낸 진짜 말이라는 뜻).
 * 집 쪽 원본에는 meta.roam:<부른 방> 을 찍는다 — 대표가 총괄실에서 이 줄을 보고 "왜 개발 방 말이
 * 여기 있나"(12:59) 물었다, 훅이 turn.extra(이 team 값)를 읽어 단다(하네스 얇게 — 여기서 한 번만).
 * sendAndWait 을 쓰므로(진행 중인 턴이 있으면 큐에 서서) 기다렸다 처리한다 — fire-and-forget.
 */
function callHomeElsewhere(actor, team, kind = 'called') {
  const home = ROAM_HOME[actor];
  const { lines, last } = unheard(team, actor, {});
  if (last) setCursor(team, actor, last);
  const roomName = listTeams().find((t) => t.id === team)?.room ?? team;
  const homeName = listTeams().find((t) => t.id === home)?.room ?? home;
  const who = nameOf(home, actor);
  const anchor = `너는 ${who}다. 지금 ${roomName}에서 불렸다 — 네 세션은 ${homeName} 하나뿐이라 그 세션이 이 방 사정을 듣고 대신 답한다. `;
  const body = (lines.length ? `그동안 그 방에서 오간 말:\n\n${lines.join('\n')}\n\n---\n` : '') + anchor + INSTRUCTION[kind];
  session.sendAndWait(home, quiet(body), actor, { kind: 'called', extra: team, internal: true }).then((text) => {
    const t = String(text ?? '').trim();
    if (!t || t === '(패스)') return;
    try { emit(team, { actor, type: 'message', text: t, meta: { via: home, hand: 'server' } }); } catch { /* 방이 닫혔으면 조용히 넘어간다 */ }
  }).catch((e) => note(team, `${nameOf(home, actor)}에게 묻지 못했습니다 — ${String(e.message ?? e).slice(0, 160)}`));
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
const RANK = { verdict: 4, third: 3, called: 2, carried: 2, roadmap: 2, status: 2, close: 2, lull: 1, lunch: 1 };
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
    // 로드맵 청함(㉡, checkStalls)은 방이 idle 이라는 사실 자체가 이유라 라운드 없이도 나간다 — 안 그러면
    // 바로 아래 stash→pickCarry 가 'roadmap' 을 모르는 종류라 그냥 버렸다(2판 #6, "다음 단계 제안이 안 옴").
    for (const [actor, p] of [...r.pending]) {
      if (p.kind !== 'roadmap' || busy(team, actor)) continue;
      r.pending.delete(actor);
      giveTurn(team, actor, p.kind, p.tries ?? 1);
    }
    // 막 닫혔다(idle) — 닫히는 동안 dispatch 가 안 돌았으면 나머지(로드맵 아닌 것)는 여기서 넘긴다. blocked 는 대표 차례라 버린다.
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
export function startVerdict(team, target, targetSeat = null, requester = null) {
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
  r.verdictAsk = null;   // 흐름이 돌면 말로 부른 기록은 할 일을 다했다
  // 대상을 여기서 한 번 정해 글에 박는다(세라 조건 — 판정 요청마다 '대상:' 명시, apr_132205cc) — 클로드
  // 감사역(giveTurn)도 codex·gemini 감사역(bus/outside.mjs)도 같은 이 글을 받으니 어느 길이든 같은 값이다.
  // targetSeat 는 청하는 쪽이 직접 적은 것(--target, /api/verdict) — 자유 글 짐작보다 우선한다(테라
  // code-review 지적 ①: "테라 화면 + 솔라 서버" 처럼 둘을 한 번에 청하면 짐작은 하나로 뭉개진다).
  // requester(청한 자리)는 그다음 — 명시가 없으면 청한 자리 본인이 기본, 감사가 청했을 때만 이름 찾기
  // (나리 15:3x — 헨리가 청했는데 글 속 "클레멘타인" 이름을 잡아 엉뚱하게 ops 로 찍혔다).
  const targetText = String(target ?? '').trim() || '이번 라운드 산출물';
  const vt = withVerdictTarget(team, targetText, targetSeat, requester);
  r.flow = { target: vt.text, steps, i: 0, asked: 0, skipped: outsideWhy && out ? ['outside'] : [], reason: outsideWhy };
  // meta.target — 판정 대상 글 그대로. 닫을 때 bus.artifactsOf 가 여기서 out/ 경로를 읽어 산출물이 비었는지 본다(8단계).
  emit(team, { actor: 'system', type: 'note', text: `판정 시작 — ${r.flow.target}. ${steps.map((s) => nameOf(team, s)).join(' → ')} 순서.`, meta: { verdictFlow: 'start', steps, skipped: r.flow.skipped, reason: outsideWhy, target: r.flow.target } });
  // 대상을 못 찾아 guide 로 기본값이 갔다 — 조용히 넘어가지 않는다(테라 code-review 지적 ③, 세라가 걸었던
  // "조용히 guide 로 잇는 병"과 같은 자리). --target 을 쓰라고 바로 알려 준다.
  if (!vt.matched) {
    emit(team, { actor: 'system', type: 'note', text: `판정 대상을 글에서 못 찾아 ${nameOf(team, 'guide')}(기본값)로 갑니다 — 다른 자리를 보게 하려면 node bus/round.mjs verdict --target <자리> "…" 로 다시 부르세요.`, meta: { verdictFlow: 'target-default' } });
  }
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
    // 아직 일하는 중이면 안 끊는다(2판 코드 점검 #5) — 시간만 보고 끊으면 긴 감사 도중에도 흐름이
    // 놓였다. 진짜 멈춘 세션은 세션 자체의 무응답 타이머(session.mjs TURN_TIMEOUT)가 먼저 잡는다 —
    // 그러면 busy 가 꺼지고 여기서 다음 틱에 정리된다.
    if (busy(team, who)) continue;
    r.flow = null; r.pending.delete(who); r.inflight.delete(who); persist(team);
    emit(team, { actor: 'system', type: 'note', text: `판정 흐름을 멈춥니다 — ${nameOf(team, who)}이 ${Math.round(FLOW_TIMEOUT_MS / 60_000)}분 안에 판정을 내지 않았습니다. 다시 부르세요 (node bus/round.mjs verdict).`, meta: { verdictFlow: 'timeout', waiting: who } });
  }
}

/**
 * 말로 부른 판정 — 카드 없이 10분이면 서버가 흐름을 돌린다 (나리 점검-0916 3-7, R31).
 * 실무가 "레오, … 판정 …" 하고 부르면 called 차례만 가서 외부감사가 "재보겠습니다" 로 끝나는 일이 마크 89%·다니엘 100% 였다.
 * 판정은 흐름(startVerdict → verdict 차례)이어야 카드가 온다. 순수한 asksVerdict 는 check 가 돌린다.
 */
export const AUTO_VERDICT_MS = Number(process.env.PPANAM_AUTO_VERDICT_MS || 10 * 60_000);
/** 첫머리에 외부감사를 부른 말이 판정을 청하는가 — "판정" 낱말(판정해·판정 부탁·판정 카드). 인용("판정은 나중에")도 걸리지만 카드가 오면 안 돌리고, 돌아도 흐름 한 번이다. */
export const asksVerdict = (text) => /판정/.test(String(text ?? ''));
export function autoVerdicts(now = Date.now()) {
  for (const [team, r] of rooms) {
    const a = r.verdictAsk;
    if (!a || r.flow || now - a.at < AUTO_VERDICT_MS) continue;
    let state; try { state = readState(team); } catch { continue; }
    r.verdictAsk = null; persist(team);
    if (state.phase !== 'running' || state.round !== a.round) continue;   // 회차가 닫혔거나 막혔다 — 흐름 돌릴 자리가 아니다
    const min = Math.round((now - a.at) / 60_000);
    emit(team, { actor: 'system', type: 'note', text: `${ga(nameOf(team, a.by))} ${min}분 전에 ${eul(nameOf(team, 'outside'))} 판정으로 불렀는데 판정 카드가 없어 서버가 판정 흐름을 돌립니다.`, meta: { verdictFlow: 'auto', askedBy: a.by, askedAt: new Date(a.at).toISOString(), waitedMs: now - a.at } });
    try {
      startVerdict(team, a.text, null, a.by);
    } catch (e) {
      note(team, `말로 부른 판정을 흐름으로 돌리지 못했습니다 — ${String(e.message).slice(0, 120)}`);
    }
  }
}

/* ── 멈춤 감시 (나리 지시, 전체-작업표-0916 #12 — 대표 "라운드 안 켜져서 다 아무 말도 안 하는 거 왜 아무도 해결 안 함?") ──
 * 멈춤 넷 중 ㉠(회차가 닫힌 뒤 5분 — 같은 단계로 다시 열기)은 이미 됨(커밋 9840773, bus.endRound). 여기는 나머지 셋:
 *   ㉡ 로드맵 마일스톤이 전부 pass — 실무를 불러 다음 단계 제안 카드(--roadmap)를 올리게 하고, 10분 안에 카드가 없으면 표에 올린다.
 *   ㉢ 회차가 running 인데 20분 동안 사건이 0 — 실무를 불러 "지금 뭐 하나" 한 줄을 묻는다.
 *   ㉣ 자리 세션이 꺼진 채로 차례가 나갔는데 응답이 없다(giveTurn 의 inflight.since 로 잰다) — 세션을 다시 띄우고 note.
 * expireFlows·autoVerdicts 와 같은 자리 — index.mjs 틱이 순수 함수처럼 now 를 넣어 부른다(round.mjs check 가 가짜 now 로 시험할 수 있게).
 * Date.now() 를 직접 부르지 않는다 — 인자로 받은 now 를 쓴다. 부작용은 enqueue/giveTurn(차례)·note/emit(안내) 뿐이다.
 * 팀마다 room(team).stall 에 "이미 불렀다·이미 알렸다" 표시를 남겨 매 틱(250ms) 마다 다시 부르거나 다시 알리지 않는다 — 조건이 풀리면 비운다.
 * 걸린 게 하나도 없으면 hq 에 아무것도 안 보낸다(토큰 0) — 걸린 게 있을 때만, 그 팀·그 종류로 한 번만 표에 올린다.
 */
export const ROADMAP_PROPOSAL_MS = Number(process.env.PPANAM_ROADMAP_PROPOSAL_MS || 10 * 60_000);
export const ROUND_SILENT_MS = Number(process.env.PPANAM_ROUND_SILENT_MS || 20 * 60_000);
export const DEAD_SEAT_MS = Number(process.env.PPANAM_DEAD_SEAT_MS || 5 * 60_000);
export const CLOSE_REMINDER_MS = Number(process.env.PPANAM_CLOSE_REMINDER_MS || 20 * 60_000);

const stallState = (team) => (room(team).stall ??= { roadmap: null, silent: null, closeReminded: null, delegate: null });
/** 순수 — 이 팀에서 work.json 에 "진행" 으로 걸린 자리들(독립검수 실측: ㉢ 이 owner 만 불러 다른 몫 자리를 놓쳤다). */
export function workSeatsOf(team, work) {
  return [...new Set((work?.items ?? []).filter((it) => it.team === team && it.status === '진행').map((it) => it.seat))];
}
/**
 * 완료 조건(D1, 대표 승인 09:5x 151 — 닫힘 조건은 감사 통과 + 완료 조건 둘뿐). 그 자리(team+seat)가 걸린
 * "진행"·"감사 대기" 항목을 찾아 doneCheck 를 본다 — 저장소 기준 상대 경로 한 줄(예: "안젤 검수 파일 있음"의
 * 실제 값 "teams/design/out/usability-0916.md"). 그 파일이 있고 0바이트가 아니면 통과. 아직 아무도 doneCheck
 * 를 안 적었으면(필드 없음) 감사 통과만으로 충분하다 — 예전 동작 그대로, 억지로 조건을 만들지 않는다.
 */
export function doneCheckOf(team, seat, work) {
  const items = work?.items ?? [];
  const item = items.find((it) => it.team === team && it.seat === seat && (it.status === '진행' || it.status === '감사 대기')) ?? null;
  if (!item?.doneCheck) return { ok: true, item };
  // doneCheck 는 work.json 에 자유로이 적히는 경로다 — 경계 없이 join 만 하면 "../../etc/passwd" 같은
  // ..로 저장소 밖도 완료 조건이 됐다(2판 코드 점검 #10). 저장소 밖이면 그 자체를 이유로 돌려준다 —
  // 오타든 뭐든 아무리 기다려도 파일이 안 생기니, 호출부(checkStalls ㉤)가 이건 조용히 안 기다리고 알린다.
  const abs = path.resolve(REPO, item.doneCheck);
  if (abs !== REPO && !abs.startsWith(REPO + path.sep)) return { ok: false, item, reason: `저장소 밖 경로 — ${item.doneCheck}` };
  let bytes = 0;
  try { bytes = fs.statSync(abs).size; } catch { bytes = 0; }
  return { ok: bytes > 0, item, reason: bytes > 0 ? null : '파일 없음(아직 안 썼거나 경로가 틀림) — 아직 조용히 기다림' };
}
/** 순수 — 로드맵 마일스톤이 있고 전부 pass 인가. round.mjs check 가 돌려본다. */
export function roadmapAllPass(roadmap) {
  const ms = roadmap?.milestones ?? [];
  return ms.length > 0 && ms.every((m) => m.status === 'pass');
}
const minAgo = (now, ts) => Math.max(0, Math.round((now - ts) / 60_000));

export function checkStalls(now = Date.now()) {
  const rows = [];
  for (const t of listTeams()) {
    const team = t.id;
    if (isOffice(team)) continue;
    let state; try { state = readState(team); } catch { continue; }
    const r = room(team);
    const s = stallState(team);
    const owner = session.ownerOf(team);

    // ㉡ — 로드맵이 전부 pass 인 건 보통 라운드가 닫힌(idle) 뒤다. running 중이면(다음 마일스톤이 이미 now) 걸 게 없다.
    let roadmap; try { roadmap = readRoadmap(team); } catch { roadmap = null; }
    if (state.phase === 'idle' && roadmapAllPass(roadmap)) {
      if (!s.roadmap) {
        s.roadmap = { askedAt: now, notified: false };
        note(team, `${nameOf(team, owner)}, 로드맵 마일스톤이 모두 pass 입니다 — 다음 단계 제안 카드(--roadmap)를 올려 주세요.`);
        enqueue(team, owner, 'roadmap');
      } else if (!s.roadmap.notified && now - s.roadmap.askedAt >= ROADMAP_PROPOSAL_MS) {
        s.roadmap.notified = true;   // 카드가 왔든 안 왔든 이 청함은 여기서 끝 — 다시 걸리려면 로드맵이 바뀌어야
        const proposed = listApprovals({ team }).some((a) => a.action?.type === 'roadmap' && new Date(a.ts).getTime() >= s.roadmap.askedAt);
        if (!proposed) rows.push([team, state.round, minAgo(now, s.roadmap.askedAt), `계획표 전부 pass — ${nameOf(team, owner)}에게 제안 카드를 청했는데 아직 없음`]);
      }
    } else {
      s.roadmap = null;
    }

    // ㉢ — 회차가 running 인데 20분 동안 이 라운드의 사건(message·verdict)이 없다. owner(실무) 만 부르면
    // 그 회차에 몫이 걸린 다른 자리(work.json 에 "진행" 으로 걸린 seat)가 조용해도 못 잡는다 — 독립검수 실측,
    // 노라(경영 ops)가 71분 조용했는데 안 걸림. owner + work.json 몫이 걸린 자리를 같이 부른다.
    // 위임 자리(결정 154, D4)는 뺀다 — 일반 침묵 20분과 위임 판정 40분은 다른 시계라, 같이 넣으면
    // 판정을 기다리는 중인데 "지금 뭐 하나" 로 또 부르게 된다(㉥ 이 그 시계를 따로 잰다).
    // 기다림(O1, 톰 지적 09-16)도 뺀다 — "내일 06:30 첫 실물까지 답만" 처럼 회차가 스스로 기다림을 적었으면
    // (node bus/round.mjs wait) until 까지는 조용한 게 정상이라 20분 부름이 헛돈다.
    if (state.phase === 'running' && !roundWaitActive(state, now)) {
      const log = readLog(team).filter((e) => e.round === state.round && (e.type === 'message' || e.type === 'verdict'));
      const lastTs = log.length ? new Date(log[log.length - 1].ts).getTime() : (state.startedAt ? new Date(state.startedAt).getTime() : now);
      if (now - lastTs >= ROUND_SILENT_MS) {
        if (!s.silent || s.silent.since !== lastTs) {
          let work; try { work = readWork(); } catch { work = null; }
          const dg = readDelegation(now);
          const actors = [...new Set([owner, ...workSeatsOf(team, work)])].filter((a) => !(dg && a === dg.to));
          s.silent = { since: lastTs, notified: false, actors };
          note(team, `방이 ${Math.round(ROUND_SILENT_MS / 60_000)}분째 조용합니다 — ${actors.map((a) => nameOf(team, a)).join('·')}에게 지금 하는 일을 묻습니다.`);
          for (const a of actors) enqueue(team, a, 'status');
        }
        if (!s.silent.notified) {
          s.silent.notified = true;
          rows.push([team, state.round, minAgo(now, lastTs), `${Math.round(ROUND_SILENT_MS / 60_000)}분째 사건 없음 — ${s.silent.actors.map((a) => nameOf(team, a)).join('·')}을 불렀음`]);
        }
      } else {
        s.silent = null;
      }
    } else {
      s.silent = null;
    }

    // ㉤(독립검수 실측 + D1, 대표 승인 09:5x 151) — 판정이 다 났는데 회차를 닫는 눈이 없었다. 닫힘 조건은
    // 둘뿐이라고 정했다: 감사 통과(이 회차의 "판정 완료" note) + 완료 조건 통과(그 일에 걸린 work.json 항목의
    // doneCheck — 파일 경로 한 줄, 예: "안젤 검수 파일 있음"이면 그 파일이 실제로 있나). 둘 다 됐을 때만,
    // 한 번만 부른다 — 참고-비교-0916.md 6절 1번("닫는 조건이 둘이 되면 더 안 닫힌다"는 지적을 하나로 합쳐 풀었다).
    // 항목에 doneCheck 가 없으면(아직 아무도 안 적었으면) 감사 통과만으로 충분하다 — 예전 동작 그대로.
    if (state.phase === 'running') {
      const roundLog = readLog(team).filter((e) => e.round === state.round);
      const closed = roundLog.some((e) => e.type === 'round_end');
      const lastPass = [...roundLog].reverse().find((e) => e.type === 'note' && e.meta?.verdictFlow === 'pass');
      if (!closed && lastPass) {
        const passedAt = new Date(lastPass.ts).getTime();
        if (now - passedAt >= CLOSE_REMINDER_MS) {
          let work; try { work = readWork(); } catch { work = null; }
          const dc = doneCheckOf(team, owner, work);
          if (dc.ok) {
            if (s.closeReminded !== `${state.round}:${lastPass.id}`) {
              s.closeReminded = `${state.round}:${lastPass.id}`;
              note(team, `판정이 끝난 지 ${Math.round(CLOSE_REMINDER_MS / 60_000)}분이 지났는데 회차가 안 닫혔습니다 — ${nameOf(team, owner)}, 닫으세요.`);
              enqueue(team, owner, 'close');
              rows.push([team, state.round, minAgo(now, passedAt), `판정 완료 뒤 안 닫힘 — ${nameOf(team, owner)}에게 닫으라 알림`]);
            }
          } else if (dc.reason?.startsWith('저장소 밖')) {
            // 저장소 밖 경로는 아무리 기다려도 안 생긴다 — 조용히 기다리지 않고 한 번은 알린다(2판 #10).
            const tag = `bad-path:${dc.item?.id}`;
            if (s.closeReminded !== tag) {
              s.closeReminded = tag;
              note(team, `완료 조건 경로가 저장소 밖입니다 — ${dc.item?.doneCheck} (work.json ${dc.item?.id}). 고쳐야 회차가 닫힙니다.`);
              rows.push([team, state.round, minAgo(now, passedAt), `완료 조건 경로가 저장소 밖 — work.json 고쳐야 함`]);
            }
          } else {
            // 완료 조건이 아직이면 조용히 기다린다 — 재촉하지 않는다. 다음 틱에 파일이 생기면 그때 부른다.
            s.closeReminded = null;
          }
        }
      } else {
        s.closeReminded = null;
      }
    } else {
      s.closeReminded = null;
    }

    // ㉣ — 차례가 나갔는데(inflight) 그 자리 세션이 꺼져 있고, 그 상태로 DEAD_SEAT_MS 를 넘겼다. 외부 자리(codex·gemini)는
    // outsideFailed 가 이미 재시도·버림을 한다 — 여기서는 claude 자리만 본다. 다시 띄우면(giveTurn) inflight.since 가 새로 찍혀
    // 다음 판정까지 또 DEAD_SEAT_MS 가 걸린다 — 매 틱 다시 띄우지 않는다.
    for (const [actor, inf] of [...r.inflight]) {
      if (isOutside(team, actor)) continue;
      if (session.status(team, actor).alive) continue;
      const since = inf.since ?? now;
      if (now - since < DEAD_SEAT_MS) continue;
      r.inflight.delete(actor); persist(team);
      note(team, `${nameOf(team, actor)}의 세션이 꺼진 채 ${minAgo(now, since)}분째 답이 없습니다 — 다시 띄웁니다.`);
      giveTurn(team, actor, inf.kind, 1);
      rows.push([team, state.round, minAgo(now, since), `${nameOf(team, actor)} 세션 꺼짐 — 다시 띄움`]);
    }
  }

  // ㉥ — 위임 자리(결정 154, D4) 판정 카드 마감 감시. 팀 방 루프 밖의 전역 검사 — 위임·승인 큐는
  // 총괄실 하나뿐이라 팀마다 돌 이유가 없다. 위임 자리(나리)가 아직 안 정한 카드가 40분을 넘으면
  // 한 번만 hq 에 note + 그 자리를 부른다(dedup 은 hq stallState.delegate 에 카드 id 로).
  {
    const overdue = delegateOverdueCards(now);
    const ds = stallState('hq');
    if (overdue.length) {
      ds.delegate ??= new Set();
      const fresh = overdue.filter((r) => !ds.delegate.has(r.id));
      if (fresh.length) {
        for (const r of fresh) ds.delegate.add(r.id);
        const dg = readDelegation(now);
        const who = nameOf('hq', dg?.to ?? 'system');
        const body = fresh.map((r) => `${r.team} · [${r.grade}] ${r.what} (${minAgo(now, new Date(r.ts).getTime())}분 전)`).join('\n');
        emit('hq', { actor: 'system', type: 'note', text: `${who}, 위임 중인 판정 카드가 40분을 넘겼습니다 — 지금 정해 주세요.\n${body}`, meta: { delegateOverdue: fresh.map((r) => r.id) } });
        if (dg?.to && dg.to !== 'boss') enqueue('hq', dg.to, 'called');
        for (const r of fresh) rows.push([r.team, r.round ?? 0, minAgo(now, new Date(r.ts).getTime()), `위임 카드 40분 넘김 — ${who}에게 알림 (${r.id})`]);
      }
    } else {
      stallState('hq').delegate = null;
    }
  }

  if (rows.length) {
    const body = rows.slice(0, 10).map(([team, round, min, what]) => `${team} · R${round} · ${min}분 전 · ${what}`).join('\n');
    emit('hq', { actor: 'system', type: 'note', text: `톰, 멈춤 감시 — 팀 · 회차 · 마지막 사건(분 전) · 무엇이 멈췄나\n${body}`, meta: { stallPatrol: rows.map(([team, round, min, what]) => ({ team, round, min, what })) } });
  }
  return rows;
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
    // 모양이 안 맞아 서버가 REVISE 로 되돌린 PASS(meta.shape, 점검-0916 3-9) — 실무를 부르지 않고 그 자리에 한 번 더 묻는다. 두 번째도 그러면 흐름을 놓는다.
    if (e.meta?.shape) {
      if (f.asked < 1) { f.asked += 1; f.since = Date.now(); persist(team); enqueue(team, e.actor, 'verdict'); return; }
      r.flow = null; f.waiting = null; persist(team);
      emit(team, { actor: 'system', type: 'note', text: `${ga(nameOf(team, e.actor))} 두 번 물어도 떨어뜨릴 이유 셋 없이 PASS 를 냈습니다. 판정 흐름을 멈춥니다 — 다시 부르세요 (node bus/round.mjs verdict).`, meta: { verdictFlow: 'abort', reason: 'shape' } });
      return;
    }
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
      // 시스템 화자로 남겼는데 아무도 안 깨어 20분 멈춘 일(2026-09-12). codex 자리도 같다. system(나리) 자신이
      // 남긴 note 가 또 나리를 부르는 경우는 없다 — 있어도 아래 callable 판단이 hq 로 돌려보낸다.
      for (const to of addressees(e.text, cast)) {
        if (to === 'boss') continue;
        if (ROAM_HOME[to] && team !== ROAM_HOME[to]) { callHomeElsewhere(to, team, 'called'); armLull(team); continue; }
        if (participants(team).includes(to)) { enqueue(team, to, 'called'); armLull(team); }
      }
      continue;
    }

    // 총괄실(hq)에서 다른 방 사람을 불렀다 — 그 방에도 같은 말을 게시한다 (아래 crossPost). 총괄실 세션의 훅은
    // 자기 방에만 남기므로 톰의 "하영, …" 이 하영 없는 방에만 떴다 (대표 원문 09-13 13:08, 결정 21). **비서실은
    // 뺀다** — 대표 원문 09-16 10:55 "비서실에서 나눈 세라랑 나리 대화가 그냥 그대로 다른 방에 노출되는거야?" —
    // isOffice(team) 이 hq 뿐 아니라 sera 도 참이라, 세라가 "나리, …" 라고만 해도(N1 뒤로 나리는 어느 방에서든
    // 이름이 잡힌다) 비서실 대화가 통째로 다른 방에 복사됐다. 비서실 말을 다른 방에 옮길 일이 생기면 인용
    // 모양(meta.quote)으로 — 원문 그대로 새 발언인 척 안 한다.
    // meta.via 가 있으면 callHomeElsewhere 가 이미 옮겨 적은 사본이다(로밍 자리의 답) — 그걸 또 다른 방에 옮기지 않는다.
    if (team === 'hq' && e.type === 'message' && !e.meta?.from && !e.meta?.via) crossPost(team, e);

    r.recent.push(e.actor);
    r.recent = r.recent.slice(-RECENT_KEEP);
    if (e.type === 'message') noteChat(team, e);   // 잡담인가 일인가 — 결정 121

    onFlowEvent(team, e);

    // 부른 사람 전부, 부른 순서대로 차례 (결정 22). 두 사람 왕복 브레이크(3회면 제3자·쉼)는 **결정 120 으로 철회** — 대표 09-14 "3번 넘으면 대화 못하게 하는 거 철회해",
    // 09-02 "대화로 풀어가라고 했잖아". 그 브레이크는 대표가 만든 게 아니라 09-02 하네스가 Fable 감사 뒤 넣은 것(bf81ead)이었다.
    // 로밍 자리(system·secretary)는 이 방 참여자 목록(participants)에 안 뜨는 방이 많다(세션이 집 하나뿐이라
    // model 이 거기서만 claude) — 그래도 이름을 부르면 불려야 하니 따로 끼운다(N1 재정의).
    const called = addressees(e.text, cast).filter((to) => to !== e.actor && (ROAM_HOME[to] || participants(team).includes(to)));
    for (const [k, to] of called.entries()) {
      // 대표가 부른 사람이 이 방의 claude 자리면 /api/say 가 이미 그에게 넣었다(첫 사람) — 다시 주지 않는다.
      // codex 자리나 로밍 자리(나리·세라, 집이 아닌 방)는 /api/say 가 세션에 못 넣고 말풍선만 남겼다 —
      // 여기서 깨운다 (레오 감사, 2026-09-12 · 점검-코드리뷰-0916 #1 — 총괄실 밖에서 "나리, …" 가 안 가던 것).
      const isRoamElsewhere = ROAM_HOME[to] && team !== ROAM_HOME[to];
      if (e.actor === 'boss' && k === 0 && !isOutside(team, to) && !isRoamElsewhere) continue;
      if (isRoamElsewhere) { callHomeElsewhere(to, team, 'called'); continue; }
      enqueue(team, to, 'called');
    }
    // 말로 외부감사를 판정으로 불렀다("레오, … 판정 …") — 흐름(startVerdict) 없이 called 차례만 가면 "재보겠습니다" 로 끝나고 카드가 안 온다
    // (나리 점검-0916 3-7: 마크 89%·다니엘 100%). 시각을 적어 두고 AUTO_VERDICT_MS 안에 카드가 없으면 autoVerdicts 가 흐름을 돌린다.
    if (!isOffice(team) && e.type === 'message' && !r.flow && called.includes('outside') && isOutside(team, 'outside') && asksVerdict(e.text)) {
      r.verdictAsk = { at: Date.now(), by: e.actor, text: e.text, round: state.round }; persist(team);
    }
    if (e.type === 'verdict' && e.actor === 'outside' && r.verdictAsk && !e.meta?.stale) { r.verdictAsk = null; persist(team); }   // 카드가 왔다 — 안 돌린다
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
  if (e.actor === 'boss' || ROAM_HOME[e.actor]) return;
  for (const t of listTeams()) {
    if (t.id === team || isOffice(t.id)) continue;
    // 호명은 이름으로 맞춘다 — 자리 이름(outside)이 방마다 있어도 제리와 다니엘은 다른 이름이다.
    const cast = readCast(t.id).agents ?? {};
    // 로밍 자리(system·secretary)는 집 세션 하나뿐이라 사본으로 옮기지 않는다(09-16 10:5x 대표: 비서실 말이
    // 다섯 방에 그대로 노출) — 다른 방에서 부르는 건 callHomeElsewhere 가 맡는다.
    const there = addressees(e.text, cast).filter((to) => to !== 'boss' && !ROAM_HOME[to]);
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
