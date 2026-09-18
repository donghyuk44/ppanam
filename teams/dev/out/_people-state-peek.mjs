// 살아 있는 서버의 사람 상태 실측(req_d82aaf90 ③ — '진행 중' 은 차례 도는 사람만) — node teams/dev/out/_people-state-peek.mjs [팀] [포트]
const team = process.argv[2] ?? 'dev', port = process.argv[3] ?? 9612;
const r = await fetch(`http://localhost:${port}/api/team?team=${team}`);
const j = await r.json();
const people = j.summary?.people ?? j.people ?? {};
const now = Date.now();
for (const [id, p] of Object.entries(people)) {
  if (id === 'boss') continue;
  const ago = p.lastSignal ? Math.round((now - new Date(p.lastSignal).getTime()) / 60000) + '분 전' : '—';
  console.log(id.padEnd(10), String(p.state).padEnd(9), 'busy=' + p.busy, 'alive=' + p.alive, '신호 ' + ago);
}
