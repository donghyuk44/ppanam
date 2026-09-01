#!/usr/bin/env node
// 바깥눈 어댑터 — 다른 회사 모델에 물어본다.
//
//   node bus/outside.mjs --check "이 주장이 사실인가: ..."
//   node bus/outside.mjs --status
//
// 경로는 두 가지고, 있는 것을 쓴다.
//   1) codex CLI      (PATH 에 codex 가 있으면)
//   2) OpenAI API     (OPENAI_API_KEY 가 있으면)
// 둘 다 없으면 그렇게 말하고 1번으로 끝낸다. 없는 걸 있는 척하지 않는다 —
// 클로드가 바깥눈인 척 판정하면 이 자리의 의미가 사라지기 때문이다.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MODEL = process.env.PPANAM_OUTSIDE_MODEL || 'gpt-5.1';

const SYSTEM = [
  '너는 다른 회사 모델이 만든 산출물을 교차검증하는 감사역이다.',
  '합의를 만들려 하지 마라. 이견이 없으면 없다고 하고, 있으면 근거와 함께 말해라.',
  '특히 다음을 본다: 인용된 수치·날짜·링크가 실재하는가, 코드라면 경계 조건과 멱등성,',
  '그리고 상대가 당연하게 깔고 있는 가정 중 의심할 만한 것.',
  '한국어로, 다섯 문장 안에 답한다.',
].join(' ');

async function viaCodex(prompt) {
  try {
    await run('which', ['codex']);
  } catch {
    return null;
  }
  const { stdout } = await run('codex', ['exec', '--skip-git-repo-check', `${SYSTEM}\n\n${prompt}`], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function viaOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

async function available() {
  const out = [];
  try { await run('which', ['codex']); out.push('codex'); } catch { /* 없음 */ }
  if (process.env.OPENAI_API_KEY) out.push('openai');
  return out;
}

const argv = process.argv.slice(2);
let prompt = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--check' || argv[i] === '-c') prompt = argv[++i];
  else if (argv[i] === '--status') {
    const a = await available();
    console.log(a.length ? `바깥눈 사용 가능: ${a.join(', ')}` : '바깥눈 설정 안 됨');
    process.exit(a.length ? 0 : 1);
  } else if (!prompt && !argv[i].startsWith('-')) prompt = argv[i];
}

if (!prompt) {
  console.error('사용법: outside.mjs --check "검증할 주장"');
  process.exit(2);
}

let answer = null;
let via = null;
const errors = [];

for (const [name, fn] of [['codex', viaCodex], ['openai', viaOpenAI]]) {
  try {
    const r = await fn(prompt);
    if (r) { answer = r; via = name; break; }
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
  }
}

if (!answer) {
  console.log('바깥눈 설정 안 됨 — codex CLI 도 OPENAI_API_KEY 도 없습니다.');
  if (errors.length) console.log('시도한 것: ' + errors.join(' / '));
  console.log('교차검증 없이 진행한다는 사실을 작전실에 남기세요.');
  process.exit(1);
}

console.log(`[${via}] ${answer}`);
