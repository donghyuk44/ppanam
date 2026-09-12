// 마을 지도 생성기 — `node tools/world/mapgen.mjs` 가 server/public/world/map.json 을 쓴다. 손으로 고치지 않고 이 스크립트를 고친다.
// 장면 둘: 마을(village) 과 회사(castle, 성 안). 포탈로 오간다. 그림 사전(TILES)만 바꾸면 다른 에셋 팩으로 갈아탈 수 있다.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'server/public/world/map.json');
const T = 16;
const OW = 0, IN = 1;                       // 시트 번호: Overworld, Inner
const ref = (s, c, r) => s * 10000 + r * 100 + c + 1;

/* ── 그림 사전 (시트, 열, 행[, 너비, 높이]) — 확대 검사 페이지로 눈으로 확인한 좌표 ── */
const TILES = {
  grass: [[OW, 0, 0], [OW, 0, 9], [OW, 12, 5]],
  path: (x, y) => [OW, 13 + (x % 2), 15 + (y % 2)],          // 황토색 포석
  plaza: (x, y) => [OW, 20 + ((x + y) % 3), 30],             // 밝은 돌바닥
  wood: (x, y) => [IN, x % 4, 3 + (y % 3)],                   // 나무 마루
  beige: () => [IN, 0, 2],                                    // 베이지 벽돌 바닥
  stone: () => [IN, 0, 0],                                    // 밝은 돌 타일
  wall: { TL: [IN, 5, 6], T: [IN, 6, 6], TR: [IN, 7, 6], L: [IN, 5, 7], R: [IN, 7, 7], BL: [IN, 5, 8], B: [IN, 6, 8], BR: [IN, 7, 8] },
  face: (i, row) => [IN, 6 + (i % 2), 2 + row],               // 보라 벽면 패널
  bush: [OW, 0, 14],
  tree: [OW, 5, 16, 3, 3],
  fence: [OW, 2, 17, 3, 2],
  house: [OW, 6, 0, 5, 5],       door: [2, 4],                // 큰 집(문 상대 좌표)
  hut: [OW, 13, 5, 2, 4],        hutDoor: [0, 3],             // 오두막
  tower: [OW, 0, 21, 3, 8], keep: [OW, 19, 28, 5, 5], gate: [OW, 25, 22, 5, 7],   // 성
  stall: [OW, 18, 22, 5, 6], fountain: [OW, 22, 9, 3, 3], statue: [OW, 8, 31, 2, 3],
  banner: [OW, 3, 29, 2, 2], bench: [OW, 28, 4, 3, 2], urn: [OW, 14, 27, 2, 2],
  barrel: [OW, 33, 5, 2, 2], crate: [OW, 30, 0, 2, 2], sign: [OW, 15, 22, 2, 3],
  desk: [IN, 0, 15, 2, 2], bigdesk: [IN, 10, 7, 3, 3], table: [OW, 21, 7, 4, 2],
  sofa: [IN, 14, 7, 3, 3], shelf: [IN, 3, 12, 3, 2], wardrobe: [IN, 6, 12, 2, 4],
  plant: [IN, 8, 12, 1, 2], lamp: [IN, 4, 15, 1, 2], picture: [IN, 9, 0, 1, 1],
  board: [IN, 12, 0, 2, 1], window: [IN, 14, 0, 2, 1], arch: [IN, 5, 2, 1, 1],
};

/* ── 장면 ── */
const places = {};
function scene(name, W, H) {
  const L = {}; for (const k of ['ground', 'deco', 'wall', 'objects', 'over']) L[k] = new Array(W * H).fill(0);
  const col = new Array(W * H).fill(0);
  const sc = { name, w: W, h: H, layers: L, collision: col, rooms: {}, portals: [] };
  const idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  sc.put = (layer, x, y, t) => { if (inb(x, y)) L[layer][idx(x, y)] = ref(t[0], t[1], t[2]); };
  sc.block = (x, y, v = 1) => { if (inb(x, y)) col[idx(x, y)] = v; };
  sc.blocked = (x, y) => !inb(x, y) || col[idx(x, y)] === 1;
  /** 여러 칸짜리 그림. solid 면 전부 막고 free 의 상대 좌표만 연다. */
  sc.stamp = (layer, x, y, t, { solid = true, free = [] } = {}) => {
    const [s, c, r, w = 1, h = 1] = t;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      sc.put(layer, x + dx, y + dy, [s, c + dx, r + dy]);
      if (solid) sc.block(x + dx, y + dy, free.some(([fx, fy]) => fx === dx && fy === dy) ? 0 : 1);
    }
  };
  sc.fill = (layer, x0, y0, w, h, fn, walk = true) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { sc.put(layer, x, y, fn(x, y)); if (walk) sc.block(x, y, 0); }
  };
  sc.place = (name, x, y, dir) => { places[name] = { scene: sc.name, x, y, ...(dir ? { dir } : {}) }; };
  sc.portal = (x, y, to) => { sc.portals.push({ x, y, to }); };
  return sc;
}

