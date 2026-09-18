// 타임라인 블록 화면 글자 → 하영 아홉(사전 111~125행): 끝난 것 → 끝난 · 막힌 것 → 막힘 · 담당 없음 → 담당자 없음 · 끝난 작업 → 완료. 코드 글자(따옴표·역따옴표 안)만, 주석은 안 건드린다.
import fs from 'node:fs';
const P = 'teams/dev/out/_tl-block.mjs';
let s = fs.readFileSync(P, 'utf8');
const swaps = [
  ['` · 끝난 것 ${doneThisWeek}`', '` · 끝난 ${doneThisWeek}`'],
  ["tlCell('bad', '막힌 것')", "tlCell('bad', '막힘')"],
  ['`☑ 끝난 작업 ${oldDone.length}`', '`☑ 완료 ${oldDone.length}`'],
  ['`☑ 끝난 작업 ${done.length}`', '`☑ 완료 ${done.length}`'],
  ['`막힌 것 ${blocked}`', '`막힘 ${blocked}`'],
  ["'tl__face tl__face--none', '담당 없음'", "'tl__face tl__face--none', '담당자 없음'"],
];
let n = 0;
for (const [a, b] of swaps) { if (!s.includes(a)) { console.error('없음:', a); process.exit(1); } s = s.split(a).join(b); n++; }
fs.writeFileSync(P, s);
console.log('swapped', n);
