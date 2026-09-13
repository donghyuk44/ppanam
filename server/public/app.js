// 작전실 화면.
//
// 대화록은 지워지지 않는다. 라운드 경계는 구분선일 뿐이고,
// 위로 스크롤하면 지난 라운드가 계속 나온다.

import * as World from '/world/world.js';

const $ = (id) => document.getElementById(id);
const app = $('app'), feed = $('feed'), stream = $('stream');
const SVGNS = 'http://www.w3.org/2000/svg';
const FALLBACK = { name: '알 수 없음', initial: '?', color: '#8a8175' };

let teams = [];
let active = null;
let cast = { agents: {} };
let roadmap = { milestones: [], cutList: [] };
let journal = {};            // 자리 → 최근 일지 문단
let summary = {};
let summaries = {};
let approvals = [];          // 대기 중인 승인 — 모든 탭 맨 위
let pendingMark = -1;        // 마지막으로 본 대기 건수 합 — 바뀌면 목록을 다시 받는다
let told = {};               // 승인 id → { requested, decided, executed } — 서버가 언제 알렸나
let grades = {};
let oldest = null;          // 더 불러올 기준점
let hasMore = false;
let unread = {};            // team → 안 읽은 건수
let lastActor = null;
let lastDay = null;

/* ── 작은 도구들 ── */

// 이 방에 없는 자리는 총괄실 것이다 — 총괄실에서 옮겨온 발언(meta.from)의 화자 톰.
const who = (id) => cast.agents?.[id] ?? summaries.hq?.cast?.[id] ?? { ...FALLBACK, name: id };

