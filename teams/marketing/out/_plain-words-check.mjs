// 보통 말 표(plain-words.md)를 방 말 검사기(server/public/roomwords.js, 솔라)가 실제로 어떻게 읽나 — 읽기만 한다.
// 검사기는 표가 아니라 "한 줄에 낱말 하나" 를 기대한다. 이 도구는 지금 파일에서 뽑히는 낱말을 보여 준다.
// 쓰기: node teams/marketing/out/_plain-words-check.mjs [시험할 문장]
import fs from 'node:fs';
import { parseInsiderWords, insiderWordHit } from '../../../server/public/roomwords.js';

const md = fs.readFileSync('teams/marketing/out/plain-words.md', 'utf8');
const words = parseInsiderWords(md);
console.log(`뽑힌 낱말 ${words.length}개 — 12자 이하만:`);
for (const w of words) if (w.length <= 12) console.log('  ' + JSON.stringify(w));
const probe = process.argv.slice(2).join(' ');
if (probe) console.log('시험 문장 →', JSON.stringify(insiderWordHit(probe, words)));
