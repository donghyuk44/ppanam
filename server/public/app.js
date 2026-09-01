// 작전실 화면.
//
// 대화록은 지워지지 않는다. 라운드 경계는 구분선일 뿐이고,
// 위로 스크롤하면 지난 라운드가 계속 나온다.

const $ = (id) => document.getElementById(id);
const app = $('app'), feed = $('feed'), stream = $('stream');
const SVGNS = 'http://www.w3.org/2000/svg';
const FALLBACK = { name: '알 수 없음', initial: '?', color: '#8a8175' };

let teams = [];
let active = null;
let cast = { agents: {} };
let roadmap = { milestones: [], cutList: [] };
let summary = {};
let summaries = {};
let oldest = null;          // 더 불러올 기준점
let hasMore = false;
let unread = {};            // team → 안 읽은 건수
let lastActor = null;
let lastDay = null;

/* ── 작은 도구들 ── */

const who = (id) => cast.agents?.[id] ?? { ...FALLBACK, name: id };

const hhmm = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dayOf = (ts) => new Date(ts).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function svg(d, size = 9, width = 3) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', width);
  s.setAttribute('stroke-linecap', 'round');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}

/* ── 왼쪽 레일 ── */

function renderRail() {
  const nav = $('teams');
  nav.replaceChildren();

  for (const t of teams) {
    const s = summaries[t.id] ?? {};
    const b = el('button', 'team');
    b.type = 'button';
    b.dataset.id = t.id;
    b.setAttribute('aria-current', String(t.id === active));

    const dot = el('span', 'team__dot');
    dot.dataset.s = s.needsBoss ? 'alert' : s.phase === 'running' ? 'running' : 'idle';
    b.appendChild(dot);

    const body = el('span', 'team__body');
    body.appendChild(el('span', 'team__name', t.name));
    const sub = s.round
      ? `R${s.round}${s.milestonesTotal ? ` · 마일스톤 ${s.milestone}` : ''}`
      : s.logCount ? '대기' : '아직 없음';
    body.appendChild(el('span', 'team__sub', sub));
    b.appendChild(body);

    const badge = el('span', 'team__badge');
    if (s.needsBoss) {
      badge.textContent = '대표';
      badge.dataset.kind = 'alert';
    } else if (unread[t.id] > 0 && t.id !== active) {
      badge.textContent = String(unread[t.id]);
    } else {
      badge.hidden = true;
    }
    b.appendChild(badge);

    b.addEventListener('click', () => pickTeam(t.id));
    nav.appendChild(b);
  }
}

/* ── 가운데 머리 ── */

function renderHead() {
  const t = teams.find((x) => x.id === active);
  $('roomName').textContent = t?.room ?? '작전실';
  $('roomWho').textContent = Object.entries(cast.agents ?? {})
    .filter(([id]) => id !== 'boss' && id !== 'system')
    .map(([, a]) => a.name).join(', ');
  document.title = summary.round ? `R${summary.round} · ${t?.name ?? '작전실'}` : (t?.room ?? '작전실');

  $('rnum').textContent = summary.round ? `R${summary.round}` : '—';
  $('rtitle').textContent = summary.round
    ? (summary.topic ? `마일스톤 ${summary.milestone} — ${summary.topic}` : `마일스톤 ${summary.milestone}`)
    : '대기 중 — 라운드를 시작하세요';
  $('rprog').textContent = summary.attempt > 0 ? `반박 ${summary.attempt}/3` : '';
  app.dataset.alert = summary.attempt > 0 || summary.needsBoss ? '1' : '0';

  // 길잡이가 지금 일하는 중인가. 줄 서 있는 지시가 있으면 개수도 함께.
  const sess = summary.session ?? {};
  const work = $('rwork');
  work.hidden = !(summary.round && sess.busy);
  work.textContent = sess.queued ? `길잡이가 일하는 중 · 대기 ${sess.queued}` : '길잡이가 일하는 중';

  $('roundBtn').textContent = summary.round ? '라운드 닫기' : '라운드 열기';

  // 라운드 밖에서는 훅이 기록하지 않는다. 쓸 수 있게 두면 고장으로 보인다.
  const input = $('input');
  input.disabled = !summary.round;
  input.placeholder = summary.round ? '길잡이에게 지시하기' : '라운드를 열면 지시할 수 있습니다';

  const crew = $('crew');
  crew.replaceChildren();
  for (const [id, a] of Object.entries(cast.agents ?? {})) {
    if (id === 'boss' || id === 'system') continue;
    const c = el('div', 'chip', a.initial ?? '?');
    c.style.background = a.color ?? FALLBACK.color;
    c.title = `${a.name} — ${a.role ?? ''}`;
    crew.appendChild(c);
  }
  const dot = el('div', 'live');
  dot.id = 'liveDot';
  dot.dataset.on = String(Number(ws?.readyState === 1));
  crew.appendChild(dot);
}

