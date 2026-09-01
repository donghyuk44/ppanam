#!/usr/bin/env node
// 외부감사 — 다른 회사 모델이 이 방의 참여자로 앉는다.
//
//   node bus/outside.mjs --status
//   node bus/outside.mjs --team marketing --ask "이 산출물의 근거가 실재하는가"
//   node bus/outside.mjs --check "2 더하기 2는 5인가"      한 번만 묻고 끝 (기록 안 함)
//   node bus/outside.mjs --team marketing --reset          세션 버리기
//   node bus/outside.mjs --setup
//
// 이 자리가 존재하는 이유는 하나다.
// 클로드 둘이 사이좋게 같이 틀릴 때, 그건 다른 엔진에게만 보인다.
//
// **이 파일이 곧 그 참여자다.** 클로드 서브에이전트가 codex 를 대신 불러 답을 옮기면,
// 옮기는 순간 그건 다시 클로드의 말이 된다. 그래서 여기서 직접 대화록에 남긴다.
// 클로드는 부르기만 하고 본문에 손대지 않는다.
//
// 세션은 방마다 하나씩 유지된다 (codex exec resume). 외부감사도 대화를 기억한다.
// 라운드가 끝나면 버린다 — 비워지는 건 AI 컨텍스트뿐이라는 규칙은 여기에도 같다.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, emit, recordVerdict, readContext, readTail, readCast,
  defaultTeam, teamExists, isOffice, paths, VERDICTS, addressee,
} from './bus.mjs';

const run = promisify(execFile);
const TIMEOUT = Number(process.env.PPANAM_OUTSIDE_TIMEOUT || 300_000);
const API_MODEL = process.env.PPANAM_OUTSIDE_MODEL || 'gpt-5.1';

// codex 는 모델이 아니라 CLI 다. 그 안에서 도는 모델을 여기서 못 박는다.
// 기본값에 얹어두면 어느 엔진이 판정했는지 기록에 남지 않는다.
const CODEX_MODEL = process.env.PPANAM_CODEX_MODEL || 'gpt-5.6-sol';
const ENGINE = `codex · ${CODEX_MODEL}`;

const STORE = path.join(ROOT, 'state', 'outside-sessions.json');

/* ── 세션 보관 ── */

const readStore = () => {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
};

function writeStore(all) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}

/** 예전 형식({팀: "세션id"})도 읽는다. */
function slotOf(team) {
  const v = readStore()[team];
  if (!v) return null;
  return typeof v === 'string' ? { id: v, lastSeen: null } : v;
}

function remember(team, id, lastSeen) {
  const all = readStore();
  all[team] = { id, lastSeen: lastSeen ?? slotOf(team)?.lastSeen ?? null };
  writeStore(all);
}

function forget(team) {
  const all = readStore();
  if (!(team in all)) return false;
  delete all[team];
  writeStore(all);
  return true;
}

/* ── codex ── */

async function hasCodex() {
  try { await run('which', ['codex']); return true; } catch { return false; }
}

/**
 * codex 한 턴.
 *
 * 프롬프트는 인자가 아니라 stdin 으로 넘긴다. execFile 로는 stdin 을 닫을 수 없어
 * codex 가 입력을 영원히 기다린다 — spawn 으로 직접 쓰고 닫는다.
 * 최종 답은 -o 파일로 받는 쪽이 확실하다. 진행 상황은 stderr 로 나온다.
 *
 * 샌드박스는 건드리지 않는다. 기본값이 읽기 전용이고, 감사역은 고치면 안 된다.
 */
function runCodex(input, { resume = null } = {}) {
  const outPath = path.join(os.tmpdir(), `ppanam-outside-${crypto.randomBytes(4).toString('hex')}.txt`);
  const args = resume
    ? ['exec', 'resume', resume, '--skip-git-repo-check', '-m', CODEX_MODEL, '-o', outPath, '-']
    : ['exec', '--skip-git-repo-check', '-m', CODEX_MODEL, '-o', outPath, '-'];

  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`응답 없음 (${Math.round(TIMEOUT / 1000)}초 초과)`));
    }, TIMEOUT);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      let answer = '';
      try { answer = fs.readFileSync(outPath, 'utf8').trim(); } catch { /* stdout 으로 */ }
      try { fs.unlinkSync(outPath); } catch { /* 없으면 그만 */ }
      if (code !== 0) {
        const why = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        return finish(reject, new Error(`codex exit ${code}${why ? ' — ' + why : ''}`));
      }
      // 세션 id 는 stderr 머리말에 나온다. 다음 턴을 이어붙이려면 이게 필요하다.
      const sid = /session id:\s*([0-9a-f-]{8,})/i.exec(stderr)?.[1] ?? resume ?? null;
      finish(resolve, { answer: answer || stdout.trim(), sessionId: sid });
    });

    child.stdin.on('error', () => { /* 자식이 먼저 죽은 경우 */ });
    child.stdin.end(input);
  });
}

