// 타임라인 시안 본보기 값 — 로드맵 단계·작업 보드·회차 실측을 한 번에 찍는다(헨리, 계획 2판 4번). 그림 글자는 여기서 옮긴다.
import fs from 'node:fs';
const teams = ['hq', 'dev', 'design', 'marketing', 'finance'];
const out = {};
for (const t of teams) {
  const rm = JSON.parse(fs.readFileSync(`teams/${t}/roadmap.json`, 'utf8'));
  const ms = (rm.milestones || []).map((m) => ({ n: m.n ?? m.id, title: (m.title || m.name || '').slice(0, 40), status: m.status }));
  const rounds = fs.existsSync(`teams/${t}/rounds.jsonl`) ? fs.readFileSync(`teams/${t}/rounds.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const wk = (ts) => { const d = new Date(new Date(ts).getTime() + 9 * 3600e3); const day = (d.getUTCDay() + 6) % 7; const mon = new Date(d.getTime() - day * 86400e3); return `${mon.getUTCMonth() + 1}/${mon.getUTCDate()}`; };
  const byWeek = {};
  for (const r of rounds) { const w = wk(r.startedAt || r.at || r.ts); if (!w || w.includes('NaN')) continue; byWeek[w] = byWeek[w] || { rounds: 0, pass: 0, ms: new Set() }; byWeek[w].rounds++; if (r.verdict === 'PASS' || r.pass) byWeek[w].pass++; if (r.milestone != null) byWeek[w].ms.add(r.milestone); }
  for (const w in byWeek) byWeek[w].ms = [...byWeek[w].ms];
  out[t] = { destination: (rm.destination || '').slice(0, 60), milestones: ms, byWeek, roundKeys: rounds[0] ? Object.keys(rounds[0]) : [] };
}
const work = JSON.parse(fs.readFileSync('state/work.json', 'utf8'));
const items = (work.items || work).slice ? (work.items || work) : Object.values(work.items || {});
const pick = items.filter((i) => i && i.what).map((i) => ({ id: i.id, team: i.team, what: String(i.what).slice(0, 40), seat: i.seat || i.who || '', status: i.status, after: (i.after || []).join(','), doneAt: i.doneAt ? 1 : 0 }));
out.work = { count: pick.length, noSeat: pick.filter((i) => !i.seat).length, sample: pick.slice(0, 80) };
for (const t of teams) {
  console.log(`== ${t} | ${out[t].destination}`);
  for (const m of out[t].milestones) console.log(`  ${m.n} ${m.status} ${m.title}`);
  console.log(`  weeks: ${JSON.stringify(out[t].byWeek)}`);
}
console.log(`work ${out.work.count} · 담당 없음 ${out.work.noSeat}`);
for (const i of out.work.sample) console.log(`  ${i.id} ${i.team} ${i.status} ${i.seat || '-'} ${i.what}${i.after ? ' 뒤에 ' + i.after : ''}${i.doneAt ? ' ✓' : ''}`);