/* ── 오른쪽 상황판 ── */

function renderSide() {
  // 이번 라운드
  const r = $('cardRound');
  r.replaceChildren();
  r.appendChild(el('div', 'card__k', '이번 라운드'));
  if (summary.round) {
    r.appendChild(el('div', 'card__big', `라운드 ${summary.round}`));
    if (summary.topic) r.appendChild(el('div', 'card__note', summary.topic));
    const dl = el('dl');
    for (const [k, v] of [
      ['마일스톤', summary.milestone ? `${summary.milestone} / ${summary.milestonesTotal || '—'}` : '—'],
      ['상태', summary.needsBoss ? '대표 판단 필요' : summary.phase === 'running' ? '진행 중' : '대기'],
      ['대화록', `${summary.logCount ?? 0}건`],
    ]) {
      const row = el('div', 'kv');
      row.appendChild(el('dt', null, k));
      row.appendChild(el('dd', null, v));
      dl.appendChild(row);
    }
    r.appendChild(dl);
    const g = el('div', 'gauge');
    for (let i = 1; i <= 3; i++) g.appendChild(el('div', i <= (summary.attempt ?? 0) ? 'on' : ''));
    r.appendChild(g);
    r.appendChild(el('div', 'card__note', `반박 ${summary.attempt ?? 0} / 3 — 다 차면 대표를 부릅니다`));
  } else {
    r.appendChild(el('div', 'card__note', '진행 중인 라운드가 없습니다.'));
  }

  // 로드맵
  const m = $('cardRoadmap');
  m.replaceChildren();
  m.appendChild(el('div', 'card__k', '로드맵'));
  if (roadmap.destination) {
    const d = el('div', 'dest');
    d.appendChild(el('div', 'dest__k', 'DESTINATION'));
    d.appendChild(el('div', 'dest__v', roadmap.destination));
    m.appendChild(d);
  }
  if (roadmap.milestones?.length) {
    const list = el('div', 'ms');
    for (const ms of roadmap.milestones) {
      const row = el('div', `ms__row${ms.status === 'wait' ? ' wait' : ''}`);
      const n = el('div', `ms__n ${ms.status ?? ''}`.trim(), String(ms.n));
      row.appendChild(n);
      const t = el('div', 'ms__t');
      t.appendChild(el('div', 'ms__title', ms.title));
      if (ms.deliverable) t.appendChild(el('div', 'ms__out', ms.deliverable));
      row.appendChild(t);
      list.appendChild(row);
    }
    m.appendChild(list);
  } else {
    m.appendChild(el('div', 'card__note', '아직 로드맵이 없습니다. /kickoff 로 5단계 결정을 뽑으세요.'));
  }
  if (roadmap.cutList?.length) {
    const c = el('div', 'cut');
    c.appendChild(el('div', 'cut__k', 'CUT LIST — 이번엔 하지 않는다'));
    const ul = el('ul');
    for (const x of roadmap.cutList) ul.appendChild(el('li', null, x));
    c.appendChild(ul);
    m.appendChild(c);
  }

  // 참여
  const c = $('cardCrew');
  c.replaceChildren();
  c.appendChild(el('div', 'card__k', '참여'));
  for (const [id, a] of Object.entries(cast.agents ?? {})) {
    if (id === 'system') continue;
    const row = el('div', 'who__row');
    const av = el('div', 'chip', a.initial ?? '?');
    av.style.background = a.color ?? FALLBACK.color;
    row.appendChild(av);
    const t = el('div', 'who__t');
    t.appendChild(el('div', 'who__n', a.name));
    t.appendChild(el('div', 'who__r', a.role ?? ''));
    row.appendChild(t);
    if (a.model) row.appendChild(el('div', 'who__m', a.model.toUpperCase()));
    c.appendChild(row);
  }
}

