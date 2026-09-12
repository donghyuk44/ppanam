// 마을 — 대화록의 시각화.
//
// 캐릭터가 어디 있고 무엇을 하는지는 기록된 사건(message·verdict·tool·enter…)과 지도의 자리 표에서만 나온다.
// LLM 이 좌표를 정하는 채널은 없다. 그림은 캔버스가, 글(말풍선·이름표)은 DOM 이 맡는다.
// 대표(댄)만 사람이라 방향키로 움직이고, 옆 사람에게 Enter 로 말을 건다 — 그 말은 작전실과 같은 /api/say 로 간다.
// 장면은 둘이다: 마을(village) 과 회사(castle, 성 안). 포탈(성문·정문)로 오가고, "어디로" 목록으로 바로 간다.

const $ = (id) => document.getElementById(id);
const T = 16;                                      // 타일 한 변(px)
const DIR = { down: 0, left: 1, up: 2, right: 3 }; // NPC_test.png 의 행 순서
const WALK = 4;                                    // 초당 걷는 칸 수
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const PAD = { x: 120, y: 110 };                    // 지도 둘레 여백(CSS px) — world.css 의 --pad-x/--pad-y 와 같다

const S = {
  open: false, ready: null, map: null, sheets: [], npc: null,
  z: 2, teams: [], casts: {}, actors: new Map(), boss: null,
  scene: 'castle', caches: {},                       // 보고 있는 장면, 장면별 정적 층 캐시
  canvas: null, ctx: null,
  bubbles: new Set(), cam: true, raf: 0, last: 0,
};
const cur = () => S.map.scenes[S.scene];             // 지금 보는 장면
const sceneOf = (a) => S.map.scenes[a.scene];
const placeOf = (name) => S.map.places[name] ?? null;
// 재생 상태. 한 번에 한 방만 재생한다. 그 방의 실시간 사건은 재생이 끝날 때까지 무시한다.
const R = { team: null, round: null, events: [], i: 0, timer: 0, playing: false, speed: 2, held: [] };   // held: 재생 중 도착한 같은 방의 실시간 사건

/* ── 불러오기 ── */

const loadImage = (src) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`못 읽음: ${src}`)); i.src = src;
});

/** 스프라이트를 캐스트 색으로 물들인다. 윤곽은 남고 몸만 색이 든다. */
function tint(img, color) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-atop'; x.globalAlpha = 0.55; x.fillStyle = color || '#8a8175';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function makeActor(team, id, a, home) {
  const act = {
    key: `${team}:${id}`, team, id, name: a.name ?? id, color: a.color, model: a.model, scene: home.scene,
    x: home.x, y: home.y, px: home.x * T, py: home.y * T, dir: DIR[home.dir ?? 'down'] ?? 0,
    frame: 0, animT: 0, path: [], onArrive: null, hidden: false, home, lastSpoke: 0,
    sprite: tint(S.npc, a.color),
  };
  S.actors.set(act.key, act);
  return act;
}

async function load() {
  const map = await fetch('/world/map.json').then((r) => r.json());
  const [sheets, npc] = await Promise.all([
    Promise.all(map.sheets.map((s) => loadImage('/world/' + s))),
    loadImage('/world/assets/zelda/NPC_test.png'),
  ]);
  S.map = map; S.sheets = sheets; S.npc = npc;

  const casts = await Promise.all(S.teams.map((t) =>
    fetch(`/api/team?team=${encodeURIComponent(t.id)}`).then((r) => r.json()).then((r) => [t.id, r.cast?.agents ?? {}]).catch(() => [t.id, {}])));
  S.casts = Object.fromEntries(casts);
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
    x: bd.x, y: bd.y, px: bd.x * T, py: bd.y * T, dir: DIR.down, frame: 0, animT: 0, path: [], onArrive: null,
    hidden: false, home: bd, lastSpoke: 0, controlled: 0, sprite: tint(npc, bc.color),
  };

  S.canvas = $('wvCanvas'); S.ctx = S.canvas.getContext('2d');
  initToolbar();
  setScene(bd.scene);
  window.addEventListener('keydown', onKey);
  lookAt(S.boss, true);
}