/* ── 참여자로서 말하기 ── */

const DEFAULT_PERSONA = `너는 이 팀의 **외부감사**이다. 다른 회사 모델이고, 그래서 여기 있다.
클로드끼리 합의한 지점이야말로 네가 봐야 하는 곳이다.

본다: 인용된 수치·날짜·링크가 실재하는가. 코드라면 경계 조건과 멱등성.
그리고 상대가 당연하게 깔고 있어서 스스로는 못 보는 가정.

합의를 만들려 하지 마라. 이견이 없으면 없다고 하고, 있으면 근거와 함께 말해라.
파일은 읽되 고치지 마라. 한국어로 답한다.`;

function personaOf(team) {
  try { return fs.readFileSync(path.join(paths(team).dir, 'outside.md'), 'utf8').trim(); }
  catch { return DEFAULT_PERSONA; }
}

/**
 * 이 방에서 오간 말. 외부감사도 대화를 따라와야 참여자다.
 *
 * 작전실은 이번 라운드만 본다(라운드마다 컨텍스트를 비운다는 규칙).
 * 총괄실은 라운드가 없어서 readContext 가 늘 비어 있으므로 최근 대화를 쓴다 —
 * 이걸 안 하면 제리가 대표 원문을 못 보고 대조하는 척만 하게 된다.
 */
function contextOf(team, { since = null } = {}) {
  const cast = readCast(team).agents ?? {};
  let events = isOffice(team) ? readTail(team, { limit: 40 }).events : readContext(team);

  // 이어지는 턴에는 지난번 이후에 새로 오간 말만 넘긴다.
  // 이게 없으면 첫 턴 이후로 방에서 무슨 말이 오갔는지 모른 채 답하게 된다.
  if (since) {
    const i = events.findIndex((e) => e.id === since);
    events = i >= 0 ? events.slice(i + 1) : events.slice(-10);
  }

  const lines = [];
  for (const e of events) {
    if (e.type === 'tool') continue;
    const who = cast[e.actor]?.name ?? e.actor;
    const tag = e.type === 'verdict' ? ` [${e.meta?.verdict ?? ''}]` : '';
    lines.push(`${who}${tag}: ${e.text.replace(/\s+/g, ' ').slice(0, 600)}`);
  }
  return lines.slice(-40).join('\n');
}

/** 방 주인 — 작전실이면 실무, 총괄실이면 총괄. 그에게 말한 건 따로 넘길 필요가 없다. */
const OWNER_OF = (team) => (isOffice(team) ? 'chief' : 'guide');

/** 이 방에서 지금까지 남은 마지막 이벤트. 다음 턴에 "그 뒤로 새로 온 말"의 기준이 된다. */
function lastEventId(team) {
  const { events } = readTail(team, { limit: 1 });
  return events[0]?.id ?? null;
}

/**
 * 방금 한 말을 상대 세션의 귀에 넣는다.
 *
 * 외부감사의 말은 그가 직접 대화록에 남겼다. 그런데 실무 세션은 대화록을 읽지
 * 않으므로, 넣어주지 않으면 못 듣는다. 그러면 대화가 아니라 각자 독백이 된다.
 * 훅은 이 표시를 보고 기록하지 않는다 — 말한 사람이 이미 남겼기 때문이다.
 */