/** 이 말이 대표를 불렀나 — 첫머리나 문단 첫머리의 "대표님·대표·댄" 또는 대표 이름. 서버(bus.callsBoss)와 같은 규칙. */
function callsBoss(text) {
  const s = String(text ?? '');
  const bossName = cast.agents?.boss?.name;
  const names = ['대표님', '대표', '댄', ...(bossName ? [bossName] : [])].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|\\n\\s*\\n)\\s*(${names.join('|')})\\s*(씨|님)?\\s*[,，、:·]`).test(s);
}

/** 자리의 살아 있음. 세션이 있나(듣는 중), 일하는 중인가, 지금 차례가 잡혀 있나. codex 자리는 사회자의 busy 로. */
const STATE_LABEL = { off: '자는 중', idle: '듣는 중', busy: '말하는 중', turn: '차례 대기' };
function stateOf(id) {
  const c = summary.conductor ?? {};
  const a = cast.agents?.[id];
  if (a?.model === 'gpt') return c.outsideBusy ? 'busy' : (c.pending ?? []).some((p) => p.startsWith(id + ':')) ? 'turn' : 'idle';
  const s = summary.sessions?.[id];
  if (!s || !s.alive) return (c.pending ?? []).some((p) => p.startsWith(id + ':')) ? 'turn' : 'off';
  if (s.busy) return 'busy';
  return (c.pending ?? []).some((p) => p.startsWith(id + ':')) ? 'turn' : 'idle';
}

const hhmm = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dayOf = (ts) => new Date(ts).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 말풍선 본문. 인격은 "보고서를 쓰지 마라" 지만 대표 보고에는 표와 굵은 글씨가 온다. 그걸 원문 기호로
 * 보여주면 읽히지 않는다(** 와 | 가 그대로 떴다). 굵게·인라인 코드·줄바꿈만 살리고, 표와 코드블록은
 * 접어 둔다 — 방은 채팅이지 문서가 아니다. 먼저 이스케이프한 뒤 기호를 바꾸므로 HTML 이 새지 않는다.
 */
function bubble(text) {
  const n = el('div', 'bub');
  const src = String(text ?? '');
  const blocks = [];
  // 코드블록과 표(연속된 | 줄)를 떼어 접는다
  let body = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => { blocks.push(['코드', code]); return `\u0000${blocks.length - 1}\u0000`; });
  // 표는 머리줄 + 구분선(|---|) 이 있어야 표다. '|' 로 시작하는 줄 둘만으로 판정하면 일반 문장을 잡아먹는다 (레오 감사, 2026-09-12).
  body = body.replace(/(?:^|\n)([ \t]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-{3,}[ \t|:-]*(?:\n(?:[ \t]*\|[^\n]*(?:\n|$))*)?)/g, (m, tbl) => { blocks.push(['표', tbl.trim()]); return `\n\u0000${blocks.length - 1}\u0000`; });
  let html = escapeHtml(body)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^[ \t]*[-*]\s+/gm, '· ');
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const [kind, content] = blocks[Number(i)];
    return `<details class="bub__fold"><summary>${kind} 보기</summary><pre>${escapeHtml(content)}</pre></details>`;
  });
  n.innerHTML = html.trim();
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
  renderBossBadge();
}

/**
 * 대표 차례 — 어느 탭에서든 보이는 배지 (결정 19-2). 셋을 센다:
 * 막히거나 하루 넘게 조용한 방(needsBoss) · 누가 대표를 불렀는데 답이 없는 방(bossCall) · 대표가 판정할 승인(C).
 */
function bossTurns() {
  const rooms = teams.filter((t) => summaries[t.id]?.needsBoss || summaries[t.id]?.bossCall);
  const cards = approvals.filter((r) => r.grade === 'C');
  return { rooms, cards, n: rooms.length + cards.length };
}
function renderBossBadge() {
  const b = $('bossBadge');
  const { rooms, cards, n } = bossTurns();
  b.hidden = n === 0;
  if (n) {
    b.textContent = `대표 차례 ${n}`;
    b.title = [...rooms.map((t) => `${t.name}: ${summaries[t.id].needsBoss ? BOSS_WHY[summaries[t.id].needsBossWhy] ?? '대표 판단' : (summaries[t.id].cast?.[summaries[t.id].bossCall.by]?.name ?? summaries[t.id].bossCall.by) + '이 불렀습니다'}`), ...cards.map((r) => `승인: ${r.what}`)].join('\n');
  }
}
const BOSS_WHY = { blocked: '대표 결정 기다리는 중 (FAIL)', attempts: '고쳐 오기 3번 다 씀', silent: '하루 넘게 말이 없음' };
$('bossBadge').addEventListener('click', () => {
  const { rooms, cards } = bossTurns();
  if (cards.length) return setView('tower');
  if (rooms.length) { pickTeam(rooms[0].id); setView('room'); }
});

/* ── 가운데 머리 ── */

function renderHead() {
  const t = teams.find((x) => x.id === active);
  $('roomName').textContent = t?.room ?? '작전실';
  $('roomWho').textContent = Object.entries(cast.agents ?? {})
    .filter(([id]) => id !== 'boss' && id !== 'system')
    .map(([, a]) => a.name).join(', ');
  // 총괄실은 대표와의 1:1 이라 라운드가 없다. 늘 열려 있다.
  const office = t?.kind === 'office';
  // 라운드가 "있다" 는 번호가 아니라 phase 다. 번호는 닫힌 뒤에도 남아서, 번호로 그리면 닫힌 방이
  // "R14 · 라운드 닫기 · 입력 가능" 으로 보이고 보내면 409, 닫으면 두 번 닫힌다 (Fable 재점검, 2026-09-12).
  const open = office || summary.phase === 'running' || summary.phase === 'blocked';
  const blocked = !office && summary.phase === 'blocked';
  document.title = open && !office ? `R${summary.round} · ${t?.name ?? '작전실'}` : (t?.room ?? '작전실');
  const turns = bossTurns().n;
  if (turns) document.title = `(${turns}) ` + document.title;   // 탭 제목에도 — 다른 창에 있어도 보이게

  $('rnum').textContent = office ? '1:1' : open ? `R${summary.round}` : '—';
  $('rtitle').textContent = office
    ? '늘 열려 있습니다 — 지시하면 톰이 팀에 나눕니다'
    : blocked
      ? `대표 판단 필요 — FAIL. 여기에 판단을 적으면 라운드 ${summary.round} 이 재개됩니다`
      : open
        ? (summary.topic ? `마일스톤 ${summary.milestone} — ${summary.topic}` : `마일스톤 ${summary.milestone}`)
        : '대기 중 — 라운드를 시작하세요';
  const c = summary.conductor ?? {};
  const turnNote = c.flow ? `판정 중 · ${who(c.flow.waiting ?? c.flow.step).name} 차례` : c.pending?.length ? `차례: ${c.pending.map((p) => who(p.split(':')[0]).name).join(', ')}` : '';
  $('rprog').textContent = [turnNote, open && summary.attempt > 0 ? `반박 ${summary.attempt}/3` : ''].filter(Boolean).join(' · ');
  app.dataset.alert = (open && summary.attempt > 0) || summary.needsBoss ? '1' : '0';

  // 누가 지금 일하는 중인가. 총괄실도 일한다 — 라운드 번호가 0 이라고 숨기지 않는다.
  const sess = summary.session ?? {};
  const work = $('rwork');
  work.hidden = !sess.busy;
  work.textContent = sess.queued ? `${office ? '톰' : '실무'}이 일하는 중 · 대기 ${sess.queued}` : `${office ? '톰' : '실무'}이 일하는 중`;

  const rb = $('roundBtn');
  // 막힌 방(FAIL)은 대표가 말해 풀기 전엔 닫히지 않는다 — 버튼을 보여 주면 누르고 거부당한다 (가드 R13).
  rb.hidden = office || blocked;
  rb.textContent = open ? '라운드 닫기' : '라운드 열기';
  if (office) $('roundOpen').hidden = true;

  // 라운드 밖에서도 쓸 수 있다. 보내면 첫 줄이 주제로 채워진 열기 폼이 뜨고, 열리면 그 말이 첫 지시로 들어간다 (결정 19).
  // 전에는 잠겨 있어 "고장" 으로 보였다.
  const input = $('input');
  input.disabled = false;
  input.placeholder = office
    ? '톰에게 지시하기'
    : blocked
      ? '대표 판단을 적으면 라운드가 재개됩니다'
      : open ? '실무에게 지시하기' : '지시하면 라운드가 열립니다 — 첫 줄이 주제가 됩니다';

  const crew = $('crew');
  crew.replaceChildren();
  for (const [id, a] of Object.entries(cast.agents ?? {})) {
    if (id === 'boss' || id === 'system') continue;
    const c = el('div', 'chip', a.initial ?? '?');
    c.style.background = a.color ?? FALLBACK.color;
    const st = stateOf(id);
    c.dataset.state = st;
    c.title = `${a.name} — ${a.role ?? ''} · ${STATE_LABEL[st]}`;
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
  if (summary.phase === 'running' || summary.phase === 'blocked') {
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
    if (id !== 'boss') av.dataset.state = stateOf(id);
    row.appendChild(av);
    const t = el('div', 'who__t');
    t.appendChild(el('div', 'who__n', a.name));
    t.appendChild(el('div', 'who__r', id === 'boss' ? (a.role ?? '') : `${a.role ?? ''} · ${STATE_LABEL[stateOf(id)]}`));
    row.appendChild(t);
    if (a.model) row.appendChild(el('div', 'who__m', a.model.toUpperCase()));
    c.appendChild(row);
  }

  // 일지 — 자리마다 어제 한 문단. 세션이 죽어도 이게 남는다.
  const j = $('cardJournal');
  j.replaceChildren();
  j.appendChild(el('div', 'card__k', '일지'));
  const entries = Object.entries(journal);
  if (!entries.length) {
    j.appendChild(el('div', 'card__note', '아직 없습니다. 라운드가 닫힐 때 자리마다 한 문단이 남습니다.'));
  } else {
    for (const [id, text] of entries) {
      const d = el('details', 'jr');
      const s = el('summary', null, `${who(id).name} — ${text.split('\n')[0].replace(/^## /, '')}`);
      d.appendChild(s);
      d.appendChild(el('div', 'jr__body', text.split('\n').slice(1).join('\n').trim()));
      j.appendChild(d);
    }
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
      const called = !me && e.actor !== 'system' && callsBoss(e.text);
      const cont = lastActor === e.actor && !called;
      lastActor = e.actor;
      const row = el('div', `row${me ? ' me' : ''}${cont ? ' cont' : ''}${called ? ' calls-boss' : ''}`);
      const av = el('div', 'av', a.initial ?? '?');
      av.style.background = a.color ?? FALLBACK.color;
      row.appendChild(av);
      const stack = el('div', 'stack');
      if (!cont && !me) {
        const name = el('div', 'name');
        name.appendChild(el('b', null, a.name));
        name.append(' ' + hhmm(e.ts));
        // 총괄실에서 옮겨온 말 — 톰이 이 방 사람을 불렀다 (결정 21).
        if (e.meta?.from) name.appendChild(el('span', 'fromtag', `${teams.find((t) => t.id === e.meta.from)?.room ?? e.meta.from}에서`));
        stack.appendChild(name);
      }
      // 대표를 불렀다 — 멘션 표시 (결정 19-2).
      if (called) stack.appendChild(el('div', 'callmark', '@ 대표님을 불렀습니다'));
      stack.appendChild(bubble(e.text));
      row.appendChild(stack);
      return row;
    }
  }
}

