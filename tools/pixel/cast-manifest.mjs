// teams/design/out/sprites64/ → server/public/world/assets/cast/ (그림 복사 + manifest.json).
// 정지 그림 <name>.png 은 1프레임 시트(칸 = 그림 크기, 발 가운데 앵커), <name>-walk.png + <name>-walk.json 이 있으면 PixelLab 8방향 시트.
// 이름은 <팀>-<자리> (대표는 boss). world.js 가 객체형 sprite(idle 줄/칸, walk 줄, flip)를 읽는다.
//
//   node tools/pixel/cast-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = path.join(root, 'teams/design/out/sprites64'), dst = path.join(root, 'server/public/world/assets/cast');
const keyOf = (n) => (n === 'boss' ? 'boss' : n.replace('-', ':'));
const m = {
  note: '디자인팀 64px 캐릭터. 정지 그림은 ChatGPT 64px(칸 = 그림 크기, 1프레임), 걷기는 PixelLab 8방향 시트(칸 88×88, 0줄 = 8방향 정지 S,SE,E,NE,N,NW,W,SW, 방향마다 걷기 줄). 없는 자리는 대체 그림.',
  cell: [32, 48], rows: ['down', 'left', 'right', 'up'], frames: 4, sprites: {},
};
for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.png') && !f.endsWith('-walk.png')).sort()) {
  const name = f.replace('.png', ''); const img = decodePNG(fs.readFileSync(path.join(src, f)));
  fs.copyFileSync(path.join(src, f), path.join(dst, `${name}-64.png`));
  m.sprites[keyOf(name)] = { file: `${name}-64.png`, cell: [img.width, img.height], frames: 1, anchor: [Math.round(img.width / 2), img.height], idle: { row: 0, cols: { down: 0, left: 0, right: 0, up: 0 } }, walk: { down: 0, left: 0, right: 0, up: 0 } };
}
for (const f of fs.readdirSync(src).filter((f) => f.endsWith('-walk.png'))) {
  const name = f.replace('-walk.png', ''); const meta = JSON.parse(fs.readFileSync(path.join(src, `${name}-walk.json`), 'utf8'));
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  m.sprites[keyOf(name)] = { file: f, cell: meta.cell ?? [88, 88], frames: meta.frames ?? 8, anchor: meta.anchor ?? [44, 75], idle: { row: 0, cols: { down: 0, right: 2, up: 4, left: 6 } }, walk: meta.walk };
}
fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('manifest sprites:', Object.keys(m.sprites).length, Object.keys(m.sprites).join(' '));
