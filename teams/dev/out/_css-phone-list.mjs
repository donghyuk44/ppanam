// 폰 방 칩 띠(가로 스크롤) 규칙 묶음을 뺀다 — '‹ 목록' 세로 목록(req_f8a12066)이 대신한다. style.css 819 미디어 블록 안 여덟 줄.
import fs from 'node:fs';
const P = 'server/public/style.css';
let s = fs.readFileSync(P, 'utf8');
const start = s.indexOf('  .rail__list {\n    flex: 1 1 0; min-width: 96px; flex-direction: row;');
const endMark = '  .team__sub { display: none; }\n';
const end = s.indexOf(endMark, start);
if (start < 0 || end < 0) { console.error('anchor missing', { start, end }); process.exit(1); }
const removed = s.slice(start, end + endMark.length);
const keep = '  .rail__more { display: none; }   /* 옛 가로 칩 띠의 "밖 N" 힌트 — 세로 목록엔 밖이 없다 */\n  .approvals { padding-right: 52px; }   /* 첫 카드의 오른쪽 끝(방에서 보기)이 종 밑에 안 들어가게 */\n';
s = s.slice(0, start) + keep + s.slice(end + endMark.length);
fs.writeFileSync(P, s);
console.log('removed lines', removed.split('\n').length - 1);