/* ── 연속 도구 줄 접기 ──
 * "Read · /Users/…/worktrees/…" 가 18줄 연속으로 대표 화면을 채웠다 (결정 30). 같은 사람의 연속 도구 이벤트는
 * 한 줄 — "테라 · 파일 7개 읽고 11개 고치는 중 (app.js, style.css …)" — 사람·동사·파일 이름만, 전체 경로 없음.
 * 펼치면 목록. 다른 이벤트가 오면 "…중" 이 "…함" 으로 바뀐다. */
let toolGroup = null;   // { actor, node, sum, list, items: [{tool, text}] }

const VERB = { Read: '읽', Edit: '고치', Write: '고치', NotebookEdit: '고치', MultiEdit: '고치', WebFetch: '가져오', WebSearch: '찾' };
const DONE = { 읽: '읽음', 고치: '고침', 가져오: '가져옴', 찾: '찾음', 쓰: '씀' };
const baseName = (s) => String(s ?? '').replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';

function groupLabel(g, live) {
  const by = {};
  for (const it of g.items) { const v = VERB[it.tool] ?? '쓰'; by[v] = (by[v] ?? 0) + 1; }
  const parts = Object.entries(by);
  // 어간 + 어미: "읽고" · "읽는 중" · "읽음". 끝난 꼴(DONE)은 어간을 포함한 온전한 말이라 어간을 다시 붙이지 않는다 (레오 감사).
  const verbs = parts.map(([v, n], i) => `${n}개 ${i < parts.length - 1 ? v + '고' : live ? v + '는 중' : DONE[v]}`).join(' ');
  const names = [...new Set(g.items.map((it) => baseName(it.text)).filter(Boolean))];
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '');
  return `${who(g.actor).name} · 파일 ${verbs}${shown ? ` (${shown})` : ''}`;
}

