#!/usr/bin/env node
// 대표 화면에 올라가는 글이 사람 말인가 — 나리 검수용 자(09-16, 대표 "가시성 가독성 0점").
// 본다: 다섯 팀 progress.json 의 blocked·boss 줄 · 대기 결재 카드의 what · /api/done 의 항목 글 ·
// 멤버 카드 "마지막 말"(peopleOf 의 doing, 굵은 글이 아니라 동적으로 조립되는 자리 — 대표 09-16 지적 ①,
// 도구 줄에 meta.tool 이 없으면 원문 그대로 새던 것) · 작업 보드 병목 줄(timelineOf 의 topBlockers, 지적 ⑤).
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
import { peopleOf, readLog, readCast, timelineOf } from '../bus/bus.mjs';
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
// 멤버 카드 "마지막 말" — peopleOf(bus.mjs) 의 doing 이 굵은 글 표도 API 호출도 아니라 조립되는 값이라 위 두 자리로는 못 잡았다.
// 도구 줄에서 온 것(meta.tool 이 없는 Bash 등)이면 화면이 원문을 그대로 새울 수 있다(대표 09-16 지적 ①) — 여기서 그 값을 그대로 잰다.
if (!args.includes('--file')) for (const t of ['hq', 'dev', 'design', 'marketing', 'finance']) {
  let log, cast; try { log = readLog(t); cast = readCast(t).agents ?? {}; } catch { continue; }
  const people = peopleOf(log, cast, {});
  for (const [actor, p] of Object.entries(people)) if (p.doing?.text) rows.push({ where: `멤버카드 ${t} ${actor} 마지막말`, text: String(p.doing.text) });
}
// 작업 보드 병목 줄 — timelineOf(bus.mjs) 의 bottleneck 은 work.json 에 나리·톰이 손으로 적어 하네스 말이 섞이기 쉽다(대표 09-16 지적 ⑤).
if (!args.includes('--file')) {
  let tl; try { tl = timelineOf(); } catch { tl = null; }
  for (const b of tl?.topBlockers ?? []) if (b?.bottleneck) rows.push({ where: '작업보드 병목', text: String(b.bottleneck) });
}
const get = async (u) => { try { return await (await fetch(`http://localhost:${port}${u}`)).json(); } catch { return null; } };
const apr = args.includes('--file') ? null : await get('/api/approvals');
for (const a of apr?.pending ?? []) rows.push({ where: `결재 ${a.grade} ${a.id}`, text: String(a.what ?? '') });
const done = args.includes('--file') ? null : await get(`/api/done?since=${Date.now() - 12 * 3600e3}`);
for (const it of (done?.items ?? []).slice(0, 40)) rows.push({ where: `누가뭘했나 ${it.kind ?? ''}`, text: String(it.text ?? it.title ?? '') });
let bad = 0;
for (const r of rows) { const ok = isBossWord(r.text) && r.text.length <= MAX_LEN; if (!ok) bad++; if (r.text.length > MAX_LEN) r.where += ` (${r.text.length}자, ${MAX_LEN} 넘음)`; if (all || !ok) console.log(ok ? '○' : '✗', r.where, '|', r.text.replace(/\s+/g, ' ').slice(0, 110)); }
console.log(`--- 대표 화면 글 ${rows.length}줄 중 하네스 말 ${bad}줄 (${rows.length ? Math.round(bad * 100 / rows.length) : 0}%)`);
