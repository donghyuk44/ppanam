// 마을의 그림 — Three.js (M5, 결정 54·55·56·57).
//
// 이 파일은 "무엇을 어디에 그리나" 만 안다. 누가 어디로 걷고 무슨 말을 하는지는 world.js 가 정하고,
// 여기는 그 상태(px·py·dir·hidden·scene)를 받아 인형과 이름표를 옮길 뿐이다.
// 파일 형식은 teams/dev/out/village-file-contract.md 2판 — city.json(무엇이 어디에) + parts.json(부품·수정 표·색·빛·인형).
// 부품 glb 가 없으면 자리표시 도형(상자·캡슐)으로 세운다 — 화면이 비지 않는다.
// three 는 CDN(jsDelivr, 결정 39)에서 온다. 이 파일은 world.js 가 import() 로 늦게 부른다 — CDN 이 죽어도 작전실은 산다.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TP = 32;                                   // world.js 의 칸 픽셀 — px/TP 가 칸 좌표
const DEG = Math.PI / 180;
const FACE = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };   // 인형이 +z(남, 화면 쪽)를 보는 것이 0 — 확인 전 가정
const DIR_NAME = ['down', 'left', 'up', 'right'];   // world.js 의 DIR 번호 순서

const D = {
  stage: null, renderer: null, labels: null, camera: null, controls: null, scene: null,
  city: null, parts: null, map: null, groups: {}, current: null, roomEls: {},
  lights: {}, loader: new GLTFLoader(), cache: new Map(), loaded: 0, failed: 0, placeholders: 0,
  goal: null, fitZ: 2, w: 1, h: 1, mode: null,
};

const color = (name) => D.parts.colors[name] ?? name;          // 이름이면 표에서, 아니면 그대로(#hex)
const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: color(c), roughness: 1, metalness: 0, ...extra });   // 매트 — 장난감 재질
const box = (w, h, d, c, r = 0.06) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)), mat(c)); m.castShadow = m.receiveShadow = true; return m; };
const cyl = (rt, rb, h, c, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c)); m.castShadow = m.receiveShadow = true; return m; };
const range = (r) => ({ min: r[0], max: r[1], mid: (r[0] + r[1]) / 2, len: r[1] - r[0] });

/* ── 시작 ── */

export async function init({ stage, onClick }) {
  D.stage = stage;
  const [city, parts, map] = await Promise.all(['city', 'parts', 'map'].map((n) => fetch(`/world/${n}.json`).then((r) => { if (!r.ok) throw new Error(`${n}.json ${r.status}`); return r.json(); })));
  D.city = city; D.parts = parts; D.map = map;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'world__gl';
  stage.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.className = 'world__labels';
  stage.appendChild(labels.domElement);
  D.renderer = renderer; D.labels = labels;

  D.scene = new THREE.Scene();
  D.scene.background = new THREE.Color(parts.light.background);
  const hemi = new THREE.HemisphereLight(parts.light.sky, parts.light.ground, parts.light.hemi ?? 1);
  const sun = new THREE.DirectionalLight(parts.light.sun.color, parts.light.sun.intensity);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  D.scene.add(hemi, sun, sun.target);
  D.lights = { hemi, sun };

  D.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  D.controls = new MapControls(D.camera, renderer.domElement);
  D.controls.enableRotate = false;                     // 아이소메트릭 — 각도는 city.json 의 camera 가 정한다 (헨리와)
  D.controls.enableDamping = true; D.controls.dampingFactor = 0.12;
  D.controls.zoomToCursor = true; D.controls.minZoom = 0.4; D.controls.maxZoom = 6;
  D.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  D.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  D.controls.addEventListener('start', () => { D.goal = null; });   // 손으로 끌면 따라가기를 끊는다

  // 끌기(이동)의 끝은 클릭이 아니다 — 6px 넘게 움직였으면 카드를 열고 닫지 않는다
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  renderer.domElement.addEventListener('click', (ev) => { if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return; onClick?.(ev.offsetX, ev.offsetY); });
  new ResizeObserver(() => resize()).observe(stage);
  resize();
  return api;
}

