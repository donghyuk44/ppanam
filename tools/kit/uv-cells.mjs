// colormap-uv-*.md(클레멘타인 실측 표)를 칸 단위로 묶어 보여 준다 — 어느 칸(띠×줄)이 어느 높이에서 몇 면인지.
// 건물 키트 색표는 인형 것과 달리 줄이 셋이다(py 128~255 위 · 256~383 가운데 · 384~511 아래, 0~127 은 검정 빈칸 — 실측 R15 헨리, 그림 열어 봄).
// 이름(벽·지붕·창…)은 사람이 붙인다. 이 스크립트는 묶기만 한다.
//
//   node tools/kit/uv-cells.mjs teams/design/out/kit/colormap-uv-commercial.md [모델이름…]
import fs from 'node:fs';

const [file, ...only] = process.argv.slice(2);
if (!file) { console.log('사용법: uv-cells.mjs <colormap-uv-*.md> [모델…]'); process.exit(2); }

const ROWS = [[0, 127, 'top'], [128, 255, 'A'], [256, 383, 'B'], [384, 511, 'C']];
const rowOf = (py) => ROWS.find(([a, b]) => py >= a && py <= b)?.[2] ?? '?';

let model = null; const cells = new Map(); // model -> Map(cell -> {tile,row,hexes:Set,y0,y1,faces})
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const h = line.match(/^## (.+)\.obj/); if (h) { model = h[1]; if (!cells.has(model)) cells.set(model, new Map()); continue; }
  const m = line.match(/^\| [\d.]+,[\d.]+ \| (\d+),(\d+) \| `(#[0-9a-f]{6})` \| ([\d.]+)~([\d.]+) \| (\d+) \|/);
  if (!m || !model) continue;
  const [, px, py, hex, y0, y1, faces] = m;
  const tile = Math.floor(+px / 64), row = rowOf(+py), key = `${tile}${row}`;
  const c = cells.get(model); const e = c.get(key) ?? { tile, row, hexes: new Set(), y0: Infinity, y1: -Infinity, faces: 0, pys: new Set() };
  e.hexes.add(hex); e.pys.add(+py); e.y0 = Math.min(e.y0, +y0); e.y1 = Math.max(e.y1, +y1); e.faces += +faces / 2; // 표가 mesh 마다 두 번 적혀 있어 반으로
  c.set(key, e);
}
for (const [name, c] of cells) {
  if (only.length && !only.includes(name)) continue;
  console.log(`\n${name}`);
  for (const e of [...c.values()].sort((a, b) => b.faces - a.faces)) {
    const pys = [...e.pys].sort((a, b) => a - b);
    console.log(`  띠 ${e.tile} 줄 ${e.row}  py ${pys[0]}~${pys[pys.length - 1]}  y ${e.y0.toFixed(2)}~${e.y1.toFixed(2)}  면 ${e.faces}  ${[...e.hexes].slice(0, 3).join(' ')}${e.hexes.size > 3 ? ' …' : ''}`);
  }
}
