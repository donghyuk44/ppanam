// 시트의 칸마다 발 상자를 잰다 — 디자인팀 manifest.json 의 feet.left/right 를 채우는 값.
//
//   node tools/pixel/feet.mjs <sheet.png> [--cell 32x48] [--footline 46] [--rows south,west,east,north] [--cols stand,left,stand,right]
//
// 방법: 칸의 불투명 픽셀 중 가장 아래 6줄을 발로 본다. 그 줄들의 픽셀을 세로 기둥으로 묶어(빈 열이 경계) 둘이면 왼발·오른발(화면 기준),
// 하나면(옆모습 겹침) 가운데에서 반으로 나눈다. planted 는 밑선(footline)에 닿는 상자. 출력은 JSON(frames 배열).
import fs from 'node:fs';
import { decodePNG } from './png.mjs';

const argv = process.argv.slice(2);
const opt = { cell: [32, 48], footline: 46, rows: ['south', 'west', 'east', 'north'], cols: ['stand', 'left', 'stand', 'right'], band: 6 };
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cell') opt.cell = argv[++i].split('x').map(Number);
  else if (a === '--footline') opt.footline = Number(argv[++i]);
  else if (a === '--rows') opt.rows = argv[++i].split(',');
  else if (a === '--cols') opt.cols = argv[++i].split(',');
  else if (a === '--band') opt.band = Number(argv[++i]);
  else files.push(a);
}
if (!files.length) { console.log('사용법: feet.mjs <sheet.png> [--cell 32x48] [--footline 46]'); process.exit(2); }

const img = decodePNG(fs.readFileSync(files[0]));
const { width: W, height: H, data } = img;
const [cw, ch] = opt.cell;
const frames = [];
for (let r = 0; r < Math.floor(H / ch); r++) for (let c = 0; c < Math.floor(W / cw); c++) {
  const on = (x, y) => data[((r * ch + y) * W + c * cw + x) * 4 + 3] > 0;
  let maxY = -1, minX = cw, maxX = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (on(x, y)) { maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const dir = opt.rows[r] ?? String(r), pose = opt.cols[c] ?? String(c);
  if (maxY < 0) { frames.push({ dir, pose, planted: null, feet: null, note: '빈 칸' }); continue; }
  const y0 = Math.max(0, maxY - opt.band + 1);
  // 발 띠 안에서 세로 기둥 묶기
  const cols = [];
  for (let x = 0; x < cw; x++) { let any = false; for (let y = y0; y <= maxY; y++) if (on(x, y)) { any = true; break; } cols.push(any); }
  const groups = [];
  for (let x = 0; x < cw; x++) { if (!cols[x]) continue; if (groups.length && groups[groups.length - 1][1] === x - 1) groups[groups.length - 1][1] = x; else groups.push([x, x]); }
  let L, R;
  if (groups.length >= 2) {
    // 가장 큰 두 기둥을 왼·오른으로 (작은 조각은 옷자락)
    const big = [...groups].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
    [L, R] = big;
  } else {
    const [a, b] = groups[0]; const mid = Math.floor((a + b) / 2);
    L = [a, mid]; R = [mid + 1, b];
  }
  const box = ([x1, x2]) => {
    let top = ch, bot = -1;
    for (let y = y0; y <= maxY; y++) for (let x = x1; x <= x2; x++) if (on(x, y)) { top = Math.min(top, y); bot = Math.max(bot, y); }
    return { box: [x1, top, x2 - x1 + 1, bot - top + 1], bottom: bot };
  };
  const lb = box(L), rb = box(R);
  const lp = lb.bottom >= opt.footline, rp = rb.bottom >= opt.footline;
  const planted = lp && rp ? 'both' : lp ? 'left' : rp ? 'right' : 'none';
  frames.push({ dir, pose, planted, feet: { left: lb.box, right: rb.box }, bottom: { left: lb.bottom, right: rb.bottom }, figure: { top: null, bottom: maxY, x: [minX, maxX] } });
}
// figure top 도 채운다
for (let r = 0; r < Math.floor(H / ch); r++) for (let c = 0; c < Math.floor(W / cw); c++) {
  const f = frames[r * Math.floor(W / cw) + c]; if (!f.figure) continue;
  let top = ch; for (let y = 0; y < ch; y++) { let any = false; for (let x = 0; x < cw; x++) if (data[((r * ch + y) * W + c * cw + x) * 4 + 3]) { any = true; break; } if (any) { top = y; break; } }
  f.figure.top = top;
}
console.log(JSON.stringify({ file: files[0], cell: opt.cell, footline: opt.footline, frames }, null, 1));
