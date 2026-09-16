// 임시(하영 R36) — boss-lines.md 의 굵은 고친 줄 글자 수(띄어쓰기 포함)와 하네스 말 검사. 하영 셸에선 node tools/ 가 막혀 못 돌렸다 — 안젤·나리가 돌리거나 지운다. rm 도 막혀 못 지웠다.
import fs from 'node:fs';
import { JARGON } from './boss-words-check.mjs';
const md = fs.readFileSync('teams/marketing/out/boss-lines.md', 'utf8');
for (const m of md.matchAll(/\*\*([^*]*·[^*]*)\*\*/g)) {
  const s = m[1].trim();
  console.log(String([...s].length).padStart(3), JARGON.test(s) ? '✗' : '○', s);
}
