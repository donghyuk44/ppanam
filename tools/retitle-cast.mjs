#!/usr/bin/env node
// 직책 열일곱 + 방 이름 넷을 확정 낱말표로 (결정 136 · apr_ee0c16a2 · 하영 opsroom-words.md 0-1·0-2 ① 열). 한 번 돌리고 커밋 하나 — 두 이름이 섞여 도는 기간을 없애려고.
//   node tools/retitle-cast.mjs          바꾸고 무엇이 바뀌었는지 찍는다 (이미 맞으면 0)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 0-2 표 ① 열 — 사람이 아니라 자리 기준(한 팀에 한 자리). 총괄실은 총괄실 그대로라 톰은 "실장"(비서실이면 비서실장).
const TITLES = {
  hq:        { chief: '실장', outside: '감사 · 다른 회사', secretary: '비서', boss: '대표', system: '검수' },
  sera:      { secretary: '비서', boss: '대표', system: '검수' },
  dev:       { guide: '개발팀장', ops: '운영 담당', outside: '외부 감사', boss: '대표', system: '검수' },
  marketing: { guide: '마케팅팀장', review: '감사', outside: '외부 감사', boss: '대표', system: '검수' },
  design:    { guide: '디자인팀장', ops: '디자이너', outside: '외부 감사', boss: '대표', system: '검수' },
  finance:   { guide: '경영팀장', review: '감사', outside: '외부 감사', boss: '대표', system: '검수' },
};
// 나리(system) 의 하는 일 — 0-2 표 ② 열. "안내" 는 하네스가 자동으로 넣는 글의 이름이지 사람 직책이 아니다.
const SYSTEM_DOES = '파일을 열어 다시 센다 · 재시작·스크린샷·유니티처럼 저장소 밖에 손이 닿는 일 (자동 안내 글도 이 자리 이름으로 뜬다)';
// 0-1 표 (덤) 작전실 → 팀 방: 방 이름은 "마케팅 방" 꼴(대표가 이미 그렇게 부른다, R22). 총괄실·비서실·마을은 그대로.
const ROOMS = { marketing: '마케팅 방', dev: '개발 방', design: '디자인 방', finance: '경영 방' };

let changed = 0;
for (const [team, map] of Object.entries(TITLES)) {
  const file = path.join(ROOT, 'teams', team, 'cast.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [seat, title] of Object.entries(map)) {
    const a = j.agents?.[seat];
    if (!a) { console.error(`${team}/${seat} 자리 없음`); continue; }
    if (a.title !== title) { console.log(`${team}/${seat} ${a.name}: ${a.title} → ${title}`); a.title = title; changed++; }
    if (seat === 'system' && a.does !== SYSTEM_DOES) { a.does = SYSTEM_DOES; changed++; }
  }
  for (const seat of Object.keys(j.agents ?? {})) if (!(seat in map)) console.error(`${team}/${seat} 표에 없음 — 그대로`);
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
}
// teams.json 은 손으로 한 줄씩 맞춰 둔 파일이라 통째로 다시 찍지 않고 글자만 바꾼다
const tf = path.join(ROOT, 'state', 'teams.json');
let ts = fs.readFileSync(tf, 'utf8');
for (const [id, room] of Object.entries(ROOMS)) {
  const cur = JSON.parse(ts).teams.find((t) => t.id === id)?.room;
  if (!cur || cur === room) continue;
  ts = ts.replace(`"room": "${cur}"`, `"room": "${room}"`); console.log(`teams.json ${id}: ${cur} → ${room}`); changed++;
}
fs.writeFileSync(tf, ts);
console.log(`바뀐 것 ${changed}`);
