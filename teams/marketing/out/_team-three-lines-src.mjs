// 팀별 세 줄(지금·다음·그 뒤) 재료 읽기 — 하영, 09-16. 쓰기: node teams/marketing/out/_team-three-lines-src.mjs
import fs from 'node:fs';
const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
for (const t of ['marketing', 'dev', 'design', 'finance', 'hq']) {
  console.log('=== ' + t);
  try {
    const p = JSON.parse(fs.readFileSync(`teams/${t}/progress.json`, 'utf8'));
    console.log('doing :', cut((p.doing ?? []).join(' | '), 320));
    console.log('next  :', cut((p.next ?? []).join(' | '), 420));
    console.log('blocked:', cut((p.blocked ?? []).join(' | '), 200));
    console.log('boss  :', cut((p.boss ?? []).join(' | '), 200));
  } catch { console.log('progress: none'); }
  try {
    const r = JSON.parse(fs.readFileSync(`teams/${t}/roadmap.json`, 'utf8'));
    const ms = r.milestones ?? [];
    const now = ms.find((m) => m.status === 'now') ?? ms.find((m) => m.status !== 'pass');
    console.log('now   :', now ? `${now.n} ${now.title} [${now.status}]` : '(없음)');
    const nx = ms.filter((m) => m.status !== 'pass' && m !== now).slice(0, 2).map((m) => `${m.n} ${m.title} [${m.status}]`);
    console.log('nextMs:', nx.join(' | ') || '(없음)');
  } catch { console.log('roadmap: none'); }
}