function closeToolGroup() {
  if (!toolGroup) return;
  toolGroup.sum.textContent = groupLabel(toolGroup, false);
  toolGroup = null;
}

function drawTool(e, frag) {
  if (!toolGroup || toolGroup.actor !== e.actor) {
    closeToolGroup();
    const node = el('details', 'toolgroup');
    const summary = el('summary');
    summary.appendChild(svg('M9 6l6 6-6 6'));
    const sum = el('span');
    summary.appendChild(sum);
    node.appendChild(summary);
    const list = el('ul');
    node.appendChild(list);
    if (e.id) node.dataset.id = e.id;
    frag.appendChild(node);
    toolGroup = { actor: e.actor, node, sum, list, items: [] };
  }
  const tool = e.meta?.tool ?? '도구';
  toolGroup.items.push({ tool, text: e.text });
  const li = el('li', null, `${tool} · ${baseName(e.text) || e.text}`);
  li.title = e.text;
  toolGroup.list.appendChild(li);
  toolGroup.sum.textContent = groupLabel(toolGroup, true);
}

/** 날짜가 바뀌면 날짜 표시를 끼워넣는다 (카톡처럼). */
function drawWithDay(e, frag) {
  const d = dayOf(e.ts);
  if (d !== lastDay) {
    lastDay = d;
    lastActor = null;
    closeToolGroup();
    frag.appendChild(el('div', 'daymark', d));
  }
  if (e.type === 'tool') { lastActor = null; drawTool(e, frag); return; }
  closeToolGroup();
  const n = draw(e);
  if (e.id) n.dataset.id = e.id;                    // 마을의 말풍선 ↗ 가 여기로 건너온다
  frag.appendChild(n);
}

function emptyView() {
  const n = el('div', 'quiet');
  const s = svg('M4 5h16M4 12h16M4 19h9', 30, 1.4);
  s.style.opacity = '.45';
  n.appendChild(s);
  n.appendChild(el('div', 'quiet__t', '아직 조용합니다'));
  const p = el('div', 'quiet__s');
  p.textContent = '위의 "라운드 열기" 를 누르고 주제를 적으면 실무가 일을 시작합니다.';
  n.appendChild(p);
  return n;
}