function resize() {
  const w = D.stage.clientWidth || 1, h = D.stage.clientHeight || 1;
  D.w = w; D.h = h;
  D.renderer.setSize(w, h, false); D.labels.setSize(w, h);
  fit();
}
/** 화면 배율 — 짧은 변에 몇 칸이 들어가나 (city.json camera.fit). MapControls 의 휠·핀치는 camera.zoom 으로 그 위에 얹힌다. */
function fit() {
  const units = D.city.camera.fit[String(D.fitZ)] ?? 30;
  const ppu = Math.min(D.w, D.h) / units;
  const c = D.camera;
  c.left = -D.w / 2 / ppu; c.right = D.w / 2 / ppu; c.top = D.h / 2 / ppu; c.bottom = -D.h / 2 / ppu;
  c.updateProjectionMatrix();
}
/** 카메라를 목표 자리 위에 둔다 — 남쪽에서 azimuth 만큼 돌아 elevation 으로 내려본다. */
function placeCamera(tx, tz) {
  const { elevation, azimuth } = D.city.camera;
  const el = elevation * DEG, az = azimuth * DEG, dist = 120;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  D.controls.target.set(tx, 0, tz);
  D.camera.position.copy(D.controls.target).addScaledVector(dir, dist);
  D.camera.lookAt(D.controls.target);
  D.controls.update();
}

/* ── 장면 ── */

function sceneSize(name) { const s = D.map.scenes[name]; return { w: s.w, h: s.h }; }

/** 장면을 세운다. 한 번 세우면 다시 안 세운다 — 보이기만 바꾼다. */
function buildScene(name) {
  if (D.groups[name]) return D.groups[name];
  const g = new THREE.Group(); g.name = name;
  const spec = D.city.scenes[name] ?? {};
  const { w, h } = sceneSize(name);
  if (spec.kind === 'interior') buildInterior(g, name, spec, w, h); else buildVillage(g, name, spec, w, h);
  buildRoomLabels(g, name);
  g.visible = false;
  D.scene.add(g); D.groups[name] = g;
  return g;
}

function buildVillage(g, name, spec, w, h) {
  const pad = spec.base?.pad ?? 2;
  const base = box(w + pad * 2, 0.8, h + pad * 2, spec.base?.color ?? 'base', 0.5);   // 디오라마 받침 — 참고 그림의 둥근 판
  base.position.set(w / 2, -0.4, h / 2); base.castShadow = false; g.add(base);
  for (const p of spec.ground ?? []) {
    const x = range(p.x), z = range(p.z);
    const y = p.kind === 'water' ? -0.02 : 0.02;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x.len, z.len), mat(p.kind, p.kind === 'water' ? { roughness: 0.35 } : {}));
    m.rotation.x = -Math.PI / 2; m.position.set(x.mid, y, z.mid); m.receiveShadow = true; g.add(m);
  }
  for (const b of spec.buildings ?? []) g.add(placePart(b, teamColorOf(b.team)));
  for (const p of spec.props ?? []) g.add(placePart(p, null));
  for (const l of spec.landmarks ?? []) { const o = LANDMARK[l.kind]?.(l); if (o) g.add(o); }
}

const TEAM_COLORS = {};
export function setTeamColors(colors) { Object.assign(TEAM_COLORS, colors); }
const teamColorOf = (team) => (team ? TEAM_COLORS[team] ?? '#8a7320' : null);

/** 부품 하나를 자리에 놓는다. glb 가 오기 전엔 size 크기의 상자, 오면 바꿔 끼운다. 수정 표(mods)는 부품 위에 얹는다. */
function placePart(entry, teamColor) {
  const part = D.parts.parts[entry.part];
  const g = new THREE.Group(); g.name = entry.id ?? entry.part;
  if (!part) return g;
  const k = part.scale ?? D.parts.scale, [sw, sh, sd] = part.size.map((v, i) => v * k);
  g.position.set(entry.at[0], 0, entry.at[1]); g.rotation.y = (entry.rotY ?? 0) * DEG;
  const ph = box(sw, sh, sd, '#e6dccb'); ph.position.y = sh / 2; g.add(ph); D.placeholders += 1;
  loadGlb(D.parts.kits[part.kit] + part.file).then((src) => {
    const m = src.clone(); m.scale.setScalar(k);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) { o.material.roughness = 1; o.material.metalness = 0; } } });
    g.remove(ph); g.add(m); D.placeholders -= 1;
  }).catch(() => { /* 없으면 상자 그대로 */ });
  for (const name of part.mods ?? []) { const mod = D.parts.mods[name]; if (mod) g.add(buildMod(mod, [sw, sh, sd], entry, teamColor)); }
  return g;
}

