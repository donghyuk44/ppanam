// 리포트 ④ 된 것 블록을 대시보드와 같은 재료(dashStats doneList)로 바꿔 끼운다 — '  // ④ 된 것 — 팀당 한 줄' 부터 "  // ⑤ 옛 '오늘 할 일'" 앞까지.
import fs from 'node:fs';
const P = 'server/src/app.js';
let s = fs.readFileSync(P, 'utf8');
const block = fs.readFileSync('teams/dev/out/_report-done-block.mjs', 'utf8');
const a = s.indexOf('  // ④ 된 것 — 팀당 한 줄');
const b = s.indexOf("  // ⑤ 옛 '오늘 할 일'");
if (a < 0 || b < 0 || b < a) { console.error('자리 못 찾음', a, b); process.exit(2); }
s = s.slice(0, a) + block + s.slice(b);
fs.writeFileSync(P, s);
console.log('끼움 —', P, a, '→', b);
