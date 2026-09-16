// 초상 칩 화면용 작은 판 — portraits/chip/*.png(394×394, 한 장 ~286KB) → portraits/chip128/*.png(128×128, 100KB 아래)
// 나리 apr_654ef2a7: 폴더만 바꾸지 말고 화면용은 작은 판으로 — 폰에서 무겁지 않게, 저장소에도 들어가게.
//   node teams/design/out/portraits/_chip128.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const src = 'teams/design/out/portraits/chip';
const dst = 'teams/design/out/portraits/chip128';
mkdirSync(dst, { recursive: true });
let n = 0, max = 0, big = [];
for (const f of readdirSync(src).filter((x) => x.endsWith('.png'))) {
  execFileSync('sips', ['-Z', '128', join(src, f), '--out', join(dst, f)], { stdio: 'ignore' });
  const s = statSync(join(dst, f)).size; n++; if (s > max) max = s; if (s > 100 * 1024) big.push(f);
}
console.log(`${n}장 → ${dst} · 제일 큰 것 ${(max / 1024).toFixed(1)}KB · 100KB 넘는 것 ${big.length ? big.join(' ') : '없음'}`);