/** 수정 표 — cap(지붕 위 상자) · front(앞면 낱장). 새 종류는 계약 문서에 먼저. */
function buildMod(mod, [sw, sh, sd], entry, teamColor) {
  const c = mod.color === 'team' ? (teamColor ?? '#8a7320') : mod.color;
  if (mod.kind === 'cap') {
    const o = mod.overhang ?? 0.3, m = box(sw + o * 2, mod.h, sd + o * 2, c, 0.12);
    m.position.y = sh + mod.h / 2;
    const ridge = box(sw + o * 2 - 0.3, 0.12, 0.3, c, 0.05); ridge.position.y = sh + mod.h + 0.06;   // 용마루 한 줄 — 기와 지붕으로 읽히게
    const grp = new THREE.Group(); grp.add(m, ridge); return grp;
  }
  if (mod.kind === 'front') {
    const text = mod.text === '@sign' ? entry.sign : mod.text;
    if (mod.text && !text) return new THREE.Group();          // 간판 글자가 없는 건물엔 간판을 안 단다
    const m = new THREE.Mesh(new THREE.PlaneGeometry(mod.w, mod.h), text ? signMaterial(text, c) : mat(c));
    m.position.set(0, (mod.y ?? 0) + mod.h / 2, sd / 2 + 0.03); m.castShadow = false; m.receiveShadow = true;
    return m;
  }
  return new THREE.Group();
}

/** 한글 간판 — 글자를 캔버스에 그려 텍스처로. 서울다움 ②. */
function signMaterial(text, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 84;
  const x = c.getContext('2d');
  x.fillStyle = color(bg); x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = color('ink'); x.lineWidth = 6; x.strokeRect(3, 3, c.width - 6, c.height - 6);
  x.fillStyle = color('ink'); x.font = 'bold 50px "IBM Plex Sans KR", "Gowun Batang", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, c.height / 2 + 3);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
}

function loadGlb(url) {
  if (!D.cache.has(url)) {
    D.cache.set(url, D.loader.loadAsync(url).then((gltf) => { D.loaded += 1; return gltf.scene; }).catch((e) => { D.failed += 1; throw e; }));
  }
  return D.cache.get(url);
}

/* ── 랜드마크 — 부품이 아니라 코드가 짓는다. "알아볼 형태" 까지만 (결정 57). ── */

