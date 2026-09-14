// 인형 한 줄 — 열여섯을 디자인 색표(teams/design/out/kit/colormaps/people/)로 입혀 한 장에. 마을(draw3d.js)과 같은 빛·재질·배율.
// 대표 09-14 "알아서 해서 이미지만 보여주면 됨". 화면이 아니라 그림 찍는 판이다 — 조작 없음. 찍는 건 tools/lineup-shot.mjs (헤드리스 크롬, GPU 없는 깃발 셋).
//
//   /world/lineup.html                                        열여섯 한 줄 · 1920 폭 · 마을 배경색
//   /world/lineup.html?only=hq-secretary&size=200&transparent=1&front=1   세라 정면 · 200px · 투명 배경 (결정 87·88)
//   ?w=1920&h=520   판 크기 · ?angle=0.35  옆에서 보는 각(라디안, 기본 0 = 정면 살짝 위)
//
// 다 그려지면 window.__lineup = { ready:true, loaded, failed, colormaps, names } — 찍는 쪽이 이걸 기다린다. 색표 못 읽은 사람은 Kenney 원색 그대로(팀 색 옷 없음) 이고 failed 에 센다.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const q = new URLSearchParams(location.search);
const ONLY = q.get('only');
const TRANSPARENT = q.get('transparent') === '1';
const FRONT = q.get('front') === '1';
const SIZE = Number(q.get('size') || 0);
const W = SIZE || Number(q.get('w') || 1920), H = SIZE || Number(q.get('h') || 520);
const ANGLE = Number(q.get('angle') || 0);
const COLORMAP_URL = (file) => `/out/design/kit/colormaps/people/${file}`;   // 디자인 산출물은 /out/<팀>/ 로 읽는다(결정 36 읽기 전용)
const KIT_URL = (dir, file) => dir + file;

window.__lineup = { ready: false, loaded: 0, failed: 0, colormaps: 0, names: [] };

const [parts, design] = await Promise.all([
  fetch('/world/parts.json').then((r) => r.json()),
  fetch('/out/design/kit/characters.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
]);
const k = parts.scale;
const chars = Object.entries(parts.characters).filter(([key]) => !ONLY || key === ONLY);
if (!chars.length) throw new Error(`자리 없음: ${ONLY}`);

const canvas = document.getElementById('stage');
canvas.width = W; canvas.height = H; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: TRANSPARENT, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
if (TRANSPARENT) renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
if (!TRANSPARENT) scene.background = new THREE.Color(parts.light.background);
// 빛은 마을과 같은 값(parts.json light) — 첫 화면과 같은 빛이어야 색표가 같은 색으로 보인다
const hemi = new THREE.HemisphereLight(parts.light.sky, parts.light.ground, parts.light.hemi ?? 1);
const sun = new THREE.DirectionalLight(parts.light.sun.color, parts.light.sun.intensity);
const f = parts.light.sun.from;
sun.position.set(f[0] * 10, f[1] * 10, f[2] * 10); sun.castShadow = !TRANSPARENT;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(hemi, sun, sun.target);

// 바닥 — 한 줄일 때만(그림자 받침). 투명 그림엔 없다.
if (!TRANSPARENT) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: parts.light.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
}

const loader = new GLTFLoader();
const loadGlb = (url) => new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej));
const loadTex = (url) => new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; res(t); }, undefined, rej));

