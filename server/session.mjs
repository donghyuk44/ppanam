// 팀별 실무 세션.
//
// 작전실 입력창에 쓴 지시가 여기를 통해 실무에게 간다.
// 터미널을 열지 않고도 라운드가 돌게 하는 것이 이 파일의 전부다.
//
// 팀마다 claude 프로세스를 하나씩 살려둔다. stdin 을 열어둔 채 stream-json 을
// 한 줄씩 밀어넣으면 같은 세션에서 대화가 이어진다. 프로세스가 죽으면
// 다음 지시 때 --resume 으로 되살린다.
//
// 기록은 하지 않는다. 훅이 이미 한다 (.claude/hooks/to-bus.mjs).
// 여기서 stdout 을 파싱해 대화록에 또 쓰면 같은 말이 두 번 쌓인다.
// 이 파일이 stdout 에서 읽는 것은 두 가지뿐이다 — 세션 id 와 "지금 일하는 중인가".

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, emit, listTeams, isOffice, paths, endRound } from '../bus/bus.mjs';

const STORE = path.join(ROOT, 'state', 'sessions.json');

/** 한 턴이 이 시간 안에 안 끝나면 죽은 것으로 본다. */
const TURN_TIMEOUT = Number(process.env.PPANAM_TURN_TIMEOUT || 15 * 60_000);

/**
 * --bare 를 쓰지 않는다. 훅을 아예 로드하지 않아 아무것도 기록되지 않는다.
 * --verbose 는 --output-format stream-json 이 요구한다 (없으면 기동 자체가 거부된다).
 */
const ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--forward-subagent-text',
];

const sessions = new Map(); // team → session

/* ── 세션 id 보관 ── */

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}

function rememberId(team, id) {
  const all = readStore();
  if (all[team] === id) return;
  all[team] = id;
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}

/* ── 기동 ── */

/**
 * 이 방 주인의 인격.
 *
 * 실무와 총괄은 서브에이전트가 아니라 메인 세션이라 .md frontmatter 가 없다.
 * CLAUDE.md 는 다섯 방이 공용이므로 방별 인격은 teams/<방>/ 에 두고 여기서 붙인다.
 * 대화록에는 안 남는다 — 시스템 프롬프트지 발언이 아니다.
 */
function personaOf(team) {
  const file = path.join(paths(team).dir, isOffice(team) ? 'chief.md' : 'guide.md');
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}

function spawnFor(team) {
  const prior = readStore()[team];
  const args = prior ? [...ARGS, '--resume', prior] : [...ARGS];

  // 방마다 다른 모델을 쓸 수 있다 (state/teams.json 의 model).
  const model = listTeams().find((t) => t.id === team)?.model;
  if (model) args.push('--model', model);

  const persona = personaOf(team);
  if (persona) args.push('--append-system-prompt', persona);

  const child = spawn('claude', args, {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    // 훅은 이 값으로 방을 정한다. 팀별 세션이 각자 팀
    // 대화록에 기록되는 것은 전적으로 이 한 줄 덕분이다.
    env: { ...process.env, PPANAM_TEAM: team },
  });

  const s = {
    team, child,
    id: prior ?? null,
    busy: false,
    queue: [],
    buf: '',
    stderr: '',
    timer: null,
    startedAt: new Date().toISOString(),
    resumed: !!prior,   // --resume 으로 떴다. 첫 턴이 성공하기 전에 죽으면 그 id 가 문제다
    firstOk: false,     // 이 프로세스에서 턴이 한 번이라도 끝났나
    inflight: null,     // 지금 보내진 지시 — 프로세스가 죽으면 한 번 다시 보낼 수 있게
    closeAfter: null,   // 턴이 끝나면 라운드를 닫고 세션을 비운다 ({ verdict, summary })
    closing: false,     // stop() 이 불렸다. 프로세스가 끝날 때까지 맵에 남는다 — 그 사이 온 지시는 아래에
    pendingAfterClose: [],
  };

  child.stdout.on('data', (d) => { s.buf += d; drain(s); });
  child.stderr.on('data', (d) => {
    s.stderr = (s.stderr + d).slice(-4000);
  });

  child.on('error', (e) => die(s, `실무를 띄우지 못했습니다 — ${e.message}`));
  child.on('close', (code) => {
    // 우리가 닫은 것이다 — 끝나기를 기다리고 있었다.
    if (s.closing) { onClosed(s); return; }
    // 우리가 부른 게 아니라 스스로 죽었다면 대표에게 알린다.
    if (sessions.get(team) === s) {
      sessions.delete(team);
      clearTimeout(s.timer);
      if (code !== 0) {
        const why = s.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200);
        // 저장된 id 로 이어붙이려다 첫 턴도 못 끝내고 죽었다 — 그 id 가 썩은 것이다. 버리고 새 세션으로
        // 같은 지시를 한 번 다시 보낸다. 안 그러면 id 가 영영 남아 그 뒤 모든 지시가 같은 이유로 죽는다.
        if (s.resumed && !s.firstOk && s.inflight) {
          forgetId(team);
          note(team, `저장된 세션을 이어붙이지 못했습니다 (code ${code})${why ? ' — ' + why : ''}. 새 세션으로 다시 보냅니다.`);
          const fresh = spawnFor(team);
          fresh.queue.push(...s.queue);
          write(fresh, s.inflight);
          return;
        }
        note(team, `실무 세션이 끊겼습니다 (code ${code})${why ? ' — ' + why : ''}. 다음 지시에 다시 붙습니다.`);
        dropped(s);
      }
      // 닫기가 예약돼 있었는데 턴을 못 끝내고 죽었다 — 그래도 닫는다. 대표가 닫으라고 했다.
      if (s.closeAfter) finishClose(s);
    }
  });

  child.stdin.on('error', () => { /* 자식이 먼저 죽은 경우 */ });

  sessions.set(team, s);
  return s;
}