const LANDMARK = {
  /** 한옥 — 기단·벽·기둥·기와 지붕 두 단. 근정전(회사)과 댄의 집이 같은 함수, 크기만 다르다. */
  hanok(l) {
    const x = range(l.x), z = range(l.z), g = new THREE.Group(); g.name = l.id;
    const wallH = l.wallH ?? 2.4, tiers = l.tiers ?? 2, inset = Math.min(0.6, x.len * 0.08);
    const plinth = box(x.len, 0.35, z.len, 'stone', 0.08); plinth.position.set(x.mid, 0.175, z.mid); g.add(plinth);
    const wall = box(x.len - inset * 2, wallH, z.len - inset * 2, 'wall', 0.05); wall.position.set(x.mid, 0.35 + wallH / 2, z.mid); g.add(wall);
    const n = l.columns ?? 6, cz = z.max - inset * 0.55;
    for (let i = 0; i < n; i++) {                                     // 앞면 기둥 — 붉은 갈색
      const c = cyl(0.13, 0.13, wallH, 'wood', 10); c.position.set(x.min + inset + (x.len - inset * 2) * (i + 0.5) / n, 0.35 + wallH / 2, cz); g.add(c);
    }
    let y = 0.35 + wallH, ex = 0.9, ez = 0.9;
    for (let t = 0; t < tiers; t++) {                                  // 기와 지붕 — 단마다 조금씩 좁아진다
      const rh = 0.55, r = box(x.len + ex * 2 - t * 1.6, rh, z.len + ez * 2 - t * 1.4, 'roof', 0.15);
      r.position.set(x.mid, y + rh / 2, z.mid); g.add(r);
      const eave = box(x.len + ex * 2 - t * 1.6 + 0.2, 0.08, z.len + ez * 2 - t * 1.4 + 0.2, 'wood', 0.02); eave.position.set(x.mid, y + 0.02, z.mid); g.add(eave);
      y += rh + (t < tiers - 1 ? 0.5 : 0);
      if (t < tiers - 1) { const up = box(x.len - inset * 2 - 1.0, 0.5, z.len - inset * 2 - 1.0, 'wall', 0.05); up.position.set(x.mid, y - 0.25, z.mid); g.add(up); }
    }
    const ridge = box(x.len * 0.7, 0.16, 0.36, 'roof', 0.06); ridge.position.set(x.mid, y + 0.08, z.mid); g.add(ridge);
    return g;
  },
  /** 남산타워 — 언덕 반구 + 기둥 + 전망대 + 안테나. 전망대 + 기둥이면 충분(결정 57). */
  'namsan-tower'(l) {
    const g = new THREE.Group(); g.name = l.id; const [x, z] = l.at, R = l.hillR ?? 5, H = l.hillH ?? 3;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat('hill'));
    hill.scale.y = H / R; hill.position.set(x, 0, z); hill.castShadow = hill.receiveShadow = true; g.add(hill);
    for (let i = 0; i < 9; i++) {                                     // 나무 덩어리 — 언덕 위 숲
      const a = i * 0.7 + 0.3, r = R * (0.35 + (i % 3) * 0.18), s = 0.45 + (i % 2) * 0.2;
      const t = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), mat(i % 2 ? '#6f9e4f' : 'grass'));
      const yy = H * Math.sqrt(Math.max(0, 1 - (r / R) ** 2));
      t.position.set(x + Math.cos(a) * r, yy + s * 0.5, z + Math.sin(a) * r); t.castShadow = true; g.add(t);
    }
    const th = l.towerH ?? 7, dr = l.deckR ?? 1.1;
    const post = cyl(0.22, 0.32, th, 'tower'); post.position.set(x, H + th / 2, z); g.add(post);
    const deck = cyl(dr, dr * 0.85, 0.75, 'tower', 24); deck.position.set(x, H + th - 0.9, z); g.add(deck);
    const ring = cyl(dr * 1.05, dr * 1.05, 0.14, 'antenna', 24); ring.position.set(x, H + th - 1.2, z); g.add(ring);
    const cap = cyl(0.5, dr * 0.85, 0.35, 'tower', 20); cap.position.set(x, H + th - 0.35, z); g.add(cap);
    const ant = cyl(0.04, 0.1, 2.4, 'antenna', 8); ant.position.set(x, H + th + 1.2, z); g.add(ant);
    const ant2 = cyl(0.06, 0.06, 0.5, 'tower', 8); ant2.position.set(x, H + th + 0.9, z); g.add(ant2);
    return g;
  },
  /** 한강 다리 — 상판 + 다리 기둥 + 아치 둘. */
  bridge(l) {
    const x = range(l.x), z = range(l.z), g = new THREE.Group(); g.name = l.id;
    const deck = box(x.len, 0.16, z.len, 'stone', 0.03); deck.position.set(x.mid, 0.42, z.mid); g.add(deck);
    for (const side of [-1, 1]) {                                       // 양옆 난간 위로 낮은 아치 — 다리 길이(z) 방향으로 눕는다
      const xx = x.mid + side * (x.len / 2 - 0.08);
      const rail = box(0.08, 0.28, z.len, 'wall', 0.02); rail.position.set(xx, 0.62, z.mid); g.add(rail);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(z.len / 2 - 0.3, 0.07, 8, 24, Math.PI), mat('wood'));
      arch.position.set(xx, 0.5, z.mid); arch.rotation.y = Math.PI / 2; arch.scale.y = 0.45; arch.castShadow = true; g.add(arch);
    }
    for (const t of [0.3, 0.7]) for (const side of [-1, 1]) { const p = cyl(0.12, 0.16, 0.5, 'stone', 10); p.position.set(x.mid + side * (x.len / 2 - 0.15), 0.2, z.min + z.len * t); g.add(p); }
    return g;
  },
  /** 광장 분수. */
  fountain(l) {
    const g = new THREE.Group(); g.name = l.id; const [x, z] = l.at, r = l.r ?? 1;
    const rim = cyl(r, r, 0.3, 'stone', 28); rim.position.set(x, 0.15, z); g.add(rim);
    const water = cyl(r * 0.85, r * 0.85, 0.32, 'water', 28); water.position.set(x, 0.16, z); water.castShadow = false; g.add(water);
    const mid = cyl(r * 0.28, r * 0.35, 0.7, 'stone', 16); mid.position.set(x, 0.6, z); g.add(mid);
    const top = new THREE.Mesh(new THREE.SphereGeometry(r * 0.18, 12, 10), mat('water')); top.position.set(x, 1.05, z); g.add(top);
    return g;
  },
};

