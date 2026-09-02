// 외부감사를 참여자로 만드는 방아쇠.
//
// 클로드 세션은 이름이 불리면 다음 화자가 된다 — 인접쌍. codex 는 별도 프로세스라 그
// 장치가 없었고, 그래서 실무가 --ask 로 부를 때만 한 번 돌고 첫 줄에 판정을 강제받았다.
// 대표가 세 번 말했다. 대화를 하라고, 실제 참여자로 하기로 했다고. 이 파일이 그 답이다.
//
// 서버는 방을 250ms 마다 tail 한다. 새 발언이 오면 여기로 넘어오고,
//   1. 외부감사 이름으로 시작하는 말이면 → 바로 깨운다. 본문에 승인 번호(apr_…)가 있으면
//      --talk 가 아니라 --ask 로 — 대조는 큐에 남아야 한다. 말풍선만 남으면 톰은 통과로
//      읽고 큐는 대기로 남는 함정이 된다 (Fable 감사).
//   2. 이름이 안 불렸어도 그는 듣고 있다 → 방이 LULL_MS 동안 조용하고 방 주인 세션도 놀고
//      있으면 차례를 한 번 준다 (--lull). 도구를 쓰는 중이면 조용한 게 아니다.
//      할 말이 있으면 한두 문장, 없으면 (패스). (패스) 는 기록되지 않는다.
//
// 멈추는 조건은 인격 문장이 아니라 여기 코드에 있다 (Fable 감사: "인격 문장으로는 안 선다").
//   - 시간당 호출 상한 MAX_PER_HOUR. 이름이 불려도 넘지 않는다.
//   - 외부감사와 한 사람 사이 왕복이 MAX_EXCHANGE 를 넘으면 제3자가 말할 때까지 쉰다.
//     실무 인격이 "상대 이름으로 시작해라" 이고 외부감사도 그러니, 둘만 두면 무한 핑퐁이다.
//   - 한 방에 한 번에 하나만. 생각하는 중에 또 불리면 끝나고 한 번 더.
// 조용히 죽지 않는다: spawn 실패·비정상 종료는 방에 note 로 남는다.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addressee, readCast, readState, isOffice, emit } from '../bus/bus.mjs';
import { status as sessionStatus } from './session.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTSIDE = path.join(REPO, 'bus', 'outside.mjs');
const LULL_MS = Number(process.env.PPANAM_LULL_MS || 20_000);
const MIN_GAP_MS = Number(process.env.PPANAM_OUTSIDE_GAP_MS || 60_000);
const MAX_PER_HOUR = Number(process.env.PPANAM_OUTSIDE_PER_HOUR || 20);
const MAX_EXCHANGE = Number(process.env.PPANAM_OUTSIDE_EXCHANGE || 3);
const HOUR = 3_600_000;

const slots = new Map();
const slot = (t) => {
  if (!slots.has(t)) slots.set(t, { busy: false, again: null, timer: null, lastLull: 0, wakes: [], recent: [], capNoted: 0, loopNoted: false, retried: false });
  return slots.get(t);
};

function note(team, text) {
  try { emit(team, { actor: 'system', type: 'note', text }); } catch { /* 기록 실패는 삼킨다 */ }
}

/** 시간당 상한 안인가. 넘었으면 한 시간에 한 번만 알린다. */
function underCap(team) {
  const s = slot(team);
  const now = Date.now();
  s.wakes = s.wakes.filter((t) => now - t < HOUR);
  if (s.wakes.length < MAX_PER_HOUR) return true;
  if (now - s.capNoted > HOUR) {
    s.capNoted = now;
    note(team, `외부감사 호출이 시간당 상한(${MAX_PER_HOUR}회)에 닿았습니다. 한 시간 동안은 이름을 불러도 답하지 않습니다.`);
  }
  return false;
}

