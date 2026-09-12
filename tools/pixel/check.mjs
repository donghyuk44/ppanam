// 그림 검사 — 열어서 재고 센다. 클레멘타인이 조립 뒤에, 마크가 판정 때 돌린다. 읽기 전용.
//
//   node tools/pixel/check.mjs <png…> [--cell 32x48] [--palette out/palette.json] [--max-colors 32] [--torsox]
//
// 보는 것: 크기·격자 나눠떨어짐·칸마다 그림이 있나·투명 모서리·칸 경계 침범·색 수·팔레트 밖 색.
// --torsox: 칸 안 y 32~40 띠(도포 자락, style.md 3절)의 불투명 픽셀 가로 중간이 칸 중심(cw/2)에서 얼마나 벗어났는지 잰다.
import fs from 'node:fs';
import { decodePNG } from './png.mjs';

const argv = process.argv.slice(2);
const opt = { cell: null, palette: null, maxColors: 32, torsox: false, torsoBand: [32, 40] };
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cell') opt.cell = argv[++i].split('x').map(Number);
  else if (a === '--palette') opt.palette = argv[++i];
  else if (a === '--max-colors') opt.maxColors = Number(argv[++i]);
  else if (a === '--torsox') opt.torsox = true;
  else if (a === '--torso-band') opt.torsoBand = argv[++i].split('-').map(Number);
  else files.push(a);
}
if (!files.length) { console.log('사용법: check.mjs <png…> [--cell WxH] [--palette 파일] [--max-colors N] [--torsox] [--torso-band y0-y1]'); process.exit(2); }

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const palette = opt.palette ? new Set(JSON.parse(fs.readFileSync(opt.palette, 'utf8')).colors.map((c) => c.toLowerCase())) : null;

let bad = 0;
for (const file of files) {
  const notes = [];
  let img;
  try { img = decodePNG(fs.readFileSync(file)); } catch (e) { console.log(`✗ ${file}: ${e.message}`); bad++; continue; }
  const { width: W, height: H, data } = img;
  const alpha = (x, y) => data[(y * W + x) * 4 + 3];
  // 색 수와 팔레트
  const colors = new Map();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) { const k = hex(data[i], data[i + 1], data[i + 2]); colors.set(k, (colors.get(k) ?? 0) + 1); }
  if (colors.size > opt.maxColors) notes.push(`색이 ${colors.size}개 (상한 ${opt.maxColors})`);
  if (palette) { const off = [...colors].filter(([k]) => !palette.has(k)); if (off.length) notes.push(`팔레트 밖 색 ${off.length}개: ${off.slice(0, 5).map(([k, n]) => `${k}×${n}`).join(' ')}`); }
  // 반투명 픽셀 — 도트는 0 아니면 255 여야 한다
  let semi = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < 255) semi++;
  if (semi) notes.push(`반투명 픽셀 ${semi}개`);
  // 격자
  if (opt.cell) {
    const [cw, ch] = opt.cell;
    if (W % cw || H % ch) notes.push(`${W}×${H} 가 ${cw}×${ch} 로 나눠떨어지지 않음`);
    else {
      const cols = W / cw, rows = H / ch;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let n = 0, edge = 0;
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          if (alpha(c * cw + x, r * ch + y) === 0) continue;
          n++;
          if (x === 0 || y === 0 || x === cw - 1 || y === ch - 1) edge++;
        }
        if (!n) notes.push(`빈 칸 (${c},${r})`);
        else if (edge) notes.push(`칸 (${c},${r}) 가장자리에 픽셀 ${edge}개 — 경계 침범 의심`);
      }
      // 중심축 흐름 — torsoX
      if (opt.torsox) {
        const [by0, by1] = opt.torsoBand, centerX = cw / 2;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          let minX = Infinity, maxX = -Infinity;
          for (let y = by0; y <= by1 && y < ch; y++) for (let x = 0; x < cw; x++) {
            if (alpha(c * cw + x, r * ch + y) === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
          if (minX > maxX) { notes.push(`칸 (${c},${r}) torsoX 띠(y ${by0}..${by1})가 비어 있음`); continue; }
          const torsoX = Math.round((minX + maxX) / 2), shift = centerX - torsoX;
          if (shift !== 0) notes.push(`칸 (${c},${r}) torsoX=${torsoX} 중심(${centerX})에서 ${shift > 0 ? '+' : ''}${shift}px 벗어남`);
        }
      }
    }
  }
  // 모서리 투명
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].filter(([x, y]) => alpha(x, y) !== 0);
  if (corners.length) notes.push(`불투명 모서리 ${corners.length}개`);
  const ok = notes.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${file} ${W}×${H} 색 ${colors.size}${notes.length ? '\n   - ' + notes.join('\n   - ') : ''}`);
}
process.exit(bad ? 1 : 0);
