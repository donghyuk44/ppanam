// 대표가 최근에 한 말 — 방 넷 기록에서 시각 구간으로(우리 시각 +9). node teams/dev/out/_boss-recent.mjs <UTC 시작 HH:MM> <UTC 끝 HH:MM>
import fs from 'node:fs';
const [from = '06:30', to = '07:00'] = process.argv.slice(2);
const day = '2026-09-18T';
for (const team of ['hq', 'sera', 'dev', 'marketing', 'design', 'finance']) {
  let lines = []; try { lines = fs.readFileSync(`teams/${team}/log.jsonl`, 'utf8').trim().split('\n'); } catch { continue; }
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.actor !== 'boss' || !e.ts?.startsWith(day)) continue;
    const hm = e.ts.slice(11, 16);
    if (hm < from || hm > to) continue;
    console.log(`${team.padEnd(9)} ${hm}  ${String(e.text ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}
