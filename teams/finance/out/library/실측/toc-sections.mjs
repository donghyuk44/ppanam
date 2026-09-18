// 목차 어느 폴더가 몇 바이트를 먹는지 — 접는 규칙을 고치기 전 실측 (유진 09-18). node teams/finance/out/library/실측/toc-sections.mjs
import fs from 'node:fs';
const t = fs.readFileSync('teams/finance/out/library/toc.md', 'utf8').split('\n');
const secs = []; let cur = null;
for (const l of t) {
  if (l.startsWith('## ')) { cur = { h: l.slice(0, 80), n: 0, b: 0, lines: [] }; secs.push(cur); continue; }
  if (cur) { cur.n++; cur.b += Buffer.byteLength(l) + 1; cur.lines.push(l); }
}
secs.sort((a, b) => b.b - a.b);
console.log('머리 바이트:', Buffer.byteLength(t.slice(0, 3).join('\n')));
for (const s of secs.slice(0, 40)) console.log(String(s.b).padStart(5), String(s.n).padStart(3), s.h);
console.log('절', secs.length, '· 절 합계', secs.reduce((a, s) => a + s.b, 0), '· 전체', Buffer.byteLength(t.join('\n')));
if (process.argv[2]) { const s = secs.find((x) => x.h.includes(process.argv[2])); if (s) console.log(s.lines.join('\n')); }
