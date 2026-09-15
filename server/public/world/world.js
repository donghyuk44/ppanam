// 마을 — 대화록의 시각화.
//
// 캐릭터가 어디 있고 무엇을 하는지는 기록된 사건(message·verdict·tool·enter…)과 지도의 자리 표에서만 나온다.
// LLM 이 좌표를 정하는 채널은 없다. 그림은 draw3d.js(Three.js, M5)가, 글(말풍선·이름표)은 DOM(CSS2D)이 맡는다.
// 이 파일은 걷기·자리·연출·재생·카드 — 결정 16 대로 그림 엔진을 바꿔도 그대로다. 칸 좌표(px = 칸 × TP)도 그대로.
// 대표(댄)만 사람이라 방향키로 움직이고, 옆 사람에게 Enter 로 말을 건다 — 그 말은 작전실과 같은 /api/say 로 간다.
// 장면은 둘이다: 마을(village) 과 회사(castle, 성 안). 포탈(성문·정문)로 오가고, "어디로" 목록으로 바로 간다.

import { splitSpeech } from './speech.js';        // 말 → 말풍선 조각 (순수, check 가 같은 것을 돌린다)

const $ = (id) => document.getElementById(id);
const TP = 32;                                   // 칸 한 변(px) — 걷기 코드는 px/py 로 셈하고, 그림은 px/TP 를 칸 좌표로 받는다
const DIR = { down: 0, left: 1, up: 2, right: 3 }; // 방향 번호
const WALK = 4;                                    // 초당 걷는 칸 수
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const S = {
  lamps: new Set(), blocked: new Set(), failAt: {}, summaries: null,   // FAIL 램프·대표실 문 앞 대기 (W3)
  open: false, ready: null, map: null, gl: null,     // gl: draw3d.js 의 그림 — CDN 이 안 오면 null 이고 마을은 "못 불러왔습니다"
  z: 2, teams: [], casts: {}, actors: new Map(), boss: null,
  scene: 'castle',                                   // 보고 있는 장면
  bubbles: new Set(), speaking: new Set(), cam: true, raf: 0, last: 0,   // speaking — 쪼갠 말의 다음 조각이 남은 사람
  world: null,                                       // 세상의 시계 — 서버가 준 { hour, mode, actors } (W2)
};
const MODE_LABEL = { work: '근무', lunch: '점심', evening: '퇴근', night: '밤', rest: '휴식' };
/** 시각 → 모드 (화면용 근사. 정본은 server/world.mjs). 재생할 때 사건의 시각으로 색조를 정한다. */
const modeOfHour = (h) => (h >= 23 || h < 7 ? 'night' : h >= 12 && h < 13 ? 'lunch' : h >= 9 && h < 18 ? 'work' : 'evening');
const cur = () => S.map.scenes[S.scene];             // 지금 보는 장면
const sceneOf = (a) => S.map.scenes[a.scene];
const placeOf = (name) => S.map.places[name] ?? null;
// 재생 상태. 한 번에 한 방만 재생한다. 그 방의 실시간 사건은 재생이 끝날 때까지 무시한다.
const R = { team: null, round: null, events: [], i: 0, timer: 0, playing: false, speed: 2, held: [] };   // held: 재생 중 도착한 같은 방의 실시간 사건

/* ── 불러오기 ── */

/** 팀 색 — 그 방 실무(총괄실은 총괄)의 색. 집 문·이름표·발밑 고리에 쓴다. */
const teamColor = (team) => S.casts[team]?.guide?.color ?? S.casts[team]?.chief?.color ?? '#8a7320';

function makeActor(team, id, a, home) {
  const act = {
    key: `${team}:${id}`, team, id, name: a.name ?? id, color: a.color, model: a.model, scene: home.scene,
    x: home.x, y: home.y, px: home.x * TP, py: home.y * TP, dir: DIR[home.dir ?? 'down'] ?? 0,
    animT: 0, path: [], onArrive: null, hidden: false, home, lastSpoke: 0,
  };
  S.actors.set(act.key, act);
  S.gl.addActor(act, { key: `${team}-${id}`, name: act.name, color: teamColor(team) });
  return act;
}

async function load() {
  const map = await fetch('/world/map.json').then((r) => r.json());
  S.map = map;
  // 그림 엔진은 늦게 부른다 — three 가 CDN 에서 안 오면 작전실(app.js)까지 같이 죽지 않게. 실패하면 마을만 "못 불러왔습니다".
  const draw = await import('./draw3d.js').catch((e) => { throw new Error(`3D 를 못 불러왔습니다(CDN?) — ${e.message}`); });

  const casts = await Promise.all(S.teams.map((t) =>
    fetch(`/api/team?team=${encodeURIComponent(t.id)}`).then((r) => r.json()).then((r) => [t.id, r.cast?.agents ?? {}]).catch(() => [t.id, {}])));
  S.casts = Object.fromEntries(casts);
  draw.setTeamColors(Object.fromEntries(S.teams.map((t) => [t.id, teamColor(t.id)])));
  S.gl = await draw.init({ stage: $('wvStage'), onClick: onStageClick });

  for (const [team, agents] of casts) {
    for (const [id, a] of Object.entries(agents)) {
      const home = map.places[`${team}.desk.${id}`];   // 자리가 없는 이름(boss·system·남의 방 총괄)은 캐릭터가 아니다
      if (home) makeActor(team, id, a, home);
    }
  }
  const bc = S.casts.hq?.boss ?? { initial: '댄', color: '#8a7320' };
  const bd = map.places['boss.desk'] ?? map.places['hq.bossdoor'];
  S.boss = {
    key: 'boss', team: null, id: 'boss', name: bc.initial ?? '댄', color: bc.color, scene: bd.scene,
    x: bd.x, y: bd.y, px: bd.x * TP, py: bd.y * TP, dir: DIR.down, animT: 0, path: [], onArrive: null,
    hidden: false, home: bd, lastSpoke: 0, controlled: 0,
  };
  S.gl.addActor(S.boss, { key: 'boss', name: S.boss.name, color: bc.color, boss: true });

  initToolbar();
  setScene(bd.scene);
  window.addEventListener('keydown', onKey);
  lookAt(S.boss, true);
  if (S.world) applyWorld(S.world);
  // 비교판(결정 123, 톰 09-15) — ?only=… 이면 유니티 판과 같은 조건: 인형은 댄·세라 둘만 회사 앞 통로(26.2·28.8, 9.5 — PpanamShot.cs 와 같은 자리), 표찰·말풍선 없음, 루틴 이동 없음.
  if (new URLSearchParams(location.search).get('only')) {
    S.compare = true; S.cam = false;
    for (const a of S.actors.values()) a.hidden = true;
    // 세라는 지도에 책상이 아직 없어(hq.desk.secretary 없음, 결정 86 자리 미정) 평소엔 인형이 안 선다 — 비교판에서만 세운다(첫 판엔 인형 하나뿐이었다, 나리 09-15)
    const sec = S.actors.get('hq:secretary') ?? (S.casts.hq?.secretary ? makeActor('hq', 'secretary', S.casts.hq.secretary, { scene: 'village', x: 28.8, y: 9.5, dir: 'down' }) : null);
    if (sec) teleport(sec, { scene: 'village', x: 28.8, y: 9.5, dir: 'down' });
    teleport(S.boss, { scene: 'village', x: 26.2, y: 9.5, dir: 'down' });
    setScene('village');
    S.gl.setZoom(S.z = 1);   // '작게'(60칸) — 유니티 판과 같은 크기. 조작판이 서랍 안이라 찍는 도구가 못 고른다
    const zs = $('wvZoom'); if (zs) zs.value = '1';
    $('wvStage').classList.add('world--compare');
  }
}

