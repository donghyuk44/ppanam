// 유니티 재기 준비(결정 123·127) — 헨리 조각 목록(castle·namsan·home.design + 댄·세라)이 부르는 glb 와 색표를 unity/ppanam-shot/Assets/Kenney/ 로 복사한다
// (glTFast 가 import 해 프리팹으로). 저장소 안에서만 움직인다(server/public/world/assets · teams/design/out/kit/colormaps/people → unity/…).
//
//   node tools/unity-prep.mjs            복사
//   그 다음(헤드리스, 첫 열기에 패키지 몇 분):
//   /Applications/Unity/Hub/Editor/6000.6.0f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath unity/ppanam-shot -executeMethod PpanamShot.Render -logFile unity/ppanam-shot/shot.log -quit
//   결과: teams/dev/out/shots/r25-unity-village-412.png · 로그 마지막 'PpanamShot: placed N · missing M'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KENNEY = path.join(ROOT, 'server/public/world/assets/kenney');
const KIT = { commercial: 'city-kit-commercial', suburban: 'city-kit-suburban', characters: 'mini-characters' };
const DEST = path.join(ROOT, 'unity/ppanam-shot/Assets/Kenney');
const PIECES = ['castle', 'namsan', 'home.design'];
const buildings = JSON.parse(fs.readFileSync(path.join(ROOT, 'teams/design/out/kit/buildings.json'), 'utf8'));
const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/public/world/parts.json'), 'utf8'));
fs.mkdirSync(path.join(DEST, 'people'), { recursive: true });

const want = new Map();   // 목적 파일 이름 → 원본 절대 경로
for (const b of buildings.buildings ?? []) {
  if (!PIECES.includes(b.id)) continue;
  for (const p of b.parts ?? []) {
    if (p.shape !== 'model' || !p.file) continue;
    const [kit, file] = String(p.file).split('/');
    want.set(file, path.join(KENNEY, KIT[kit] ?? kit, 'Models', 'GLB format', file));
  }
}
for (const key of ['boss', 'hq-secretary']) {
  const c = parts.characters[key]; if (!c) continue;
  want.set(c.model, path.join(KENNEY, KIT.characters, 'Models', 'GLB format', c.model));
}
let n = 0, miss = 0;
for (const [file, src] of want) {
  if (!fs.existsSync(src)) { console.error('없음:', src); miss += 1; continue; }
  fs.copyFileSync(src, path.join(DEST, file)); n += 1;
}
// 텍스처 — Kenney 원본 colormap 은 glb 안에 박혀 있다(glTFast 가 같이 읽음). 사람 색표(디자인)만 따로.
for (const f of ['boss.png', 'hq-secretary.png']) {
  const src = path.join(ROOT, 'teams/design/out/kit/colormaps/people', f);
  if (!fs.existsSync(src)) { console.error('없음:', src); miss += 1; continue; }
  fs.copyFileSync(src, path.join(DEST, 'people', f)); n += 1;
}
console.log(`복사 ${n} · 없음 ${miss} → ${path.relative(ROOT, DEST)} (${[...want.keys()].join(', ')} + 색표 둘)`);
process.exit(miss ? 1 : 0);
