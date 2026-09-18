// 설정 3판 블록(_settings-block.mjs)을 app.js 의 옛 loadSettings 자리에 끼운다 — 'async function loadSettings() {' 부터 '/* ══ 관제탑 ══ */' 앞까지 바꿔치기.
import fs from 'node:fs';
const P = 'server/src/app.js';
let s = fs.readFileSync(P, 'utf8');
const block = fs.readFileSync('teams/dev/out/_settings-block.mjs', 'utf8');
const a = s.indexOf('async function loadSettings() {');
const b = s.indexOf('/* ══ 관제탑 ══ */');
if (a < 0 || b < 0 || b < a) { console.error('자리 못 찾음', a, b); process.exit(2); }
s = s.slice(0, a) + block.trimEnd() + '\n\n' + s.slice(b);
fs.writeFileSync(P, s);
console.log('끼움 —', P, '옛 자리', a, '→', b);
