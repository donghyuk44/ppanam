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
import { addressee, addressees, readCast, readState, isOffice, emit, readLog, readTail, quiet, TURN_VERDICT, listTeams } from '../bus/bus.mjs';
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

function giveTurn(team, actor, kind) {
  const r = room(team);
  const target = r.flow?.target ?? '';

  if (isOutside(team, actor)) {
    // codex 는 프로세스가 턴마다 뜬다. outside.mjs 가 자기 커서(lastSeen)로 못 들은 말을 붙이므로 여기선 종류만 넘긴다.
    r.outsideBusy = true;
    const args = [OUTSIDE, '--team', team, '--actor', actor, '--turn', kind];   // 자리 이름으로 띄운다 — outside 가 아닌 codex 자리도 (결정 69 ①)
    if (kind === 'verdict') args.push('--text', target);
    if (kind === 'carried' && r.carryFrom) args.push('--from-round', String(r.carryFrom));   // 닫힌 라운드의 못 들은 말부터 (결정 25)
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

  const { lines, last } = unheard(team, actor, kind === 'carried' ? { fromRound: r.carryFrom } : {});
  const instruction = kind === 'verdict' ? VERDICT_INSTRUCTION(target, nameOf(team, session.ownerOf(team))) : INSTRUCTION[kind];
  // 턴마다 이름을 한 번 불러 준다 — 긴 세션에서 말투가 모델 기본값으로 흘러가는 것을 막는 닻 (docs/cases.md 24·25).
  const anchor = kind === 'verdict' ? '' : `너는 ${nameOf(team, actor)}다. `;
  const body = (lines.length ? `그동안 이 방에서 오간 말:\n\n${lines.join('\n')}\n\n---\n` : '') + anchor + instruction;
  if (last) setCursor(team, actor, last);
  const sent = session.send(team, quiet(body), actor, kind === 'verdict' ? { kind: 'verdict', extra: target.slice(0, 200) } : {});
  if (sent?.refused) note(team, `${nameOf(team, actor)}의 차례를 주지 못했습니다 — ${sent.reason}`);
}

/** 차례를 예약한다. 같은 자리에 쌓이면 더 센 종류로 합친다. */
const RANK = { verdict: 4, third: 3, called: 2, carried: 2, lull: 1, lunch: 1 };
function enqueue(team, actor, kind) {
  const r = room(team);
  const cur = r.pending.get(actor);
  if (!cur || (RANK[kind] ?? 0) > (RANK[cur.kind] ?? 0)) r.pending.set(actor, { kind });
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
    if (state.phase === 'idle') stash(team, '라운드가 닫혀'); else r.pending.clear();
    return;
  }
  // 라운드가 닫히는 중이다(일지를 받는 동안). 쌓인 차례는 닫히는 라운드의 것 — 버리지 않고 다음 라운드 첫 턴으로 (결정 25).
  if (session.isClosing(team)) { stash(team, '라운드가 닫히는 중이라'); return; }
  for (const [actor, p] of [...r.pending]) {
    if (busy(team, actor)) continue;
    r.pending.delete(actor);
    giveTurn(team, actor, p.kind);
  }
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
  if (r.flow) throw new Error(`이미 판정이 돌고 있습니다 (${r.flow.step}).`);
  const cast = readCast(team).agents ?? {};
  // 내부감사는 엔진이 무엇이든(대표가 codex 로 바꿨을 수도, 결정 69 ①) 그 자리가 있으면 한 걸음. 외부감사는 gpt 여야 한다(CLAUDE.md).
  const steps = [cast.review?.model ? 'review' : null, cast.outside?.model === 'gpt' ? 'outside' : null].filter(Boolean);
  if (!steps.length) throw new Error('이 방에는 감사역이 없습니다.');
  r.round = state.round;
  r.flow = { target: String(target ?? '').trim() || '이번 라운드 산출물', steps, i: 0, asked: 0 };
  emit(team, { actor: 'system', type: 'note', text: `판정 시작 — ${r.flow.target}. ${steps.map((s) => nameOf(team, s)).join(' → ')} 순서.`, meta: { verdictFlow: 'start' } });
  askStep(team);
  return r.flow;
}