/** 장면을 바꾼다. 정적 층은 장면·배율마다 한 번만 그려 둔다. */
function setScene(name) {
  if (!S.map.scenes[name]) return;
  S.scene = name;
  rebuild();
  for (const b of $('wvScene').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.scene === name));
}

/* ── 정적 층은 한 번만 그려 둔다 ── */

function tileAt(v) {
  const n = v - 1;
  return [Math.floor(n / 10000), n % 100, Math.floor((n % 10000) / 100)];   // [시트, 열, 행]
}
function paintLayer(x, arr) {
  const { w, h } = cur(), z = S.z;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const v = arr[y * w + xx]; if (!v) continue;
    const [s, c, r] = tileAt(v);
    x.drawImage(S.sheets[s], c * T, r * T, T, T, xx * T * z, y * T * z, T * z, T * z);
  }
}
function layerCanvas(names) {
  const c = document.createElement('canvas'); c.width = cur().w * T * S.z; c.height = cur().h * T * S.z;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  for (const n of names) paintLayer(x, cur().layers[n]);
  return c;
}
function rebuild() {
  const { w, h } = cur(), z = S.z;
  S.canvas.width = w * T * z; S.canvas.height = h * T * z;
  S.ctx.imageSmoothingEnabled = false;
  $('wvInner').style.width = `${w * T * z + PAD.x * 2}px`; $('wvInner').style.height = `${h * T * z + PAD.y * 2}px`;
  for (const id of ['wvBubbles', 'wvLabels']) { const el = $(id); el.style.width = `${w * T * z}px`; el.style.height = `${h * T * z}px`; }
  const key = `${S.scene}@${z}`;
  if (!S.caches[key]) S.caches[key] = { bg: layerCanvas(['ground', 'deco', 'wall']), obj: layerCanvas(['objects']), over: layerCanvas(['over']) };
  Object.assign(S, S.caches[key]);
  buildLabels();
}

function buildLabels() {
  const box = $('wvLabels'); box.replaceChildren();
  const z = S.z;
  for (const [id, r] of Object.entries(cur().rooms)) {
    if (!r.label) continue;
    const el = document.createElement('div'); el.className = 'wv-room'; el.textContent = r.label;
    el.style.left = `${(r.x + r.w / 2) * T * z}px`; el.style.top = `${r.y * T * z + (id === 'plaza' || id === 'cafe' ? 14 * z : 4 * z)}px`;
    box.appendChild(el);
  }
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

function teleport(a, p) {
  a.path = []; a.onArrive = null; a.x = p.x; a.y = p.y; a.px = p.x * T; a.py = p.y * T; a.frame = 0; a.hidden = false;
  if (p.scene) a.scene = p.scene;
  if (p.dir) a.dir = DIR[p.dir];
}
/** 같은 장면 안에서만 걷는다. 다른 장면의 자리면 순간이동 — 장면 사이 이동 연출은 W2 의 루틴이 맡는다. */
function walkTo(a, p, done) {
  if (!p) return;
  a.hidden = false;
  const path = (p.scene && p.scene !== a.scene) ? null : bfs(sceneOf(a), { x: a.x, y: a.y }, p);
  if (!path) { teleport(a, p); done?.(); return; }
  a.path = path;
  a.onArrive = () => { if (p.dir) a.dir = DIR[p.dir]; done?.(); };
  if (!path.length) { const f = a.onArrive; a.onArrive = null; f(); }
}

function tick(dt) {
  for (const a of everyone()) {
    if (!a.path.length) continue;
    const [tx, ty] = a.path[0]; const gx = tx * T, gy = ty * T;
    const dx = gx - a.px, dy = gy - a.py, dist = Math.hypot(dx, dy), step = WALK * T * dt;
    a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR.right : DIR.left) : (dy > 0 ? DIR.down : DIR.up);
    if (dist <= step) {
      a.px = gx; a.py = gy; a.x = tx; a.y = ty; a.path.shift();
      if (!a.path.length) { a.frame = 0; const f = a.onArrive; a.onArrive = null; f?.(); }
      if (a === S.boss) usePortal(a);
    } else { a.px += dx / dist * step; a.py += dy / dist * step; }
    a.animT += dt; if (a.animT > 0.12) { a.animT = 0; a.frame = (a.frame + 1) % 4; }
  }
}

