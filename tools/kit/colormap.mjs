// out/kit/colormap-roles-buildings.json(헨리의 칸 이름)로 건물 keny 원본 colormap.png 을 칠한다.
// 칸 하나 = 64×128 사각형(tile×row 셋 A·B·C), 칸 전체를 한 색으로 채운다 — 그라데이션은 안 살린다.
// 사람 쪽(colormap-paint.mjs)과 달리 장(sheet)이 세 장뿐이고 칸이 몸마다 갈리지 않는다 — maps 순서대로 한 장씩.
//
//   node tools/kit/colormap.mjs <colormap-roles-buildings.json> [출력 디렉터리]
//
// 출력은 <출력 디렉터리 또는 roles 파일 옆 colormaps/>/<map.file 의 파일 이름>.
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from '../pixel/png.mjs';

const [rolesFile, outDirArg] = process.argv.slice(2);
if (!rolesFile) { console.log('사용법: colormap.mjs <colormap-roles-buildings.json> [출력 디렉터리]'); process.exit(2); }

const roles = JSON.parse(fs.readFileSync(rolesFile, 'utf8'));
const rolesDir = path.dirname(rolesFile);
const kitDir = path.resolve(rolesDir, '..'); // out/kit
const outDir = outDirArg ? path.resolve(outDirArg) : path.join(kitDir, 'colormaps');
fs.mkdirSync(outDir, { recursive: true });

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rowRange = (row) => roles.tileGrid.rows[row]; // [y0, y1] inclusive
const tileWidth = roles.tileGrid.tileWidth;

const sourceCache = new Map();
function loadSource(name) {
  if (!sourceCache.has(name)) {
    const file = path.resolve(process.cwd(), roles.source[name]);
    sourceCache.set(name, decodePNG(fs.readFileSync(file)));
  }
  return sourceCache.get(name);
}

let written = 0;
for (const [mapName, map] of Object.entries(roles.maps)) {
  const base = loadSource(map.source);
  const data = Uint8Array.from(base.data);
  for (const [role, cells] of Object.entries(map.roles)) {
    const color = roles.colors[role];
    if (!color) { console.error(`${mapName}: colors 에 "${role}" 없음`); continue; }
    const [r, g, b] = hexToRgb(color);
    for (const { tile, row } of cells) {
      const [y0, y1] = rowRange(row);
      const x0 = tile * tileWidth, x1 = Math.min(base.width, x0 + tileWidth);
      for (let y = y0; y <= y1 && y < base.height; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * base.width + x) * 4;
          data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
        }
      }
    }
  }
  const outFile = path.join(outDir, path.basename(map.file));
  fs.writeFileSync(outFile, encodePNG(base.width, base.height, data));
  written++;
  console.log(`${mapName} → ${path.relative(process.cwd(), outFile)}`);
}

console.log(`칠한 장: ${written}/${Object.keys(roles.maps).length}`);
