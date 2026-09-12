// 생성 도구가 뱉은 "픽셀 아트처럼 보이는 그림"을 진짜 도트로 되돌린다.
//
//   node tools/pixel/fix.mjs <in.png> <out.png> [--block 8] [--key ff00ff] [--colors 32] [--trim] [--height 64]
//
// 순서: 1) 블록 크기 추정(--block 없으면) → 최근접 축소  2) 크로마 키(#ff00ff 근처)를 투명으로  3) 여백 잘라내기(--trim)
//       4) 팔레트 축소(--colors, 단순 중앙값 분할)  5) 알파는 0/255 로. 결과는 check.mjs 로 다시 잰다.
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const argv = process.argv.slice(2);
const files = [], opt = { block: 0, key: 'ff00ff', colors: 0, trim: false, height: 0, tol: 60 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--block') opt.block = Number(argv[++i]);
  else if (a === '--key') opt.key = argv[++i].replace('#', '');
  else if (a === '--colors') opt.colors = Number(argv[++i]);
  else if (a === '--trim') opt.trim = true;
  else if (a === '--height') opt.height = Number(argv[++i]);
  else if (a === '--tol') opt.tol = Number(argv[++i]);
  else files.push(a);
}
if (files.length < 2) { console.log('사용법: fix.mjs <in.png> <out.png> [--block N] [--key ff00ff] [--colors N] [--trim] [--height N]'); process.exit(2); }

const img = decodePNG(fs.readFileSync(files[0]));
let { width: W, height: H, data } = img;

/** 블록 크기 추정 — 가로로 색이 바뀌는 지점 사이 간격의 최빈값 */
function guessBlock() {
  const runs = new Map();
  for (let y = 0; y < H; y += Math.max(1, Math.floor(H / 64))) {
    let run = 1;
    for (let x = 1; x < W; x++) {
      const a = (y * W + x) * 4, b = a - 4;
      const same = Math.abs(data[a] - data[b]) < 12 && Math.abs(data[a + 1] - data[b + 1]) < 12 && Math.abs(data[a + 2] - data[b + 2]) < 12;
      if (same) run++; else { if (run >= 2 && run <= 32) runs.set(run, (runs.get(run) ?? 0) + 1); run = 1; }
    }
  }
  let best = 1, bn = 0;
  for (const [r, n] of runs) if (n > bn) { bn = n; best = r; }
  return best;
}
let block = opt.block || (opt.height ? Math.max(1, Math.round(H / opt.height)) : guessBlock());
if (block > 1) {
  const w = Math.floor(W / block), h = Math.floor(H / block), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // 블록 가운데 픽셀을 뽑는다 (최근접). 평균을 내면 경계가 번진다.
    const sx = x * block + (block >> 1), sy = y * block + (block >> 1), s = (sy * W + sx) * 4, o = (y * w + x) * 4;
    out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
  }
  W = w; H = h; data = out;
}

// 크로마 키 → 투명
const kr = parseInt(opt.key.slice(0, 2), 16), kg = parseInt(opt.key.slice(2, 4), 16), kb = parseInt(opt.key.slice(4, 6), 16);
let keyed = 0;
for (let i = 0; i < data.length; i += 4) {
  const d = Math.abs(data[i] - kr) + Math.abs(data[i + 1] - kg) + Math.abs(data[i + 2] - kb);
  if (d < opt.tol) { data[i + 3] = 0; keyed++; }
  data[i + 3] = data[i + 3] < 128 ? 0 : 255;
}

// 여백 잘라내기
if (opt.trim) {
  let minx = W, miny = H, maxx = -1, maxy = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3]) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  if (maxx >= 0) {
    const w = maxx - minx + 1, h = maxy - miny + 1, out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y + miny) * W + (x + minx)) * 4, o = (y * w + x) * 4; out.set(data.subarray(s, s + 4), o); }
    W = w; H = h; data = out;
  }
}

// 팔레트 축소 — 중앙값 분할
if (opt.colors > 0) {
  const px = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) px.push([data[i], data[i + 1], data[i + 2]]);
  let boxes = [px];
  while (boxes.length < opt.colors) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift(); if (!box || box.length < 2) { if (box) boxes.push(box); break; }
    const ranges = [0, 1, 2].map((c) => Math.max(...box.map((p) => p[c])) - Math.min(...box.map((p) => p[c])));
    const ch = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  const pal = boxes.map((b) => b.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => Math.round(v / b.length)));
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    let bi = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) { const d = (pal[k][0] - data[i]) ** 2 + (pal[k][1] - data[i + 1]) ** 2 + (pal[k][2] - data[i + 2]) ** 2; if (d < bd) { bd = d; bi = k; } }
    data[i] = pal[bi][0]; data[i + 1] = pal[bi][1]; data[i + 2] = pal[bi][2];
  }
}

fs.writeFileSync(files[1], encodePNG(W, H, data));
const colors = new Set(); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
console.log(`${files[1]}: ${W}×${H}, 블록 ${block}, 키로 지운 픽셀 ${keyed}, 색 ${colors.size}`);