const everyone = () => [...S.actors.values(), S.boss].filter(Boolean);

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
  if (name === 'plaza') return '광장'; if (a === 'cafe') return `카페 ${b === 'seat' ? c : ''}번 자리`;
  if (name === 'village.gate') return '성문 앞'; if (name === 'castle.entrance') return '회사 정문';
  if (name === 'home.boss') return '댄의 집'; if (name === 'boss.desk') return '대표 집무실';
  if (name === 'hq.board') return '총괄실 게시판'; if (name === 'hq.bossdoor') return '총괄실 안쪽 문';
  if (a === 'home') { const who = S.actors.get(`${b}:${c}`); return `${who?.name ?? c}의 집`; }
  if (b === 'door') return `${m[a] ?? a} 사무실 앞`;
  if (b === 'desk') { const who = S.actors.get(`${a}:${c}`); return `${who?.name ?? c}의 자리`; }
  return name;
};

/* ── 그리기: 바닥 → (물건 줄, 그 줄에 발 딛은 사람) → 위층 → 이름표 ── */

function render() {
  const x = S.ctx, z = S.z, { w, h } = cur(), rowH = T * z;
  x.drawImage(S.bg, 0, 0);
  const list = everyone().filter((a) => !a.hidden && a.scene === S.scene).sort((a, b) => a.py - b.py);
  // 발밑 그림자 — 바닥에 붙어 보이게 한다
  x.fillStyle = '#00000038';
  for (const a of list) { x.beginPath(); x.ellipse((a.px + 8) * z, (a.py + 14) * z, 6 * z, 2.5 * z, 0, 0, Math.PI * 2); x.fill(); }
  let drawn = 0;
  const band = (to) => { if (to > drawn) { x.drawImage(S.obj, 0, drawn * rowH, w * rowH, (to - drawn) * rowH, 0, drawn * rowH, w * rowH, (to - drawn) * rowH); drawn = to; } };
  for (const a of list) {
    band(clamp(Math.floor((a.py + T / 2) / T), 0, h - 1) + 1);
    x.drawImage(a.sprite, a.frame * 16, a.dir * 32, 16, 32, Math.round(a.px * z), Math.round((a.py - 16) * z), 16 * z, 32 * z);
  }
  band(h);
  x.drawImage(S.over, 0, 0);
  x.font = `${z >= 3 ? 15 : 12}px Galmuri11, 'IBM Plex Sans KR', sans-serif`; x.textAlign = 'center'; x.textBaseline = 'bottom';
  x.lineWidth = 3; x.lineJoin = 'round'; x.strokeStyle = '#1c1a17cc';
  for (const a of list) {
    const tx = (a.px + 8) * z, ty = (a.py - 17) * z;
    x.strokeText(a.name, tx, ty); x.fillStyle = a === S.boss ? '#ffe28a' : '#fff'; x.fillText(a.name, tx, ty);
  }
}

function frame(t) {
  S.raf = requestAnimationFrame(frame);
  const dt = clamp((t - S.last) / 1000 || 0, 0, 0.1); S.last = t;
  tick(dt); render(); layoutBubbles();
}

/* ── 말풍선 ── */

