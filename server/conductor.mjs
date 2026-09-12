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
//   5. 브레이크 — 같은 둘이 MAX_EXCHANGE 회 왕복이면 호명이어도 제3자에게 넘긴다. 제3자가 없으면 쉰다.
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
import { addressee, readCast, readState, isOffice, emit, readLog, readTail, quiet } from '../bus/bus.mjs';
import * as session from './session.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTSIDE = path.join(REPO, 'bus', 'outside.mjs');
const STORE = path.join(REPO, 'state', 'conductor.json');

export const LULL_MS = Number(process.env.PPANAM_LULL_MS || 90_000);
export const MAX_LULL_PER_HOUR = Number(process.env.PPANAM_LULL_PER_HOUR || 30);
export const MAX_EXCHANGE = Number(process.env.PPANAM_MAX_EXCHANGE || 3);
const HOUR = 3_600_000;
const HEAR_LINES = 40;    // 한 턴에 들려주는 최대 줄
const HEAR_CHARS = 600;   // 한 줄 최대 길이

const rooms = new Map();
session.onTurnEnd((team) => dispatch(team));
function room(team) {
  if (!rooms.has(team)) {
    rooms.set(team, {
      pending: new Map(),   // actor → { kind, from: [] }
      recent: [],           // 최근 발언자 (브레이크)
      lullTimer: null,
      lastLull: 0,
      lulls: [],            // 침묵 차례 시각 (시간당 상한)
      capNoted: 0,
      loopNoted: false,
      outsideBusy: false,
      outsideAgain: null,
      round: null,          // 마지막으로 본 라운드 번호 — 바뀌면 상태를 비운다
    });
  }
  return rooms.get(team);
}

/* ── 커서: 자리마다 "여기까지 들었다" ── */

function readStore() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; } }
function cursorOf(team, actor) { return readStore()[team]?.[actor] ?? null; }
function setCursor(team, actor, id) {
  const all = readStore();
  (all[team] ??= {})[actor] = id;
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}

function note(team, text) { try { emit(team, { actor: 'system', type: 'note', text }); } catch { /* 삼킨다 */ } }

/* ── 참여자 ── */

/** 이 방에서 차례를 받을 수 있는 자리. claude 자리 + 외부감사. */
function participants(team) {
  const agents = readCast(team).agents ?? {};
  return Object.keys(agents).filter((a) => agents[a]?.model === 'claude' || agents[a]?.model === 'gpt');
}
const isOutside = (team, actor) => readCast(team).agents?.[actor]?.model === 'gpt';
const nameOf = (team, actor) => readCast(team).agents?.[actor]?.name ?? actor;

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
function unheard(team, actor) {
  const since = cursorOf(team, actor);
  const state = readState(team);
  let events = isOffice(team) ? readTail(team, { limit: 60 }).events : readLog(team).filter((e) => e.round === state.round);
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
    if (e.actor === actor && e.type !== 'verdict') continue;
    if (e.actor === 'boss') {
      // /api/say 가 대표의 말을 주인(또는 대표가 부른 사람)에게 바로 넣었다. 그에게는 다시 들려주지 않는다.
      const to = addressee(e.text, cast);
      const got = to && cast[to]?.model === 'claude' ? to : session.ownerOf(team);
      if (got === actor) continue;
    }
    if (e.type === 'round_start' || e.type === 'round_end' || e.type === 'milestone') { lines.push(`[${e.text}]`); continue; }
    const who = cast[e.actor]?.name ?? e.actor;
    const tag = e.type === 'verdict' ? ` [${e.meta?.verdict ?? ''}]` : e.type === 'note' ? ' (안내)' : '';
    lines.push(`${who}${tag}: ${String(e.text).replace(/\s+/g, ' ').slice(0, HEAR_CHARS)}`);
  }
  return { lines: lines.slice(-HEAR_LINES), last };
}

const INSTRUCTION = {
  called: '방에서 너에게 한 말이다. 상대 이름으로 시작해 한두 문장으로 답해라. 판정이 아니다 — 첫 줄에 PASS·REVISE 를 쓰지 마라. 남길 말이 없으면 (패스) 한 마디만.',
  lull: '방이 잠시 조용하다. 아무도 너에게 말한 건 아니다. 그동안 오간 말에 보탤 것이 있을 때만 한두 문장 — 없으면 (패스) 한 마디만. 첫 줄에 PASS·REVISE 를 쓰지 마라.',
  third: '두 사람 사이에서 같은 얘기가 세 번 오갔다. 너는 제3자다. 정리하거나 다른 각도를 하나만, 한두 문장. 없으면 (패스).',
  lunch: '점심시간이다. 일 얘기는 잠시 두고 한마디 툭 — 한 문장. 없으면 (패스).',
};

/* ── 턴 보내기 ── */

function giveTurn(team, actor, kind) {
  const r = room(team);

  if (isOutside(team, actor)) {
    // codex 는 프로세스가 턴마다 뜬다. outside.mjs 가 자기 커서(lastSeen)로 못 들은 말을 붙이므로 여기선 종류만 넘긴다.
    r.outsideBusy = true;
    const args = [OUTSIDE, '--team', team, '--turn', kind];
    let child;
    try {
      child = spawn('node', args, { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env } });
    } catch (e) {
      r.outsideBusy = false;
      note(team, `${nameOf(team, actor)}을 깨우지 못했습니다 — ${String(e.message).slice(0, 160)}`);
      return;
    }
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    child.on('error', (e) => { r.outsideBusy = false; note(team, `${nameOf(team, actor)}을 깨우지 못했습니다 — ${String(e.message).slice(0, 160)}`); });
    child.on('close', (code) => {
      r.outsideBusy = false;
      // 1 은 outside.mjs 가 이미 방에 사유를 남긴 경우다. 그 밖의 비정상만 알린다.
      if (code && code !== 1) {
        const lastLine = err.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
        note(team, `${nameOf(team, actor)} 호출이 비정상 종료했습니다 (code ${code})${lastLine ? ' — ' + lastLine.slice(0, 160) : ''}`);
      }
      dispatch(team);
    });
    return;
  }

  const { lines, last } = unheard(team, actor);
  const body = (lines.length ? `그동안 이 방에서 오간 말:\n\n${lines.join('\n')}\n\n---\n` : '') + INSTRUCTION[kind];
  if (last) setCursor(team, actor, last);
  session.send(team, quiet(body), actor);
}

