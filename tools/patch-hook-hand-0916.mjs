#!/usr/bin/env node
// 훅 두 줄 고치기 — 서버 나리(system) 말에 meta.hand = 'server' 를 찍는다 (C16, 결정 157 · 테라 1852f11 · 솔라 fdcd224).
// .claude/ 밑은 대표 손이라 대표 터미널에서 돌린다:  node tools/patch-hook-hand-0916.mjs
// 두 줄이 정확히 한 번씩 있을 때만 바꾸고, 아니면 아무것도 안 건드리고 멈춘다. 원본은 .bak-0916 으로 남긴다.
import fs from 'node:fs';

const p = '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');

const edits = [
  [
    "out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true } };",
    "out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true, ...(actor === 'system' ? { hand: 'server' } : {}) } };",
  ],
  [
    "out = { actor, type: 'message', text: trim(text) };",
    "out = { actor, type: 'message', text: trim(text), meta: actor === 'system' ? { hand: 'server' } : undefined };",
  ],
];

if (src.includes("hand: 'server'")) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
for (const [from] of edits) {
  const n = src.split(from).length - 1;
  if (n !== 1) { console.error(`멈춤 — 이 줄이 ${n}번 있음(1번이어야): ${from}`); process.exit(1); }
}

fs.writeFileSync(p + '.bak-0916', src);
let out = src;
for (const [from, to] of edits) out = out.replace(from, to);
fs.writeFileSync(p, out);
const lines = out.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes("hand: 'server'")).map(([i]) => i);
console.log(`고침 — ${p} ${lines.join('·')}행. 원본은 ${p}.bak-0916`);