function speak(a, text, { kind = 'say', who = a.name, cls = '', ms } = {}) {
  const full = String(text ?? '').trim();
  if (!full && kind !== 'tool') return null;
  const el = document.createElement('div'); el.className = `wb ${cls}`;
  if (kind !== 'tool') { const w = document.createElement('span'); w.className = 'wb__who'; w.textContent = who; el.appendChild(w); }
  const short = full.length > 80 ? full.slice(0, 80) + '…' : full;
  const body = document.createElement('span'); body.textContent = kind === 'tool' ? '⌨ 작업 중' : short; el.appendChild(body);
  const b = { el, a, kind, until: performance.now() + (ms ?? clamp(3000 + full.length * 70, 4000, 14000)), expanded: false };
  el.addEventListener('click', () => {
    b.expanded = !b.expanded; body.textContent = b.expanded ? full : short; el.classList.toggle('wb--full', b.expanded);
    b.until = performance.now() + (b.expanded ? 20000 : 4000);
  });
  const mine = [...S.bubbles].filter((o) => o.a === a && o.kind !== 'tool');
  while (mine.length >= 3) removeBubble(mine.shift());          // 한 사람에 최대 셋
  S.bubbles.add(b); $('wvBubbles').appendChild(el);
  a.lastSpoke = performance.now();
  if (S.cam && kind !== 'tool') lookAt(a);
  return b;
}
function removeBubble(b) {
  S.bubbles.delete(b); b.el.classList.add('wb--gone'); setTimeout(() => b.el.remove(), 260);
}
function layoutBubbles() {
  const z = S.z, now = performance.now(), by = new Map();
  for (const b of S.bubbles) {
    if (now > b.until) { removeBubble(b); continue; }
    if (!by.has(b.a)) by.set(b.a, []); by.get(b.a).push(b);
  }
  for (const [a, list] of by) {
    let off = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i].el;
      el.style.display = (a.hidden || a.scene !== S.scene) ? 'none' : '';
      el.style.left = `${(a.px + 8) * z}px`; el.style.top = `${(a.py - 26) * z - off}px`;
      off += el.offsetHeight + 8;
    }
  }
}
function clearBubbles(team) {
  for (const b of [...S.bubbles]) if (!team || b.a.team === team) removeBubble(b);
}

/** 방 위에 띄우는 띠 — round_start/end·note·system 발언 */
function roomOf(id) {
  for (const sc of Object.values(S.map.scenes)) if (sc.rooms[id]) return [sc, sc.rooms[id]];
  return [null, null];
}
function banner(team, text) {
  const [sc, r] = roomOf(team); if (!r || !text) return;
  if (sc.name !== S.scene && !(S.cam && setScene(sc.name))) return;   // 다른 장면의 띠는 카메라가 따라갈 때만
  const el = document.createElement('div'); el.className = 'wv-banner';
  el.textContent = String(text).length > 60 ? String(text).slice(0, 60) + '…' : text;
  el.style.left = `${(r.x + r.w / 2) * T * S.z}px`; el.style.top = `${(r.y + 3) * T * S.z}px`;
  $('wvLabels').appendChild(el);
  setTimeout(() => { el.classList.add('wb--gone'); setTimeout(() => el.remove(), 260); }, 5000);
}

function lookAt(a, force = false) {
  if (a.scene !== S.scene) { if (!S.cam && !force) return; setScene(a.scene); force = true; }
  const v = $('wvView'), z = S.z;
  const cx = (a.px + 8) * z + PAD.x, cy = a.py * z + PAD.y;
  const l = v.scrollLeft, t = v.scrollTop, W = v.clientWidth, H = v.clientHeight;
  if (!force && cx > l + 60 && cx < l + W - 60 && cy > t + 80 && cy < t + H - 40) return;
  v.scrollTo({ left: cx - W / 2, top: cy - H / 2, behavior: force ? 'auto' : 'smooth' });
}

