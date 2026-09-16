// daily-words.md 의 본보기 줄을 자(bossOk)에 대 본다 — 하영, 09-16. 쓰기: node teams/marketing/out/_daily-words-check.mjs
import fs from 'node:fs';
import { bossOk } from '../../../server/public/bosswords.js';

const md = fs.readFileSync(new URL('./daily-words.md', import.meta.url), 'utf8');
// 표 안 "→ "…"" 본보기와 4절 코드 블록의 "- " 줄을 잰다
const samples = new Set();
for (const m of md.matchAll(/→ "([^"]+)"/g)) samples.add(m[1]);
const block = md.split('```')[1] ?? '';
for (const l of block.split('\n')) if (l.startsWith('- ')) samples.add(l.slice(2));
let bad = 0;
for (const s of samples) {
  const ok = bossOk(s);
  if (!ok) bad += 1;
  console.log(`${ok ? '✓' : '✗'} ${[...s].length}자  ${s}`);
}
console.log(`--- ${samples.size}줄 중 자에 안 맞는 줄 ${bad}`);