/** 지붕 없는 방. 위쪽은 돌 테두리 + 보라 벽면 2줄, 나머지는 돌 테두리 1줄. door: bottom | left | right */
function room(sc, id, x0, y0, w, h, { floor, label, door = 'bottom' }) {
  sc.rooms[id] = { x: x0, y: y0, w, h, label };
  const WL = TILES.wall;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const top = y === y0, bot = y === y0 + h - 1, lef = x === x0, rig = x === x0 + w - 1;
    if (top) sc.put('wall', x, y, lef ? WL.TL : rig ? WL.TR : WL.T);
    else if (bot) sc.put('wall', x, y, lef ? WL.BL : rig ? WL.BR : WL.B);
    else if (lef) sc.put('wall', x, y, WL.L);
    else if (rig) sc.put('wall', x, y, WL.R);
    else if (y <= y0 + 2) sc.put('wall', x, y, TILES.face(x - x0 - 1, y - y0 - 1));
    else sc.put('ground', x, y, floor(x - x0, y - y0));
    sc.block(x, y, (top || bot || lef || rig || y <= y0 + 2) ? 1 : 0);
  }
  // 문 — 아래쪽 벽이면 오른쪽 끝에서 두 번째 칸(방 안 맨 오른쪽 열은 비워 둔다), 옆벽이면 세로 가운데
  let dx, dy, ox, oy;
  if (door === 'bottom') { dx = x0 + w - 2; dy = y0 + h - 1; ox = dx; oy = dy + 1; }
  else if (door === 'right') { dx = x0 + w - 1; dy = y0 + 5; ox = dx + 1; oy = dy; }
  else { dx = x0; dy = y0 + 5; ox = dx - 1; oy = dy; }
  sc.layers.wall[dy * sc.w + dx] = 0; sc.put('deco', dx, dy, TILES.path(dx, dy)); sc.block(dx, dy, 0);
  sc.place(`${id}.door`, ox, oy); sc.place(`${id}.doorway`, dx, dy);
}
function desk(sc, team, actor, x, y) { sc.stamp('objects', x, y, TILES.desk); sc.place(`${team}.desk.${actor}`, x, y - 1, 'down'); }
function table(sc, team, x, y) {
  sc.stamp('objects', x, y, TILES.table);
  sc.place(`${team}.table`, x + 1, y - 1);
  for (let i = 0; i < 4; i++) sc.place(`${team}.seat.${i + 1}`, x + i, y - 1, 'down');
}
function office(sc, team, x0, y0, actors, label, door = 'bottom') {
  room(sc, team, x0, y0, 11, 10, { floor: TILES.wood, label, door });
  const slots = [x0 + 1, x0 + 4, x0 + 7];
  actors.slice(0, 3).forEach((a, i) => desk(sc, team, a, slots[i], y0 + 4));
  table(sc, team, x0 + 3, y0 + 7);
  sc.stamp('objects', x0 + 2, y0 + 2, TILES.picture, { solid: false });
  sc.stamp('objects', x0 + 5, y0 + 2, TILES.window, { solid: false });
  sc.stamp('objects', x0 + 1, y0 + 7, TILES.plant);
  sc.stamp('objects', x0 + 8, y0 + 7, TILES.lamp);
}

/* ── 캐스트 ── */
const teams = JSON.parse(fs.readFileSync(path.join(ROOT, 'state/teams.json'), 'utf8')).teams;
const ORDER = ['chief', 'guide', 'review', 'ops', 'outside'];
const castOf = (t) => { const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'teams', t, 'cast.json'), 'utf8')).agents ?? {}; return ORDER.filter((k) => c[k]); };
const cast = Object.fromEntries(teams.map((t) => [t.id, castOf(t.id)]));
const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? id;
const roomOf = (id) => teams.find((t) => t.id === id)?.room ?? id;

/* ════ 마을 ════ */
const V = scene('village', 56, 30);
V.fill('ground', 0, 0, V.w, V.h, (x, y) => { const h = (x * 7 + y * 13) % 11; return TILES.grass[h === 0 ? 1 : h === 1 ? 2 : 0]; });

