// 8단계 ④ 실측 — 개발 방의 침묵 장부를 상한(30)까지 채운다. 다음 침묵 차례가 note "침묵 차례가 시간당 상한(30회)에 닿았습니다" 로 막혀야 한다.
// node --test tools/m8-seed-budget.mjs. 다른 방 칸은 그대로 둔다. 한 시간 지나면 스스로 풀린다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CAPS, lullUsed } from '../bus/bus.mjs';
const p = path.join(ROOT, 'state', 'budget.json');
let b; try { b = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { b = { lull: {}, village: { day: 0, items: [] } }; }
const now = Date.now();
b.lull ??= {};
b.lull.dev = Array.from({ length: CAPS.lullPerHour }, (_, i) => now - 60_000 + i * 10);
fs.writeFileSync(p, JSON.stringify(b) + '\n');
console.log(`dev 침묵 장부 ${lullUsed('dev')}/${CAPS.lullPerHour} — 다음 침묵 차례는 막혀야 한다 (${new Date(now).toISOString()})`);
