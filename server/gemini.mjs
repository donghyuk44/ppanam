// 상주 gemini — 자리마다 agy 프로세스 하나를 띄워 두고 차례가 오면 stdin 에 한 줄 (결정 122, 대표 09-14 "그냥 불렀는데 왜 답이 1분이나 걸려?").
//
// 전에는 outside.mjs 가 부를 때마다 `agy -p` 를 새로 띄웠다 — 시작·로그인·방 대화 읽기가 매번(실측: 빈 물음도 8.6초). 여기서는
// `agy --input-format stream-json --output-format stream-json` 을 한 번 띄우고(문서 antigravity.google/docs/cli/headless "Stream prompts from stdin"),
// 차례마다 `{ "event":"user", "message":{ "content": … } }` 한 줄을 쓴다. 답은 step_update 의 text_delta(첫 낱말 시각)와 result 의 response(끝).
// 한 프로세스에 여러 턴, 시작 비용 없음. stdin 을 닫으면 지금 턴을 끝내고 종료. 죽으면 다음 물음에 다시 띄운다.
// 인격은 결정 15 대로 user 줄마다 다시 넣는다(outside.mjs 가 조립) — 상주라도 첫 턴만 인격이면 안 된다.
// 대화가 outside.mjs 가 아는 것과 다르면(라운드가 닫혀 세션 칸이 비었다 = resume null) 새 프로세스 — 라운드마다 컨텍스트를 비운다는 규칙 그대로.

import { spawn } from 'node:child_process';
import { ROOT } from '../bus/bus.mjs';

const AGY = process.env.PPANAM_AGY || 'agy';
const TURN_TIMEOUT = Number(process.env.PPANAM_OUTSIDE_TIMEOUT || 300_000);
const pool = new Map();   // "team:actor" → { child, model, effort, conversationId, buf, pending, queue, since, turns }

const keyOf = (team, actor) => `${team}:${actor}`;
const effortOf = (e) => (e === 'xhigh' ? 'high' : e || 'medium');

