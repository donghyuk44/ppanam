// 정지 그림을 PixelLab 참고용 캔버스에 얹는다 — PixelLab 은 폭 32 이상만 받는다(24×60 은 튕긴다).
// 투명 캔버스(기본 40×64)에 가로 가운데, 발은 바닥에.
//
//   node tools/pixel/pad.mjs <in.png> <out.png> [--w 40] [--h 64]
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const argv = process.argv.slice(2);
const opt = { w: 40, h: 64 }; const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--w') opt.w = Number(argv[++i]);
  else if (argv[i] === '--h') opt.h = Number(argv[++i]);
  else files.push(argv[i]);
}
if (files.length < 2) { console.log('사용법: pad.mjs <in.png> <out.png> [--w 40] [--h 64]'); process.exit(2); }
const img = decodePNG(fs.readFileSync(files[0]));
const W = Math.max(opt.w, img.width + (img.width % 2)), H = Math.max(opt.h, img.height);
const out = new Uint8Array(W * H * 4);
const ox = Math.floor((W - img.width) / 2), oy = H - img.height;
for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
  const s = (y * img.width + x) * 4, d = ((y + oy) * W + (x + ox)) * 4;
  out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
}
fs.writeFileSync(files[1], encodePNG(W, H, out));
console.log(`${files[1]}: ${img.width}×${img.height} → ${W}×${H}`);