async function tell(team, name, text) {
  const base = process.env.PPANAM_SERVER || 'http://localhost:4321';
  try {
    const r = await fetch(`${base}/api/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team, quiet: true, text: `${name}: ${text}` }),
    });
    return r.ok;
  } catch { return false; }   // 서버가 안 떠 있으면 대화록에는 남았으니 그걸로 족하다
}

/**
 * 판정을 첫 줄에서 읽는다.
 * 페르소나가 "판정할 때는 첫 줄에 PASS 또는 REVISE 만" 이라고 시킨다.
 */
function splitVerdict(text) {
  const [first, ...rest] = text.split('\n');
  const v = first.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (VERDICTS.has(v)) return { verdict: v, body: rest.join('\n').trim() || text };
  return { verdict: null, body: text };
}

async function ask(team, question) {
  if (!await hasCodex()) {
    emit(team, {
      actor: 'outside', type: 'note',
      text: '외부 모델이 연결되어 있지 않습니다. 교차검증 없이 진행합니다.',
    });
    console.error('외부감사 설정 안 됨 — node bus/outside.mjs --setup');
    return 1;
  }

  const slot = slotOf(team);
  const prior = slot?.id ?? null;
  const name = readCast(team).agents?.outside?.name ?? '외부감사';

  // 첫 턴에는 인격과 지금까지의 대화 전부. 이어지는 턴에는 지난번 이후 새로 온 말만.
  // 자기 세션이 앞의 대화는 이미 기억하고 있으니, 못 들은 부분만 채워주면 된다.
  const ctx = contextOf(team, { since: prior ? slot.lastSeen : null });
  const input = [
    prior ? null : personaOf(team),
    prior ? null : '\n---\n',
    ctx ? `그동안 이 방에서 오간 말:\n\n${ctx}\n\n---\n` : null,
    question,
  ].filter(Boolean).join('\n');

  let res;
  try {
    res = await runCodex(input, { resume: prior });
  } catch (e) {
    // 이어붙이기가 깨졌으면 세션을 버리고 다음에 새로 연다.
    if (prior) forget(team);
    emit(team, {
      actor: 'outside', type: 'note',
      text: `외부 모델을 부르지 못했습니다 — ${String(e.message).split('\n')[0].slice(0, 200)}`,
    });
    console.error('실패: ' + e.message);
    return 1;
  }

  if (!prior) emit(team, { actor: 'system', type: 'enter', text: `${name} 님이 들어왔습니다` });

  const { verdict, body } = splitVerdict(res.answer || '(빈 답)');
  const rec = verdict
    ? recordVerdict(team, { actor: 'outside', verdict, text: body, target: 'guide' })
    : emit(team, { actor: 'outside', type: 'message', text: body, meta: { engine: ENGINE } });

  // 방금 남긴 것까지가 "이미 본 것"이다. 다음 턴에는 이 뒤로 새로 온 말만 받는다.
  if (res.sessionId) remember(team, res.sessionId, rec.id);

  // 같은 방에 있는데 못 들으면 대화가 아니다. 이 방 주인의 귀에 넣는다.
  //
  // 그리고 이 말이 누구를 향한 것인지도 함께 알린다. 질문에 답이 오지 않으면
  // 대화가 아니라 독백이다. 감사역은 스스로 등장할 수 없으므로, 방 주인이
  // 그를 불러 답하게 해야 한다.
  const cast = readCast(team).agents ?? {};
  const to = addressee(body, cast, { except: 'outside' });
  const route = to && to !== OWNER_OF(team)
    ? `\n\n(이 말은 ${cast[to]?.name ?? to} 에게 한 것입니다. 그를 불러 답하게 하세요.)`
    : '';

  const heard = await tell(team, name, (verdict ? `[${verdict}] ` : '') + body + route);
  if (!heard) console.error('(서버가 없어 상대에게 들려주지 못했습니다. 대화록에는 남았습니다.)');

  console.log(`[${ENGINE}] ${team} · ${rec.type}${verdict ? ' ' + rec.meta.verdict : ''}`);
  console.log(body);
  return 0;
}

/* ── 한 번만 묻기 (기록 안 함) ── */

async function viaCodexOnce(prompt) {
  if (!await hasCodex()) return null;
  const { answer } = await runCodex(`${DEFAULT_PERSONA}\n\n---\n\n${prompt}`);
  return answer || null;
}

async function viaOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: API_MODEL,
      messages: [{ role: 'system', content: DEFAULT_PERSONA }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status} ${(await res.text()).slice(0, 180)}`);
  return (await res.json()).choices?.[0]?.message?.content?.trim() ?? null;
}

/* ── 상태 ── */

async function status() {
  const codex = await hasCodex();
  const lines = [];
  if (codex) {
    let v = '';
    try { v = (await run('codex', ['--version'], { timeout: 15_000 })).stdout.trim(); } catch { /* 무시 */ }
    lines.push(`codex CLI 있음${v ? ` (${v})` : ''} · 모델 ${CODEX_MODEL}` +
      (process.env.CODEX_API_KEY ? ' · CODEX_API_KEY 설정됨' : ' · 저장된 로그인 사용'));
    const open = Object.entries(readStore());
    lines.push(open.length
      ? `열린 세션: ${open.map(([t, id]) => `${t}(${id.slice(0, 8)})`).join(', ')}`
      : '열린 세션 없음');
  }
  if (process.env.OPENAI_API_KEY) lines.push(`OpenAI API 있음 (모델 ${API_MODEL}) — 한 번 묻기 전용`);
  return { ok: codex || !!process.env.OPENAI_API_KEY, lines };
}

const SETUP = `외부감사를 연결하는 법.

 1) codex CLI  (권장. 저장소를 직접 읽고, 세션을 유지한다)

      npm install -g @openai/codex
      codex login                     # 또는 export CODEX_API_KEY=...
      codex exec --skip-git-repo-check "안녕"      # 되는지 확인

 2) OpenAI API — export OPENAI_API_KEY=sk-...
    간단하지만 저장소를 못 읽고 세션도 없다. --check 에만 쓰인다.

확인:  node bus/outside.mjs --status
시험:  node bus/outside.mjs --check "2 더하기 2는 5인가?"

붙이지 않으면 감사역이 전부 같은 회사 모델이 되어,
함께 틀리는 지점을 아무도 보지 못한다.`;

/* ── 실행 ── */

const argv = process.argv.slice(2);
let team = process.env.PPANAM_TEAM ?? null;
let question = null, mode = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') team = argv[++i];
  else if (a === '--ask' || a === '-a') { mode = 'ask'; question = argv[++i]; }
  else if (a === '--check' || a === '-c') { mode = 'check'; question = argv[++i]; }
  else if (a === '--reset') mode = 'reset';
  else if (a === '--status') mode = 'status';
  else if (a === '--setup' || a === '-h' || a === '--help') mode = 'setup';
  else if (!question && !a.startsWith('-')) question = a;
}