/* ── 회사 안 — 지붕을 걷어낸 방(컷어웨이). map.json 의 wall 층과 자리로 세운다. ── */

function buildInterior(g, name, spec, w, h) {
  const sc = D.map.scenes[name];
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat('floor')); floor.rotation.x = -Math.PI / 2; floor.position.set(w / 2, 0, h / 2); floor.receiveShadow = true; g.add(floor);
  const base = box(w + 2, 0.8, h + 2, 'base', 0.5); base.position.set(w / 2, -0.41, h / 2); base.castShadow = false; g.add(base);
  const wallH = spec.wallH ?? 1.2, cells = [];
  const layer = sc.layers?.wall ?? [];
  for (let i = 0; i < layer.length; i++) if (layer[i]) cells.push([i % sc.w, Math.floor(i / sc.w)]);
  if (cells.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, wallH, 1), mat('floorWall'), cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach(([x, y], i) => { m4.makeTranslation(x + 0.5, wallH / 2, y + 0.5); inst.setMatrixAt(i, m4); });
    inst.castShadow = inst.receiveShadow = true; g.add(inst);
  }
  for (const [id, p] of Object.entries(D.map.places)) {
    if (p.scene !== name) continue;
    if (/\.desk\./.test(id) || id === 'boss.desk') {                  // 책상 — 사람 자리 앞(북쪽) 칸
      const d = box(0.9, 0.55, 0.5, 'desk', 0.04); d.position.set(p.x + 0.5, 0.275, p.y + 0.5 - 0.65); g.add(d);
      const s = box(0.5, 0.06, 0.34, '#f4efe4', 0.02); s.position.set(p.x + 0.5, 0.58, p.y + 0.5 - 0.7); s.rotation.x = -0.6; g.add(s);   // 화면 — 작업 중인 사람 앞에 얇은 판
    } else if (/\.table$/.test(id)) {                                    // 회의상
      const t = cyl(1.0, 1.0, 0.5, 'desk', 24); t.position.set(p.x + 0.5, 0.25, p.y + 0.5); g.add(t);
    } else if (id === 'hq.board') {                                      // 승인 게시판 — 서 있는 판
      const b = box(1.6, 1.1, 0.08, '#e9dfcf', 0.03); b.position.set(p.x + 0.5, 0.75, p.y + 0.5 - 0.45); g.add(b);
    }
  }
}

/* ── 방 이름표 — CSS2D ── */