/** 차례를 예약한다. 같은 자리에 쌓이면 더 센 종류로 합친다. */
const RANK = { third: 3, called: 2, lull: 1, lunch: 1 };
function enqueue(team, actor, kind) {
  const r = room(team);
  const cur = r.pending.get(actor);
  if (!cur || (RANK[kind] ?? 0) > (RANK[cur.kind] ?? 0)) r.pending.set(actor, { kind });
  dispatch(team);
}

/** 예약된 차례 중 지금 줄 수 있는 것을 준다. 한 자리에 한 번에 하나, 놀고 있을 때만. */
function dispatch(team) {
  const r = room(team);
  const state = readState(team);
  if (!isOffice(team) && state.phase !== 'running') { r.pending.clear(); return; }
  for (const [actor, p] of [...r.pending]) {
    if (busy(team, actor)) continue;
    r.pending.delete(actor);
    giveTurn(team, actor, p.kind);
  }
}

/* ── 침묵 ── */

function underCap(team) {
  const r = room(team);
  const now = Date.now();
  r.lulls = r.lulls.filter((t) => now - t < HOUR);
  if (r.lulls.length < MAX_LULL_PER_HOUR) return true;
  if (now - r.capNoted > HOUR) {
    r.capNoted = now;
    note(team, `침묵 차례가 시간당 상한(${MAX_LULL_PER_HOUR}회)에 닿았습니다. 한 시간 동안은 호명·판정·대표 지시에만 답합니다.`);
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
  const cands = participants(team).filter((a) => a !== lastActor && !busy(team, a));
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
    if (!underCap(team)) return;
    const who = quietest(team);
    if (!who) return;
    r.lastLull = Date.now();
    r.lulls.push(r.lastLull);
    enqueue(team, who, mode === 'lunch' ? 'lunch' : 'lull');
  }, LULL_MS);
}

/* ── 브레이크 ── */

function inLoop(team) {
  const r = room(team).recent.slice(-MAX_EXCHANGE * 2);
  if (r.length < MAX_EXCHANGE * 2) return false;
  const two = new Set(r);
  if (two.size !== 2) return false;
  // 엄격한 교대(A B A B)가 아니어도 둘만 오갔으면 루프다 — 답이 늦어 A A B B 로 찍힐 때가 있다.
  const [a, b] = [...two];
  return r.filter((x) => x === a).length >= 2 && r.filter((x) => x === b).length >= 2;
}

/** 두 사람 사이 핑퐁이면 제3자에게. 없으면 null. */
function thirdParty(team, a, b) {
  return participants(team).find((x) => x !== a && x !== b && !busy(team, x)) ?? null;
}

/* ── 입구 ── */

/** 폴링이 새 이벤트를 넘겨준다. 여기서 차례를 정한다. */
export function noticeEvents(team, events) {
  const cast = readCast(team).agents ?? {};
  const r = room(team);
  const state = readState(team);

  if (!isOffice(team)) {
    if (state.round !== r.round) { r.round = state.round; r.pending.clear(); r.recent = []; r.loopNoted = false; }
    if (state.phase !== 'running') { clearTimeout(r.lullTimer); r.lullTimer = null; r.pending.clear(); return; }   // idle·blocked: 차례 없음
  }

  for (const e of events) {
    if (e.type === 'tool') { if (r.lullTimer) armLull(team); continue; }     // 누가 일하는 중 — 조용함이 아니다
    if (e.type !== 'message' && e.type !== 'verdict') continue;
    if (e.actor === 'system') continue;

    r.recent.push(e.actor);
    r.recent = r.recent.slice(-MAX_EXCHANGE * 4);

    const to = addressee(e.text, cast);
    if (to && to !== e.actor && participants(team).includes(to)) {
      // 대표가 부른 사람은 /api/say 가 이미 그에게 넣었다. 대표 발언은 여기서 다시 주지 않는다.
      if (e.actor === 'boss') { armLull(team); continue; }
      if (inLoop(team) && new Set(r.recent.slice(-MAX_EXCHANGE * 2)).has(to)) {
        const z = thirdParty(team, e.actor, to);
        if (!r.loopNoted) {
          r.loopNoted = true;
          note(team, `${nameOf(team, e.actor)}·${nameOf(team, to)} 사이에서 ${MAX_EXCHANGE}번 넘게 오갔습니다. ${z ? nameOf(team, z) + '에게 차례를 넘깁니다.' : '다른 사람이 말할 때까지 쉽니다.'}`);
        }
        if (z) enqueue(team, z, 'third');
        armLull(team);
        continue;
      }
      r.loopNoted = false;
      enqueue(team, to, 'called');
    }
    armLull(team);
  }
}

/** 화면·시험용. */
export function snapshot(team) {
  const r = room(team);
  return { pending: [...r.pending.entries()].map(([a, p]) => `${a}:${p.kind}`), recent: r.recent, lulls: r.lulls.length, outsideBusy: r.outsideBusy };
}