const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;

function paint(events, { replace = true } = {}) {
  if (replace) {
    stream.replaceChildren();
    lastActor = null; lastDay = null; toolGroup = null;
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
  cast = r.cast; roadmap = r.roadmap; summary = r.summary; journal = r.journal ?? {};
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

/** 위쪽 한 페이지를 더 불러온다. 불러온 게 있으면 true. */
async function loadOlder() {
  if (!hasMore || !oldest) return false;
  const keepH = feed.scrollHeight, keepT = feed.scrollTop;
  const r = await fetch(`/api/log?team=${encodeURIComponent(active)}&before=${oldest}`).then((x) => x.json());
  if (!r.events.length) { hasMore = false; $('loadMore').hidden = true; return false; }

  // 위쪽에 끼워넣고 스크롤 위치를 유지한다.
  const frag = document.createDocumentFragment();
  const saveActor = lastActor, saveDay = lastDay, saveGroup = toolGroup;
  lastActor = null; lastDay = null; toolGroup = null;
  for (const e of r.events) drawWithDay(e, frag);
  closeToolGroup();   // 위쪽에 끼운 묶음은 끝난 것이다
  lastActor = saveActor; lastDay = saveDay; toolGroup = saveGroup;
  stream.insertBefore(frag, stream.firstChild);

  oldest = r.events[0]?.id ?? oldest;
  hasMore = r.more;
  $('loadMore').hidden = !hasMore;
  feed.scrollTop = keepT + (feed.scrollHeight - keepH);
  return true;
}
$('loadMoreBtn').addEventListener('click', loadOlder);

/**
 * 마을 → 작전실. 그 팀 방을 열고 발언 하나를 가운데로 데려와 잠깐 빛낸다.
 * 화면에 없는 오래된 발언이면 위쪽을 더 불러오며 찾는다(최대 30쪽).
 */
async function jumpTo(team, id) {
  if (team && team !== active && teams.some((x) => x.id === team)) await selectTeam(team);
  setView('room');
  if (!id) return;
  const find = () => stream.querySelector(`[data-id="${CSS.escape(id)}"]`);
  let n = find();
  for (let i = 0; !n && i < 30; i++) { if (!(await loadOlder())) break; n = find(); }
  if (!n) return;
  n.scrollIntoView({ block: 'center' });
  n.classList.remove('is-hit'); void n.offsetWidth; n.classList.add('is-hit');
}

/* ── 연결 ── */

let ws = null, retry = 0, everOpened = false;

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.onopen = () => {
    retry = 0;
    const d = $('liveDot'); if (d) d.dataset.on = '1';
    // 끊겼다 붙었다. 그 사이 발언은 소켓으로 안 왔다 — 보던 방을 다시 불러온다. 안 그러면 화면이 조용히 빠진다.
    if (everOpened && active) selectTeam(active).then(() => { if (view === 'tower') renderTower(); if (view === 'analysis') loadAnalysis(); });
    everOpened = true;
  };
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
      World.onSummaries(summaries);
      renderRail(); renderHead(); renderSide();
      // 승인 대기 블록은 모든 탭 맨 위에 있다. 대기 건수가 움직였을 때만 목록을 다시 받는다 — 250ms 마다 받을 이유가 없다.
      const pend = Object.values(summaries).reduce((n, s) => n + (s.approvals?.pending ?? 0), 0);
      if (pend !== pendingMark) {
        pendingMark = pend;
        fetch('/api/approvals').then((r) => r.json()).then((a) => { approvals = a.pending ?? []; told = a.told ?? told; renderApprovals(); renderBossBadge(); if (view === 'tower') renderTower(); }).catch(() => {});
      } else if (view === 'tower') renderTower();
      // 분석은 값이 실제로 움직였을 때만 다시 불러온다. 250ms 마다 받아올 이유가 없다.
      if (view === 'analysis') {
        const s = summaries[active] ?? {};
        if (`${s.round}:${s.logCount}:${s.phase}` !== anMark) loadAnalysis();
      }
      return;
    }
    if (msg.kind === 'world') { World.onWorld(msg.world); return; }   // 세상의 시계 — 자리·루틴 (W2)
    if (msg.kind === 'hello' && msg.world) World.onWorld(msg.world);
    if (msg.kind === 'events') {
      World.onEvents(msg.team, msg.events);          // 마을은 모든 방을 한 화면에 본다
      if (msg.team === active) {
        append(msg.events);
      } else {
        // 도구 줄은 발언이 아니다. 안 읽음 배지가 도구 호출로 부풀면 배지가 의미를 잃는다.
        unread[msg.team] = (unread[msg.team] ?? 0) + msg.events.filter((e) => e.type !== 'tool').length;
        if (unread[msg.team] > 0) renderRail();
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

// 라운드 밖에서 보낸 지시. 열기 폼의 주제가 이걸로 채워지고, 라운드가 열리면 첫 지시로 보낸다.
let pendingSay = null;

const showOpen = (on, { topic = '' } = {}) => {
  $('roundOpen').hidden = !on;
  if (on) { $('roundTopic').value = topic; $('roundMs').value = ''; $('roundTopic').focus(); }
  else pendingSay = null;
};

$('roundBtn').addEventListener('click', async () => {
  if (!active) return;
  const open = summary.phase === 'running' || summary.phase === 'blocked';
  if (!open) return showOpen($('roundOpen').hidden);

  // 판정은 감사역이 낸다. 여기서 닫는 건 판정 없이 라운드를 접는 것이다.
  if (!confirm(`라운드 ${summary.round} 을 닫습니다.\n\n대화록은 그대로 남고, 다음 라운드는 새 컨텍스트로 시작합니다.`)) return;
  const r = await post('/api/round', { team: active, action: 'end' });
  if (!r.ok) say(r.data.error ?? '라운드를 닫지 못했습니다.');
  else if (r.data.deferred) say('실무가 일하는 중입니다. 이 턴이 끝나면 닫힙니다.', 10000);
  else if (r.data.accepted) say('닫는 중 — 자리마다 일지 한 문단을 받은 뒤 닫힙니다. 끝나면 방에 안내가 남습니다.', 10000);
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
  const first = pendingSay;
  showOpen(false);
  $('input').focus();
  // 라운드 밖에서 보낸 지시가 있었다 — 열렸으니 그 말을 첫 지시로 넣는다.
  if (first) { $('input').value = ''; fitInput(); sendSay(first); }
});

/* ── 지시 ── */

const input = $('input');

/** 여러 줄 입력창의 높이를 내용에 맞춘다 (한 줄 ~ 화면의 40%). */
function fitInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + 'px';
}
input.addEventListener('input', fitInput);

// Enter 는 보내기, Shift+Enter 는 줄바꿈. 한글 조합 중(isComposing)의 Enter 는 조합 확정이라 보내지 않는다.
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
  e.preventDefault();
  $('composer').requestSubmit();
});
// 폰 자판에는 Shift+Enter 가 없다 — 줄바꿈 버튼.
$('composerNl').addEventListener('click', () => {
  const { selectionStart: s, selectionEnd: t, value } = input;
  input.value = value.slice(0, s) + '\n' + value.slice(t);
  input.selectionStart = input.selectionEnd = s + 1;
  fitInput(); input.focus();
});