function buildRoomLabels(g, name) {
  const sc = D.map.scenes[name];
  for (const [id, r] of Object.entries(sc.rooms ?? {})) {
    if (!r.label) continue;
    const el = document.createElement('div'); el.className = 'wv-room'; el.textContent = r.label;
    const o = new CSS2DObject(el); o.center.set(0.5, 1);
    const yTop = name === 'castle' ? 1.3 : (id === 'castle' ? 6.5 : id.startsWith('home.') ? 4.6 : 0.6);
    o.position.set(r.x + r.w / 2, yTop, r.y + (name === 'castle' ? 0.4 : r.h / 2));
    g.add(o); D.roomEls[id] = el;
  }
}

/* ── 사람 ── */

/** 인형 하나를 만든다. 오기 전엔 팀 색 캡슐, 오면 Kenney 인형(원색 — colormap 은 디자인이 주면 갈아 끼운다). */
function addActor(a, { key, name, color: teamColor, boss = false }) {
  const spec = D.parts.characters[key] ?? null;
  const k = D.parts.scale, height = spec ? spec.sourceHeight * k : 1.0;
  const g = new THREE.Group(); g.name = key;
  const ph = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, height - 0.4, 4, 10), mat(teamColor ?? '#8a7320'));
  ph.position.y = height / 2; ph.castShadow = true; g.add(ph);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24), new THREE.MeshBasicMaterial({ color: teamColor ?? '#8a7320', transparent: true, opacity: 0.55 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);   // 발밑 팀 색 고리 — 옷을 못 물들이는 동안의 팀 표시
  if (spec) {
    loadGlb(D.parts.kits.characters + spec.model).then((src) => {
      const m = src.clone(); m.scale.setScalar(k);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (o.material) { o.material = o.material.clone(); o.material.roughness = 1; o.material.metalness = 0; } } });
      if (spec.colormap) {                                           // 디자인이 준 사람 색 한 장 — 있으면 갈아 끼운다
        new THREE.TextureLoader().load(`/world/assets/colormaps/people/${spec.colormap}`, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; m.traverse((o) => { if (o.isMesh && o.material.map) { o.material.map = tex; o.material.needsUpdate = true; } }); });
      }
      g.remove(ph); g.add(m);
    }).catch(() => { /* 캡슐 그대로 */ });
  }
  // 이름표 + 말풍선 기둥 — 머리 위. 말풍선은 world.js 가 이 안에 넣는다.
  const tag = document.createElement('div'); tag.className = 'wv-tag';
  const nm = document.createElement('div'); nm.className = 'wv-name' + (boss ? ' wv-name--boss' : ''); nm.textContent = name; nm.style.setProperty('--team', teamColor ?? '#8a7320');
  tag.appendChild(nm);
  const o = new CSS2DObject(tag); o.center.set(0.5, 1); o.position.set(0, height + 0.15, 0); g.add(o);
  D.scene.add(g);
  a.obj = g; a.tag = tag; a.nameEl = nm; a.height = height;
  updateActor(a);
}
function updateActor(a) {
  const g = a.obj; if (!g) return;
  g.visible = !a.hidden && a.scene === D.current;
  g.position.set(a.px / TP + 0.5, 0, a.py / TP + 0.5);
  g.rotation.y = FACE[DIR_NAME[a.dir] ?? 'down'] ?? 0;
}

/* ── 화면 ── */

function showScene(name) {
  buildScene(name);
  for (const [n, g] of Object.entries(D.groups)) g.visible = n === name;
  D.current = name;
  const { w, h } = sceneSize(name);
  const sun = D.lights.sun, f = D.parts.light.sun.from;
  sun.position.set(w / 2 + f[0] * 40, f[1] * 40, h / 2 + f[2] * 40); sun.target.position.set(w / 2, 0, h / 2);
  const sc = sun.shadow.camera; sc.left = -(w * 0.6 + 4); sc.right = w * 0.6 + 4; sc.top = h * 0.6 + 8; sc.bottom = -(h * 0.6 + 8); sc.near = 1; sc.far = 200; sc.updateProjectionMatrix();
  if (!D.placed?.[name]) { D.placed = D.placed ?? {}; D.placed[name] = true; placeCamera(w / 2, h / 2); }
}