/** 장면을 바꾼다. 장면은 draw3d 가 한 번 세워 두고 보이기만 바꾼다. */
function setScene(name) {
  if (!S.map.scenes[name]) return;
  S.scene = name;
  S.gl.showScene(name);
  for (const a of everyone()) S.gl.updateActor(a);
  for (const id of S.lamps) S.gl.roomEls[id]?.classList.add('wv-room--fail');
  for (const b of $('wvScene').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.scene === name));
}

/* ── 걷기 ── */

const free = (sc, x, y) => x >= 0 && y >= 0 && x < sc.w && y < sc.h && !sc.collision[y * sc.w + x];

function bfs(sc, from, to) {
  const { w, h, collision } = sc;
  const key = (x, y) => y * w + x, goal = key(to.x, to.y), start = key(from.x, from.y);
  if (start === goal) return [];
  const prev = new Int32Array(w * h).fill(-1); prev[start] = start;
  const q = [[from.x, from.y]]; let head = 0;
  while (head < q.length) {
    const [x, y] = q[head++]; const k = key(x, y);
    if (k === goal) break;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = key(nx, ny);
      if (prev[nk] !== -1 || (collision[nk] && nk !== goal)) continue;
      prev[nk] = k; q.push([nx, ny]);
    }
  }
  if (prev[goal] === -1) return null;
  const path = []; for (let k = goal; k !== start; k = prev[k]) path.push([k % w, Math.floor(k / w)]);
  return path.reverse();
}

/* ── 길찾기 — EasyStar.js(jsDelivr, 결정 39)가 있으면 그것, 안 왔으면 위 bfs. 같은 격자·4방향이라 답이 같다. 목표 칸이 막힌 칸(책상 앞 자리)이어도 간다 — bfs 와 같은 규칙. ── */
const finders = new Map();
function finderFor(name) {
  if (!globalThis.EasyStar?.js) return null;
  if (!finders.has(name)) {
    const sc = S.map.scenes[name];
    const rows = Array.from({ length: sc.h }, (_, y) => Array.from({ length: sc.w }, (_, x) => (sc.collision[y * sc.w + x] ? 1 : 0)));
    const es = new globalThis.EasyStar.js(); es.setGrid(rows); es.setAcceptableTiles([0]); es.enableSync();
    finders.set(name, { es, rows });
  }
  return finders.get(name);
}
function findPath(name, from, to) {
  const sc = S.map.scenes[name], f = finderFor(name);
  if (!f) return bfs(sc, from, to);
  if (from.x === to.x && from.y === to.y) return [];
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < sc.w && p.y < sc.h;
  if (!inside(from) || !inside(to)) return null;
  // 출발 칸(책상 앞에 서 있다)과 목표 칸은 막힌 칸이어도 된다 — EasyStar 는 둘 다 걸을 수 있어야 하므로 잠깐 연다
  const opened = [from, to].filter((p) => f.rows[p.y][p.x] !== 0);
  for (const p of opened) f.rows[p.y][p.x] = 0;
  let out = null;
  try { f.es.findPath(from.x, from.y, to.x, to.y, (p) => { out = p; }); f.es.calculate(); }
  finally { for (const p of opened) f.rows[p.y][p.x] = 1; }
  return out ? out.slice(1).map((p) => [p.x, p.y]) : null;
}
const pathfinder = () => (globalThis.EasyStar?.js ? 'easystar' : 'bfs');

function teleport(a, p) {
  a.path = []; a.onArrive = null; a.x = p.x; a.y = p.y; a.px = p.x * TP; a.py = p.y * TP; a.hidden = false;
  if (p.scene) a.scene = p.scene;
  if (p.dir) a.dir = DIR[p.dir];
}
/** 같은 장면 안에서만 걷는다. 다른 장면의 자리면 순간이동 — 장면 사이 이동 연출은 W2 의 루틴이 맡는다. */
function walkTo(a, p, done) {
  if (!p) return;
  a.hidden = false;
  const path = (p.scene && p.scene !== a.scene) ? null : findPath(a.scene, { x: a.x, y: a.y }, p);
  if (!path) { teleport(a, p); done?.(); return; }
  a.path = path;
  a.onArrive = () => { if (p.dir) a.dir = DIR[p.dir]; done?.(); };
  if (!path.length) { const f = a.onArrive; a.onArrive = null; f(); }
}

function tick(dt) {
  const nowT = performance.now();
  fidget(nowT);
  for (const a of everyone()) {
    if (a.detour && nowT > a.detour.until && !a.path.length) endDetour(a);
    if (a.act === 'typing' && !a.hidden) {
      const cur = [...S.bubbles].find((b) => b.a === a && b.kind === 'tool');
      if (cur) cur.until = performance.now() + 1500; else speak(a, '', { kind: 'tool', cls: 'wb--tool', ms: 1500 });
    }
    if (!a.path.length) continue;
    const [tx, ty] = a.path[0]; const gx = tx * TP, gy = ty * TP;
    const dx = gx - a.px, dy = gy - a.py, dist = Math.hypot(dx, dy), step = WALK * (a.hurry ? 2 : 1) * TP * dt;   // 급하면 두 배 (결정 13)
    a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR.right : DIR.left) : (dy > 0 ? DIR.down : DIR.up);
    if (dist <= step) {
      a.px = gx; a.py = gy; a.x = tx; a.y = ty; a.path.shift();
      if (!a.path.length) { a.hurry = false; const f = a.onArrive; a.onArrive = null; f?.(); }
      if (a === S.boss) usePortal(a);
    } else { a.px += dx / dist * step; a.py += dy / dist * step; }
    // 걷기 동작은 없다 — 인형은 정지 자세로 미끄러져 간다 (컷리스트: 리깅·애니메이션 안 함)
  }
}

const everyone = () => [...S.actors.values(), S.boss].filter(Boolean);

/* ── 세상의 시계 → 자리 (W2) ── */

