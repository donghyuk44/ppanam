// 리포트 1판-d 블록(_report-block.mjs)을 renderReport 의 ③~⑤ 자리에 끼운다 — '  // ③ 막힌 것 N · 한 것은 점' 부터 '  // 한마디 — 사람 글' 앞까지 바꿔치기.
import fs from 'node:fs';
const P = 'server/src/app.js';
let s = fs.readFileSync(P, 'utf8');
const block = fs.readFileSync('teams/dev/out/_report-block.mjs', 'utf8');
const a = s.indexOf('  // ③ 막힌 것 N · 한 것은 점');
const b = s.indexOf('  // 한마디 — 사람 글(teams/hq/out/daily');
if (a < 0 || b < 0 || b < a) { console.error('자리 못 찾음', a, b); process.exit(2); }
s = s.slice(0, a) + block.trimEnd() + '\n\n' + s.slice(b);
fs.writeFileSync(P, s);
console.log('끼움 —', P, a, '→', b);