if (!team) {
  try { team = fs.readFileSync(path.join(ROOT, 'state', 'active-team'), 'utf8').trim(); } catch { /* 기본값 */ }
}
if (!team || !teamExists(team)) team = defaultTeam();

if (mode === 'setup') { console.log(SETUP); process.exit(0); }

if (mode === 'status') {
  const s = await status();
  console.log(s.ok ? s.lines.join('\n') : '외부감사 설정 안 됨 — node bus/outside.mjs --setup');
  process.exit(s.ok ? 0 : 1);
}

if (mode === 'reset') {
  console.log(forget(team) ? `[${team}] 외부감사 세션을 버렸습니다.` : `[${team}] 열린 세션이 없습니다.`);
  process.exit(0);
}

if (!question) {
  console.error('사용법: outside.mjs --team <팀> --ask "물어볼 것"');
  console.error('        outside.mjs --check "한 번만 물어볼 것"');
  console.error('        outside.mjs --setup');
  process.exit(2);
}

if (mode === 'check') {
  const errors = [];
  for (const [name, fn] of [['codex', viaCodexOnce], ['openai', viaOpenAI]]) {
    try {
      const r = await fn(question);
      if (r) {
        console.log(`[${name === 'codex' ? ENGINE : `openai · ${API_MODEL}`}] ${r}`);
        process.exit(0);
      }
    } catch (e) { errors.push(`${name}: ${String(e.message).split('\n')[0].slice(0, 200)}`); }
  }
  console.log('외부감사 설정 안 됨 — 교차검증 없이 진행한다는 사실을 작전실에 남기세요.');
  if (errors.length) console.log('\n시도한 것:\n  ' + errors.join('\n  '));
  console.log('\n' + SETUP);
  process.exit(1);
}

process.exit(await ask(team, question));
