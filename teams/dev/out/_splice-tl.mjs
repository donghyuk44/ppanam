// 타임라인 탭 블록 갈아 끼우기 — app.js 의 '/* ── 타임라인 탭 (' 부터 '/* ══ 보고서' 앞까지를 _tl-block.mjs 로 바꾼다(첫 판은 옛 순서 칸 띠 loadDashboardBand 를 이걸로 바꿨다).
import fs from 'node:fs';
const P = 'server/src/app.js';
const src = fs.readFileSync(P, 'utf8').split('\n');
const block = fs.readFileSync('teams/dev/out/_tl-block.mjs', 'utf8').replace(/\n+$/, '\n');
const iTl = src.findIndex((l) => l.startsWith('/* ── 타임라인 탭 ('));
const iEnd = src.findIndex((l, i) => i > iTl && l.startsWith('/* ══ 보고서 — '));
if (iTl < 0 || iEnd < 0) { console.error('anchor missing', { iTl, iEnd }); process.exit(1); }
const out = [...src.slice(0, iTl), ...block.split('\n'), ...src.slice(iEnd)];
fs.writeFileSync(P, out.join('\n'));
console.log('spliced', { removed: iEnd - iTl, added: block.split('\n').length });