/* ── 이벤트 하나 그리기 ── */

function draw(e) {
  const a = who(e.actor);

  switch (e.type) {
    case 'round_start': lastActor = null; return el('div', 'banner start', e.text);
    case 'round_end':   lastActor = null; return el('div', 'banner', e.text);
    case 'milestone':   lastActor = null; return el('div', 'banner', e.text);
    case 'enter':       lastActor = null; return el('div', 'pill', e.text);
    case 'note':        lastActor = null; return el('div', 'note', e.text);

    case 'tool': {
      lastActor = null;
      const n = el('div', 'tool');
      n.appendChild(svg('M9 6l6 6-6 6'));
      n.appendChild(el('span', null, `${e.meta?.tool ? e.meta.tool + ' · ' : ''}${e.text}`));
      return n;
    }

    case 'verdict': {
      lastActor = null;
      const v = e.meta?.verdict ?? 'REVISE';
      const n = el('div', 'stamp' + (v === 'PASS' ? ' pass' : ''));
      const top = el('div', 'stamp__top');
      top.appendChild(el('div', 'stamp__label', v));
      top.appendChild(el('div', 'stamp__meta', `${a.name} → ${who(e.meta?.target ?? 'guide').name}`));
      n.appendChild(top);
      n.appendChild(el('div', 'stamp__body', e.text));
      if (v !== 'PASS') {
        const max = e.meta?.max ?? 3, at = e.meta?.attempt ?? 0;
        const foot = el('div', 'stamp__foot');
        foot.appendChild(el('span', null, `반박 ${at} / ${max}`));
        const ticks = el('div', 'ticks');
        for (let i = 1; i <= max; i++) ticks.appendChild(el('div', 'tick' + (i <= at ? ' on' : '')));
        foot.appendChild(ticks);
        n.appendChild(foot);
      }
      return n;
    }

    default: {
      const me = e.actor === 'boss';
      const cont = lastActor === e.actor;
      lastActor = e.actor;
      const row = el('div', `row${me ? ' me' : ''}${cont ? ' cont' : ''}`);
      const av = el('div', 'av', a.initial ?? '?');
      av.style.background = a.color ?? FALLBACK.color;
      row.appendChild(av);
      const stack = el('div', 'stack');
      if (!cont && !me) {
        const name = el('div', 'name');
        name.appendChild(el('b', null, a.name));
        name.append(' ' + hhmm(e.ts));
        stack.appendChild(name);
      }
      stack.appendChild(el('div', 'bub', e.text));
      row.appendChild(stack);
      return row;
    }
  }
}

/** 날짜가 바뀌면 날짜 표시를 끼워넣는다 (카톡처럼). */
function drawWithDay(e, frag) {
  const d = dayOf(e.ts);
  if (d !== lastDay) {
    lastDay = d;
    lastActor = null;
    frag.appendChild(el('div', 'daymark', d));
  }
  frag.appendChild(draw(e));
}

function emptyView() {
  const n = el('div', 'quiet');
  const s = svg('M4 5h16M4 12h16M4 19h9', 30, 1.4);
  s.style.opacity = '.45';
  n.appendChild(s);
  n.appendChild(el('div', 'quiet__t', '아직 조용합니다'));
  const p = el('div', 'quiet__s');
  p.innerHTML = '터미널에서 <code>node bus/round.mjs start "주제"</code><br>로 라운드를 시작하세요.';
  n.appendChild(p);
  return n;
}

const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;

function paint(events, { replace = true } = {}) {
  if (replace) {
    stream.replaceChildren();
    lastActor = null; lastDay = null;
  }
  if (!events.length && replace) { stream.appendChild(emptyView()); return; }
  const frag = document.createDocumentFragment();
  for (const e of events) drawWithDay(e, frag);
  stream.appendChild(frag);
  if (replace) feed.scrollTop = feed.scrollHeight;
}

