// 첨부 블록 갈아 끼우기(결정 226) — app.js 의 '// 그림 올리기 (결정 130 ②' 부터 '/* ── / 명령 (C13' 앞까지를 _attach-block.mjs 로.
import fs from 'node:fs';
const P = 'server/src/app.js';
const src = fs.readFileSync(P, 'utf8').split('\n');
const block = fs.readFileSync('teams/dev/out/_attach-block.mjs', 'utf8').replace(/\n+$/, '\n');
const i0 = src.findIndex((l) => l.startsWith('// 그림 올리기 (결정 130 ②') || l.startsWith('// 그림·문서 첨부 (결정 130 ②'));
const i1 = src.findIndex((l, i) => i > i0 && l.startsWith('/* ── / 명령 (C13'));
if (i0 < 0 || i1 < 0) { console.error('anchor missing', { i0, i1 }); process.exit(1); }
const out = [...src.slice(0, i0), ...block.split('\n'), ...src.slice(i1)];
fs.writeFileSync(P, out.join('\n'));
console.log('spliced', { removed: i1 - i0, added: block.split('\n').length });
