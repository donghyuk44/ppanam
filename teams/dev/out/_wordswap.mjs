// 타임라인 블록 글자·호출 바꾸기 — (4판: 하영 req_d29407c3 — 보드 값 '감사 대기' 는 화면에 '검토 기다림')
import fs from 'node:fs';
const P = 'teams/dev/out/_tl-block.mjs';
let s = fs.readFileSync(P, 'utf8');
const swaps = [
  ["tlCell('wait', '감사 대기')", "tlCell('wait', '검토 기다림')"],
  ["chip(1, 'wait', '감사 대기')", "chip(1, 'wait', '검토 기다림')"],
  ["dot.title = k.status;", "dot.title = STATUS_WORD[k.status] ?? k.status;"],
];
let n = 0;
for (const [a, b] of swaps) { if (!s.includes(a)) { console.error('없음:', a); process.exit(1); } n += s.split(a).length - 1; s = s.split(a).join(b); }
fs.writeFileSync(P, s);
console.log('swapped', n);
