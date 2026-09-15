// colormap-uv.mjs 의 실측을 헨리의 칸 규칙(out/kit/colormap-bands.md 1절)으로 묶는다 —
// 띠 = px÷64(0~7), 줄 = py<384 "위" · py≥384 "아래". 칸마다 mesh 그룹별로 y 범위·면 수 합·칸 중심 색 하나.
// 이름(피부·머리·옷…) 은 사람이 붙인다 — 이 스크립트는 칸을 묶기만 한다.
//
//   node tools/pixel/colormap-bands.mjs <colormap.png> <obj…> [--out=<path>]
//
// 출력은 JSON(기본 out/kit/colormap-bands.json) — { "<이름>": { "<mesh 그룹>": [{tile,row,hex,y,faces}], ... } }
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';

const rawArgs = process.argv.slice(2);
const outArg = rawArgs.find((a) => a.startsWith('--out='));
const outFile = outArg ? outArg.slice('--out='.length) : 'out/kit/colormap-bands.json';
const [pngFile, ...objFiles] = rawArgs.filter((a) => a !== outArg);
if (!pngFile || !objFiles.length) { console.log('사용법: colormap-bands.mjs <colormap.png> <obj…> [--out=<path>]'); process.exit(2); }

const png = decodePNG(fs.readFileSync(pngFile));
const hex = (r, g, b) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
const sampleUV = (u, v) => {
  const px = Math.min(png.width - 1, Math.max(0, Math.round(u * (png.width - 1))));
  const py = Math.min(png.height - 1, Math.max(0, Math.round((1 - v) * (png.height - 1))));
  return { px, py };
};
const centerHex = (tile, row) => {
  const px = tile * 64 + 32, py = (row === 'low' ? 384 : 256) + 64;
  const o = (Math.min(png.height - 1, py) * png.width + Math.min(png.width - 1, px)) * 4;
  return hex(png.data[o], png.data[o + 1], png.data[o + 2]);
};

function parseObj(text) {
  const verts = [[0, 0, 0]], vts = [[0, 0]];
  const groups = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const [, x, y, z] = line.trim().split(/\s+/); verts.push([+x, +y, +z]); }
    else if (line.startsWith('vt ')) { const [, u, v] = line.trim().split(/\s+/); vts.push([+u, +v]); }
    else if (line.startsWith('g ')) { cur = { name: line.slice(2).trim(), faces: [] }; groups.push(cur); }
    else if (line.startsWith('f ') && cur) {
      const parts = line.trim().split(/\s+/).slice(1).map((p) => p.split('/').map(Number));
      const ys = parts.map(([vi]) => verts[vi][1]);
      const vtIdx = parts.map(([, vti]) => vti).filter(Boolean);
      cur.faces.push({ vtIdx, yMin: Math.min(...ys), yMax: Math.max(...ys) });
    }
  }
  return { vts, groups };
}

const out = {};
for (const objFile of objFiles) {
  const name = path.basename(objFile, '.obj').replace(/^character-/, '');
  const { vts, groups } = parseObj(fs.readFileSync(objFile, 'utf8'));
  const byGroup = {};
  for (const g of groups) {
    const cells = new Map(); // "tile,row" -> { tile, row, yMin, yMax, faces }
    for (const f of g.faces) {
      for (const vti of f.vtIdx) {
        const [u, v] = vts[vti];
        const { px, py } = sampleUV(u, v);
        const tile = Math.floor(px / 64), row = py >= 384 ? 'low' : 'high';
        const key = `${tile},${row}`;
        if (!cells.has(key)) cells.set(key, { tile, row, yMin: Infinity, yMax: -Infinity, faces: 0 });
        const c = cells.get(key);
        c.yMin = Math.min(c.yMin, f.yMin); c.yMax = Math.max(c.yMax, f.yMax); c.faces++;
      }
    }
    if (!cells.size) continue;
    byGroup[g.name] = [...cells.values()]
      .sort((a, b) => a.tile - b.tile || (a.row === b.row ? 0 : a.row === 'high' ? -1 : 1))
      .map((c) => ({ tile: c.tile, row: c.row, hex: centerHex(c.tile, c.row), y: [+c.yMin.toFixed(3), +c.yMax.toFixed(3)], faces: c.faces }));
  }
  out[name] = byGroup;
}

fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`${outFile} 씀 — ${objFiles.length}개`);
