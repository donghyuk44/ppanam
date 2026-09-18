// 2판 대장 — 비서실 평가 칸 채우기(방에서 온 말 그대로 요약). 읽고 쓴다.
import fs from 'node:fs';
const f = 'teams/marketing/out/world-bible/40-persona/2판-대장.md';
let t = fs.readFileSync(f, 'utf8');
const ev = {
  '테라': '나리: 어긋남 없음 — 출생·입학·경력 연도 맞물림, 자리 성격 맞음',
  '솔라': '나리: 어긋남 없음 — 연도 맞물림, 자리 성격 맞음',
  '레오': '나리: 어긋남 없음 — 석사 5년까지 연도 맞음, 자리 성격 맞음',
  '다니엘': '나리: 어긋남 없음 — 영국 3년제까지 연도 맞음, 자리 성격 맞음',
  '유진': '나리: 어긋남 없음 — 회계사 2013·법인 6년·경영기획 6년, 원문 81행 뼈대 맞음',
  '노라': '나리: 어긋남 없음 — 베르겐 3년제·오슬로 석사·쉬운 말 부서, 원문 81행 맞음',
  '빅터': '나리: 어긋남 없음 — 독일 회계사 2015 는 실무 5년 뒤라 맞음, 원문 81행 맞음',
  '헨리': '세라 몫 — 대기',
  '클레멘타인': '세라 몫 — 대기',
  '마크': '세라 몫 — 대기',
};
for (const [name, text] of Object.entries(ev)) {
  const re = new RegExp('^(\\| \\d+ \\| ' + name + ' \\|[^\\n]*\\| ①②③ \\|) \\| \\|$', 'm');
  if (!re.test(t)) { console.error('줄 못 찾음:', name); continue; }
  t = t.replace(re, '$1 ' + text + ' | |');
  console.log('적음', name);
}
fs.writeFileSync(f, t);