/** 광장 같은 넓은 자리는 사람마다 다른 칸을 준다. 막힌 칸이면 근처를 찾는다. */
function spreadIn(roomId, i) {
  const sc = S.map.scenes.village, r = sc.rooms[roomId]; if (!r) return null;
  const cand = [];
  for (let k = 0; k < 12; k++) cand.push([r.x + 1 + ((i * 5 + k * 3) % Math.max(1, r.w - 2)), r.y + 2 + ((i * 3 + k) % Math.max(1, r.h - 3))]);
  for (const [x, y] of cand) if (free(sc, x, y)) return { scene: 'village', x, y, dir: 'down' };
  return null;
}
function routinePlace(a, name, i) {
  if (name === 'plaza') return spreadIn('plaza', i) ?? a.home;
  return placeOf(name) ?? a.home;
}
/** 서버의 시계가 준 자리로 걸어간다. 재생 중인 방은 건드리지 않는다. 대표는 사람이라 움직이지 않는다. */
function applyWorld(w) {
  if (!S.map || !w?.actors || S.compare) return;   // 비교판은 아무도 안 움직인다
  let i = 0;
  for (const a of S.actors.values()) {
    const t = w.actors[a.key]; i += 1;
    if (!t) continue;
    a.act = t.act;
    if (R.team === a.team && R.events.length) continue;
    if (a.routine !== t.place) {
      a.routine = t.place;
      if (!a.detour) { const p = routinePlace(a, t.place, i); if (p) walkTo(a, p); }
    }
    const zzz = [...S.bubbles].find((b) => b.a === a && b.kind === 'zzz');
    if (t.act === 'sleep' && !zzz) speak(a, 'z z z', { kind: 'zzz', cls: 'wb--zzz', ms: 1e9 });
    if (t.act !== 'sleep' && zzz) removeBubble(zzz);
  }
  const el = $('wvClock');
  if (el) { const h = Math.floor(w.hour), m = Math.round((w.hour - h) * 60); el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${MODE_LABEL[w.mode] ?? w.mode}${w.debug ? ' (시험)' : ''}`; }
  const sel = $('wvHour'); if (sel && document.activeElement !== sel) sel.value = w.debug ? String(Math.round(w.hour)) : '';
}
export function onWorld(w) { S.world = w; applyWorld(w); }

/* ── 연출 (W3): 사건이 잠깐 자리를 바꾼다. 끝나면 시계가 정한 자리로 돌아간다 ── */

/** p 주변의 빈 칸 하나 — 같은 장면에서. i 로 자리를 나눠 여럿이 겹치지 않게. */
function nearFree(p, i = 0, radius = 2) {
  const sc = S.map.scenes[p.scene]; if (!sc) return null;
  const ring = [];
  for (let r = 1; r <= radius; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push([dx, dy]);
  const taken = new Set(everyone().map((a) => `${a.scene}:${a.x},${a.y}`));
  const cand = ring.filter(([dx, dy]) => free(sc, p.x + dx, p.y + dy) && !taken.has(`${p.scene}:${p.x + dx},${p.y + dy}`));
  if (!cand.length) return null;
  const [dx, dy] = cand[i % cand.length];
  return { scene: p.scene, x: p.x + dx, y: p.y + dy };
}
/** a 가 b 를 바라본다. */
function face(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  a.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? DIR.right : DIR.left) : (dy > 0 ? DIR.down : DIR.up);
}
/** 잠깐 다른 자리로 갔다가(ms) 시계가 정한 자리로 돌아온다. 도착하면 arrive() */
function detour(a, place, ms, arrive, { hurry = false } = {}) {
  if (!place) return;
  // 머무는 시간(ms)은 도착한 뒤부터 센다 — 성 반대편 게시판까지 걸어가는 데 걸리는 시간이 머무는 시간을 잡아먹지 않게.
  // 길이 없거나 너무 멀면 90초 뒤 포기한다.
  a.detour = { until: performance.now() + 90000 };
  a.hurry = hurry;   // 급한 사건(FAIL 도장·대표 부름·대표실 문 앞)은 두 배로 달린다 (결정 13). 도착하면 풀린다(tick).
  walkTo(a, place, () => { if (a.detour) { a.detour.until = performance.now() + ms; arrive?.(); } });
}
function endDetour(a) {
  if (!a.detour) return;
  a.detour = null;
  // 재생 중인 방은 시계가 아니라 재생의 기준 자리(자기 책상)로 돌아간다 — 밤에 낮 회의를 재생해도 집으로 가지 않게
  const replaying = R.team === a.team && R.events.length;
  const back = replaying ? a.home : routinePlace(a, a.routine ?? `${a.team}.desk.${a.id}`, 0);
  if (back) walkTo(a, back);
}
/** 회의 — 팀이 회의상 둘레에 모인다. */
function gather(team, ms = 25000) {
  const t = placeOf(`${team}.table`); if (!t) return;
  let i = 0;
  for (const a of S.actors.values()) if (a.team === team && !a.hidden) { const spot = nearFree(t, i++, 2); detour(a, spot, ms, () => face(a, t)); }
}
/** 살아 있는 느낌의 잔동작 — 근무 중 놀고 있는 사람 하나가 가끔 근처를 한 바퀴 돈다. 토큰 0. */
let fidgetAt = 0;
function fidget(now) {
  if (now < fidgetAt || S.compare) return;
  fidgetAt = now + 40000 + Math.random() * 50000;
  if (S.world?.mode !== 'work') return;
  const pool = [...S.actors.values()].filter((a) => !a.hidden && a.act === 'idle' && !a.detour && !a.path.length && !(R.team === a.team && R.events.length));
  if (!pool.length) return;
  const a = pool[Math.floor(Math.random() * pool.length)];
  const spot = nearFree({ scene: a.scene, x: a.x, y: a.y }, Math.floor(Math.random() * 8), 2);
  if (spot) detour(a, spot, 4000 + Math.random() * 5000);
}

/** 댄이 포탈 칸에 올라섰다 — 건너편에 나타나고 화면도 따라간다. */
function usePortal(a) {
  const p = sceneOf(a).portals.find((o) => o.x === a.x && o.y === a.y);
  if (!p) return;
  const to = placeOf(p.to); if (!to) return;
  teleport(a, to);
  if (S.cam || a === S.boss) { if (to.scene !== S.scene) setScene(to.scene); lookAt(a, true); }
}

/** 이동 목록에서 골랐다. 댄이 그 자리로 가고 화면이 따라간다. */
function goTo(name) {
  const p = placeOf(name); if (!p) return;
  const b = S.boss;
  b.controlled = performance.now();
  if (p.scene === b.scene) { walkTo(b, p); if (S.cam) lookAt(b, true); }
  else { teleport(b, p); setScene(p.scene); lookAt(b, true); }
  toast(`${LABEL(name)}(으)로 갑니다.`, 2000);
}
const LABEL = (name) => {
  const m = S.map.labels ?? {};
  const [a, b, c] = name.split('.');
  if (name === 'plaza') return '광장'; if (a === 'cafe') return `찻집 ${b === 'seat' ? c : ''}번 자리`;   // 세계관 문서가 찻집이라 부른다(하영 3-3)
  if (name === 'village.gate') return '성문 앞'; if (name === 'castle.entrance') return '회사 정문';
  if (name === 'home.boss') return '댄의 집'; if (name === 'boss.desk') return '대표 집무실';
  if (name === 'hq.board') return '총괄실 게시판'; if (name === 'hq.bossdoor') return '총괄실 안쪽 문';
  if (a === 'home') { const who = S.actors.get(`${b}:${c}`); return `${who?.name ?? c}의 집`; }
  if (b === 'door') return `${m[a] ?? a} 사무실 앞`;
  if (b === 'desk') { const who = S.actors.get(`${a}:${c}`); return `${who?.name ?? c}의 자리`; }
  return name;
};

/* ── 그리기 — draw3d.js 에 자리·방향·보이기만 넘긴다. 앞뒤 정렬·그림자는 3D 라 저절로. ── */

function render() {
  for (const a of everyone()) S.gl.updateActor(a);
  // 세상의 시각 — 밤엔 어둡고 저녁엔 붉다. 마을이 시계를 따른다는 것이 한눈에 보이게.
  const mode = R.team && R.events.length && R.hour != null ? modeOfHour(R.hour) : S.world?.mode;
  S.gl.render(mode);
}

function frame(t) {
  S.raf = requestAnimationFrame(frame);
  const dt = clamp((t - S.last) / 1000 || 0, 0, 0.1); S.last = t;
  tick(dt); expireBubbles(); render();
}

/* ── 말풍선 — 사람 머리 위 기둥(a.tag, CSS2D)에 쌓인다. 자리는 3D 가 옮기고 여기는 만들고 지우기만. ──
   긴 말은 풍선 하나로 키우지 않고 만화처럼 쪼갠다(대표 원문 R25 "줄바꿈, 한 박스에 표현할 내용이 너무 많으면 박스를 여러개로") —
   문장 단위로 PIECE 자 안팎씩 묶어 PACE 마다 하나씩 띄운다. 기둥에는 셋까지, 넘치면 오래된 것부터 진다.
   조각은 PIECES 까지 — 그 뒤는 '…' 로 접고 ↗ 로 작전실에서 읽는다. 쪼개는 규칙은 speech.js(순수 — check 가 돌린다). */
const PACE = 2400;

function speak(a, text, { kind = 'say', who = a.name, cls = '', ms, id = null, team = a.team } = {}) {
  const full = String(text ?? '').trim();
  if (!full && kind !== 'tool') return null;
  if (kind !== 'say') return bubble(a, full, { kind, who, cls, ms, id, team });
  // 같은 말이 여러 방에 한꺼번에 기록되면(대표 원문 배달 — hq·design·dev 셋) 같은 사람 머리 위에 똑같은 풍선이 셋 쌓였다(대표 사진, R25). 1분 안 같은 말은 한 번만.
  const now = performance.now();
  if (a.lastFull === full && now - (a.lastFullAt ?? -1e9) < 60000) return null;
  a.lastFull = full; a.lastFullAt = now;
  a.queue = splitSpeech(full).map((p) => ({ text: p, who, cls, id, team }));   // 앞 말이 남아 있어도 새 말이 이긴다 — 한 사람의 큐는 하나
  a.nextAt = now;
  drainSpeech(a);
  return null;
}
/** 큐에서 조각 하나 — 프레임마다(expireBubbles) 불려 PACE 마다 하나씩 띄운다 */
function drainSpeech(a) {
  if (!a.queue?.length || performance.now() < a.nextAt) return;
  const p = a.queue.shift();
  bubble(a, p.text, { kind: 'say', who: p.who, cls: p.cls, id: p.id, team: p.team });
  a.nextAt = performance.now() + PACE;
  if (a.queue.length) S.speaking.add(a); else a.queue = null;
}

function bubble(a, text, { kind = 'say', who = a.name, cls = '', ms, id = null, team = a.team } = {}) {
  const el = document.createElement('div'); el.className = `wb ${cls}`;
  if (kind !== 'tool') { const w = document.createElement('span'); w.className = 'wb__who'; w.textContent = who; el.appendChild(w); }
  const body = document.createElement('span'); body.textContent = kind === 'tool' ? '⌨ 작업 중' : text; el.appendChild(body);
  if (id && team && S.jump) {                       // 기록된 발언이면 작전실의 그 자리로 건너갈 수 있다 (W3)
    const go = document.createElement('button'); go.type = 'button'; go.className = 'wb__go'; go.textContent = '↗'; go.title = '작전실에서 보기';
    go.addEventListener('click', (ev) => { ev.stopPropagation(); S.jump(team, id); });
    el.appendChild(go);
  }
  const b = { el, a, kind, until: performance.now() + (ms ?? clamp(3000 + text.length * 70, 4000, 14000)) };
  el.addEventListener('click', () => { b.until = performance.now() + 12000; });   // 누르면 좀 더 머문다
  const mine = [...S.bubbles].filter((o) => o.a === a && o.kind !== 'tool');
  while (mine.length >= 3) removeBubble(mine.shift());          // 한 사람에 최대 셋
  S.bubbles.add(b);
  if (a.tag) a.tag.insertBefore(el, a.nameEl); else el.remove();   // 이름표 바로 위, 새 말이 머리에 가깝게
  a.lastSpoke = performance.now();
  if (S.cam && kind !== 'tool' && kind !== 'zzz') lookAt(a);
  return b;
}
function removeBubble(b) {
  S.bubbles.delete(b); b.el.classList.add('wb--gone'); setTimeout(() => b.el.remove(), 260);
}
function expireBubbles() {
  const now = performance.now();
  for (const b of S.bubbles) if (now > b.until) removeBubble(b);
  for (const a of S.speaking) { drainSpeech(a); if (!a.queue) S.speaking.delete(a); }
}
function clearBubbles(team) {
  for (const b of [...S.bubbles]) if (!team || b.a.team === team) removeBubble(b);
  for (const a of S.speaking) if (!team || a.team === team) { a.queue = null; S.speaking.delete(a); }
}

/** 방 위에 띄우는 띠 — round_start/end·note·system 발언 */
function roomOf(id) {
  for (const [name, sc] of Object.entries(S.map.scenes)) if (sc.rooms[id]) return [name, sc.rooms[id]];
  return [null, null];
}
function banner(team, text) {
  const [scene, r] = roomOf(team); if (!r || !text) return;
  // 장면 이름은 scenes 의 키다 — 전엔 sc.name(없는 값)을 봐서 띠가 한 번도 안 떴다 (M5 에서 발견)
  if (scene !== S.scene) { if (!S.cam) return; setScene(scene); }   // 다른 장면의 띠는 카메라가 따라갈 때만
  const el = document.createElement('div'); el.className = 'wv-banner';
  el.textContent = String(text).length > 60 ? String(text).slice(0, 60) + '…' : text;
  S.gl.banner(scene, r.x + r.w / 2, r.y + 1.5, el, 5000);
}

function lookAt(a, force = false) {
  if (a.scene !== S.scene) { if (!S.cam && !force) return; setScene(a.scene); force = true; }
  S.gl.lookAt(a, force);
}

function toast(text, ms = 3500) {
  const el = $('wvToast'); el.textContent = text; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

/* ── 사건 → 연출 ── */

const actorFor = (team, id) => S.actors.get(`${team}:${id}`) ?? null;

function handle(team, e) {
  if (S.compare) return;   // 비교판 — 사건 연출 없음(유니티 판과 같은 정지 그림)
  const P = S.map.places;
  switch (e.type) {
    case 'message': {
      if (e.actor === 'boss') {
        const b = S.boss;
        // 대표가 직접 움직이고 있으면 그 자리에서 말한다. 아니면 그 방 문(총괄실은 대표실 문)에 나타난다.
        if (!b.controlled || performance.now() - b.controlled > 10 * 60 * 1000) teleport(b, P[team === 'hq' ? 'hq.bossdoor' : `${team}.door`] ?? P['boss.desk']);
        speak(b, e.text, { cls: 'wb--boss', id: e.id, team });
        return;
      }
      if (e.actor === 'system') { banner(team, e.text); return; }
      const a = actorFor(team, e.actor); if (!a) return;
      if (a.hidden) teleport(a, a.home);
      // 대표가 마을에서 말을 건 사람이 답한다 — 다가와서 대표를 보고 말한다 (W3)
      const tt = S.talkTarget;
      if (tt && tt.key === a.key && performance.now() - tt.at < 4 * 60 * 1000 && a.scene === S.boss.scene) {
        S.talkTarget = null;
        const spot = nearFree({ scene: S.boss.scene, x: S.boss.x, y: S.boss.y }, 0, 1);
        detour(a, spot, 20000, () => { face(a, S.boss); speak(a, e.text, { id: e.id }); }, { hurry: true });   // 대표가 불렀다 — 달린다
        return;
      }
      // 호명이면 상대를 바라본다
      const m = /^\s*([^,，\s]{1,12})\s*[,，]/.exec(String(e.text ?? ''));
      const to = m ? [...S.actors.values()].find((x) => x.team === team && x.name === m[1]) : null;
      if (to && to.scene === a.scene) face(a, to);
      speak(a, e.text, { id: e.id });
      return;
    }
    case 'verdict': {
      const a = actorFor(team, e.actor); if (!a) return;
      const v = e.meta?.verdict ?? '';
      if (a.hidden) teleport(a, a.home);
      // 감사역이 판정 대상의 자리로 걸어가 도장을 찍는다 (W3). 대상은 실무(guide)다.
      const target = e.meta?.target && actorFor(team, e.meta.target) || actorFor(team, 'guide');
      const say = () => speak(a, e.text || v, { cls: `wb--verdict wb--${v}`, who: `${a.name} · ${v || '판정'}`, id: e.id });
      if (v === 'FAIL') { S.failAt[team] = performance.now() + 60000; lamp(team, true); setTimeout(() => { if (!S.blocked.has(team)) lamp(team, false); }, 60000); }
      if (target && target !== a && target.scene === a.scene && !target.hidden) {
        const spot = nearFree({ scene: target.scene, x: target.x, y: target.y }, 0, 1);
        detour(a, spot, 12000, () => { face(a, target); face(target, a); say(); }, { hurry: v === 'FAIL' });   // FAIL 도장은 달려가서
      } else say();
      return;
    }
    case 'tool': {
      const a = actorFor(team, e.actor); if (!a || a.hidden) return;
      const cur = [...S.bubbles].find((b) => b.a === a && b.kind === 'tool');
      if (cur) cur.until = performance.now() + 1500;
      else speak(a, '', { kind: 'tool', cls: 'wb--tool', ms: 1500 });
      return;
    }
    case 'enter': {
      const name = String(e.text ?? '').replace(/\s*님이 들어왔습니다.*$/, '').trim();
      const a = [...S.actors.values()].find((x) => x.team === team && x.name === name);
      if (!a) return;
      const door = P[`${team}.door`]; if (door) { teleport(a, door); walkTo(a, a.home); }
      return;
    }
    case 'round_start':
      banner(team, e.text);
      if (!S.blocked.has(team)) lamp(team, false);
      gather(team);                                   // 회의상으로 모인다 (W3)
      return;
    case 'round_end':
      banner(team, e.text);
      for (const a of S.actors.values()) if (a.team === team) endDetour(a);
      return;
    case 'note':
      banner(team, e.text);
      if (e.meta?.approval) approvalScene(team, e);   // 게시판 (W3)
      return;
    default:
  }
}

/* ── 재생 ── */

function status(t) { $('wvStatus').textContent = t; }

/** 도구막대의 팀·라운드 선택기를 지금 재생하는 것에 맞춘다. 목록에 없는 라운드(픽스처)는 항목을 만들어 넣는다. */
function syncPicker(team, round) {
  const ts = $('wvTeam'); if (ts && [...ts.options].some((o) => o.value === team)) ts.value = team;
  const sel = $('wvRound'); if (!sel || round == null) return;
  if (![...sel.options].some((o) => o.value === String(round))) {
    const o = document.createElement('option'); o.value = String(round); o.textContent = `R${round} · 재생 중`; sel.prepend(o);
  }
  sel.value = String(round);
}

async function loadRounds(team) {
  const sel = $('wvRound'); sel.replaceChildren();
  const r = await fetch(`/api/team?team=${encodeURIComponent(team)}`).then((x) => x.json()).catch(() => ({}));
  for (const rd of r.rounds ?? []) {
    const o = document.createElement('option'); o.value = rd.round;
    o.textContent = `R${rd.round} · ${rd.topic ?? ''}${rd.verdict ? ` · ${rd.verdict}` : ''}`;
    sel.appendChild(o);
  }
  if (!sel.options.length) { const o = document.createElement('option'); o.value = ''; o.textContent = '라운드 없음'; sel.appendChild(o); }
}

async function play() {
  const team = $('wvTeam').value, round = Number($('wvRound').value);
  if (!team || !round) return toast('다시 볼 회차가 없어요.');
  const r = await fetch(`/api/log?team=${encodeURIComponent(team)}&round=${round}`).then((x) => x.json()).catch(() => ({}));
  if (!r.events?.length) return toast('그 회차엔 기록이 없어요.');
  replay(team, r.events, round);
}
/** 사건 목록을 그 방에서 재생한다. 화면의 재생 버튼도, 바깥(예: 작전실의 "마을에서 보기")도 이걸 부른다. */
export function replay(team, events, round = events[0]?.round ?? null) {
  if (!S.map || !events?.length) return;
  stop(true);
  R.team = team; R.round = round; R.events = [...events]; R.i = 0; R.playing = true; R.held = [];
  syncPicker(team, round);
  for (const a of S.actors.values()) if (a.team === team) teleport(a, a.home);
  clearBubbles(team);
  $('wvPlay').textContent = '잠깐 멈춤'; $('wvStop').hidden = false;
  const [scene, room] = roomOf(team);
  if (room && S.cam) { if (scene !== S.scene) setScene(scene); S.gl.lookAtXZ(room.x + room.w / 2, room.y + room.h / 2); }   // 그 방 가운데로 (전엔 sc.name 이 없는 값이라 장면이 안 바뀌었다)
  step();
}
function step() {
  if (!R.playing) return;
  if (R.i >= R.events.length) { status(`재생 끝 · R${R.round}`); stop(); return; }
  const e = R.events[R.i++];
  R.hour = e.ts ? new Date(e.ts).getHours() + new Date(e.ts).getMinutes() / 60 : null;
  handle(R.team, e);
  status(`재생 ${R.i}/${R.events.length}`);
  const nxt = R.events[R.i];
  if (!nxt) { R.timer = setTimeout(step, 2000); return; }
  const gap = new Date(nxt.ts) - new Date(e.ts);
  const base = nxt.type === 'tool' ? 250 : 1000;
  R.timer = setTimeout(step, clamp(gap, base, 2600) / R.speed);
}
function pause() {
  if (!R.events.length) return;
  R.playing = !R.playing;
  clearTimeout(R.timer);
  $('wvPlay').textContent = R.playing ? '잠깐 멈춤' : '이어서';
  if (R.playing) step();
}
function stop(quiet) {
  clearTimeout(R.timer); R.playing = false; R.events = []; R.i = 0; R.hour = null;
  const team = R.team, held = R.held; R.team = null; R.held = [];
  $('wvPlay').textContent = '재생'; $('wvStop').hidden = true;
  if (!quiet) status('');
  // 재생하는 동안 이 방에 실제로 오간 말 — 이제 들려준다
  if (team && held.length) { for (const e of held) handle(team, e); status(`재생 중 도착한 실시간 사건 ${held.length}건을 이어서 보여줍니다`); }
}

/* ── 대표 조작 ── */

function nearest(b, within) {
  let best = null, bd = Infinity;
  for (const a of S.actors.values()) {
    if (a.hidden || a.scene !== b.scene) continue;
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (d <= within && d < bd) { best = a; bd = d; }
  }
  return best;
}
const KEYS = {
  ArrowUp: [0, -1, 'up'], ArrowDown: [0, 1, 'down'], ArrowLeft: [-1, 0, 'left'], ArrowRight: [1, 0, 'right'],
  w: [0, -1, 'up'], s: [0, 1, 'down'], a: [-1, 0, 'left'], d: [1, 0, 'right'],
};
let talkTo = null;
function onKey(ev) {
  if (!S.open || !S.map || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const tag = ev.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const b = S.boss, m = KEYS[ev.key];
  if (m) {
    ev.preventDefault();
    b.controlled = performance.now(); b.dir = DIR[m[2]];
    if (b.path.length > 1) return;
    const [lx, ly] = b.path.length ? b.path[b.path.length - 1] : [b.x, b.y];
    const nx = lx + m[0], ny = ly + m[1];
    if (free(sceneOf(b), nx, ny)) b.path.push([nx, ny]);
    if (S.cam) lookAt(b);
    return;
  }
  if (ev.key === 'Enter') {
    ev.preventDefault();
    const a = nearest(b, 2);
    if (!a) return toast('방향키로 누군가의 옆까지 가서 Enter 를 누르세요.');
    openTalk(a);
  }
  if (ev.key === 'Escape') { closeTalk(); closeCard(); }
}
function openTalk(a) {
  talkTo = a;
  face(a, S.boss);
  const f = $('wvTalk'), i = $('wvTalkIn');
  f.hidden = false; i.value = `${a.name}, `; i.placeholder = `${a.name}에게`; i.focus();
  i.setSelectionRange(i.value.length, i.value.length);
  if (S.boss.dir !== undefined) S.boss.dir = a.x > S.boss.x ? DIR.right : a.x < S.boss.x ? DIR.left : a.y < S.boss.y ? DIR.up : DIR.down;
}
function closeTalk() { $('wvTalk').hidden = true; talkTo = null; }
async function submitTalk(ev) {
  ev.preventDefault();
  const a = talkTo, text = $('wvTalkIn').value.trim();
  if (!a || !text) return closeTalk();
  const r = await fetch('/api/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team: a.team, text }) })
    .then(async (x) => ({ ok: x.ok, data: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, data: {} }));
  if (r.ok) { S.talkTarget = { key: a.key, at: performance.now() }; toast(`${a.name}에게 전했습니다. 답은 여기와 작전실에 같이 뜹니다.`); }
  else toast(r.data.needsRound ? `${a.team} 방 회차를 먼저 시작하세요.` : (r.data.error ?? '전하지 못했어요.'), 5000);
  closeTalk();
}

/* ── 승인 게시판 (W3) — 요청자는 총괄실 게시판에 두루마리를 붙이고, 통과·반려는 톰이 게시판 앞에서 도장을 찍는다 ── */

function approvalScene(team, e) {
  const board = placeOf('hq.board'); if (!board) return;
  const text = String(e.text ?? ''), status = e.meta?.status ?? null;
  if (e.actor !== 'system' && /^승인 요청/.test(text)) {
    const a = actorFor(team, e.actor); if (!a || a.hidden || a.scene !== board.scene) return;
    detour(a, nearFree(board, 0, 1), 15000, () => { a.dir = DIR.up; speak(a, text, { id: e.id, team }); });
    return;
  }
  if (!status) return;
  const tom = actorFor('hq', 'chief'); if (!tom || tom.hidden || tom.scene !== board.scene) return;
  const v = status === 'passed' ? 'PASS' : status === 'revised' ? 'FAIL' : '';   // 큐의 상태값: pending·passed·revised(반려)·void
  detour(tom, nearFree(board, 1, 1), 10000, () => { tom.dir = DIR.up; speak(tom, text, { cls: v ? `wb--verdict wb--${v}` : '', who: `${tom.name} · 게시판`, id: e.id, team }); });
}

/* ── FAIL 램프와 대표실 문 앞 대기 (W3) — 방 상태(phase)는 사건이 아니라 요약으로 온다 ── */

function lamp(team, on) {
  if (on) S.lamps.add(team); else S.lamps.delete(team);
  S.gl?.roomEls[team]?.classList.toggle('wv-room--fail', on);
}
function setBlocked(team, on) {
  const was = S.blocked.has(team);
  if (on) S.blocked.add(team); else S.blocked.delete(team);
  lamp(team, on || (S.failAt[team] ?? 0) > performance.now());
  const g = actorFor(team, 'guide'), door = placeOf('hq.bossdoor');
  if (!g || !door) return;
  if (on) { if ((!was || !g.detour) && g.scene === door.scene && !g.hidden) detour(g, nearFree(door, 0, 1), 10 * 60 * 1000, () => { g.dir = DIR.right; }, { hurry: true }); }   // 막혔다 — 대표실 문 앞으로 달린다
  else if (was) endDetour(g);
}

/* ── 캐릭터 카드 — 누구인가·어제·최근 발언 (W3) ── */

/** 클릭한 화면 좌표(CSS px)에 선 캐릭터 — 발과 머리를 화면에 비춰 그 사이면 맞은 것. 앞(남쪽)에 선 사람이 이긴다. 댄은 카드가 없다. */
function actorAt(cx, cy) {
  const hits = [];
  for (const a of everyone()) {
    if (a.key === 'boss' || a.scene !== S.scene || a.hidden) continue;
    const s = S.gl.project(a); if (!s) continue;
    const half = Math.max(10, s.ppu * 0.45);
    if (cx >= s.foot.x - half && cx <= s.foot.x + half && cy >= s.head.y - 6 && cy <= s.foot.y + 4) hits.push(a);
  }
  return hits.sort((p, q) => q.py - p.py)[0] ?? null;
}
function onStageClick(cx, cy) {
  const a = actorAt(cx, cy);
  if (a) openCard(a); else closeCard();
}
const ACT_LABEL = { typing: '일하는 중', sleep: '자는 중', idle: '듣는 중', talking: '말하는 중', walking: '걷는 중' };   // 하영 3-3 — "일하는 중" 은 관제탑 알약과 같은 글자
let cardKey = null;
async function openCard(a) {
  const box = $('wvCard'); cardKey = a.key;
  box.hidden = false; box.replaceChildren(node('div', 'wc__sec', `${a.name} — 불러오는 중…`));
  let r;
  try { r = await fetch(`/api/actor?team=${encodeURIComponent(a.team)}&actor=${encodeURIComponent(a.id)}`).then((x) => x.json()); }
  catch { r = null; }
  if (cardKey !== a.key) return;                    // 그새 다른 사람을 눌렀다
  box.replaceChildren();
  if (!r || r.error) { box.appendChild(node('div', 'wc__sec', r?.error ?? '카드를 못 불러왔어요.')); return; }
  const team = S.teams.find((t) => t.id === a.team);
  const head = node('div', 'wc__head');
  const av = node('span', 'wc__av'); av.style.background = r.color ?? a.color ?? '#888'; head.appendChild(av);
  const nm = node('div'); nm.appendChild(node('div', 'wc__name', r.name));
  nm.appendChild(node('div', 'wc__sub', [r.persona?.title?.split(' — ')[1] ?? r.title ?? a.id, team?.room ?? team?.name ?? a.team, r.model === 'gpt' ? '다른 회사 모델' : null].filter(Boolean).join(' · ')));
  head.appendChild(nm);
  const x = node('button', 'wc__x', '×'); x.type = 'button'; x.title = '닫기'; x.addEventListener('click', closeCard); head.appendChild(x);
  box.appendChild(head);

  // 지금
  const w = r.world ?? S.world?.actors?.[a.key] ?? null;
  const st = r.status ?? {};
  const now = [w?.place ? `${LABEL(w.place)}에서` : null, st.busy ? '말하는 중' : (ACT_LABEL[w?.act] ?? (st.alive ? '듣는 중' : st.engine && st.engine !== 'claude' ? '부르면 와요' : '자리 비움'))].filter(Boolean).join(' ');
  const s0 = node('div', 'wc__sec'); s0.appendChild(node('div', 'wc__h', '지금')); s0.appendChild(node('div', 'wc__state', now || '—')); box.appendChild(s0);

  // 누구
  const s1 = node('div', 'wc__sec'); s1.appendChild(node('div', 'wc__h', '누구'));
  if (r.persona?.identity) s1.appendChild(node('p', 'wc__p', r.persona.identity));
  if (r.persona?.who) {
    for (const para of r.persona.who.split(/\n{2,}/)) {
      const lines = para.split('\n');
      if (lines.every((l) => /^\s{4}/.test(l))) for (const l of lines) s1.appendChild(node('div', 'wc__q', l.trim()));
      else s1.appendChild(node('p', 'wc__p', para.replace(/\*\*/g, '')));
    }
  } else if (!r.persona?.identity) s1.appendChild(node('div', 'wc__empty', '캐릭터 설정이 아직 없어요 — 대표님이 정해요.'));
  box.appendChild(s1);

  // 어제 — 일지 맨 위 문단. 첫 문장("나는 …")이 한 줄로 먼저(결정 13), 나머지는 그 아래.
  const s2 = node('div', 'wc__sec'); s2.appendChild(node('div', 'wc__h', r.journal ? `어제 · 일지 ${r.journal.total}문단 중 최근` : '어제'));
  if (r.journal?.latest) {
    const [h, ...rest] = r.journal.latest.split('\n');
    s2.appendChild(node('div', 'wc__state', h.replace(/^## /, '')));
    const body = rest.join('\n').trim();
    const flat = body.replace(/\s+/g, ' ');
    if (r.journal.first && flat.startsWith(r.journal.first)) {
      s2.appendChild(node('div', 'wc__first', r.journal.first));
      const tail = flat.slice(r.journal.first.length).trim();
      if (tail) s2.appendChild(node('p', 'wc__p', tail));
    } else s2.appendChild(node('p', 'wc__p', body));
  } else s2.appendChild(node('div', 'wc__empty', '아직 회차를 끝낸 적이 없어요.'));
  box.appendChild(s2);

  // 최근 발언 — 누르면 작전실의 그 자리로
  const s3 = node('div', 'wc__sec'); s3.appendChild(node('div', 'wc__h', '최근에 한 말'));
  if (r.recent?.length) {
    for (const m of [...r.recent].reverse()) {
      const b = node('button', 'wc__msg'); b.type = 'button';
      const t = new Date(m.ts); b.appendChild(node('span', 'wc__t', `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}${m.round ? ' R' + m.round : ''}`));
      if (m.verdict) { const v = node('span', 'wc__v', m.verdict); v.dataset.v = m.verdict; b.appendChild(v); }
      b.appendChild(document.createTextNode(m.text.length > 90 ? m.text.slice(0, 90) + '…' : m.text));
      b.addEventListener('click', () => S.jump?.(a.team, m.id));
      s3.appendChild(b);
    }
  } else s3.appendChild(node('div', 'wc__empty', '아직 한 말이 없어요.'));
  box.appendChild(s3);

  const foot = node('div', 'wc__foot');
  const talk = node('button', 'primary', '말 걸기'); talk.type = 'button'; talk.addEventListener('click', () => { closeCard(); openTalk(a); }); foot.appendChild(talk);
  const room = node('button', null, '작전실로'); room.type = 'button'; room.addEventListener('click', () => S.jump?.(a.team, null)); foot.appendChild(room);
  box.appendChild(foot);
}
function closeCard() { const box = $('wvCard'); if (box) { box.hidden = true; box.replaceChildren(); } cardKey = null; }
function node(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

/* ── 도구막대 ── */

function initToolbar() {
  const ts = $('wvTeam'); ts.replaceChildren();
  for (const t of S.teams) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.room ?? t.name; ts.appendChild(o); }
  ts.value = S.teams.find((t) => t.id === 'marketing') ? 'marketing' : (S.teams[0]?.id ?? '');
  ts.addEventListener('change', () => loadRounds(ts.value));
  if (ts.value) loadRounds(ts.value);
  $('wvPlay').addEventListener('click', () => (R.events.length ? pause() : play()));
  $('wvStop').addEventListener('click', () => stop());
  $('wvSpeed').addEventListener('change', (e) => { R.speed = Number(e.target.value) || 1; });
  R.speed = Number($('wvSpeed').value) || 2;
  $('wvZoom').addEventListener('change', (e) => { S.z = Number(e.target.value) || 2; S.gl.setZoom(S.z); });   // 휠·핀치는 그 위에 MapControls 가 얹는다 (결정 13 의 줌)
  S.gl.setZoom(S.z = Number($('wvZoom').value) || 2);
  $('wvCam').addEventListener('change', (e) => { S.cam = e.target.checked; });
  $('wvHour')?.addEventListener('change', (e) => {
    fetch('/api/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ debugHour: e.target.value === '' ? null : Number(e.target.value) }) })
      .then((r) => r.json()).then((r) => { if (r.world) onWorld(r.world); }).catch(() => toast('시각을 바꾸지 못했습니다.'));
  });
  $('wvTalk').addEventListener('submit', submitTalk);
  $('wvTalkX').addEventListener('click', closeTalk);
  // 장면 전환과 이동 목록
  for (const b of $('wvScene').querySelectorAll('button')) b.addEventListener('click', () => { setScene(b.dataset.scene); });
  const go = $('wvGo'); go.replaceChildren();
  const group = (label, names) => {
    const g = document.createElement('optgroup'); g.label = label;
    for (const n of names) { if (!placeOf(n)) continue; const o = document.createElement('option'); o.value = n; o.textContent = LABEL(n); g.appendChild(o); }
    if (g.children.length) go.appendChild(g);
  };
  const P = S.map.places;
  group('회사', ['castle.entrance', 'boss.desk', 'hq.board', ...S.teams.filter((t) => t.id !== 'hq').map((t) => `${t.id}.door`)]);
  group('마을', ['village.gate', 'plaza', 'cafe.seat.1', 'home.boss']);
  group('집', Object.keys(P).filter((n) => n.startsWith('home.') && n !== 'home.boss'));
  $('wvGoBtn').addEventListener('click', () => goTo(go.value));
  go.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goTo(go.value); } });
  // 서랍(결정 105) — 다시 보기·속도·배율·따라가기·시험용 시각은 눌러야 열린다. 처음 들어온 사람은 마을만 본다.
  const more = $('wvMore'), drawer = $('wvDrawer');
  if (more && drawer) more.addEventListener('click', () => { const open = drawer.hidden; drawer.hidden = !open; more.setAttribute('aria-expanded', String(open)); more.textContent = open ? '접기' : '더 보기'; });
}

/* ── 바깥에서 부르는 것 ── */

/** 마을 탭이 열렸다. 처음이면 지도·시트·캐스트를 읽는다. */
export async function open({ teams, jump } = {}) {
  S.open = true;
  if (teams) S.teams = teams;
  if (jump) S.jump = jump;
  if (!S.ready) S.ready = load().catch((e) => { S.ready = null; status(`마을을 못 불러왔습니다 — ${e.message}`); throw e; });
  await S.ready;
  if (!S.open) return;
  if (!S.raf) { S.last = performance.now(); S.raf = requestAnimationFrame(frame); }
  if (S.summaries) onSummaries(S.summaries);        // 열기 전에 온 방 상태(blocked)를 지금 반영한다
  // 검증용: ?fixture=marketing-r14 로 열면 fixtures/ 의 사건 배열을 그 방에서 재생한다 (통과 조건 "R14 재생" 을 누구나 재현)
  const fx = new URLSearchParams(location.search).get('fixture');
  if (fx && !S.fixtureDone) {
    S.fixtureDone = true;
    fetch(`/world/fixtures/${encodeURIComponent(fx)}.json`).then((r) => r.json())
      .then((ev) => { const team = ev[0]?.team; if (team) replay(team, ev, ev[0]?.round ?? null); })
      .catch(() => status('픽스처를 못 읽었습니다'));
  }
}
export function close() {
  S.open = false;
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  closeTalk(); closeCard();
}
/** 소켓으로 온 새 사건. 탭이 열려 있을 때만 연출한다 — 닫혀 있으면 대화록이 기록이고, 다시 열면 모두 자리에 있다. */
export function onEvents(team, events) {
  if (!S.open || !S.map) return;
  // 재생 중인 방의 실시간 사건은 버리지 않고 모아 둔다 — 재생이 끝나면 그때 연출한다 (레오 W1 감사)
  if (R.team === team && R.events.length) { R.held.push(...events); return; }
  for (const e of events) handle(team, e);
}
/** 방 요약 — 자리 상태는 world 메시지로 오고(onWorld), 여기서는 phase 만 본다: blocked 면 램프와 문 앞 대기. */
export function onSummaries(summaries) {
  S.summaries = summaries ?? null;
  if (!S.map) return;
  for (const [team, s] of Object.entries(summaries ?? {})) if (roomOf(team)[1]) setBlocked(team, s?.phase === 'blocked');
}
/** 시험용 — 장면·자리·말풍선 수. 화면을 보지 않고도 재생이 맞는지 확인할 수 있다. */
export function snapshot() {
  return {
    scene: S.scene,
    actors: everyone().map((a) => ({ key: a.key, name: a.name, scene: a.scene, x: a.x, y: a.y, hidden: a.hidden, walking: a.path.length > 0, routine: a.routine ?? null, act: a.act ?? null })),
    draw: S.gl ? S.gl.stats() : null,               // 그림 엔진 — three · glb 몇 개 왔고 몇 개 못 왔나 · 아직 상자인 부품 수
    pathfinder: pathfinder(),                        // easystar(CDN 이 왔을 때) 또는 bfs
    bubbles: [...S.bubbles].map((b) => ({ who: b.a.key, kind: b.kind, text: b.el.textContent.slice(0, 40) })),
    replay: { team: R.team, round: R.round, i: R.i, n: R.events.length, playing: R.playing },
    world: S.world ? { hour: S.world.hour, mode: S.world.mode, debug: S.world.debug } : null,
  };
}