function die(s, message) {
  if (sessions.get(s.team) === s) sessions.delete(s.team);
  clearTimeout(s.timer);
  try { s.child.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
  note(s.team, message);
  dropped(s);
  if (s.closeAfter) finishClose(s);
}

/**
 * 닫히던 프로세스가 끝났다. 이제야 맵에서 뺀다. 닫히는 동안 온 지시가 있으면 그제야 새 프로세스를 띄운다 —
 * 전에는 stop() 이 맵에서 바로 빼고 돌아와, 새 지시가 오면 옛 프로세스가 30~40초 살아 있는 채 둘째가 떴다
 * (레오 감사, 2026-09-12).
 */
function onClosed(s) {
  if (sessions.get(s.team) === s) sessions.delete(s.team);
  const pend = s.pendingAfterClose ?? [];
  s.pendingAfterClose = [];
  if (pend.length) {
    const fresh = spawnFor(s.team);
    fresh.queue.push(...pend.slice(1));
    write(fresh, pend[0]);
  }
}

/** 줄 서 있던 지시가 버려졌으면 말한다. 조용히 사라지는 것이 가장 나쁘다. */
function dropped(s) {
  if (s.queue.length) note(s.team, `대기 중이던 지시 ${s.queue.length}건을 버렸습니다. 다시 보내세요.`);
  s.queue = [];
}

function forgetId(team) {
  const all = readStore();
  if (!(team in all)) return;
  delete all[team];
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}

/** 예약된 닫기를 실행한다 — 라운드를 닫고 이 방의 세션 컨텍스트를 비운다. */
function finishClose(s) {
  const o = s.closeAfter;
  s.closeAfter = null;
  try { endRound(s.team, o); } catch (e) { note(s.team, `라운드를 닫지 못했습니다 — ${e.message}`); }
  reset(s.team);
}

/** 시스템 안내. 화면에서 가장 약하게 표시되는 줄이다 (event-schema 3절). */
function note(team, text) {
  try { emit(team, { actor: 'system', type: 'note', text }); } catch { /* 기록 실패는 삼킨다 */ }
}

/* ── stdout 읽기 ── */

function drain(s) {
  const lines = s.buf.split('\n');
  s.buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.session_id && msg.session_id !== s.id) {
      s.id = msg.session_id;
      rememberId(s.team, s.id);
    }

    if (msg.type === 'result') {
      clearTimeout(s.timer);
      s.busy = false;
      s.inflight = null;
      s.firstOk = true;
      if (msg.subtype && msg.subtype !== 'success') {
        note(s.team, `실무가 이번 지시를 끝내지 못했습니다 (${msg.subtype}).`);
      }
      // 턴이 끝나면 닫기로 했다. 줄 서 있던 지시는 닫히는 라운드의 것이라 버린다 — 말하고 버린다.
      if (s.closeAfter) { dropped(s); finishClose(s); return; }
      next(s);
    }
  }
}

/* ── 보내기 ── */

