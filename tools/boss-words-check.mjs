#!/usr/bin/env node
// 대표 화면에 올라가는 글이 사람 말인가 — 나리 검수용 자(09-16, 대표 "가시성 가독성 0점").
// 본다: 다섯 팀 progress.json 의 blocked·boss 줄 · 대기 결재 카드의 what · /api/done 의 항목 글.
// 하네스 말 = 카드 번호·파일 경로·결정 번호·회차/단계·판정 낱말·커밋 해시. 한 낱말이라도 있으면 그 줄은 대표가 못 읽는 줄로 센다.
// 쓰기: node tools/boss-words-check.mjs [--port 4321] [--all]   (--all 은 줄마다 찍음)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '4321';
const all = args.includes('--all');
// 자는 server/public/bosswords.js 하나 — 화면(app.js)이 같은 것으로 "아직 쉬운 말로 안 적음" 을 정한다(R32). 여기서 다시 적지 않는다.
export { JARGON, isBossWord } from '../server/public/bosswords.js';
import { isBossWord, MAX_LEN } from '../server/public/bosswords.js';
const rows = [];
// --file <md>: 표가 있는 파일의 "규칙대로" 칸(없으면 마지막 글 칸)만 잰다 — 하영 본보기(boss-lines.md)를 화면에 올리기 전에 재는 용도.
if (args.includes('--file')) {
  const f = args[args.indexOf('--file') + 1];
  let col = -1;
  for (const line of fs.readFileSync(path.resolve(ROOT, f), 'utf8').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue;
    if (cells[0] === '#') { col = cells.findIndex((c) => /규칙대로|고친/.test(c)); if (col < 0) col = cells.length - 2; continue; }
    if (col < 0) continue;
    const raw = cells[col] ?? '';
    const bold = [...raw.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);   // 굵은 부분이 실제 줄, 나머지는 하영 메모
    for (const text of bold.length ? bold : [raw]) if (text.trim()) rows.push({ where: `${f} 표 ${cells[0]}`, text: text.trim() });
  }
}
if (!args.includes('--file')) for (const t of ['hq', 'dev', 'design', 'marketing', 'finance']) {
  let p; try { p = JSON.parse(fs.readFileSync(path.join(ROOT, 'teams', t, 'progress.json'), 'utf8')); } catch { continue; }
  for (const k of ['blocked', 'boss']) for (const s of [].concat(p[k] ?? []).filter(Boolean)) rows.push({ where: `현황 ${t} ${k}`, text: String(s) });
}
const get = async (u) => { try { return await (await fetch(`http://localhost:${port}${u}`)).json(); } catch { return null; } };
const apr = args.includes('--file') ? null : await get('/api/approvals');
for (const a of apr?.pending ?? []) rows.push({ where: `결재 ${a.grade} ${a.id}`, text: String(a.what ?? '') });
const done = args.includes('--file') ? null : await get(`/api/done?since=${Date.now() - 12 * 3600e3}`);
for (const it of (done?.items ?? []).slice(0, 40)) rows.push({ where: `누가뭘했나 ${it.kind ?? ''}`, text: String(it.text ?? it.title ?? '') });
let bad = 0;
for (const r of rows) { const ok = isBossWord(r.text) && r.text.length <= MAX_LEN; if (!ok) bad++; if (r.text.length > MAX_LEN) r.where += ` (${r.text.length}자, ${MAX_LEN} 넘음)`; if (all || !ok) console.log(ok ? '○' : '✗', r.where, '|', r.text.replace(/\s+/g, ' ').slice(0, 110)); }
console.log(`--- 대표 화면 글 ${rows.length}줄 중 하네스 말 ${bad}줄 (${rows.length ? Math.round(bad * 100 / rows.length) : 0}%)`);