/** 우리가 짓는 부착물 둘 — 갓(댄) · 리본(세라). characters.json 의 note 대로. 나머지는 Kenney aid-*.glb 를 머리 자리에. */
function customProp(id) {
  const g = new THREE.Group();
  if (id === 'gat') {
    const black = new THREE.MeshStandardMaterial({ color: '#1b1a1f', roughness: 1 });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.25, 24), black); tube.position.y = 0.125;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.375, 0.03, 32), black); brim.position.y = 0.015;
    g.add(tube, brim);
  } else if (id === 'ribbon') {
    const red = new THREE.MeshStandardMaterial({ color: '#c94a3a', roughness: 0.9 });
    const a = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.06, 0.04, 2, 0.015), red), b = a.clone();
    a.rotation.z = 0.45; b.rotation.z = -0.45; a.position.x = -0.055; b.position.x = 0.055;
    g.add(a, b);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const GAP = Number(q.get('gap') || 1.2);             // 사람 사이(월드 단위) — 헨리: 1.2 씩, 가운데 0 기준 −9~+9
const ROWS = ONLY ? 1 : Number(q.get('rows') || 1);  // 헨리: 한 줄. (두 줄이 크게 보이지만 디자이너가 한 줄로 봤다 — ?rows=2 로 열 수 있다)
const n = chars.length, COLS = Math.ceil(n / ROWS), ROW_GAP = 1.7;
const x0 = -((COLS - 1) * GAP) / 2;
let maxH = 0;
const jobs = chars.map(async ([key, spec], i) => {
  const g = new THREE.Group(); g.name = key;
  const row = Math.floor(i / COLS), col = i % COLS;
  g.position.x = x0 + col * GAP + (row % 2 ? GAP / 2 : 0);   // 뒷줄은 반 칸 어긋나게 — 앞사람이 안 가린다
  g.position.z = -(ROWS - 1 - row) * ROW_GAP;               // 첫 여덟이 뒷줄
  const height = spec.sourceHeight * k; maxH = Math.max(maxH, height);
  try {
    const src = await loadGlb(KIT_URL(parts.kits.characters, spec.model));
    // Kenney 인형은 뼈대(SkinnedMesh)가 있다 — Object3D.clone() 은 뼈를 원본 것과 공유해 몸이 원본 자리(원점·배율 1)에 그려지고 부착물만 제자리로 흩어졌다
    // (하네스 실측 R25: 열여섯이 한 자리에 겹침). SkeletonUtils.clone 이 뼈까지 복사한다.
    const m = SkeletonUtils.clone(src); m.scale.setScalar(k);
    const meshes = [];
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (o.material) { o.material = o.material.clone(); o.material.roughness = 1; o.material.metalness = 0; } meshes.push(o); } });
    // 색표 — 디자인 characters.json 의 colormap 파일. 없으면 parts.json 것, 그것도 없으면 Kenney 원색.
    const file = design?.characters?.[key]?.colormap ?? spec.colormap ?? null;
    if (file) {
      try { const tex = await loadTex(COLORMAP_URL(file)); for (const o of meshes) if (o.material.map) { o.material.map = tex; o.material.needsUpdate = true; } window.__lineup.colormaps += 1; }
      catch { window.__lineup.failed += 1; }
    }
    g.add(m);
    g.userData.body = m;
    // 부착물 — 머리 위. Kenney 것은 glb, 우리 것은 위 customProp.
    // 소품 자리 — 헨리(R25, 모델 원본 단위, 배율 전): 갓 = 머리 꼭대기 (0, 0.78, 0.02) · 안경/선글라스 = 눈높이 얼굴 앞 (0, 0.46, 0.18) · 세라 리본 = 땋은 머리 끝 등 뒤 (0, 0.36, −0.20)
    const PROP_AT = { gat: [0, 0.78, 0.02], ribbon: [0.12, 0.62, 0.05], kenney: [0, 0.46, 0.18] };   // 리본은 헨리 두 번째 값(09-14, first-scene.md 뒤)
    const prop = spec.prop ?? design?.characters?.[key]?.prop ?? null;
    if (prop?.kind === 'kenney' && prop.file) {
      try {
        const p = (await loadGlb(KIT_URL(parts.kits.characters, prop.file))).clone(); p.scale.setScalar(k); p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const [x, y, z] = PROP_AT.kenney; p.position.set(x * k, y * k, z * k); g.add(p);
      } catch { window.__lineup.failed += 1; }
    } else if (prop?.kind === 'custom') {
      const p = customProp(prop.id);
      const [x, y, z] = PROP_AT[prop.id] ?? [0, 0.78, 0]; p.position.set(x * k, y * k, z * k);
      g.add(p);
    }
    window.__lineup.loaded += 1;
  } catch (e) {
    console.warn('인형 실패', key, e);
    window.__lineup.failed += 1;
    const ph = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, height - 0.4, 4, 10), new THREE.MeshStandardMaterial({ color: '#8a7320' })); ph.position.y = height / 2; g.add(ph);
  }
  window.__lineup.names.push(spec.name ?? key);
  scene.add(g);
});
await Promise.all(jobs);

