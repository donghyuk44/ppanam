// 정면 초상 한 장짜리 그림에서 최하단 불투명 줄과 torsoX(가로 중심선)를 잰다.
//
//   node tools/pixel/portrait-measure.mjs <png…> [--torso-band y0-y1]
//
// torso-band 기본은 이미지 높이의 2/3~5/6 (도포 자락 대략 위치).
import fs from 'node:fs';
import { decodePNG } from './png.mjs';

const argv = process.argv.slice(2);
let torsoBand = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--torso-band') torsoBand = argv[++i].split('-').map(Number);
  else files.push(a);
}
if (!files.length) { console.log('사용법: portrait-measure.mjs <png…> [--torso-band y0-y1]'); process.exit(2); }

const results = [];
for (const file of files) {
  const img = decodePNG(fs.readFileSync(file));
  const { width: W, height: H, data } = img;
  const alpha = (x, y) => data[(y * W + x) * 4 + 3];
  let bottom = -1;
  for (let y = H - 1; y >= 0; y--) { let any = false; for (let x = 0; x < W; x++) if (alpha(x, y)) { any = true; break; } if (any) { bottom = y; break; } }
  const [by0, by1] = torsoBand ?? [Math.floor(H * 2 / 3), Math.floor(H * 5 / 6)];
  let minX = Infinity, maxX = -Infinity;
  for (let y = by0; y <= by1 && y < H; y++) for (let x = 0; x < W; x++) if (alpha(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  const torsoX = minX <= maxX ? Math.round((minX + maxX) / 2) : null;
  results.push({ file, width: W, height: H, bottom, torsoBand: [by0, by1], torsoX, centerX: W / 2, shift: torsoX === null ? null : Math.round(W / 2 - torsoX) });
}
console.log(JSON.stringify(results, null, 1));