/** 화면 위 좌표(CSS px) — 발과 머리. 클릭이 누구인지 가릴 때. */
function project(a) {
  if (!a.obj) return null;
  const p = (y) => { const v = new THREE.Vector3(a.px / TP + 0.5, y, a.py / TP + 0.5).project(D.camera); return { x: (v.x + 1) / 2 * D.w, y: (1 - v.y) / 2 * D.h }; };
  return { foot: p(0), head: p(a.height ?? 1), ppu: D.w / (D.camera.right - D.camera.left) * D.camera.zoom };
}
/** 화면이 그 자리로 간다. force 가 아니면 이미 보이는 자리는 놔둔다. */
function lookAt(a, force) {
  const s = project(a); if (!s) return;
  const m = 60;
  if (!force && s.foot.x > m && s.foot.x < D.w - m && s.head.y > m && s.foot.y < D.h - m) return;
  lookAtXZ(a.px / TP + 0.5, a.py / TP + 0.5, force);
}
/** 칸 좌표 (x, z) 로 화면을 옮긴다. force 면 바로, 아니면 부드럽게. */
function lookAtXZ(x, z, force = false) {
  const goal = new THREE.Vector3(x, 0, z);
  if (force) { const d = goal.clone().sub(D.controls.target); D.controls.target.copy(goal); D.camera.position.add(d); D.goal = null; }
  else D.goal = goal;
}
function setZoom(z) { D.fitZ = z; D.camera.zoom = 1; fit(); }

/** 띠 — 방 위에 잠깐 뜨는 글(라운드 시작·끝). world.js 가 만든 요소를 받아 자리에 붙인다. */
function banner(sceneName, x, z, el, ms = 5000) {
  const g = buildScene(sceneName); const o = new CSS2DObject(el); o.center.set(0.5, 1); o.position.set(x, 2.2, z); g.add(o);
  setTimeout(() => { el.classList.add('wb--gone'); setTimeout(() => { g.remove(o); el.remove(); }, 260); }, ms);
}

/** 세상의 시각 — 밤엔 어둡고 저녁엔 붉다. 빛과 배경만 바꾼다. */
function applyMode(mode) {
  if (mode === D.mode) return; D.mode = mode;
  const L = D.parts.light, m = L[mode] ?? null;
  D.scene.background.set(m?.background ?? L.background);
  D.lights.hemi.color.set(m?.sky ?? L.sky); D.lights.hemi.groundColor.set(m?.ground ?? L.ground); D.lights.hemi.intensity = m?.hemi ?? L.hemi ?? 1;
  D.lights.sun.intensity = m?.sun ?? L.sun.intensity;
}

function render(mode) {
  applyMode(mode === 'night' || mode === 'evening' ? mode : 'day');
  if (D.goal) {                                                       // 따라가기 — 목표 자리로 부드럽게
    const d = D.goal.clone().sub(D.controls.target).multiplyScalar(0.12);
    if (d.lengthSq() < 1e-4) D.goal = null; else { D.controls.target.add(d); D.camera.position.add(d); }
  }
  D.controls.update();
  // 멀리서 보면 이름표·말풍선이 마을을 덮는다(폰 폭 "화면 작게" 에서 열여섯 이름표가 한 줄로 겹침, R24 첫 그림). 칸 하나가 10px 아래면 방 이름만 남긴다.
  const ppu = D.w / (D.camera.right - D.camera.left) * D.camera.zoom;
  D.labels.domElement.classList.toggle('world__labels--far', ppu < 10);
  D.renderer.render(D.scene, D.camera);
  D.labels.render(D.scene, D.camera);
}

/** 시험용 — 화면을 안 보고도 무엇이 섰는지. */
function stats() {
  return { engine: 'three', scene: D.current, glbLoaded: D.loaded, glbFailed: D.failed, placeholders: D.placeholders, scenes: Object.keys(D.groups), zoom: D.camera?.zoom ?? null, fit: D.fitZ };
}

const api = { showScene, addActor, updateActor, project, lookAt, lookAtXZ, setZoom, banner, render, stats, get roomEls() { return D.roomEls; }, get current() { return D.current; } };
