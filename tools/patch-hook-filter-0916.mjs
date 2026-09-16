#!/usr/bin/env node
// 훅의 영어 속말 거름줄 고치기 (작은 B apr_df4bc5b8, 나리 PASS · 근거 dea1182 code-review).
// 2판 — 솔라가 그 줄을 비율 규칙으로 먼저 바꿨다(0ce069e: 영어 글자가 한글 글자의 6배 넘고 40자 이상이면 덩이). 1판의 겨냥 줄이 사라져 이 스크립트는 "0번 있음" 으로 멈췄다.
// 그래서 솔라 규칙 위에 얹는다: 비율은 그대로, **영어 글자를 세는 원문만** 문장으로 좁힌다 — 백틱 안·첫 토큰이 해시·경로인 목록 줄·경로·명령 토큰(/ . : _ - 숫자 @ # = \ 가 든 것)을 빼고 센다.
//   · git log 열 줄·파일 목록·명령 답(한글 없음) → 문장 글자 0 → 기록된다 (1판이 잡으려던 것)
//   · 400자 영어 요약에 한글 낱말 둘 → 문장 글자 300 > 한글 2×6 → 덩이 (솔라가 잡으려던 것, 백틱 방패도 같이 벗겨진다)
// .claude/ 밑은 대표 손이라 관리 창에서 돌린다:  node tools/patch-hook-filter-0916.mjs
// 그 줄이 정확히 한 번 있을 때만 바꾸고, 아니면 아무것도 안 건드리고 멈춘다. 원본은 .bak-filter-0916 으로 남긴다. 훅은 이벤트마다 새로 돌아 재시작이 없다.
// 확인:  node --test teams/dev/out/_hook-filter-check.mjs
import fs from 'node:fs';

const p = process.argv[2] || '.claude/hooks/to-bus.mjs';   // 시험용으로 사본 경로를 줄 수 있다(테라: teams/dev/out/_hook-copy.mjs 에 먼저 돌려 봄)
const src = fs.readFileSync(p, 'utf8');

const from = "    const latinChars = (text.match(/[A-Za-z]/g) || []).length;";
const to = [
  "    // 영어 글자는 **문장**에서만 센다 — 백틱 안, 첫 토큰이 해시·경로(숫자 / . : 가 든 것)인 목록 줄, 경로·명령 토큰(/ . : _ - 숫자 @ # = \\ 가 든 것)은 빼고(작은 B apr_df4bc5b8 — git log·파일 목록 답이 같이 버려졌다). 비율 규칙(솔라 0ce069e)은 그대로.",
  "    const proseText = String(text).replace(/`[^`]*`/g, ' ').split('\\n').filter((l) => !/^\\s*\\S*[\\/\\\\.:\\d]\\S*(\\s|$)/.test(l)).join(' ').split(/\\s+/).filter((w) => w && !/[\\/.:_\\-\\d@#=\\\\]/.test(w)).join(' ');",
  "    const latinChars = (proseText.match(/[A-Za-z]/g) || []).length;",
].join('\n');

if (src.includes('const proseText')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 그 줄이 ${n}번 있음(1번이어야). 훅이 바뀌었으면 이 스크립트를 다시 맞춘다.`); process.exit(1); }

fs.writeFileSync(p + '.bak-filter-0916', src);
const out = src.replace(from, to);
fs.writeFileSync(p, out);
const line = out.split('\n').findIndex((l) => l.includes('const proseText')) + 1;
console.log(`고침 — ${p} ${line}행. 원본은 ${p}.bak-filter-0916. 확인: node --test teams/dev/out/_hook-filter-check.mjs`);