function toast(text, ms = 3500) {
  const el = $('wvToast'); el.textContent = text; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

/* ── 사건 → 연출 ── */

const actorFor = (team, id) => S.actors.get(`${team}:${id}`) ?? null;

function handle(team, e) {
  const P = S.map.places;
  switch (e.type) {
    case 'message': {
      if (e.actor === 'boss') {
        const b = S.boss;
        // 대표가 직접 움직이고 있으면 그 자리에서 말한다. 아니면 그 방 문(총괄실은 대표실 문)에 나타난다.
        if (!b.controlled || performance.now() - b.controlled > 10 * 60 * 1000) teleport(b, P[team === 'hq' ? 'hq.bossdoor' : `${team}.door`] ?? P['boss.desk']);
        speak(b, e.text, { cls: 'wb--boss' });
        return;
      }
      if (e.actor === 'system') { banner(team, e.text); return; }
      const a = actorFor(team, e.actor); if (!a) return;
      if (a.hidden) teleport(a, a.home);
      speak(a, e.text);
      return;
    }
    case 'verdict': {
      const a = actorFor(team, e.actor); if (!a) return;
      const v = e.meta?.verdict ?? '';
      if (a.hidden) teleport(a, a.home);
      speak(a, e.text || v, { cls: `wb--verdict wb--${v}`, who: `${a.name} · ${v || '판정'}` });
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
    case 'round_start': case 'round_end': case 'note':
      banner(team, e.text);
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
  if (!team || !round) return toast('재생할 라운드가 없습니다.');
  const r = await fetch(`/api/log?team=${encodeURIComponent(team)}&round=${round}`).then((x) => x.json()).catch(() => ({}));
  if (!r.events?.length) return toast('그 라운드에 기록이 없습니다.');
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
  $('wvPlay').textContent = '일시정지'; $('wvStop').hidden = false;
  const [sc, room] = roomOf(team);
  if (room && S.cam) { if (sc.name !== S.scene) setScene(sc.name); $('wvView').scrollTo({ left: (room.x + room.w / 2) * T * S.z + PAD.x - $('wvView').clientWidth / 2, top: Math.max(0, room.y * T * S.z + PAD.y - 60), behavior: 'smooth' }); }
  step();
}
function step() {
  if (!R.playing) return;
  if (R.i >= R.events.length) { status(`재생 끝 · R${R.round}`); stop(); return; }
  const e = R.events[R.i++];
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
  $('wvPlay').textContent = R.playing ? '일시정지' : '이어서';
  if (R.playing) step();
}
function stop(quiet) {
  clearTimeout(R.timer); R.playing = false; R.events = []; R.i = 0;
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
  if (ev.key === 'Escape') closeTalk();
}
function openTalk(a) {
  talkTo = a;
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
  if (r.ok) toast(`${a.name}에게 전했습니다. 답은 여기와 작전실에 같이 뜹니다.`);
  else toast(r.data.needsRound ? `${a.team} 방의 라운드를 먼저 여세요(작전실에서).` : (r.data.error ?? '전하지 못했습니다.'), 5000);
  closeTalk();
}

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
  $('wvZoom').addEventListener('change', (e) => { S.z = Number(e.target.value) || 2; rebuild(); });
  $('wvCam').addEventListener('change', (e) => { S.cam = e.target.checked; });
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
}

/* ── 바깥에서 부르는 것 ── */

/** 마을 탭이 열렸다. 처음이면 지도·시트·캐스트를 읽는다. */
export async function open({ teams } = {}) {
  S.open = true;
  if (teams) S.teams = teams;
  if (!S.ready) S.ready = load().catch((e) => { S.ready = null; status(`마을을 못 불러왔습니다 — ${e.message}`); throw e; });
  await S.ready;
  if (!S.open) return;
  if (!S.raf) { S.last = performance.now(); S.raf = requestAnimationFrame(frame); }
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
  closeTalk();
}
/** 소켓으로 온 새 사건. 탭이 열려 있을 때만 연출한다 — 닫혀 있으면 대화록이 기록이고, 다시 열면 모두 자리에 있다. */
export function onEvents(team, events) {
  if (!S.open || !S.map) return;
  // 재생 중인 방의 실시간 사건은 버리지 않고 모아 둔다 — 재생이 끝나면 그때 연출한다 (레오 W1 감사)
  if (R.team === team && R.events.length) { R.held.push(...events); return; }
  for (const e of events) handle(team, e);
}
export function onSummaries() { /* W2: 자리 상태(자는 중·말하는 중)를 여기서 받는다 */ }
/** 시험용 — 장면·자리·말풍선 수. 화면을 보지 않고도 재생이 맞는지 확인할 수 있다. */
export function snapshot() {
  return {
    scene: S.scene,
    actors: everyone().map((a) => ({ key: a.key, name: a.name, scene: a.scene, x: a.x, y: a.y, hidden: a.hidden, walking: a.path.length > 0 })),
    bubbles: [...S.bubbles].map((b) => ({ who: b.a.key, kind: b.kind, text: b.el.textContent.slice(0, 40) })),
    replay: { team: R.team, round: R.round, i: R.i, n: R.events.length, playing: R.playing },
  };
}
