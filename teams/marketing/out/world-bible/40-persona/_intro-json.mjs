// intro.md(자기소개 100자·300자) → intro.json — 화면 프로필 카드가 읽을 꼴 { name, short, long, by }. 읽고 쓴다.
// 쓰기: node teams/marketing/out/world-bible/40-persona/_intro-json.mjs
import fs from 'node:fs';
const src = 'teams/marketing/out/world-bible/40-persona/intro.md';
const out = 'teams/marketing/out/world-bible/40-persona/intro.json';
const seat = { '하영': 'marketing:guide', '안젤': 'marketing:review', '다니엘': 'marketing:outside', '톰': 'hq:chief', '제리': 'hq:outside', '세라': 'sera:secretary', '나리': 'hq:system', '나래': 'hq:narae(자리 id 미정)', '테라': 'dev:guide', '솔라': 'dev:ops', '레오': 'dev:outside', '헨리': 'design:guide', '클레멘타인': 'design:ops', '마크': 'design:outside', '유진': 'finance:guide', '노라': 'finance:review', '빅터': 'finance:outside' };
const text = fs.readFileSync(src, 'utf8');
const people = [];
for (const block of text.split(/^## /m).slice(1)) {
  const head = block.split('\n')[0];
  const name = head.replace(/\s*\(.*$/, '').trim();
  const short = (block.match(/^100자: (.*)$/m) || [])[1]?.trim() ?? '';
  const long = (block.match(/^300자: (.*)$/m) || [])[1]?.trim() ?? '';
  const by = /본인/.test(head) ? '본인' : '하영 초안';
  people.push({ name, seat: seat[name] ?? null, short, shortLen: short.length, long, longLen: long.length, by });
}
fs.writeFileSync(out, JSON.stringify({ updated: '2026-09-18', source: 'teams/marketing/out/world-bible/40-persona/intro.md', people }, null, 2) + '\n');
for (const p of people) console.log(`${p.name}: 100자 ${p.shortLen} · 300자 ${p.longLen} · ${p.by}`);
