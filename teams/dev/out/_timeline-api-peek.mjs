// /api/timeline 실측 — 타임라인 탭 갈아 끼우기 전에 서버가 주는 꼴을 본다(계획-0916 3절, 솔라 cc23d69). 인자: [port]
const port = process.argv[2] ?? '4321';
const r = await fetch(`http://127.0.0.1:${port}/api/timeline`).then((x) => x.json());
console.log('now', r.now, '| weeks', r.weeks.map((w) => `${w.key}:${w.label}`).join(' '));
for (const t of r.teams) {
  console.log(`\n== ${t.id} ${t.name} | signals`, JSON.stringify(t.signals), '| weeks', t.weeks.map((w) => w.key).join(','));
  for (const p of t.projects) {
    const wk = Object.entries(p.weeks).map(([k, v]) => `${k.slice(5)}:${v.rounds}${v.pass ? '✓' : ''}`).join(' ');
    console.log(`  ${p.n ?? '-'}단계 [${p.status ?? '-'}] ${String(p.title).slice(0, 40)} | ${wk} | 작업 ${p.tasks.length}`);
    for (const k of p.tasks.slice(0, 3)) console.log(`     · ${k.status} ${k.seat ?? '(담당 없음)'} ready=${k.ready} doneAt=${k.doneAt ? k.doneAt.slice(0, 10) : '-'} ${String(k.what).slice(0, 50)}`);
  }
}
