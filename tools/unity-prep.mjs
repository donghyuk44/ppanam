// 유니티 재기 준비(결정 123·127) — 헨리 조각 목록(castle·namsan·home.design + 댄·세라)이 부르는 glb 와 색표를 unity/ppanam-shot/Assets/Kenney/ 로 복사한다
// (glTFast 가 import 해 프리팹으로). 저장소 안에서만 움직인다(server/public/world/assets · teams/design/out/kit/colormaps/people → unity/…).
//
// Kenney glb 는 색표를 안에 품지 않고 옆 폴더를 가리킨다 — "images":[{"uri":"Textures/colormap.png"}] (실측 R25). 첫 판은 glb 만 복사해서
// glTFast 가 여섯 다 "Failed to import"(색표 없음) — 사진이 온통 흰색이었다. 그래서 키트마다 폴더를 그대로 흉내 낸다:
//   Assets/Kenney/<키트>/<파일>.glb + Assets/Kenney/<키트>/Textures/colormap.png   (키트 = city-kit-commercial · city-kit-suburban · mini-characters)
//
//   node tools/unity-prep.mjs            복사
//   그 다음(헤드리스, 첫 열기에 패키지 몇 분):
//   /Applications/Unity/Hub/Editor/6000.6.0f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath unity/ppanam-shot -executeMethod PpanamShot.Render -logFile unity/ppanam-shot/shot.log -quit
//   결과: teams/dev/out/shots/r25-unity-village-412.png · 로그 마지막 'PpanamShot: placed N · missing M' — missing 이 0 이 아니면 그 위에 'PpanamShot: import ✗ …' 줄이 이유다
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

// 옛 판(평평한 Assets/Kenney/*.glb)이 남아 있으면 glTFast 가 또 실패한 채로 import 한다 — 치운다(.meta 도)
for (const n of fs.readdirSync(DEST, { withFileTypes: true })) {
  if (n.isFile() && /\.glb(\.meta)?$/.test(n.name)) fs.rmSync(path.join(DEST, n.name));
}

const want = new Map();   // 목적 상대경로 → 원본 절대 경로
const kits = new Set();
const add = (kitDir, file) => { kits.add(kitDir); want.set(`${kitDir}/${file}`, path.join(KENNEY, kitDir, 'Models', 'GLB format', file)); };
for (const b of buildings.buildings ?? []) {
  if (!PIECES.includes(b.id)) continue;
  for (const p of b.parts ?? []) {
    if (p.shape !== 'model' || !p.file) continue;
    const [kit, file] = String(p.file).split('/');
    add(KIT[kit] ?? kit, file);
  }
}
for (const key of ['boss', 'hq-secretary']) {
  const c = parts.characters[key]; if (!c) continue;
  add(KIT.characters, c.model);
}
for (const kitDir of kits) want.set(`${kitDir}/Textures/colormap.png`, path.join(KENNEY, kitDir, 'Models', 'GLB format', 'Textures', 'colormap.png'));

let n = 0, miss = 0;
for (const [rel, src] of want) {
  if (!fs.existsSync(src)) { console.error('없음:', src); miss += 1; continue; }
  const dst = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst); n += 1;
}
// 사람 색표(디자인)만 따로 — 인형의 Kenney 색표를 이걸로 갈아 끼운다
fs.mkdirSync(path.join(DEST, 'people'), { recursive: true });
for (const f of ['boss.png', 'hq-secretary.png']) {
  const src = path.join(ROOT, 'teams/design/out/kit/colormaps/people', f);
  if (!fs.existsSync(src)) { console.error('없음:', src); miss += 1; continue; }
  fs.copyFileSync(src, path.join(DEST, 'people', f)); n += 1;
}
console.log(`복사 ${n} · 없음 ${miss} → ${path.relative(ROOT, DEST)} (${[...want.keys()].join(', ')} + 사람 색표 둘)`);
process.exit(miss ? 1 : 0);
