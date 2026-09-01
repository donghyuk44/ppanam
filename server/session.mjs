// 팀별 길잡이 세션.
//
// 작전실 입력창에 쓴 지시가 여기를 통해 길잡이에게 간다.
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
import { ROOT, emit, listTeams, isOffice, paths } from '../bus/bus.mjs';

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
 * 길잡이와 총괄은 서브에이전트가 아니라 메인 세션이라 .md frontmatter 가 없다.
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
    // 훅이 이 값을 state/active-team 보다 먼저 본다. 팀별 세션이 각자 팀
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
  };

  child.stdout.on('data', (d) => { s.buf += d; drain(s); });
  child.stderr.on('data', (d) => {
    s.stderr = (s.stderr + d).slice(-4000);
  });

  child.on('error', (e) => die(s, `길잡이를 띄우지 못했습니다 — ${e.message}`));
  child.on('close', (code) => {
    // 우리가 부른 게 아니라 스스로 죽었다면 대표에게 알린다.
    if (sessions.get(team) === s) {
      sessions.delete(team);
      clearTimeout(s.timer);
      if (code !== 0) {
        const why = s.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200);
        note(team, `길잡이 세션이 끊겼습니다 (code ${code})${why ? ' — ' + why : ''}. 다음 지시에 다시 붙습니다.`);
      }
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
      if (msg.subtype && msg.subtype !== 'success') {
        note(s.team, `길잡이가 이번 지시를 끝내지 못했습니다 (${msg.subtype}).`);
      }
      next(s);
    }
  }
}

/* ── 보내기 ── */

function write(s, text) {
  s.busy = true;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    die(s, `길잡이가 ${Math.round(TURN_TIMEOUT / 60_000)}분 동안 응답하지 않아 세션을 닫았습니다.`);
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
  if (!s || s.child.exitCode !== null || s.child.signalCode !== null) s = spawnFor(team);

  if (s.busy) {
    s.queue.push(text);
    return { queued: s.queue.length };
  }
  write(s, text);
  return { queued: 0 };
}

/** 작전실 상단의 "길잡이가 일하는 중" 표시가 읽는 값. */
export function status(team) {
  const s = sessions.get(team);
  if (!s) return { alive: false, busy: false, queued: 0, sessionId: readStore()[team] ?? null };
  return { alive: true, busy: s.busy, queued: s.queue.length, sessionId: s.id, startedAt: s.startedAt };
}

/**
 * 세션을 닫는다. 세션 id 는 남겨두므로 다음 지시에 --resume 으로 이어붙는다.
 * 라운드 도중 프로세스가 죽었을 때 쓴다.
 */
export function stop(team) {
  const s = sessions.get(team);
  if (!s) return false;
  sessions.delete(team);
  clearTimeout(s.timer);
  try { s.child.stdin.end(); } catch { /* 이미 닫힘 */ }
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
  const all = readStore();
  if (!(team in all)) return;
  delete all[team];
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}

export function stopAll() {
  for (const team of [...sessions.keys()]) stop(team);
}
