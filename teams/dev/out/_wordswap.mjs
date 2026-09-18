// 타임라인 블록 글자·호출 바꾸기 — 한 번에 여러 자리를 같은 글자로. (3판: 하영 req_d29407c3 — '뒤에 걸림' → '앞 일 남음', '하는 중' → '진행 중')
import fs from 'node:fs';
const P = 'teams/dev/out/_tl-block.mjs';
let s = fs.readFileSync(P, 'utf8');
const swaps = [
  ["afterNames(k) ?? '뒤에 걸림'", "afterNames(k) ?? '앞 일 남음'"],
  ["tlCell('now', '하는 중')", "tlCell('now', '진행 중')"],
];
let n = 0;
for (const [a, b] of swaps) { if (!s.includes(a)) { console.error('없음:', a); process.exit(1); } n += s.split(a).length - 1; s = s.split(a).join(b); }
fs.writeFileSync(P, s);
console.log('swapped', n);