function spawnOne(key, { model, effort }) {
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', model, '--effort', effortOf(effort), '--add-dir', ROOT];
  const child = spawn(AGY, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH ?? ''}` } });
  const s = { child, model, effort: effortOf(effort), conversationId: null, buf: '', stderr: '', raw: [], pending: null, queue: [], since: Date.now(), turns: 0 };
  child.stdout.on('data', (d) => { s.buf += d; let i; while ((i = s.buf.indexOf('\n')) >= 0) { const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1); if (line) onLine(s, line); } });
  child.stderr.on('data', (d) => { s.stderr = (s.stderr + d).slice(-2000); });
  child.on('close', (code) => {
    if (pool.get(key) === s) pool.delete(key);
    const err = new Error(`agy 상주 프로세스가 끝났습니다 (code ${code})${s.stderr ? ' — ' + s.stderr.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-2).join(' ').slice(0, 200) : ''}`);
    if (s.pending) { clearTimeout(s.pending.timer); s.pending.reject(err); s.pending = null; }
    for (const q of s.queue.splice(0)) q.reject(err);
  });
  child.on('error', (e) => { if (s.pending) { clearTimeout(s.pending.timer); s.pending.reject(e); s.pending = null; } });
  pool.set(key, s);
  return s;
}

/** 한 줄에서 모델 글자를 꺼낸다 — 문서의 step_update.text_delta 말고도 gemini-cli 계열 모양(message.content · content[] · delta · text)을 받는다. 대표(user) 줄의 메아리는 뺀다. */
function textOf(j) {
  if (j.event === 'user' || j.role === 'user' || j.message?.role === 'user') return '';
  const pick = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('') : '');
  return pick(j.text_delta) || pick(j.delta) || pick(j.text) || pick(j.message?.content) || pick(j.content) || '';
}

function onLine(s, line) {
  s.raw.push(line.slice(0, 400)); if (s.raw.length > 24) s.raw.shift();   // 모양을 모를 때 보는 마지막 줄들 — 빈 답이면 같이 돌려준다
  let raw; try { raw = JSON.parse(line); } catch { return; }
  // 실측(나리 R25): 알맹이가 사건 이름 밑에 한 겹 더 들어 있다 — {"event":"result","result":{"status":"SUCCESS","response":"4입니다.\n",…}}.
  // 그래서 첫 실측이 "빈 답" 이었다. 그 겹을 벗기고, 안 그런 모양(평평한 것)도 그대로 받는다.
  const ev = raw.event ?? raw.type;
  const j = ev && raw[ev] && typeof raw[ev] === 'object' && !Array.isArray(raw[ev]) ? { ...raw[ev], event: ev } : raw;
  if (ev === 'init') { s.conversationId = j.conversation_id ?? j.session_id ?? s.conversationId; return; }
  const p = s.pending; if (!p) return;
  if (ev === 'result') {
    clearTimeout(p.timer); s.pending = null; s.turns += 1;
    if (j.conversation_id) s.conversationId = j.conversation_id;
    const status = String(j.status ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') p.reject(new Error(`agy status ${j.status}${j.error ? ' — ' + String(j.error).slice(0, 160) : ''}`));
    else {
      const answer = String(j.response ?? textOf(j) ?? '').trim() || p.text.trim();
      const out = { answer, sessionId: s.conversationId, firstMs: p.first ? p.first - p.at : null, totalMs: Date.now() - p.at, turns: s.turns };
      if (!answer) out.raw = s.raw.slice();   // 빈 답 — 어떤 줄이 왔는지 그대로(outside.mjs --check 가 보여 준다)
      p.resolve(out);
    }
    next(s);
    return;
  }
  const t = textOf(j);
  if (t) {
    if (p.first == null) p.first = Date.now();
    p.text = t.startsWith(p.text) ? t : p.text + t;   // 누적 전문을 다시 주는 줄이면 갈아 끼우고, 조각이면 붙인다

    p.onDelta?.(t);
  }
}

function next(s) {
  if (s.pending || !s.queue.length) return;
  const q = s.queue.shift();
  s.pending = { ...q, text: '', first: null, at: Date.now() };
  s.pending.timer = setTimeout(() => {
    const p = s.pending; s.pending = null;
    try { s.child.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
    p?.reject(new Error(`agy 답 없음 (${Math.round(TURN_TIMEOUT / 1000)}초 초과) — 프로세스를 내렸습니다, 다음 물음에 다시 띄웁니다`));
  }, TURN_TIMEOUT);
  try { s.child.stdin.write(JSON.stringify({ event: 'user', message: { content: q.prompt } }) + '\n'); }
  catch (e) { clearTimeout(s.pending.timer); s.pending = null; q.reject(e); }
}

/**
 * 한 턴. resume 이 이 프로세스의 대화가 아니면(라운드가 닫혀 비었거나 다른 id) 새로 띄운다 — 대화는 라운드 안에서만 이어진다.
 * @returns { answer, sessionId, firstMs, totalMs, turns }
 */
export function ask({ team, actor, prompt, model, effort = null, resume = null, onDelta = null }) {
  const key = keyOf(team, actor);
  let s = pool.get(key);
  const stale = s && (s.model !== model || s.effort !== effortOf(effort) || (resume !== undefined && resume !== null && s.conversationId && resume !== s.conversationId) || (resume == null && s.turns > 0));
  if (s && stale) { try { s.child.stdin.end(); } catch { /* 무시 */ } pool.delete(key); s = null; }
  if (!s) s = spawnOne(key, { model, effort });
  return new Promise((resolve, reject) => { s.queue.push({ prompt, resolve, reject, onDelta }); next(s); });
}

/** 상태 — 관제탑·상황판이 본다. */
export function status() {
  return [...pool.entries()].map(([key, s]) => ({ key, model: s.model, effort: s.effort, conversationId: s.conversationId, busy: !!s.pending, queued: s.queue.length, turns: s.turns, since: new Date(s.since).toISOString(), pid: s.child.pid }));
}

/**
 * 시험용(round.mjs check) — 프로세스 없이 줄만 넣어 본다. 실측 줄(나리 R25)이 그대로 check 에 있다.
 * @returns Promise<{answer, sessionId, firstMs, totalMs}> — lines 를 차례로 먹인 결과
 */
export function parseLines(lines) {
  return new Promise((resolve, reject) => {
    const s = { raw: [], conversationId: null, turns: 0, queue: [], pending: null, child: { stdin: { write() {} } } };
    s.pending = { text: '', first: null, at: Date.now(), timer: setTimeout(() => {}, 0), resolve, reject, onDelta: null };
    for (const l of lines) onLine(s, l);
    if (s.pending) { clearTimeout(s.pending.timer); reject(new Error('result 줄이 없다')); }
  });
}

/** 서버가 내려갈 때 — stdin 을 닫아 곱게 끝낸다. */
export function stopAll() {
  for (const [, s] of pool) { try { s.child.stdin.end(); } catch { /* 무시 */ } }
  pool.clear();
}