function append(events) {
  const stick = atBottom();
  const q = stream.querySelector('.quiet');
  if (q) q.remove();
  const frag = document.createDocumentFragment();
  for (const e of events) drawWithDay(e, frag);
  stream.appendChild(frag);
  if (stick) feed.scrollTop = feed.scrollHeight;
}

/* ── 팀 전환 ── */

async function selectTeam(id) {
  // 주소는 여기서 건드리지 않는다. 팀과 화면이 같이 정해진 뒤에 한 번만 쓴다 —
  // 중간에 쓰면 히스토리에 지나가는 상태가 한 칸씩 남아 뒤로가기가 어긋난다.
  active = id;
  unread[id] = 0;
  const r = await fetch(`/api/team?team=${encodeURIComponent(id)}`).then((x) => x.json());
  cast = r.cast; roadmap = r.roadmap; summary = r.summary;
  oldest = r.events[0]?.id ?? null;
  hasMore = r.more;
  $('loadMore').hidden = !hasMore;
  paint(r.events);
  renderRail(); renderHead(); renderSide();
  app.dataset.side = '0';
  $('scrim').hidden = true;
}

/** 레일에서 팀을 눌렀을 때. 관제탑이면 그 방으로 들어가고, 분석이면 그 팀 분석으로 갈아탄다. */
async function pickTeam(id) {
  await selectTeam(id);
  if (view === 'tower') return setView('room');
  if (view === 'analysis') loadAnalysis();
  syncHash();
}

$('loadMoreBtn').addEventListener('click', async () => {
  if (!hasMore || !oldest) return;
  const keepH = feed.scrollHeight, keepT = feed.scrollTop;
  const r = await fetch(`/api/log?team=${encodeURIComponent(active)}&before=${oldest}`).then((x) => x.json());
  if (!r.events.length) { hasMore = false; $('loadMore').hidden = true; return; }

  // 위쪽에 끼워넣고 스크롤 위치를 유지한다.
  const frag = document.createDocumentFragment();
  const saveActor = lastActor, saveDay = lastDay;
  lastActor = null; lastDay = null;
  for (const e of r.events) drawWithDay(e, frag);
  lastActor = saveActor; lastDay = saveDay;
  stream.insertBefore(frag, stream.firstChild);

  oldest = r.events[0]?.id ?? oldest;
  hasMore = r.more;
  $('loadMore').hidden = !hasMore;
  feed.scrollTop = keepT + (feed.scrollHeight - keepH);
});

/* ── 연결 ── */

let ws = null, retry = 0;

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.onopen = () => { retry = 0; const d = $('liveDot'); if (d) d.dataset.on = '1'; };
  ws.onclose = () => {
    const d = $('liveDot'); if (d) d.dataset.on = '0';
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 400 * 2 ** (retry - 1));
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.kind === 'summaries') {
      summaries = msg.summaries ?? {};
      summary = summaries[active] ?? summary;
      renderRail(); renderHead(); renderSide();
      if (view === 'tower') renderTower();
      // 분석은 값이 실제로 움직였을 때만 다시 불러온다. 250ms 마다 받아올 이유가 없다.
      if (view === 'analysis') {
        const s = summaries[active] ?? {};
        if (`${s.round}:${s.logCount}:${s.phase}` !== anMark) loadAnalysis();
      }
      return;
    }
    if (msg.kind === 'events') {
      if (msg.team === active) {
        append(msg.events);
      } else {
        unread[msg.team] = (unread[msg.team] ?? 0) + msg.events.length;
        renderRail();
      }
    }
  };
}

/* ── 라운드 열고 닫기 ── */

