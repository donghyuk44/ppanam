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

    b.addEventListener('click', () => selectTeam(t.id));
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
  active = id;
  unread[id] = 0;
  location.hash = id;
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

/* ── 시작 ── */

const boot = await fetch('/api/boot').then((r) => r.json());
teams = boot.teams;
summaries = boot.summaries ?? {};
for (const t of teams) unread[t.id] = 0;
connect();
await selectTeam(
  teams.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : boot.defaultTeam,
);