function askStep(team) {
  const r = room(team);
  const actor = r.flow.steps[r.flow.i];
  r.flow.asked = 0;
  r.flow.waiting = actor;
  enqueue(team, actor, 'verdict');
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
    r.flow = null;
    if (v === 'PASS') {
      emit(team, { actor: 'system', type: 'note', text: `판정 완료 — ${f.steps.map((s) => nameOf(team, s)).join('·')} 모두 PASS. 라운드를 PASS 로 닫을 수 있습니다 (node bus/round.mjs end -v PASS "…").`, meta: { verdictFlow: 'pass' } });
    } else if (v === 'REVISE') {
      enqueue(team, session.ownerOf(team), 'called');   // 판정 카드를 듣고 고친다
    }
    // FAIL: recordVerdict 가 방을 막았다. 여기서 할 일 없음.
    return;
  }
  if (e.type === 'message' && e.meta?.noVerdict) {
    if (f.asked < 1) { f.asked += 1; enqueue(team, e.actor, 'verdict'); return; }
    r.flow = null;
    emit(team, { actor: 'system', type: 'note', text: `${nameOf(team, e.actor)}이 두 번 물어도 첫 줄에 판정을 쓰지 않았습니다. 판정 흐름을 멈춥니다.`, meta: { verdictFlow: 'abort' } });
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
    if (state.round !== r.round) {
      // --next 로 닫고 바로 열리면 round_end·round_start 가 한 묶음으로 와서 idle 을 못 본다 — 남은 차례는 지난 라운드 것이라 여기서 넘긴다.
      if (r.pending.size) stash(team, `라운드 ${r.round} 이 닫혀`, r.round);
      r.round = state.round; r.recent = []; r.loopNoted = false; r.flow = null; r.carryFrom = null;
    }
    if (state.phase !== 'running') {   // idle·blocked: 차례 없음. 막 닫혔으면(idle) 쌓인 차례는 버리지 않고 넘긴다.
      clearTimeout(r.lullTimer); r.lullTimer = null;
      if (state.phase === 'idle') stash(team, '라운드가 닫혀'); else r.pending.clear();
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
    r.recent = r.recent.slice(-MAX_EXCHANGE * 4);

    onFlowEvent(team, e);

    // 부른 사람 전부, 부른 순서대로 차례 (결정 22). 브레이크는 첫 상대에게만 건다 — 둘이서 도는 것이 문제지 셋을 부른 게 아니다.
    const called = addressees(e.text, cast).filter((to) => to !== e.actor && participants(team).includes(to));
    for (const [k, to] of called.entries()) {
      // 대표가 부른 사람이 claude 자리면 /api/say 가 이미 그에게 넣었다(첫 사람) — 다시 주지 않는다.
      // codex 자리면 넣을 세션이 없어 서버가 말풍선만 남겼다 — 여기서 깨운다 (레오 감사, 2026-09-12).
      if (e.actor === 'boss' && k === 0 && !isOutside(team, to)) continue;
      if (k === 0 && inLoop(team) && new Set(r.recent.slice(-MAX_EXCHANGE * 2)).has(to)) {
        const z = thirdParty(team, e.actor, to);
        if (!r.loopNoted) {
          r.loopNoted = true;
          note(team, `${nameOf(team, e.actor)}·${nameOf(team, to)} 사이에서 ${MAX_EXCHANGE}번 넘게 오갔습니다. ${z ? nameOf(team, z) + '에게 차례를 넘깁니다.' : '다른 사람이 말할 때까지 쉽니다.'}`);
        }
        if (z) enqueue(team, z, 'third');
        continue;
      }
      if (k === 0) r.loopNoted = false;
      enqueue(team, to, 'called');
    }
    armLull(team);
  }
}

/**
 * 총괄실 발언이 다른 방 사람을 첫머리에 불렀으면 그 방에 같은 말을 남긴다 — 화자는 그대로(chief), 출처는 meta.from.
 * 그 방의 사회자가 이 사본을 보고 불린 사람을 깨운다. 사본은 meta.from 이 있어 다시 옮기지 않는다.
 * 대표 발언은 옮기지 않는다 — 대표의 지시는 총괄이 배달(dispatch)로 옮긴다.
 */
function crossPost(team, e) {
  if (e.actor === 'boss' || e.actor === 'system') return;
  for (const t of listTeams()) {
    if (t.id === team || isOffice(t.id)) continue;
    // 호명은 이름으로 맞춘다 — 자리 이름(outside)이 방마다 있어도 제리와 다니엘은 다른 이름이다.
    const cast = readCast(t.id).agents ?? {};
    const there = addressees(e.text, cast).filter((to) => to !== 'boss');
    if (!there.length) continue;
    if (readState(t.id).phase === 'idle') { note(team, `${nameOf(team, e.actor)}이 ${t.name} 팀 ${there.map((x) => cast[x]?.name ?? x).join('·')}을 불렀지만 그 방은 라운드가 닫혀 있어 옮기지 못했습니다.`); continue; }
    emit(t.id, { actor: e.actor, type: 'message', text: e.text, meta: { from: team, origin: e.id } });
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
  return { pending: [...r.pending.entries()].map(([a, p]) => `${a}:${p.kind}`), recent: r.recent, lulls: r.lulls.length, outsideBusy: r.outsideBusy, flow: r.flow ? { step: r.flow.steps[r.flow.i], waiting: r.flow.waiting, asked: r.flow.asked } : null };
}