const post = (path, body) => fetch(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

let msgTimer = null;
function say(text, ms = 6000) {
  const box = $('composerMsg');
  clearTimeout(msgTimer);
  if (!text) { box.hidden = true; return; }
  box.textContent = text;
  box.hidden = false;
  msgTimer = setTimeout(() => { box.hidden = true; }, ms);
}

const showOpen = (on) => {
  $('roundOpen').hidden = !on;
  if (on) { $('roundTopic').value = ''; $('roundMs').value = ''; $('roundTopic').focus(); }
};

$('roundBtn').addEventListener('click', async () => {
  if (!active) return;
  if (!summary.round) return showOpen($('roundOpen').hidden);

  // 판정은 감사역이 낸다. 여기서 닫는 건 판정 없이 라운드를 접는 것이다.
  if (!confirm(`라운드 ${summary.round} 을 닫습니다.\n\n대화록은 그대로 남고, 다음 라운드는 새 컨텍스트로 시작합니다.`)) return;
  const r = await post('/api/round', { team: active, action: 'end' });
  if (!r.ok) say(r.data.error ?? '라운드를 닫지 못했습니다.');
});

$('roundCancel').addEventListener('click', () => showOpen(false));

$('roundOpen').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!active) return;
  const topic = $('roundTopic').value.trim();
  const ms = $('roundMs').value.trim();
  const r = await post('/api/round', {
    team: active, action: 'start',
    topic: topic || null,
    milestone: ms === '' ? null : Number(ms),
  });
  if (!r.ok) return say(r.data.error ?? '라운드를 열지 못했습니다.');
  showOpen(false);
  $('input').focus();
});

/* ── 지시 ── */

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('input');
  const text = input.value.trim();
  if (!text || !active) return;
  input.value = '';
  say(null);

  // 말풍선은 여기서 그리지 않는다. 지시가 세션에 들어가면 훅이 남긴다.
  let r;
  try {
    r = await post('/api/say', { text, team: active });
  } catch {
    input.value = text;
    return say('서버에 닿지 못했습니다.');
  }
  if (!r.ok) {
    input.value = text;
    say(r.data.error ?? '지시를 전달하지 못했습니다.');
    if (r.data.needsRound) showOpen(true);
  }
});

/* ── 상황판 서랍 (좁은 화면) ── */

const openSide = (on) => { app.dataset.side = on ? '1' : '0'; $('scrim').hidden = !on; };
$('sideToggle').addEventListener('click', () => openSide(app.dataset.side !== '1'));
$('sideClose').addEventListener('click', () => openSide(false));
$('scrim').addEventListener('click', () => openSide(false));

/* ══ 화면 전환 ══ */

let view = 'room';
const VIEWS = new Set(['room', 'tower', 'analysis']);

// 주소에 팀과 화면을 함께 남긴다 (#marketing/tower). 새로고침해도, 뒤로 가도 보던 곳으로 돌아온다.
// 우리가 쓴 해시는 되읽지 않는다 — 안 그러면 화면을 바꿀 때마다 한 번 더 바꾸려 든다.
let hashByUs = false;

const syncHash = () => {
  if (!active) return;
  const h = view === 'room' ? active : `${active}/${view}`;
  if (location.hash.slice(1) === h) return;
  hashByUs = true;
  location.hash = h;
};

window.addEventListener('hashchange', async () => {
  if (hashByUs) { hashByUs = false; return; }
  const [t, v] = location.hash.slice(1).split('/');
  if (t && t !== active && teams.some((x) => x.id === t)) await selectTeam(t);
  setView(v ?? 'room');
});

function setView(v) {
  if (!VIEWS.has(v)) v = 'room';
  view = v;
  app.dataset.view = v;
  syncHash();
  for (const b of $('views').querySelectorAll('button')) {
    b.setAttribute('aria-current', String(b.dataset.view === v));
  }
  if (v === 'tower') renderTower();
  if (v === 'analysis') loadAnalysis();
}

for (const b of $('views').querySelectorAll('button')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}

/* ══ 관제탑 ══ */

// 카드는 요약이 바뀔 때마다 다시 그려진다. 쓰던 글이 날아가지 않게 팀별로 붙들어 둔다.
const draft = {};

const ago = (ts) => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};