async function sendSay(text) {
  // 말풍선은 여기서 그리지 않는다. 지시가 세션에 들어가면 훅이 남긴다.
  let r;
  try {
    r = await post('/api/say', { text, team: active });
  } catch {
    input.value = text; fitInput();
    return say('서버에 닿지 못했습니다.');
  }
  if (!r.ok) {
    input.value = text; fitInput();
    say(r.data.error ?? '지시를 전달하지 못했습니다.');
    if (r.data.needsRound) { pendingSay = text; showOpen(true, { topic: text.split('\n')[0].slice(0, 80) }); }
  }
}

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !active) return;
  input.value = ''; fitInput();
  say(null);
  const office = teams.find((x) => x.id === active)?.kind === 'office';
  const open = office || summary.phase === 'running' || summary.phase === 'blocked';
  // 라운드 밖이다 — 보내지 않고, 첫 줄을 주제로 채운 열기 폼을 띄운다. 열리면 이 말이 첫 지시가 된다 (결정 19).
  if (!open) { pendingSay = text; input.value = text; fitInput(); showOpen(true, { topic: text.split('\n')[0].slice(0, 80) }); return; }
  sendSay(text);
});

/* ── 상황판 서랍 (좁은 화면) ── */

const openSide = (on) => { app.dataset.side = on ? '1' : '0'; $('scrim').hidden = !on; };
$('sideToggle').addEventListener('click', () => openSide(app.dataset.side !== '1'));
$('sideClose').addEventListener('click', () => openSide(false));
$('scrim').addEventListener('click', () => openSide(false));

