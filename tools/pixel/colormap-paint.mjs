// out/kit/colormap-roles.json(헨리의 칸 이름)로 colormap.png 을 인형마다 한 장씩 복사해 칠한다.
// 칸 하나 = 64×128 사각형(tile×row), 칸 전체를 한 색으로 채운다 — 그라데이션은 안 살린다(헨리 지시).
// 칸이 역할 둘에 걸치면 roles.json 의 conflicts[].goes 를 따른다. keep 은 안 칠한다.
//
//   node tools/pixel/colormap-paint.mjs <colormap.png> <characters.json> <colormap-roles.json>
//
// 출력은 characters.json 의 colormapDir 아래, 인형마다 <colormap 파일 이름>.
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './png.mjs';

const [pngFile, charsFile, rolesFile] = process.argv.slice(2);
if (!pngFile || !charsFile || !rolesFile) { console.log('사용법: colormap-paint.mjs <colormap.png> <characters.json> <colormap-roles.json>'); process.exit(2); }

const base = decodePNG(fs.readFileSync(pngFile));
const chars = JSON.parse(fs.readFileSync(charsFile, 'utf8'));
const rolesData = JSON.parse(fs.readFileSync(rolesFile, 'utf8'));

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const cellKey = (tile, row) => `${tile},${row}`;
const rowRange = (row) => rolesData.tileGrid.rows[row]; // [y0, y1] inclusive

// 몸(body) 하나마다 칸 -> 최종 역할을 한 번만 푼다(색만 인형마다 다르다).
const ROLE_ORDER = ['shoes', 'skin', 'hair', 'top', 'bottom', 'accent', 'keep'];
function resolveBody(body) {
  const byCell = new Map(); // cellKey -> Set(role)
  for (const role of ROLE_ORDER) {
    for (const c of body.roles[role] ?? []) {
      const k = cellKey(c.tile, c.row);
      if (!byCell.has(k)) byCell.set(k, { tile: c.tile, row: c.row, roles: new Set() });
      byCell.get(k).roles.add(role);
    }
  }
  const conflicts = new Map((body.conflicts ?? []).map((c) => [cellKey(c.tile, c.row), c]));
  const final = new Map(); // cellKey -> role
  for (const [k, e] of byCell) {
    if (e.roles.size === 1) { final.set(k, [...e.roles][0]); continue; }
    const c = conflicts.get(k);
    if (!c) { console.error(`풀리지 않은 겹침 — ${k}: ${[...e.roles].join(',')} (conflicts 항목 없음)`); continue; }
    final.set(k, c.goes.split('(')[0].trim());
  }
  return final; // cellKey -> role, "keep" 도 그대로 들어 있다(칠하기 단계에서 건너뜀)
}

function colorFor(role, colors) {
  if (role === 'shoes') return '#3d3a44';
  if (role === 'keep') return null;
  if (role === 'accent') return colors.accent ?? colors.top;
  return colors[role] ?? null;
}

const outDir = path.join(path.dirname(charsFile), chars.colormapDir.replace(/^out\/kit\//, ''));
fs.mkdirSync(outDir, { recursive: true });

const bodyCache = new Map();
let written = 0;
for (const [key, char] of Object.entries(chars.characters)) {
  const bodyName = char.model.replace(/^character-/, '').replace(/\.glb$/, '');
  const body = rolesData.bodies[bodyName];
  if (!body) { console.error(`${key}: colormap-roles.json 에 몸 "${bodyName}" 없음`); continue; }
  if (!bodyCache.has(bodyName)) bodyCache.set(bodyName, resolveBody(body));
  const cells = bodyCache.get(bodyName);

  const data = Uint8Array.from(base.data);
  for (const [k, role] of cells) {
    const color = colorFor(role, char.colors);
    if (!color) continue;
    const [tile, row] = [Number(k.split(',')[0]), k.split(',')[1]];
    const [r, g, b] = hexToRgb(color);
    const [y0, y1] = rowRange(row);
    const x0 = tile * 64, x1 = Math.min(base.width, x0 + 64);
    for (let y = y0; y <= y1 && y < base.height; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * base.width + x) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
  }
  fs.writeFileSync(path.join(outDir, char.colormap), encodePNG(base.width, base.height, data));
  written++;
}

console.log(`${outDir} 에 ${written}장 씀`);