// 카메라 — 정면(살짝 위). 줄은 폭에 맞추고, 하나짜리는 키에 맞춘다. 직교라 원근 없이 나란히. 뒷줄은 기울기 때문에 위로 올라가 보인다.
const span = (COLS - 1) * GAP + GAP / 2 + 1.6;
const tilt = FRONT ? 0.08 : 0.18;   // 정면 요청이면 거의 수평, 아니면 정면 살짝 위(헨리)
const depthRise = (ROWS - 1) * ROW_GAP * Math.sin(tilt);   // 뒷줄이 화면에서 올라가는 만큼
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const aspect = W / H;
const needH = ONLY ? maxH * 1.15 : Math.max(span / aspect, maxH * 1.25 + depthRise);
const halfH = needH / 2, halfW = halfH * aspect;
camera.left = -halfW; camera.right = halfW; camera.top = halfH * 1.15; camera.bottom = -halfH * 0.85;   // 발밑 조금, 머리 위 여유
camera.updateProjectionMatrix();
camera.position.set(Math.sin(ANGLE) * 20, Math.sin(tilt) * 20, Math.cos(ANGLE) * Math.cos(tilt) * 20);
camera.lookAt(0, ONLY ? maxH * 0.45 : maxH * 0.45 + depthRise / 2, -(ROWS - 1) * ROW_GAP / 2);
renderer.render(scene, camera);

// 세운 인형 수를 화면에서 센다(하네스 제안 R25 — exit 0 인데 그림이 틀린 조용한 실패를 잡는다). 몸의 뼈(있으면 첫 뼈, 없으면 몸 자체)의 세계 좌표를 화면에 투영해
// 서로 24px 넘게 떨어진 자리가 몇 개인지 — 뼈가 원본과 공유되면 전부 한 점에 모여 1 이 된다. 찍는 쪽(tools/lineup-shot.mjs)이 loaded 와 다르면 exit 3.
scene.updateMatrixWorld(true);
const spots = [];
for (const g of scene.children) {
  const body = g.userData?.body; if (!body) continue;
  let bone = null; body.traverse((o) => { if (!bone && o.isSkinnedMesh && o.skeleton?.bones?.length) bone = o.skeleton.bones[0]; });
  const p = new THREE.Vector3(); (bone ?? body).getWorldPosition(p);
  const gp = new THREE.Vector3(); g.getWorldPosition(gp);
  // 뼈가 제 자리(그룹) 근처에 있어야 몸이 거기 선 것이다 — 원본 뼈를 공유하면 그룹과 멀리 떨어진 한 점에 모인다
  if (p.distanceTo(gp) > 2) { window.__lineup.misplaced = (window.__lineup.misplaced ?? 0) + 1; continue; }
  p.project(camera);
  const sx = (p.x + 1) / 2 * W, sy = (1 - p.y) / 2 * H;
  if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) { window.__lineup.offscreen = (window.__lineup.offscreen ?? 0) + 1; continue; }
  if (!spots.some((s) => Math.hypot(s[0] - sx, s[1] - sy) < 24)) spots.push([sx, sy]);
}
window.__lineup.placed = spots.length;
window.__lineup.ready = true;
