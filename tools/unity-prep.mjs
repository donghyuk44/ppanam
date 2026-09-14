// 유니티 재기 준비(결정 123) — city.json 이 부르는 부품 glb 와 인형 셋의 glb 를 unity/ppanam-shot/Assets/Kenney/ 로 복사한다(glTFast 가 import 해 프리팹으로).
// 저장소 안에서만 움직인다(server/public/world/assets → unity/…). 텍스처(colormap.png)는 glb 옆 Textures/ 를 같이.
//
//   node tools/unity-prep.mjs            복사
//   그 다음(헤드리스, 첫 열기에 패키지 몇 분):
//   /Applications/Unity/Hub/Editor/6000.6.0f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath unity/ppanam-shot -executeMethod PpanamShot.Render -logFile unity/ppanam-shot/shot.log -quit
//   결과: teams/dev/out/shots/r25-unity-village-412.png · 로그 마지막 'PpanamShot: placed N · missing M'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = path.join(ROOT, 'server/public/world');
const DEST = path.join(ROOT, 'unity/ppanam-shot/Assets/Kenney');
const city = JSON.parse(fs.readFileSync(path.join(W, 'city.json'), 'utf8'));
const parts = JSON.parse(fs.readFileSync(path.join(W, 'parts.json'), 'utf8'));
fs.mkdirSync(DEST, { recursive: true });

const want = new Map();   // file → 원본 절대 경로
for (const b of city.scenes.village.buildings ?? []) {
  const p = parts.parts[b.part]; if (!p) continue;
  want.set(p.file, path.join(ROOT, 'server/public', decodeURIComponent(parts.kits[p.kit]), p.file));
}
for (const key of ['boss', 'dev-guide', 'design-guide']) {
  const c = parts.characters[key]; if (!c) continue;
  want.set(c.model, path.join(ROOT, 'server/public', decodeURIComponent(parts.kits.characters), c.model));
}
let n = 0, miss = 0;
for (const [file, src] of want) {
  if (!fs.existsSync(src)) { console.error('없음:', src); miss += 1; continue; }
  fs.copyFileSync(src, path.join(DEST, file)); n += 1;
  // 텍스처 — glb 옆 Textures/colormap.png 를 같은 상대 자리로
  const tex = path.join(path.dirname(src), 'Textures', 'colormap.png');
  if (fs.existsSync(tex)) { fs.mkdirSync(path.join(DEST, 'Textures'), { recursive: true }); fs.copyFileSync(tex, path.join(DEST, 'Textures', 'colormap.png')); }
}
console.log(`복사 ${n} · 없음 ${miss} → ${path.relative(ROOT, DEST)}`);
process.exit(miss ? 1 : 0);
