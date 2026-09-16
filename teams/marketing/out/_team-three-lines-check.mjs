// 팀별-세줄.md 의 세 줄 표를 자(bossOk)에 대 본다 — 하영, 09-16. 쓰기: node teams/marketing/out/_team-three-lines-check.mjs
import fs from 'node:fs';
import { bossOk } from '../../../server/public/bosswords.js';

const md = fs.readFileSync(new URL('./팀별-세줄.md', import.meta.url), 'utf8');
const rows = md.split('\n').filter((l) => /^\| (마케팅|개발|디자인|경영|총괄) \|/.test(l));
let bad = 0, n = 0;
for (const r of rows.slice(0, 5)) {   // 첫 표만(둘째 표는 재료 표)
  const cells = r.split('|').map((s) => s.trim()).filter(Boolean);
  const [team, now, next, after] = cells;
  for (const [k, s] of [['지금', now], ['다음', next], ['그 뒤', after]]) {
    n += 1;
    const ok = bossOk(s) && !/\d/.test(s);   // 숫자도 0 — 대표 원문 "번호가 많아"
    if (!ok) bad += 1;
    console.log(`${ok ? '✓' : '✗'} ${String([...s].length).padStart(2)}자  ${team} · ${k} — ${s}`);
  }
}
console.log(`--- ${n}줄 중 자에 안 맞는 줄 ${bad}`);
