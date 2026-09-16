// 칩이 대표가 고른 얼굴인가 — picks-0916.json(자리 → n) 의 fe/<자리>-<n>.png 를 chip-crop.md 값(x 59~453, y 20~414)으로 잘라
// chip/<자리>.png 와 픽셀로 대본다. 열일곱이 뜨는지가 아니라 고른 얼굴인지(톰 req_0b6441a8 목표, 결정 197).
//   node teams/design/out/portraits/_check-picks.mjs
import fs from 'node:fs';
import { decodePNG } from '../../../../tools/pixel/png.mjs';
const dir = 'teams/design/out/portraits';
const picks = JSON.parse(fs.readFileSync(`${dir}/picks-0916.json`, 'utf8')).picks;
const X0 = 59, Y0 = 20, S = 394;
const rows = [];
for (const [seat, n] of Object.entries(picks)) {
  const src = `${dir}/fe/${seat}-${n}.png`, chip = `${dir}/chip/${seat}.png`;
  if (!fs.existsSync(src) || !fs.existsSync(chip)) { rows.push(`${seat}\t없음 (${fs.existsSync(src) ? '' : 'fe '}${fs.existsSync(chip) ? '' : 'chip'})`); continue; }
  const a = decodePNG(fs.readFileSync(src)), b = decodePNG(fs.readFileSync(chip));
  if (b.width !== S || b.height !== S) { rows.push(`${seat}\t칩 크기 ${b.width}×${b.height} ≠ ${S}`); continue; }
  let diff = 0, total = 0;
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    const ia = ((Y0 + y) * a.width + (X0 + x)) * 4, ib = (y * S + x) * 4;
    const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
    total++; if (d > 24) diff++;
  }
  const pct = (100 * diff / total).toFixed(2);
  rows.push(`${seat}\tfe/${seat}-${n}.png ↔ chip/${seat}.png\t다른 픽셀 ${pct}%\t${pct < 1 ? '같다' : '다르다'}`);
}
console.log(rows.join('\n'));
