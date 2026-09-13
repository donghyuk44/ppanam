// PixelLab 내보내기(Spritesheet PNG + JSON zip) → 마을용 걷기 시트.
//   teams/design/out/gpt64/<name>-pixellab-sheet.{png,json}  (원본 보관)
//   teams/design/out/sprites64/<name>-walk.png               (팔레트 스냅)
//   teams/design/out/sprites64/<name>-walk.json              { walk:{down,right,up,left}, frames, cell, anchor }
// 칸 크기는 캐릭터마다 다르다(대표 88, 헨리 92). 앵커는 모든 칸의 발 최하단 픽셀에서 잰다. 서쪽 줄이 없으면 동쪽을 flip.
// 다음: node tools/pixel/cast-manifest.mjs
//
//   node tools/pixel/plwalk.mjs <name> <zip>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { decodePNG } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [name, zip] = process.argv.slice(2);
if (!name || !zip) { console.error('사용법: plwalk.mjs <name> <zip>'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `plwalk-${name}-`));
execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
const files = fs.readdirSync(dir, { recursive: true }).map(String);
const png = files.find((f) => f.endsWith('.png')), json = files.find((f) => f.endsWith('.json'));
if (!png || !json) { console.error('zip 안에 png/json 이 없다:', files); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(dir, json), 'utf8'));
const sheet = meta.spritesheet;
console.log('sheet', sheet.sheet_size, 'cell', sheet.cell_size, 'cols', sheet.columns);
const rows = {}; let rot = null;
for (const r of sheet.rows) {
  if (r.type === 'rotations') rot = r;
  else if (r.type === 'animation' && /walk/i.test(r.animation)) rows[r.direction] = r.row;
  console.log(' row', r.row, r.type, r.direction ?? r.directions?.join(','), r.frame_count);
}
if (rot?.directions?.[0] !== 'south') console.warn('주의: 0줄 방향 순서가 다르다', rot?.directions);
const dirs = { down: rows.south, right: rows.east, up: rows.north, left: rows.west };
if (dirs.left == null && dirs.right != null) dirs.left = { row: dirs.right, flip: true };
if (dirs.right == null && dirs.left != null) dirs.right = { row: dirs.left, flip: true };
for (const [k, v] of Object.entries(dirs)) if (v == null) { console.error('걷기 줄이 없다:', k); process.exit(1); }

const gpt64 = path.join(root, 'teams/design/out/gpt64'), sprites = path.join(root, 'teams/design/out/sprites64');
fs.mkdirSync(gpt64, { recursive: true }); fs.mkdirSync(sprites, { recursive: true });
fs.copyFileSync(path.join(dir, png), path.join(gpt64, `${name}-pixellab-sheet.png`));
fs.copyFileSync(path.join(dir, json), path.join(gpt64, `${name}-pixellab-sheet.json`));
const out = path.join(sprites, `${name}-walk.png`);
const log = execFileSync('node', [path.join(root, 'tools/pixel/fix.mjs'), path.join(gpt64, `${name}-pixellab-sheet.png`), out,
  '--block', '1', '--palette', path.join(root, 'teams/design/out/palette.json'), '--despeckle', '0'], { encoding: 'utf8' });
console.log(log.trim().split('\n').slice(-1)[0]);

// 발 밑선: 모든 칸에서 불투명 픽셀의 최대 y. 앵커 = [칸 가운데, 밑선+1]
const img = decodePNG(fs.readFileSync(out));
const cw = sheet.cell_size.width, ch = sheet.cell_size.height, cols = sheet.columns, nrows = Math.floor(img.height / ch);
let foot = 0; const feet = [];
for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
  let maxy = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (img.data[((r * ch + y) * img.width + (c * cw + x)) * 4 + 3] > 0) maxy = y;
  if (maxy >= 0) { feet.push(maxy); foot = Math.max(foot, maxy); }
}
const anchor = [Math.round(cw / 2), foot + 1];
console.log('발 밑선', foot, '(칸별 최소', Math.min(...feet), '최대', Math.max(...feet), ') 앵커', anchor);
const frames = sheet.rows.find((r) => r.type === 'animation')?.frame_count ?? 8;
fs.writeFileSync(path.join(sprites, `${name}-walk.json`), JSON.stringify({ walk: dirs, frames, cell: [cw, ch], anchor }) + '\n');
console.log('wrote', `${name}-walk.png/json`, JSON.stringify(dirs));
