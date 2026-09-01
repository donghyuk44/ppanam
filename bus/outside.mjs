#!/usr/bin/env node
// 바깥눈 어댑터 — 다른 회사 모델에 물어본다.
//
//   node bus/outside.mjs --check "이 주장이 사실인가: ..."
//   node bus/outside.mjs --status
//   node bus/outside.mjs --setup      연결하는 법
//
// 이 자리가 존재하는 이유는 하나다.
// 클로드 둘이 사이좋게 같이 틀릴 때, 그건 다른 엔진에게만 보인다.
// 그래서 여기에 클로드를 앉히면 시스템 전체가 의미를 잃는다.
// 연결이 안 되면 판정하지 않고 "설정 안 됨"이라고 말하고 끝낸다.
//
// 경로 두 가지. 있는 것을 쓴다.
//   1) codex CLI  — 저장된 로그인(codex login) 또는 CODEX_API_KEY
//   2) OpenAI API — OPENAI_API_KEY

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const run = promisify(execFile);
const TIMEOUT = Number(process.env.PPANAM_OUTSIDE_TIMEOUT || 180_000);
const API_MODEL = process.env.PPANAM_OUTSIDE_MODEL || 'gpt-5.1';

// codex 는 모델이 아니라 CLI 다. 그 안에서 도는 모델을 여기서 못 박는다.
// 기본값에 얹어두면 어느 엔진이 판정했는지 기록에 남지 않는다 — 감사역 자리에서는 안 된다.
const CODEX_MODEL = process.env.PPANAM_CODEX_MODEL || 'gpt-5.6-sol';

const SYSTEM = [
  '너는 다른 회사 모델이 만든 산출물을 교차검증하는 감사역이다.',
  '합의를 만들려 하지 마라. 이견이 없으면 없다고 하고, 있으면 근거와 함께 말해라.',
  '특히 본다: 인용된 수치·날짜·링크가 실재하는가, 코드라면 경계 조건과 멱등성,',
  '그리고 상대가 당연하게 깔고 있어서 스스로는 못 보는 가정.',
  '파일을 고치지 마라. 읽고 판단만 한다.',
  '한국어로, 다섯 문장 안에.',
].join(' ');

/* ── codex CLI ── */

async function hasCodex() {
  try { await run('which', ['codex']); return true; } catch { return false; }
}

/**
 * codex exec 는 진행 상황을 stderr 로, 최종 답변만 stdout 으로 낸다.
 * 그래도 -o 로 파일에 받는 쪽이 확실해서 그걸 먼저 쓴다.
 *
 * 프롬프트는 인자가 아니라 stdin('-')으로 넘긴다. 길이 제한과 따옴표 문제를 피한다.
 * execFile 에는 stdin 을 넣는 옵션이 없어서(그걸로 넘기면 자식이 영원히 기다린다)
 * spawn 으로 직접 쓰고 닫는다.
 *
 * 샌드박스는 건드리지 않는다 — 기본값이 읽기 전용이고, 감사역은 고치면 안 된다.
 */
function viaCodexSpawn(input, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', [
      'exec', '--ephemeral', '--skip-git-repo-check',
      '-m', CODEX_MODEL,
      '-o', outPath, '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '', stderr = '';
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`codex 응답 없음 (${Math.round(TIMEOUT / 1000)}초 초과)`));
    }, TIMEOUT);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code !== 0) {
        const why = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        return finish(reject, new Error(`codex exit ${code}${why ? ' — ' + why : ''}`));
      }
      finish(resolve, stdout.trim());
    });

    // 프롬프트를 넣고 반드시 닫는다. 닫지 않으면 codex 가 계속 기다린다.
    child.stdin.on('error', () => { /* 자식이 먼저 죽은 경우 */ });
    child.stdin.end(input);
  });
}

async function viaCodex(prompt) {
  if (!await hasCodex()) return null;

  const tmp = path.join(os.tmpdir(), `ppanam-outside-${crypto.randomBytes(4).toString('hex')}.txt`);
  try {
    const stdout = await viaCodexSpawn(`${SYSTEM}\n\n---\n\n${prompt}`, tmp);
    let answer = '';
    try { answer = fs.readFileSync(tmp, 'utf8').trim(); } catch { /* 파일이 없으면 stdout */ }
    return answer || stdout || null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 없으면 그만 */ }
  }
}

/* ── OpenAI API ── */

async function viaOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: API_MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status} ${(await res.text()).slice(0, 180)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
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
  }
  if (process.env.OPENAI_API_KEY) lines.push(`OpenAI API 있음 (모델 ${API_MODEL})`);
  return { ok: codex || !!process.env.OPENAI_API_KEY, lines };
}

const SETUP = `바깥눈을 연결하는 법 — 둘 중 하나면 된다.

 1) codex CLI  (권장. 파일을 직접 읽고 판단한다)

      npm install -g @openai/codex
      codex login                     # 또는 export CODEX_API_KEY=...
      codex exec --skip-git-repo-check "안녕"      # 되는지 확인

 2) OpenAI API (간단하지만 저장소를 못 읽는다)

      export OPENAI_API_KEY=sk-...
      # 모델을 바꾸려면 PPANAM_OUTSIDE_MODEL=gpt-5.1

확인:  node bus/outside.mjs --status
시험:  node bus/outside.mjs --check "2 더하기 2는 5인가?"

붙이지 않으면 감사역 셋이 전부 같은 회사 모델이 되어,
함께 틀리는 지점을 아무도 보지 못한다.`;

/* ── 실행 ── */

const argv = process.argv.slice(2);
let prompt = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--check' || a === '-c') prompt = argv[++i];
  else if (a === '--setup') { console.log(SETUP); process.exit(0); }
  else if (a === '--status') {
    const s = await status();
    console.log(s.ok ? s.lines.join('\n') : '바깥눈 설정 안 됨 — node bus/outside.mjs --setup');
    process.exit(s.ok ? 0 : 1);
  } else if (a === '-h' || a === '--help') { console.log(SETUP); process.exit(0); }
  else if (!prompt && !a.startsWith('-')) prompt = a;
}

if (!prompt) {
  console.error('사용법: outside.mjs --check "검증할 주장"');
  console.error('        outside.mjs --setup     연결하는 법');
  process.exit(2);
}

let answer = null, via = null;
const errors = [];

for (const [name, fn] of [['codex', viaCodex], ['openai', viaOpenAI]]) {
  try {
    const r = await fn(prompt);
    if (r) { answer = r; via = name; break; }
  } catch (e) {
    errors.push(`${name}: ${String(e.message).split('\n')[0].slice(0, 200)}`);
  }
}

if (!answer) {
  console.log('바깥눈 설정 안 됨 — 교차검증 없이 진행한다는 사실을 작전실에 남기세요.');
  if (errors.length) console.log('\n시도한 것:\n  ' + errors.join('\n  '));
  console.log('\n' + SETUP);
  process.exit(1);
}

// 어느 엔진이 말했는지 답과 함께 남긴다. 나중에 "이건 누가 본 건가"에 답할 수 있어야 한다.
console.log(`[${via === 'codex' ? `codex · ${CODEX_MODEL}` : `openai · ${API_MODEL}`}] ${answer}`);
