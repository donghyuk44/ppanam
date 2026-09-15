// R23 결정 52 실측 — 오늘 실제 대화록에서 대표를 부른 말이 보고/결정 중 어느 쪽으로 갈리는지. node teams/dev/out/r23-ask-vs-report.mjs
import { readLog, readCast, callsBoss, asksBoss } from '../../../bus/bus.mjs';

const day = process.argv[2] ?? '2026-09-13';
for (const team of ['marketing', 'design', 'dev', 'hq']) {
  let log; try { log = readLog(team); } catch { continue; }
  const cast = readCast(team).agents ?? {};
  const calls = log.filter((e) => e.type === 'message' && e.actor !== 'boss' && e.actor !== 'system' && String(e.ts).startsWith(day) && callsBoss(e.text, cast));
  const asks = calls.filter((e) => asksBoss(e.text, cast));
  console.log(`== ${team}: 대표 부른 말 ${calls.length} → 결정 ${asks.length} · 보고 ${calls.length - asks.length}`);
  for (const e of calls) console.log(`  ${asksBoss(e.text, cast) ? '[결정]' : '[보고]'} ${e.ts.slice(11, 16)} ${e.actor.padEnd(7)} ${JSON.stringify(String(e.text).replace(/\s+/g, ' ').slice(0, 100))}`);
}
