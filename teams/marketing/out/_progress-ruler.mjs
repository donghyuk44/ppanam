// 마케팅 상황판 네 줄을 자(bossOk)에 대 본다 — 아침 한 장이 이 줄을 읽어서, 자에 안 맞으면 뺀다(09-18 뺀줄 파일). 쓰기: node teams/marketing/out/_progress-ruler.mjs
import fs from 'node:fs';
import { bossOk } from '../../../server/public/bosswords.js';
const p = JSON.parse(fs.readFileSync('teams/marketing/progress.json', 'utf8'));
for (const k of ['doing', 'blocked', 'boss', 'next']) {
  const v = p[k]; const arr = Array.isArray(v) ? v : [v];
  for (const line of arr) { if (!line) continue; const r = bossOk(String(line)); console.log(k, r === true || r?.ok ? 'OK' : 'X', JSON.stringify(r).slice(0, 120), '|', String(line).slice(0, 60)); }
}