/** 최근 발언이 외부감사와 한 사람의 왕복뿐인가. */
function inLoop(team) {
  const r = slot(team).recent.slice(-MAX_EXCHANGE * 2);
  if (r.length < MAX_EXCHANGE * 2 || !r.includes('outside')) return false;
  const others = new Set(r.filter((a) => a !== 'outside'));
  if (others.size !== 1) return false;
  return r.every((a, i) => (i % 2 === 0 ? a === r[0] : a !== r[0]));
}

function wake(team, text, { mode = 'talk', addressed = false } = {}) {
  const s = slot(team);
  if (s.busy) { s.again = { text, mode, addressed }; return; }
  if (!underCap(team)) return;
  if (addressed && inLoop(team)) {
    if (!s.loopNoted) {
      s.loopNoted = true;
      note(team, `같은 두 사람 사이에서 ${MAX_EXCHANGE}번 넘게 오갔습니다. 다른 사람이 말할 때까지 외부감사는 쉽니다.`);
    }
    return;
  }
  s.loopNoted = false;
  s.busy = true;
  s.wakes.push(Date.now());

  const flag = mode === 'lull' ? '--lull' : mode === 'ask' ? '--ask' : '--talk';
  const args = [OUTSIDE, '--team', team, flag];
  if (mode !== 'lull') args.push(text);

  let child;
  try {
    child = spawn('node', args, { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env } });
  } catch (e) {
    s.busy = false;
    note(team, `외부감사를 깨우지 못했습니다 — ${String(e.message).slice(0, 160)}`);
    return;
  }
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-600); });
  child.on('error', (e) => { s.busy = false; note(team, `외부감사를 깨우지 못했습니다 — ${String(e.message).slice(0, 160)}`); });
  child.on('close', (code) => {
    s.busy = false;
    // 1 은 outside.mjs 가 이미 방에 사유를 남긴 경우다 (codex 없음·호출 실패). 그 밖의 비정상만 알린다.
    if (code && code !== 1) {
      const last = err.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
      note(team, `외부감사 호출이 비정상 종료했습니다 (code ${code})${last ? ' — ' + last.slice(0, 160) : ''}`);
    }
    if (s.again) { const a = s.again; s.again = null; wake(team, a.text, a); }
  });
}

/** 방이 조용해지면 차례를 준다. 주인 세션이 일하는 중이면 조용한 게 아니다 — 미룬다. */
function armLull(team) {
  const s = slot(team);
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    if (sessionStatus(team).busy) { armLull(team); return; }
    if (Date.now() - s.lastLull < MIN_GAP_MS) return;
    s.lastLull = Date.now();
    wake(team, null, { mode: 'lull' });
  }, LULL_MS);
}

/** 폴링이 새 이벤트를 넘겨준다. 여기서 깨울지 말지를 정한다. */
export function noticeEvents(team, events) {
  const cast = readCast(team).agents ?? {};
  if (!cast.outside) return;                                            // 이 방에 외부감사가 없다
  if (!isOffice(team) && readState(team).phase !== 'running') return;   // 라운드 밖에선 안 깨운다
  const s = slot(team);

  for (const e of events) {
    if (e.type === 'tool') { if (s.timer) armLull(team); continue; }    // 누가 일하는 중 — 조용함이 아니다
    if (e.type !== 'message' && e.type !== 'verdict') continue;
    if (e.actor === 'system') continue;

    s.recent.push(e.actor);
    s.recent = s.recent.slice(-MAX_EXCHANGE * 4);

    if (e.actor === 'outside') continue;                                // 자기 말에는 안 깨어난다

    const who = cast[e.actor]?.name ?? e.actor;
    if (addressee(e.text, cast) === 'outside') {
      clearTimeout(s.timer); s.timer = null;
      const mode = /apr_[0-9a-f]{8}/.test(e.text) ? 'ask' : 'talk';
      wake(team, `${who}: ${e.text}`, { mode, addressed: true });
      continue;
    }
    armLull(team);
  }
}
