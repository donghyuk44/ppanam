// 생성 도구가 뱉은 "픽셀 아트처럼 보이는 그림"을 진짜 도트로 되돌린다.
//
//   node tools/pixel/fix.mjs <in.png> <out.png> [--block 8] [--key ff00ff] [--colors 32] [--trim] [--height 64] [--palette out/palette.json] [--despeckle 24] [--cell 32x48 --footline 46] [--sample center|mode] [--grid 64]
//
// 순서: 1) 블록 크기 추정(--block 없으면) → 최근접 축소  2) 크로마 키(#ff00ff 근처)를 투명으로  3) 여백 잘라내기(--trim)
//       4) 팔레트 축소(--colors, 단순 중앙값 분할) 또는 팔레트 스냅(--palette, 파일의 colors 중 가장 가까운 색으로)  5) 알파는 0/255 로. 결과는 check.mjs 로 다시 잰다.
import fs from 'node:fs';
import { decodePNG, encodePNG } from './png.mjs';

const argv = process.argv.slice(2);
const files = [], opt = { block: 0, key: 'ff00ff', colors: 0, trim: false, height: 0, tol: 60, palette: null, despeckle: 0, cell: null, footline: -1, sample: 'center', grid: 0 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--block') opt.block = Number(argv[++i]);
  else if (a === '--key') opt.key = argv[++i].replace('#', '');
  else if (a === '--colors') opt.colors = Number(argv[++i]);
  else if (a === '--trim') opt.trim = true;
  else if (a === '--height') opt.height = Number(argv[++i]);
  else if (a === '--tol') opt.tol = Number(argv[++i]);
  else if (a === '--palette') opt.palette = argv[++i];
  else if (a === '--despeckle') opt.despeckle = Number(argv[++i]);
  else if (a === '--cell') opt.cell = argv[++i].split('x').map(Number);
  else if (a === '--footline') opt.footline = Number(argv[++i]);
  else if (a === '--sample') opt.sample = argv[++i];
  else if (a === '--grid') opt.grid = Number(argv[++i]);
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
// --grid N: 원본이 N×N 논리 격자를 임의 배율(정수가 아니어도)로 늘린 그림일 때 — 칸 가운데를 하나씩 뽑는다 (ChatGPT '저장' 은 1254px 로 준다)
if (opt.grid > 0) {
  const n = opt.grid, cw = W / n, chh = H / n, out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = Math.min(W - 1, Math.floor((x + 0.5) * cw)), sy = Math.min(H - 1, Math.floor((y + 0.5) * chh)), s = (sy * W + sx) * 4, o = (y * n + x) * 4;
    out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
  }
  W = n; H = n; data = out; block = 1;
}
if (block > 1) {
  const w = Math.floor(W / block), h = Math.floor(H / block), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (opt.sample === 'mode') {
      // 블록 안 최빈색 — 생성 도구의 8배 격자가 정확히 안 맞아 가운데 한 점이 옆 픽셀을 물고 올 때 잡음이 준다. 색은 16단계로 뭉쳐 센다.
      const cnt = new Map(); let best = null, bn = 0;
      for (let by = 1; by < block - 1; by++) for (let bx = 1; bx < block - 1; bx++) {
        const s = ((y * block + by) * W + x * block + bx) * 4;
        const k = ((data[s] >> 4) << 8) | ((data[s + 1] >> 4) << 4) | (data[s + 2] >> 4);
        const c = (cnt.get(k) ?? 0) + 1; cnt.set(k, c);
        if (c > bn) { bn = c; best = s; }
      }
      out[o] = data[best]; out[o + 1] = data[best + 1]; out[o + 2] = data[best + 2]; out[o + 3] = data[best + 3];
    } else {
      // 블록 가운데 픽셀을 뽑는다 (최근접). 평균을 내면 경계가 번진다.
      const sx = x * block + (block >> 1), sy = y * block + (block >> 1), s = (sy * W + sx) * 4;
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
    }
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

// 티끌 제거 — 8방향으로 이어진 불투명 덩어리 중 N픽셀보다 작은 것을 지운다 (생성 도구가 흘린 옷자락 조각·그림자 조각).
let speckled = 0;
if (opt.despeckle > 0) {
  const seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !data[i * 4 + 3]) continue;
    const comp = [i]; seen[i] = 1;
    for (let h = 0; h < comp.length; h++) {
      const k = comp[h], x = k % W, y = (k / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx; if (seen[nk] || !data[nk * 4 + 3]) continue; seen[nk] = 1; comp.push(nk);
      }
    }
    if (comp.length < opt.despeckle) { for (const k of comp) data[k * 4 + 3] = 0; speckled += comp.length; }
  }
}

// 발 밑선 맞추기 — 칸마다 그림을 위아래로 옮겨 가장 아래 불투명 픽셀이 footline 줄에 오게 한다 (생성 도구가 줄마다 조금씩 띄운 것).
// 위로 밀려 칸 밖으로 나가면 옮기지 않고 그대로 둔다 — check.mjs 가 잡는다.
let shifted = [];
if (opt.cell && opt.footline >= 0) {
  const [cw, ch] = opt.cell;
  for (let r = 0; r < Math.floor(H / ch); r++) for (let c = 0; c < Math.floor(W / cw); c++) {
    let top = ch, bot = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (data[((r * ch + y) * W + c * cw + x) * 4 + 3]) { top = Math.min(top, y); bot = Math.max(bot, y); }
    if (bot < 0) continue;
    const dy = opt.footline - bot;
    if (!dy || top + dy < 1) continue;
    const cell = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s = ((r * ch + y) * W + c * cw + x) * 4; cell.set(data.subarray(s, s + 4), (y * cw + x) * 4); }
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const d = ((r * ch + y) * W + c * cw + x) * 4, sy = y - dy;
      if (sy < 0 || sy >= ch) { data[d] = data[d + 1] = data[d + 2] = data[d + 3] = 0; }
      else data.set(cell.subarray((sy * cw + x) * 4, (sy * cw + x) * 4 + 4), d);
    }
    shifted.push(`(${c},${r})${dy > 0 ? '+' : ''}${dy}`);
  }
}

// 팔레트 스냅 — 파일의 colors 배열 중 가장 가까운 색으로. 디자인팀 palette.json 형식 { colors: ['#rrggbb', …] }
if (opt.palette) {
  const pal = JSON.parse(fs.readFileSync(opt.palette, 'utf8')).colors.map((c) => { const h = c.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; });
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    let bi = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) { const d = (pal[k][0] - data[i]) ** 2 + (pal[k][1] - data[i + 1]) ** 2 + (pal[k][2] - data[i + 2]) ** 2; if (d < bd) { bd = d; bi = k; } }
    data[i] = pal[bi][0]; data[i + 1] = pal[bi][1]; data[i + 2] = pal[bi][2];
  }
}

fs.writeFileSync(files[1], encodePNG(W, H, data));
const colors = new Set(); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
console.log(`${files[1]}: ${W}×${H}, 블록 ${block}, 키로 지운 픽셀 ${keyed}${speckled ? `, 티끌 ${speckled}px 제거` : ''}${shifted.length ? `, 밑선 맞춤 ${shifted.join(' ')}` : ''}, 색 ${colors.size}`);