function renderTower() {
  const grid = $('towerGrid');
  const focus = document.activeElement;
  const keep = focus?.classList?.contains('tcard__in')
    ? { team: focus.dataset.team, pos: focus.selectionStart } : null;

  grid.replaceChildren();

  for (const t of teams) {
    const s = summaries[t.id] ?? {};
    const agents = s.cast ?? {};
    const running = s.phase === 'running' && s.round;

    const card = el('div', 'tcard');
    card.dataset.alert = s.needsBoss ? '1' : '0';

    // 이름과 상태
    const top = el('div', 'tcard__top');
    const name = el('span', 'tcard__name', t.room ?? t.name);
    name.title = '이 작전실 열기';
    name.addEventListener('click', async () => { await selectTeam(t.id); setView('room'); });
    top.appendChild(name);
    const flag = el('span', 'tcard__flag',
      s.needsBoss ? '대표 호출' : running ? '진행 중' : '대기');
    flag.dataset.k = s.needsBoss ? 'boss' : running ? 'run' : 'idle';
    top.appendChild(flag);
    card.appendChild(top);

    // 라운드와 마일스톤
    const ms = el('div', 'tcard__ms');
    ms.appendChild(el('b', null, s.round ? `R${s.round}` : 'R—'));
    ms.append(' ');
    ms.append(s.round
      ? `마일스톤 ${s.milestone}${s.milestoneTitle ? ' · ' + s.milestoneTitle : ''}`
      : '진행 중인 라운드 없음');
    card.appendChild(ms);

    const total = s.milestonesTotal ?? 0;
    const done = s.milestonesDone ?? 0;
    const bar = el('div', 'bar2');
    const fill = el('i');
    fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
    bar.appendChild(fill);
    card.appendChild(bar);

    const meta = el('div', 'tcard__meta');
    meta.append(total ? `마일스톤 ${done}/${total}` : '로드맵 없음');
    const g = el('div', 'gauge');
    for (let i = 1; i <= 3; i++) g.appendChild(el('div', i <= (s.attempt ?? 0) ? 'on' : ''));
    meta.appendChild(g);
    meta.append(`대화록 ${s.logCount ?? 0}건`);
    if (s.session?.busy) meta.appendChild(el('span', 'rwork', '일하는 중'));
    card.appendChild(meta);

    // 마지막 발언
    const last = el('div', 'tcard__last');
    if (s.lastText) {
      const a = agents[s.lastActor] ?? FALLBACK;
      const av = el('div', 'chip', a.initial ?? '?');
      av.style.background = a.color ?? FALLBACK.color;
      av.title = a.name ?? s.lastActor;
      last.appendChild(av);
      const body = el('div', 'tcard__lastt');
      body.appendChild(el('div', null, s.lastText.replace(/\s+/g, ' ').slice(0, 160)));
      body.appendChild(el('div', 'tcard__quiet', ago(s.lastAt)));
      last.appendChild(body);
    } else {
      last.appendChild(el('div', 'tcard__quiet', '아직 아무 말도 오가지 않았습니다.'));
    }
    card.appendChild(last);

    // 지시 · 라운드. 입력창 하나가 두 가지로 쓰인다 —
    // 라운드가 없으면 주제를 받아 열고, 열려 있으면 지시를 받는다.
    const err = el('div', 'tcard__err');
    err.hidden = true;

    const row = el('div', 'tcard__do');
    const box = el('input', 'tcard__in');
    box.type = 'text';
    box.autocomplete = 'off';
    box.dataset.team = t.id;
    box.value = draft[t.id] ?? '';
    box.placeholder = running ? '지시하기' : '라운드 주제를 쓰고 열기';
    box.addEventListener('input', () => { draft[t.id] = box.value; });

    const fail = (m) => { err.textContent = m; err.hidden = false; };

    const doSay = async () => {
      const text = box.value.trim();
      if (!text) return;
      err.hidden = true;
      box.value = ''; draft[t.id] = '';
      const r = await post('/api/say', { team: t.id, text });
      if (!r.ok) { box.value = text; draft[t.id] = text; fail(r.data.error ?? '전달하지 못했습니다.'); }
    };

    const doRound = async () => {
      err.hidden = true;
      if (running) {
        if (!confirm(`${t.name}팀 라운드 ${s.round} 을 닫습니다.\n\n대화록은 그대로 남습니다.`)) return;
        const r = await post('/api/round', { team: t.id, action: 'end' });
        if (!r.ok) fail(r.data.error ?? '닫지 못했습니다.');
        return;
      }
      const topic = box.value.trim();
      const r = await post('/api/round', { team: t.id, action: 'start', topic: topic || null });
      if (!r.ok) return fail(r.data.error ?? '열지 못했습니다.');
      box.value = ''; draft[t.id] = '';
    };

    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      running ? doSay() : doRound();
    });

    const btn = el('button', 'tcard__r', running ? '라운드 닫기' : '라운드 열기');
    btn.type = 'button';
    btn.addEventListener('click', doRound);

    row.appendChild(box);
    row.appendChild(btn);
    card.appendChild(row);
    card.appendChild(err);

    grid.appendChild(card);
  }

  if (keep) {
    const back = grid.querySelector(`.tcard__in[data-team="${keep.team}"]`);
    if (back) { back.focus(); try { back.setSelectionRange(keep.pos, keep.pos); } catch { /* 무시 */ } }
  }
}

