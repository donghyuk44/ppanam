#!/usr/bin/env node
// 오늘 쓴 돈 — 팀마다·합계 (세라, 09-16 저녁). 대표께 결제 줄을 낼 때 쓰기 직전에 다시 잰다(나리 규칙).
// 값은 server/usage.mjs todayUsage(장부 state/usage.jsonl, 세션 누적을 델타로 고친 것 — 솔라 6122386) 그대로.
//   node tools/usage-today.mjs            → 팀 다섯 + 합
import { todayUsage } from '../server/usage.mjs';
import { listTeams } from '../bus/bus.mjs';

const rows = listTeams().map((t) => ({ id: t.id, name: t.name, ...todayUsage(t.id) }));
let total = 0;
for (const r of rows) { total += r.costUsd; console.log(`${r.name.padEnd(4)} ${r.costUsd.toFixed(0).padStart(6)} 달러  (턴 ${r.turns})`); }
console.log(`합계 ${total.toFixed(0).padStart(6)} 달러  · ${rows[0]?.date ?? ''} · 잰 시각 ${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(11, 16)}`);
