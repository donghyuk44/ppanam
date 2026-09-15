// out/feet/<이름>-walk.json (하네스가 tools/pixel/feet.mjs 로 잰 것) 을 out/manifest.json 의 sprites.<이름>.frames 로 옮긴다.
// 32×48 시험본(out/feet/<이름>.json, -walk 없음)은 폐기라 건너뛴다.
// 사용: node teams/design/out/feet/merge.mjs   (저장소 루트에서)
import fs from 'node:fs';
import path from 'node:path';

const root = 'teams/design/out';
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const feetDir = path.join(root, 'feet');
let moved = 0;
for (const f of fs.readdirSync(feetDir)) {
  if (!f.endsWith('-walk.json')) continue;
  const name = f.replace(/-walk\.json$/, '');
  const feet = JSON.parse(fs.readFileSync(path.join(feetDir, f), 'utf8'));
  const entry = manifest.sprites[name];
  if (!entry) { console.log(`manifest 에 ${name} 항목 없음 — 건너뜀`); continue; }
  entry.cell = feet.cell;
  // style.md 3절: footline 은 발의 가장 아래 불투명 픽셀 줄, 마을 앵커 y 는 그 아래 모서리(footline + 1).
  // feet.mjs 의 footline 필드(75)는 모서리 값이라 여기서는 실측 bottom 의 최댓값을 쓴다.
  const footline = Math.max(...feet.frames.map((fr) => Math.max(fr.bottom.left, fr.bottom.right)));
  entry.anchor = { footline, centerX: 44, village: [44, footline + 1] };
  entry.frames = feet.frames.map((fr) => ({
    dir: fr.dir, pose: fr.pose, planted: fr.planted,
    feet: { left: fr.feet.left, right: fr.feet.right },
    figure: fr.figure,
  }));
  entry.feet = `out/feet/${f}`;
  moved++;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`옮긴 시트 ${moved}`);
