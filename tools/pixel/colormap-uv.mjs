// Kenney mini-characters 의 colormap.png 512×512 에서, OBJ 의 vt(UV) 가 실제로 어느 픽셀을 가리키는지 잰다.
// 옷·머리·피부 중 어느 띠인지는 색상값(hex)과 몸통 대비 y 높이(0=발밑, 1=정수리)로 사람이 읽는다 — 스크립트는 재기만 한다.
//
//   node tools/pixel/colormap-uv.mjs <colormap.png> <obj…> [--out=<path>]
//
// 출력은 markdown(기본 out/kit/colormap-uv.md) — obj 파일마다 g 그룹(body-mesh/head-mesh 등)별 스와치 목록.
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';

const rawArgs = process.argv.slice(2);
const outArg = rawArgs.find((a) => a.startsWith('--out='));
const outFile = outArg ? outArg.slice('--out='.length) : 'out/kit/colormap-uv.md';
const [pngFile, ...objFiles] = rawArgs.filter((a) => a !== outArg);
if (!pngFile || !objFiles.length) { console.log('사용법: colormap-uv.mjs <colormap.png> <obj…> [--out=<path>]'); process.exit(2); }

const png = decodePNG(fs.readFileSync(pngFile));
const hex = (r, g, b) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
const sample = (u, v) => {
  const px = Math.min(png.width - 1, Math.max(0, Math.round(u * (png.width - 1))));
  const py = Math.min(png.height - 1, Math.max(0, Math.round((1 - v) * (png.height - 1))));
  const o = (py * png.width + px) * 4;
  return { px, py, hex: hex(png.data[o], png.data[o + 1], png.data[o + 2]) };
};

function parseObj(text) {
  const verts = [[0, 0, 0]], vts = [[0, 0]];
  const groups = []; // { name, faces: [{ vtIdx:[..], yMin, yMax }] }
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
  return { verts, vts, groups };
}

const lines = ['# colormap UV 실측', '', `colormap.png ${png.width}×${png.height}. u,v 는 OBJ 그대로(0~1), px,py 는 이미지 좌표(좌상단 0,0). y 는 모델 원본 단위 발밑=0.`, ''];

for (const objFile of objFiles) {
  const { vts, groups } = parseObj(fs.readFileSync(objFile, 'utf8'));
  lines.push(`## ${path.basename(objFile)}`, '');
  for (const g of groups) {
    // vt 인덱스 -> 그 vt 를 쓰는 face 들의 y 범위, 픽셀 좌표
    const byVt = new Map();
    for (const f of g.faces) {
      for (const vti of f.vtIdx) {
        if (!byVt.has(vti)) byVt.set(vti, { yMin: Infinity, yMax: -Infinity, count: 0 });
        const e = byVt.get(vti);
        e.yMin = Math.min(e.yMin, f.yMin); e.yMax = Math.max(e.yMax, f.yMax); e.count++;
      }
    }
    if (!byVt.size) continue;
    lines.push(`### ${g.name}`, '', '| u,v | px,py | 색 | y 범위(원본) | 면 수 |', '| --- | --- | --- | --- | --- |');
    const rows = [...byVt.entries()].sort((a, b) => a[1].yMin - b[1].yMin);
    for (const [vti, e] of rows) {
      const [u, v] = vts[vti];
      const { px, py, hex: h } = sample(u, v);
      lines.push(`| ${u.toFixed(4)},${v.toFixed(4)} | ${px},${py} | \`${h}\` | ${e.yMin.toFixed(3)}~${e.yMax.toFixed(3)} | ${e.count} |`);
    }
    lines.push('');
  }
}

fs.writeFileSync(outFile, lines.join('\n'));
console.log(`${outFile} 씀 — obj ${objFiles.length}개`);