/* ══ 화면 전환 ══ */

let view = 'room';
const VIEWS = new Set(['room', 'tower', 'analysis', 'world']);

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
  // 마을은 열려 있을 때만 그린다. 닫히면 rAF 를 멈춘다 — 관람은 공짜여야 한다.
  if (v === 'world') World.open({ teams, jump: jumpTo }).catch(() => {}); else World.close();
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

/* 승인 대기. 대표가 돌아왔을 때 200발언을 읽지 않고 이것부터 본다. */
function renderApprovals() {
  const box = $('approvals');
  box.replaceChildren();
  if (!approvals.length) { box.hidden = true; return; }
  box.hidden = false;
  box.appendChild(el('div', 'approvals__k', `승인 대기 ${approvals.length}건`));
  for (const r of approvals) {
    const row = el('div', 'apr');
    const g = el('span', 'apr__g', r.grade); g.dataset.g = r.grade; g.title = grades[r.grade]?.desc ?? '';
    row.appendChild(g);
    const t = teams.find((x) => x.id === r.team);
    row.appendChild(el('span', 'apr__team', `${t?.name ?? r.team} · ${(summaries[r.team]?.cast ?? {})[r.by]?.name ?? r.by}`));
    const w = el('div', 'apr__what', r.what);
    if (r.detail) w.appendChild(el('small', null, r.detail));
    row.appendChild(w);
    if (r.grade === 'C') {
      const act = el('div', 'apr__act');
      const err = el('div', 'apr__err'); err.hidden = true;
      const reasonBox = el('input', 'apr__reason'); reasonBox.type = 'text'; reasonBox.placeholder = '반려 이유'; reasonBox.hidden = true;
      const decide = async (d) => {
        const reason = d === 'REVISE' ? reasonBox.value.trim() : '';
        if (d === 'REVISE' && !reason) { reasonBox.hidden = false; reasonBox.focus(); return; }
        const res = await post('/api/approvals', { id: r.id, decision: d, reason });
        if (!res.ok) { err.textContent = res.data.error ?? '판정하지 못했습니다.'; err.hidden = false; }
        else { approvals = approvals.filter((x) => x.id !== r.id); renderApprovals(); renderBossBadge(); }
      };
      for (const d of ['PASS', 'REVISE']) {
        const b = el('button', null, d === 'PASS' ? '승인' : '반려'); b.type = 'button'; b.dataset.d = d;
        b.addEventListener('click', () => decide(d));
        act.appendChild(b);
      }
      reasonBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); decide('REVISE'); } });
      row.appendChild(act);
      row.appendChild(reasonBox);
      row.appendChild(err);
    } else {
      // 누가 판정했고 누가 남았나 — 이름으로. 그리고 총괄실이 이 요청을 들었는가.
      const hq = summaries.hq?.cast ?? {};
      const nameOf = (id) => hq[id]?.name ?? id;
      const need = (grades[r.grade]?.needs ?? []);
      const done = r.decisions.map((x) => `${nameOf(x.by)} ${x.decision}`).join(' · ');
      const left = need.filter((w) => !r.decisions.some((x) => x.by === w)).map(nameOf).join('·');
      const heard = told[r.id]?.requested ? '총괄실에 알림 ✓' : '총괄실에 아직 안 알림 — 서버가 다음 틱에 알립니다';
      row.appendChild(el('span', 'apr__wait', `${done ? done + ' · ' : ''}${left ? left + ' 대기' : ''} · ${heard}`));
    }
    box.appendChild(row);
  }
}

