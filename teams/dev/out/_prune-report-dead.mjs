// 리포트 1판-d 로 쓸 곳이 없어진 부품 넷을 app.js 에서 뺀다 — timeBand(시간 띠) · windowKo · dayKo · forShort · renderReport 의 since/until. 하나라도 다른 데서 쓰이면 멈춘다.
import fs from 'node:fs';
const P = 'server/src/app.js';
let s = fs.readFileSync(P, 'utf8');
const cut = (startMark, endMark, label) => {
  const a = s.indexOf(startMark); if (a < 0) { console.error('못 찾음', label); process.exit(2); }
  const b = s.indexOf(endMark, a); if (b < 0) { console.error('끝 못 찾음', label); process.exit(2); }
  s = s.slice(0, a) + s.slice(b);
  console.log('뺌', label);
};
// timeBand — JSDoc 한 줄부터 닫는 중괄호까지
cut('/** 시간 띠 — start~end 를 가로 100% 로.', '\nfunction renderTowerAll(grid) {', 'timeBand');
s = s.replace('\n\nfunction renderTowerAll(grid) {', '\nfunction renderTowerAll(grid) {');
// dayKo · windowKo — 주석 둘과 함수
cut('/** 날짜 머리 — "9월 15일 밤"', '\nfunction renderReport(r) {', 'dayKo·windowKo');
// forShort 한 줄
s = s.replace(/^const forShort = \(ms\) => \{[^\n]*\n/m, () => { console.log('뺌 forShort'); return ''; });
// since/until 선언
s = s.replace('  const since = Date.parse(r.since), until = Date.parse(r.until), now = Date.now();', '  const now = Date.now();');
for (const name of ['timeBand(', 'windowKo(', 'dayKo(', 'forShort(']) {
  const n = s.split(name).length - 1;
  if (n) { console.error('아직 쓰임:', name, n); process.exit(3); }
}
fs.writeFileSync(P, s);
console.log('됨');