// 회사(성) 정면: 탑·성벽·성문. 성문 아치가 포탈이다.
V.stamp('objects', 17, 1, TILES.tower); V.stamp('objects', 35, 1, TILES.tower);
V.stamp('objects', 20, 4, TILES.keep); V.stamp('objects', 30, 4, TILES.keep);
V.stamp('objects', 25, 2, TILES.gate, { free: [[2, 5], [2, 6]] });
V.rooms.castle = { x: 17, y: 1, w: 21, h: 8, label: '회사' };
V.portal(27, 7, 'castle.entrance');
V.place('village.gate', 27, 9, 'up');

// 길
const road = (sc, x, y) => { sc.put('deco', x, y, TILES.path(x, y)); sc.block(x, y, 0); };
for (const y of [9, 24]) for (let x = 1; x <= 54; x++) road(V, x, y);
for (let y = 10; y <= 23; y++) { road(V, 18, y); road(V, 37, y); }           // 광장 양옆 세로길
for (let y = 10; y <= 23; y++) road(V, 27, y);                               // 성문에서 아래로

// 광장
V.fill('deco', 20, 10, 15, 9, TILES.plaza);
V.stamp('objects', 26, 13, TILES.fountain);
V.stamp('objects', 21, 11, TILES.statue);
V.stamp('objects', 31, 11, TILES.banner); V.stamp('objects', 33, 11, TILES.banner);
V.stamp('objects', 21, 17, TILES.bench); V.stamp('objects', 31, 17, TILES.bench);
V.place('plaza', 27, 16, 'up');
V.rooms.plaza = { x: 20, y: 10, w: 15, h: 9, label: '광장' };

// 카페: 노점 + 앞마당 + 자리 다섯
V.stamp('objects', 11, 10, TILES.stall);
V.fill('deco', 11, 16, 6, 3, TILES.plaza);
for (let i = 0; i < 5; i++) V.place(`cafe.seat.${i + 1}`, 11 + i, 16, 'up');
V.stamp('objects', 12, 18, TILES.bench);
V.rooms.cafe = { x: 11, y: 10, w: 6, h: 9, label: '카페' };

// 댄의 집
V.stamp('objects', 40, 11, TILES.house, { free: [TILES.door] });
V.place('home.boss', 42, 15, 'up');
V.rooms['home.boss'] = { x: 40, y: 11, w: 5, h: 5, label: '댄의 집' };
V.stamp('objects', 39, 16, TILES.fence); V.stamp('objects', 43, 16, TILES.fence);
V.stamp('objects', 46, 12, TILES.urn);

// 에이전트들의 집: 팀별로 모여 있는 오두막
const HUTS = { marketing: 2, dev: 13, design: 24, finance: 35, hq: 46 };
for (const [team, x0] of Object.entries(HUTS)) {
  cast[team].forEach((a, i) => {
    const hx = x0 + i * 3;
    V.stamp('objects', hx, 20, TILES.hut, { free: [TILES.hutDoor] });
    V.place(`home.${team}.${a}`, hx + TILES.hutDoor[0], 20 + TILES.hutDoor[1], 'up');
  });
  V.rooms[`home.${team}`] = { x: x0, y: 20, w: cast[team].length * 3 - 1, h: 4, label: `${nameOf(team)} 집` };
}

// 나무·덤불·울타리·소품
const tree = (sc, x, y) => sc.stamp('objects', x, y, TILES.tree);
for (const [x, y] of [[2, 1], [6, 3], [10, 1], [2, 5], [12, 5], [40, 1], [44, 3], [48, 1], [52, 4], [41, 6], [48, 6], [3, 11], [6, 14], [3, 17], [48, 15], [51, 18], [46, 20], [51, 14], [3, 25], [9, 26], [21, 25], [31, 26], [43, 25], [50, 25]]) tree(V, x, y);
const bush = (sc, x, y) => { if (!sc.blocked(x, y)) { sc.put('objects', x, y, TILES.bush); sc.block(x, y); } };
for (let y = 0; y < 28; y += 2) bush(V, 0, y);
for (let y = 1; y < 28; y += 2) bush(V, 55, y);
for (const [x, y] of [[8, 11], [9, 17], [14, 20], [22, 19], [33, 19], [38, 19], [45, 19], [15, 26], [26, 27], [37, 26], [16, 1], [14, 8], [39, 8], [46, 9], [52, 10], [1, 20], [1, 23]]) bush(V, x, y);
for (let x = 0; x < V.w; x += 3) V.stamp('objects', x, 28, TILES.fence);
V.stamp('objects', 38, 25, TILES.barrel); V.stamp('objects', 16, 25, TILES.crate); V.stamp('objects', 23, 27, TILES.sign);