function renderTower() {
  renderApprovals();
  const grid = $('towerGrid');
  const focus = document.activeElement;
  const keep = focus?.classList?.contains('tcard__in')
    ? { team: focus.dataset.team, pos: focus.selectionStart } : null;

  grid.replaceChildren();

  for (const t of teams) {
    const s = summaries[t.id] ?? {};
    const agents = s.cast ?? {};
    const office = t.kind === 'office';       // 총괄실은 라운드가 없다. 늘 열려 있다
    const running = office || s.phase === 'running' || s.phase === 'blocked';

    const card = el('div', 'tcard');
    card.dataset.alert = s.needsBoss ? '1' : '0';

    // 이름과 상태
    const top = el('div', 'tcard__top');
    const name = el('span', 'tcard__name', t.room ?? t.name);
    name.title = '이 작전실 열기';
    name.addEventListener('click', async () => { await selectTeam(t.id); setView('room'); });
    top.appendChild(name);
    const flag = el('span', 'tcard__flag',
      s.needsBoss ? '대표 호출' : office ? '1:1' : running ? '진행 중' : '대기');
    flag.dataset.k = s.needsBoss ? 'boss' : running ? 'run' : 'idle';
    top.appendChild(flag);
    card.appendChild(top);

    // 라운드와 마일스톤
    const ms = el('div', 'tcard__ms');
    ms.appendChild(el('b', null, office ? '1:1' : s.round ? `R${s.round}` : 'R—'));
    ms.append(' ');
    ms.append(office
      ? '대표와 톰. 여기서 지시하면 팀에 나눠집니다'
      : s.round
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
    if (s.approvals?.pending) meta.appendChild(el('span', 'rwork', `승인 대기 ${s.approvals.pending}`));
    if (s.session?.busy) meta.appendChild(el('span', 'rwork', '일하는 중'));
    card.appendChild(meta);

    // 중간 상황 — teams/<팀>/progress.json. 로드맵이 목적지라면 이건 지금 위치다.
    // 대표가 돌아와 30초 안에 "어디까지 왔고 무엇이 막혔나"를 보는 자리 (M5 의 조각).
    if (s.progress) {
      const p = s.progress;
      const prog = el('details', 'tcard__prog');
      const n = (k) => (p[k]?.length ?? 0);
      prog.appendChild(el('summary', null,
        `상황 · 하는 중 ${n('doing')} · 한 것 ${n('done')} · 남은 것 ${n('left')}` + (n('issues') ? ` · 이슈 ${n('issues')}` : '')));
      for (const [k, label] of [['doing', '하는 중'], ['issues', '이슈'], ['done', '한 것'], ['left', '남은 것']]) {
        const items = p[k] ?? [];
        if (!items.length) continue;
        const h = el('div', 'tcard__progk', label); h.dataset.k = k;
        prog.appendChild(h);
        const ul = el('ul');
        for (const it of items) ul.appendChild(el('li', null, it));
        prog.appendChild(ul);
      }
      if (p.at) prog.appendChild(el('div', 'tcard__quiet', `${ago(p.at)}${p.by ? ' · ' + p.by : ''}`));
      card.appendChild(prog);
    }

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
    box.placeholder = office ? '톰에게 지시하기' : s.phase === 'blocked' ? '대표 판단을 적으면 재개' : running ? '지시하기' : '라운드 주제를 쓰고 열기';
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
        else if (r.data.deferred) fail('실무가 일하는 중입니다. 이 턴이 끝나면 닫힙니다.');
        else if (r.data.accepted) fail('닫는 중 — 일지를 받은 뒤 닫힙니다. 끝나면 방에 안내가 남습니다.');
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
      (office || running) ? doSay() : doRound();
    });

    const btn = el('button', 'tcard__r', running ? '라운드 닫기' : '라운드 열기');
    btn.type = 'button';
    btn.hidden = office || s.phase === 'blocked';   // 막힌 방은 대표가 말해 풀기 전엔 닫히지 않는다
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
approvals = boot.approvals ?? [];
told = boot.told ?? {};
grades = boot.grades ?? {};
for (const t of teams) unread[t.id] = 0;
pendingMark = Object.values(summaries).reduce((n, s) => n + (s.approvals?.pending ?? 0), 0);
connect();

const [hashTeam, hashView] = location.hash.slice(1).split('/');
await selectTeam(teams.some((t) => t.id === hashTeam) ? hashTeam : boot.defaultTeam);
renderApprovals();
// 부팅 — 주소에 화면이 없으면: 대표 차례가 있으면 관제탑, 아니면 방 (G-UX).
setView(hashView ?? (bossTurns().n ? 'tower' : 'room'));