/* ══ 분석 ══ */

let anMark = '';

async function loadAnalysis() {
  if (!active) return;
  const s = summaries[active] ?? {};
  anMark = `${s.round}:${s.logCount}:${s.phase}`;
  const t = teams.find((x) => x.id === active);
  $('anTitle').textContent = `분석 — ${t?.name ?? active}`;
  const r = await fetch(`/api/analysis?team=${encodeURIComponent(active)}`).then((x) => x.json());
  if (r.error) return;
  renderAnalysis(r);
}

function tile(k, v, note) {
  const n = el('div', 'tile');
  n.appendChild(el('div', 'tile__k', k));
  n.appendChild(el('div', 'tile__v', v));
  if (note) n.appendChild(el('div', 'tile__n', note));
  return n;
}

function panel(title) {
  const p = el('section', 'panel');
  p.appendChild(el('h2', null, title));
  return p;
}

function renderAnalysis(r) {
  const body = $('anBody');
  body.replaceChildren();
  const st = r.stats, agents = r.cast?.agents ?? {};

  // 한눈에
  const tiles = el('div', 'tiles');
  tiles.appendChild(tile('끝난 라운드', String(st.roundsDone), st.roundsDone ? `평균 반박 ${st.attemptAvg}회` : '아직 없음'));
  tiles.appendChild(tile('통과', String(st.verdicts.PASS), `되돌림 ${st.verdicts.REVISE} · 중단 ${st.verdicts.FAIL}`));
  tiles.appendChild(tile('마일스톤',
    `${r.summary.milestonesDone ?? 0}/${r.summary.milestonesTotal ?? 0}`,
    r.roadmap.destination ? '목적지 있음' : '로드맵 없음'));
  tiles.appendChild(tile('대화록', String(st.logCount), st.lastAt ? `마지막 ${ago(st.lastAt)}` : '비어 있음'));
  tiles.appendChild(tile('산출물', String(r.out.length), r.out.length ? 'teams/' + r.team + '/out/' : '아직 없음'));
  body.appendChild(tiles);

  // 라운드 이력 — rounds.jsonl 이 이걸 위해 있는 색인이다
  const rp = panel('라운드 이력');
  if (r.rounds.length) {
    const tb = el('table', 'tbl');
    const hr = el('tr');
    for (const [h, c] of [['라운드', 'num'], ['M', 'num'], ['판정', ''], ['주제', 'wrap'], ['반박', 'num'], ['건수', 'num']]) {
      hr.appendChild(el('th', c, h));
    }
    tb.appendChild(hr);
    for (const x of r.rounds) {
      const tr = el('tr');
      tr.appendChild(el('td', 'num', `R${x.round}`));
      tr.appendChild(el('td', 'num', x.milestone ? String(x.milestone) : '—'));
      const vd = el('td', 'nw');
      if (x.verdict) { const g = el('span', 'vtag', x.verdict); g.dataset.v = x.verdict; vd.appendChild(g); }
      else vd.appendChild(el('span', 'tcard__quiet', '판정 없음'));
      tr.appendChild(vd);
      tr.appendChild(el('td', 'wrap', x.topic || x.summary || '—'));
      tr.appendChild(el('td', 'num', `${x.attempts ?? 0}/3`));
      tr.appendChild(el('td', 'num', String(x.eventCount ?? 0)));
      tb.appendChild(tr);
    }
    rp.appendChild(tb);
  } else {
    rp.appendChild(el('div', 'panel__note', '끝난 라운드가 없습니다. 라운드를 닫으면 여기에 한 줄씩 쌓입니다.'));
  }
  body.appendChild(rp);

  // 누가 얼마나 말했나
  const sp = panel('발언 비중');
  const total = Object.values(st.byActor).reduce((a, b) => a + b, 0);
  if (total) {
    const bars = el('div', 'bars');
    for (const [id, n] of Object.entries(st.byActor).sort((a, b) => b[1] - a[1])) {
      const a = agents[id] ?? { ...FALLBACK, name: id };
      const row = el('div', 'bars__row');
      row.appendChild(el('div', null, a.name ?? id));
      const bar = el('div', 'bar2');
      const fill = el('i');
      fill.style.width = `${Math.round((n / total) * 100)}%`;
      fill.style.background = a.color ?? FALLBACK.color;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('div', 'bars__n', String(n)));
      bars.appendChild(row);
    }
    sp.appendChild(bars);
    sp.appendChild(el('div', 'panel__note', `말풍선·판정 ${total}건 · 도구 사용 ${st.tools}건은 따로 셉니다.`));
  } else {
    sp.appendChild(el('div', 'panel__note', '아직 발언이 없습니다.'));
  }
  body.appendChild(sp);

  // 마일스톤
  const mp = panel('마일스톤');
  if (r.roadmap.destination) {
    const d = el('div', 'dest');
    d.appendChild(el('div', 'dest__k', 'DESTINATION'));
    d.appendChild(el('div', 'dest__v', r.roadmap.destination));
    mp.appendChild(d);
  }
  if (r.roadmap.milestones?.length) {
    const list = el('div', 'ms');
    for (const m of r.roadmap.milestones) {
      const row = el('div', `ms__row${m.status === 'wait' ? ' wait' : ''}`);
      row.appendChild(el('div', `ms__n ${m.status ?? ''}`.trim(), String(m.n)));
      const t2 = el('div', 'ms__t');
      t2.appendChild(el('div', 'ms__title', m.title));
      if (m.deliverable) t2.appendChild(el('div', 'ms__out', m.deliverable));
      row.appendChild(t2);
      list.appendChild(row);
    }
    mp.appendChild(list);
  } else {
    mp.appendChild(el('div', 'panel__note', '로드맵이 없습니다. /kickoff 로 5단계 결정을 뽑으세요.'));
  }
  body.appendChild(mp);

  // 산출물 — 통과 조건은 완료율이 아니라 제출 가능한 물건이다
  const op = panel('산출물');
  if (r.out.length) {
    const tb = el('table', 'tbl');
    const hr = el('tr');
    hr.appendChild(el('th', 'wrap', '파일'));
    hr.appendChild(el('th', 'num', '크기'));
    hr.appendChild(el('th', 'num', '마지막'));
    tb.appendChild(hr);
    for (const f of r.out) {
      const tr = el('tr');
      tr.appendChild(el('td', 'wrap', f.name));
      tr.appendChild(el('td', 'num', f.size < 1024 ? `${f.size}B` : `${Math.round(f.size / 1024)}KB`));
      tr.appendChild(el('td', 'num', ago(f.at)));
      tb.appendChild(tr);
    }
    op.appendChild(tb);
  } else {
    op.appendChild(el('div', 'panel__note',
      '아직 없습니다. 라운드의 통과 조건은 완료율이 아니라 제출 가능한 물건입니다.'));
  }
  body.appendChild(op);
}

/* ── 시작 ── */

const boot = await fetch('/api/boot').then((r) => r.json());
teams = boot.teams;
summaries = boot.summaries ?? {};
for (const t of teams) unread[t.id] = 0;
connect();

const [hashTeam, hashView] = location.hash.slice(1).split('/');
await selectTeam(teams.some((t) => t.id === hashTeam) ? hashTeam : boot.defaultTeam);
setView(hashView ?? 'room');