/* ════ 회사(성 안) ════ */
const C = scene('castle', 54, 30);
C.fill('ground', 0, 0, C.w, C.h, TILES.stone);
// 바깥벽
for (let x = 0; x < C.w; x++) { C.put('wall', x, 0, x === 0 ? TILES.wall.TL : x === C.w - 1 ? TILES.wall.TR : TILES.wall.T); C.put('wall', x, C.h - 1, x === 0 ? TILES.wall.BL : x === C.w - 1 ? TILES.wall.BR : TILES.wall.B); C.block(x, 0); C.block(x, C.h - 1); }
for (let y = 1; y < C.h - 1; y++) { C.put('wall', 0, y, TILES.wall.L); C.put('wall', C.w - 1, y, TILES.wall.R); C.block(0, y); C.block(C.w - 1, y); }
// 정문(마을로 나가는 포탈)
C.layers.wall[(C.h - 1) * C.w + 27] = 0; C.put('deco', 27, C.h - 1, TILES.path(27, C.h - 1)); C.block(27, C.h - 1, 0);
C.portal(27, C.h - 1, 'village.gate');
C.place('castle.entrance', 27, C.h - 2, 'down');

// 위층: 마케팅 · 총괄실 · 대표 집무실 · 개발
office(C, 'marketing', 1, 1, cast.marketing, roomOf('marketing'));
room(C, 'hq', 18, 1, 12, 10, { floor: TILES.beige, label: '총괄실' });
[18 + 1, 18 + 4].forEach((x, i) => cast.hq[i] && desk(C, 'hq', cast.hq[i], x, 5));
table(C, 'hq', 21, 8);
C.stamp('objects', 20, 3, TILES.picture, { solid: false });
C.stamp('objects', 24, 3, TILES.board, { solid: false }); C.place('hq.board', 25, 4, 'up');
C.stamp('objects', 19, 8, TILES.plant);
room(C, 'boss', 29, 1, 10, 10, { floor: TILES.beige, label: '대표 집무실' });
// 총괄실 ↔ 집무실 문
C.layers.wall[6 * C.w + 29] = 0; C.put('ground', 29, 6, TILES.beige()); C.block(29, 6, 0);
C.place('hq.bossdoor', 28, 6, 'right'); C.place('boss.door', 30, 6, 'left');
C.stamp('objects', 33, 5, TILES.bigdesk); C.place('boss.desk', 34, 4, 'down');
C.stamp('objects', 30, 4, TILES.shelf); C.stamp('objects', 36, 3, TILES.wardrobe, { solid: false }); C.block(36, 4); C.block(37, 4); C.block(36, 5); C.block(37, 5); C.block(36, 6); C.block(37, 6);
C.stamp('objects', 30, 8, TILES.plant); C.stamp('objects', 31, 3, TILES.picture, { solid: false });
office(C, 'dev', 42, 1, cast.dev, roomOf('dev'));

// 복도 (11~13행) 는 돌바닥 그대로. 가운데 양탄자 대신 밝은 돌.
// 아래층: 디자인 · 로비 · 경영재무
office(C, 'design', 1, 14, cast.design, roomOf('design'), 'right');
office(C, 'finance', 42, 14, cast.finance, roomOf('finance'), 'left');
C.fill('deco', 12, 14, 30, 15, TILES.beige);                      // 로비 바닥
C.stamp('objects', 25, 16, TILES.table);                          // 안내 데스크
C.stamp('objects', 18, 20, TILES.sofa); C.stamp('objects', 33, 20, TILES.sofa);
for (const [x, y] of [[13, 15], [40, 15], [13, 26], [40, 26]]) C.stamp('objects', x, y, TILES.plant);
C.stamp('objects', 24, 26, TILES.urn); C.stamp('objects', 29, 26, TILES.urn);
C.stamp('objects', 30, 15, TILES.sign);
C.rooms.lobby = { x: 12, y: 14, w: 30, h: 15, label: '로비' };

/* ── 쓰기 ── */
const strip = (sc) => ({ w: sc.w, h: sc.h, layers: sc.layers, collision: sc.collision, rooms: sc.rooms, portals: sc.portals });
const out = {
  tile: T,
  sheets: ['assets/zelda/Overworld.png', 'assets/zelda/Inner.png'],
  scenes: { village: strip(V), castle: strip(C) },
  places, cast,
  labels: Object.fromEntries(teams.map((t) => [t.id, t.name])),
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes;', Object.keys(places).length, 'places');
const scenes = { village: V, castle: C };
const bad = Object.entries(places).filter(([, p]) => scenes[p.scene].blocked(p.x, p.y));
if (bad.length) { console.error('막힌 자리:', bad.map(([k]) => k).join(', ')); process.exit(1); }
for (const sc of [V, C]) for (const p of sc.portals) { if (sc.blocked(p.x, p.y)) { console.error('막힌 포탈', sc.name, p); process.exit(1); } if (!places[p.to]) { console.error('없는 포탈 목적지', p.to); process.exit(1); } }