function write(s, text) {
  s.busy = true;
  s.inflight = text;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    die(s, `실무가 ${Math.round(TURN_TIMEOUT / 60_000)}분 동안 응답하지 않아 세션을 닫았습니다.`);
  }, TURN_TIMEOUT);

  s.child.stdin.write(JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  }) + '\n');
}

function next(s) {
  if (s.busy || !s.queue.length) return;
  write(s, s.queue.shift());
}

/**
 * 지시를 보낸다.
 *
 * 대표 말풍선은 여기서 만들지 않는다 — 프롬프트가 세션에 들어가면
 * UserPromptSubmit 훅이 알아서 남긴다. 여기서 또 emit 하면 두 번 뜬다.
 *
 * 앞 지시가 아직 안 끝났으면 줄을 세운다. 한 번에 하나씩 시킨다.
 */
export function send(team, text) {
  let s = sessions.get(team);
  // 닫히는 중이다. 옛 프로세스가 끝나면 새로 띄워 보낸다 — 한 팀에 프로세스는 하나다.
  if (s?.closing) { s.pendingAfterClose.push(text); return { queued: s.pendingAfterClose.length, closing: true }; }
  if (!s || s.child.exitCode !== null || s.child.signalCode !== null) s = spawnFor(team);

  if (s.busy) {
    s.queue.push(text);
    return { queued: s.queue.length };
  }
  write(s, text);
  return { queued: 0 };
}

/** 작전실 상단의 "실무가 일하는 중" 표시가 읽는 값. */
export function status(team) {
  const s = sessions.get(team);
  if (!s) return { alive: false, busy: false, queued: 0, sessionId: readStore()[team] ?? null };
  if (s.closing) return { alive: false, closing: true, busy: false, queued: s.pendingAfterClose.length, sessionId: readStore()[team] ?? null };
  return { alive: true, busy: s.busy, queued: s.queue.length, sessionId: s.id, startedAt: s.startedAt };
}

/**
 * 세션을 닫는다. 세션 id 는 남겨두므로 다음 지시에 --resume 으로 이어붙는다.
 *
 * stdin 만 닫고 잊으면 안 된다. 턴을 마저 끝내는 고아가 남고, 그 사이 새 지시가 오면 같은 팀에
 * 프로세스가 둘이 된다. 끝나기를 기다리고, 30초 안에 안 끝나면 SIGTERM, 10초 더 지나면 SIGKILL.
 */
export function stop(team) {
  const s = sessions.get(team);
  if (!s || s.closing) return false;
  s.closing = true;             // 맵에 남긴다. send() 가 이걸 보고 기다린다
  clearTimeout(s.timer);
  const c = s.child;
  try { c.stdin.end(); } catch { /* 이미 닫힘 */ }
  if (c.exitCode !== null || c.signalCode !== null) { onClosed(s); return true; }
  const t1 = setTimeout(() => { try { c.kill('SIGTERM'); } catch { /* 이미 죽음 */ } }, 30_000);
  const t2 = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* 이미 죽음 */ } }, 40_000);
  c.once('close', () => { clearTimeout(t1); clearTimeout(t2); });   // onClosed 는 위의 close 핸들러가 부른다
  return true;
}

/**
 * 실무가 일하는 중이면 지금 닫지 않는다. 턴이 끝난 뒤 라운드를 닫고 세션을 비운다.
 * 지금 닫으면 그 턴의 마지막 발언이 훅에서 버려진다(phase 가 이미 idle). 대표가 닫으라고 한 뒤에
 * 나온 말이지만, 실무의 마무리 보고는 그 라운드의 것이다.
 * 일하는 중이 아니면 false — 부른 쪽이 바로 닫는다.
 */
export function closeWhenIdle(team, opts = {}) {
  const s = sessions.get(team);
  if (!s || !s.busy) return false;
  s.closeAfter = { verdict: opts.verdict ?? null, summary: opts.summary ?? null };
  return true;
}

/**
 * 세션을 닫고 **세션 id 까지 버린다.** 라운드가 끝날 때 쓴다.
 *
 * 비워지는 건 AI 컨텍스트뿐이다 (CLAUDE.md). id 를 남겨두면 다음 라운드가
 * --resume 으로 지난 라운드 대화를 통째로 안고 시작한다. 대화록은 그대로 남는다.
 */
export function reset(team) {
  stop(team);
  forgetId(team);
}

export function stopAll() {
  for (const team of [...sessions.keys()]) stop(team);
}
