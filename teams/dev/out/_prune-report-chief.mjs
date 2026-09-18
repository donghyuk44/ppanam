// 리포트 맨 밑 '톰의 한마디'(r.chief) 블록을 뺀다 — 세라 카드가 맡는다(헨리 11절 '안 옮긴 것' · 결정 143).
import fs from 'node:fs';
const P = 'server/src/app.js';
let s = fs.readFileSync(P, 'utf8');
const a = s.indexOf('  // 한마디 — 사람 글(teams/hq/out/daily');
const b = s.indexOf('\n}\n\n/* ══ 분석 ══ */', a);
if (a < 0 || b < 0) { console.error('못 찾음', a, b); process.exit(2); }
s = s.slice(0, a) + "  // 톰의 한마디(옛 r.chief 첫 문단)는 뺐다 — 세라 카드가 맡는다(헨리 11절 '안 옮긴 것' · 결정 143).\n" + s.slice(b + 1);
fs.writeFileSync(P, s);
console.log('뺌 한마디');
