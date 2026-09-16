#!/usr/bin/env node
// 훅의 영어 속말 거름줄 한 줄 고치기 (작은 B apr_df4bc5b8, 나리 PASS · 근거 dea1182 code-review).
// 지금 줄: 한글이 없고 영어 낱말(3자 이상)이 여덟 넘으면 기록 안 함 — git log·파일 목록·명령 답처럼 한글 없는 정상 답도 같이 버린다.
// 고친 줄: 낱말을 세기 전에 백틱 안·경로·해시·명령 토큰(/ . : _ - 숫자 @ # = \ 가 든 것)을 빼고 **문장 낱말만** 센다 — 속말은 문장이고 목록은 토큰이라 갈린다.
// .claude/ 밑은 대표 손이라 관리 창에서 돌린다:  node tools/patch-hook-filter-0916.mjs
// 그 줄이 정확히 한 번 있을 때만 바꾸고, 아니면 아무것도 안 건드리고 멈춘다. 원본은 .bak-filter-0916 으로 남긴다. 훅은 이벤트마다 새로 돌아 재시작이 없다.
// 확인:  node --test teams/dev/out/_hook-filter-check.mjs   (표본 둘 — git log 열 줄은 기록, 영어 문장 여덟 낱말은 여전히 bail)
import fs from 'node:fs';

const p = process.argv[2] || '.claude/hooks/to-bus.mjs';   // 시험용으로 사본 경로를 줄 수 있다(테라: teams/dev/out/_hook-copy.mjs 에 먼저 돌려 봄)
const src = fs.readFileSync(p, 'utf8');

const from = "    if (!/[가-힣]/.test(text) && (text.match(/[A-Za-z]{3,}/g) || []).length >= 8) bail('영어 속말 — 기록 안 함');";
const to = [
  "    // 영어 속말 — 문장 낱말만 센다: 백틱 안, 첫 토큰이 해시·경로(숫자 / . : 가 든 것)인 목록 줄, 경로·명령 토큰(/ . : _ - 숫자 @ # = \\ 가 든 것)은 빼고(작은 B apr_df4bc5b8 — git log·파일 목록 답이 같이 버려졌다)",
  "    const proseWords = (t) => (String(t).replace(/`[^`]*`/g, ' ').split('\\n').filter((l) => !/^\\s*\\S*[\\/\\\\.:\\d]\\S*(\\s|$)/.test(l)).join(' ').split(/\\s+/).filter((w) => w && !/[\\/.:_\\-\\d@#=\\\\]/.test(w)).join(' ').match(/[A-Za-z]{3,}/g) || []).length;",
  "    if (!/[가-힣]/.test(text) && proseWords(text) >= 8) bail('영어 속말 — 기록 안 함');",
].join('\n');

if (src.includes('const proseWords')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 그 줄이 ${n}번 있음(1번이어야). 훅이 바뀌었으면 이 스크립트를 다시 맞춘다.`); process.exit(1); }

fs.writeFileSync(p + '.bak-filter-0916', src);
const out = src.replace(from, to);
fs.writeFileSync(p, out);
const line = out.split('\n').findIndex((l) => l.includes('const proseWords')) + 1;
console.log(`고침 — ${p} ${line}행. 원본은 ${p}.bak-filter-0916. 확인: node --test teams/dev/out/_hook-filter-check.mjs`);
