// 자기소개 글자 수(공백 포함) — intro.md 의 한 절을 재 본다. 인자: 이름
import fs from 'node:fs';
const name = process.argv[2] ?? '테라';
const md = fs.readFileSync('teams/marketing/out/world-bible/40-persona/intro.md', 'utf8');
const sec = md.split(/\n## /).find((s) => s.startsWith(name));
if (!sec) { console.error('절 없음:', name); process.exit(1); }
for (const line of sec.split('\n')) {
  const m = /^(100자|300자):\s*(.*)$/.exec(line);
  if (m) console.log(m[1], '→', m[2].length, '자', m[2].length <= Number(m[1].slice(0, 3)) ? '✓' : '✗ 넘침');
}
