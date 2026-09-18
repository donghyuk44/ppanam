/* ── 타임라인 탭 (타임라인 계획-0916 2절 · 헨리 ui-spec 13절 3판-b · 결정 187·188) — 팀 → 단계(프로젝트) → 작업 나무 + 주 칸.
 * 재료는 /api/timeline 하나(솔라 cc23d69: bus.weeksOf·timelineTeamOf — rounds.jsonl 실측 주 묶기 + work.json 작업). 옛 순서 칸 띠(loadDashboardBand, /api/dashboard)는 버렸다(계획 4절 7).
 * 폰 412: 팀마다 카드 둘 — 나무 카드(머리 + 줄) + 얇은 주 칸 카드(기둥 넷: 지난 주 · 이번 주 · 다음 · 그 뒤). 날짜 글자는 지난 주·이번 주 머리 둘뿐, 앞일 칸엔 없다(188).
 * 첫 층 '대표님이 시킨 일'(34회차, 하영 ahead-five.md)은 그대로 위에. 낱말은 계획 2절 표준 낱말·ui-spec 13절 안 — 하영 낱말 아홉이 오면 그 글자로.
 */
let tlMark = '';
const TASK_DOT = { '통과': 'done', '진행': 'live', '감사 대기': 'wait', '대기': 'idle', '막힘': 'bad', '안 함': 'off' };   // 상태 점(ui-spec 13절): 완료 초록 · 진행 중 먹 · 감사 대기 놋쇠 · 대기 회색 · 막힘 빨강
const weekMD = (key) => { const [, m, d] = String(key).split('-'); return `${Number(m)}/${Number(d)}`; };   // '2026-09-07' → '9/7' — 지난 주·이번 주 머리에만
const shortTitle = (s) => String(s ?? '').split(/\s*(?:—|∥|\()\s*/)[0].trim() || String(s ?? '');   // 단계 제목은 첫 구분 기호 앞까지 — 뒤 꼬리(결정 번호·괄호)는 자에 걸리는 하네스 말(140). 전문은 title 에
function loadDashboard() {
  loadAheadFive(() => loadDashboard());
  return fetch('/api/timeline').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((r) => {
    const body = $('dashBody');
    for (const id of ['dashBand', 'dashGates']) { const n = $(id); n.replaceChildren(); n.hidden = true; }   // 옛 띠·문 상자는 비우고 숨긴다(빈 상자가 회색 줄로 남는다, 1280 실측)
    if (!r) { body.replaceChildren(el('p', 'tcard__quiet', '타임라인 로딩 실패 — 서버 재시작 필요')); return; }
    const mark = JSON.stringify([r.weeks, ahead.lines, (r.teams ?? []).map((t) => [t.id, t.signals, (t.projects ?? []).map((p) => [p.n, p.status, p.weeks, (p.tasks ?? []).map((k) => [k.id, k.status, k.seat, k.ready, k.doneAt, k.what])])])]);
    if (tlMark === mark) return;   // 안 바뀌었으면 다시 안 그린다(펼친 줄이 닫히지 않게)
    tlMark = mark;
    body.replaceChildren();
    if (ahead.lines.length) {
      const first = el('section', 'dash__card'); first.id = 'dashAhead'; first.dataset.block = 'ahead';
      first.appendChild(el('div', 'dash__k', '대표님이 시킨 일'));
      for (const a of ahead.lines) first.appendChild(el('div', 'card__text', a.text));
      body.appendChild(first);
    }
    // 기둥 넷 — 지난 주(마지막 지난 주 키) · 이번 주 · 다음 · 그 뒤. 이번 주에 회차가 없으면 이번 주 칸은 날짜 없이 '이번 주'.
    const weeks = r.weeks ?? [];
    const thisW = weeks.find((w) => w.label === '이번 주') ?? null;
    const past = weeks.filter((w) => w.label !== '이번 주');
    const prevW = past.length ? past[past.length - 1] : null;
    const cols = [
      { key: prevW?.key ?? null, head: prevW ? `지난 주 ${weekMD(prevW.key)}` : '지난 주' },
      { key: thisW?.key ?? null, head: thisW ? `이번 주 ${weekMD(thisW.key)}` : '이번 주' },
      { key: 'next', head: '다음' },
      { key: 'after', head: '그 뒤' },
    ];
    for (const t of r.teams ?? []) body.append(...timelineTeam(t, cols));
  });
}
/** 팀 하나 — 카드 둘(나무 · 주 칸). 얼굴은 portraits/chip128(withFace), 담당이 비면 빨간 칩 "담당 없음". */
function timelineTeam(t, cols) {
  const cast = summaries[t.id]?.cast ?? {};
  const color = teamColor(t.id);
  const projects = t.projects ?? [];
  const passed = projects.filter((p) => p.status === 'pass');
  const open = projects.filter((p) => p.status !== 'pass');
  // ── 나무 카드 ──
  const card = el('section', 'dash__card tl__card'); card.dataset.team = t.id;
  const head = el('div', 'tl__head');
  const tile = el('span', 'card__tile', String(t.name ?? '?').slice(0, 1)); tile.style.background = color;
  head.appendChild(tile);
  head.appendChild(el('b', 'tl__name', t.name));
  const sig = t.signals ?? {};
  const chips = el('div', 'tl__chips');
  for (const [label, n, k] of [['끝난 것', sig.done ?? 0, 'good'], ['막힌 것', sig.blocked ?? 0, 'bad'], ['담당 없음', sig.unassigned ?? 0, 'bad']]) {
    const c = el('span', 'tl__chip', `${label} ${n}`); c.dataset.k = n > 0 ? k : 'zero'; chips.appendChild(c);
  }
  head.appendChild(chips);
  card.appendChild(head);
  if (passed.length) {
    // 끝난 단계는 ✓ 로 접힌다(보관소, 계획 2절) — 펼치면 제목만
    const fold = el('details', 'tl__fold');
    fold.appendChild(el('summary', null, `✓ 끝난 단계 ${passed.length} · ${passed[0].n}~${passed[passed.length - 1].n}단계`));
    for (const p of passed) { const d = el('div', 'tl__stage tl__stage--pass', `${p.n}단계 ${shortTitle(p.title)}`); d.title = p.title; fold.appendChild(d); }
    card.appendChild(fold);
  }
  for (const p of open) {
    const row = el('div', `tl__stage tl__stage--${p.status ?? 'none'}`);
    const title = el('span', 'tl__title', p.n != null ? `${p.n}단계 ${shortTitle(p.title)}` : p.title); title.title = p.title;
    row.appendChild(title);
    if (p.status === 'now') row.appendChild(pill('진행 중', 'live'));
    card.appendChild(row);
    // 작업 줄 — 진행 중 단계와 '단계 없음' 묶음만 펼친다. 대기 단계는 제목만(계획 2절). 끝난 작업(☑)은 줄에 남지 않고 접힌다(계획 2절 "체크되서 넘어가는 것처럼" — 수는 주 칸에).
    if (p.status === 'now' || p.n == null) {
      const tasks = p.tasks ?? [];
      for (const k of tasks.filter((x) => x.status !== '통과')) card.appendChild(taskRow(t, k, cast));
      const done = tasks.filter((x) => x.status === '통과');
      if (done.length) {
        const fold = el('details', 'tl__fold tl__fold--tasks');
        fold.appendChild(el('summary', null, `☑ 끝난 작업 ${done.length}`));
        for (const k of done) fold.appendChild(taskRow(t, k, cast));
        card.appendChild(fold);
      }
    }
  }
  // ── 주 칸 카드 ── 줄 = 단계(지난 주·이번 주에 돈 것, 진행 중, 대기), 칸 넷. 지난 것은 실측 막대(회차 수 · ✓), 앞은 날짜 없는 칩.
  const wk = el('section', 'dash__card tl__weeks'); wk.dataset.team = t.id;
  const grid = el('div', 'tl__grid');
  grid.appendChild(el('span', 'tl__gh tl__gh--first', ''));
  for (const c of cols) grid.appendChild(el('span', 'tl__gh', c.head));
  const [prev, cur] = cols;
  const thisKey = cur.key;
  const rows = projects.filter((p) => p.status !== 'pass' || (prev.key && p.weeks?.[prev.key]) || (thisKey && p.weeks?.[thisKey]));
  for (const p of rows) {
    grid.appendChild(el('span', 'tl__gl', p.n != null ? `${p.n}단계` : '단계 없음'));
    const tasks = p.tasks ?? [];
    const doneThisWeek = thisKey ? tasks.filter((k) => k.doneAt && k.doneAt.slice(0, 10) >= thisKey).length : 0;
    const ready = tasks.filter((k) => k.ready).length;
    const held = tasks.filter((k) => k.status === '대기' && !k.ready).length;
    const blocked = tasks.filter((k) => k.status === '막힘').length;
    const cell = (kind, text) => { const s = el('span', 'tl__cell'); if (text) { const b = el('i', `tl__bar tl__bar--${kind}`, text); s.appendChild(b); } grid.appendChild(s); };
    // 막대 글자 — 지난 주는 "N회차 (✓)", 이번 주는 진행 중 단계면 "N회차 · 끝난 것 N"(이번 주 doneAt 수 — 지난 주 칸엔 안 붙인다, code-review)
    const bar = (w, { thisWeek = false } = {}) => (w ? `${w.rounds}회차${w.pass ? ' ✓' : thisWeek && p.status === 'now' && doneThisWeek ? ` · 끝난 것 ${doneThisWeek}` : ''}` : '');
    cell(p.status === 'pass' ? 'pass' : 'now', bar(prev.key ? p.weeks?.[prev.key] : null));
    cell(p.status === 'pass' ? 'pass' : 'now', bar(thisKey ? p.weeks?.[thisKey] : null, { thisWeek: true }));
    // 다음: 시작할 수 있는 작업(뒤에 걸린 게 없거나 풀림, isReady) · 대기 단계는 앞 단계 뒤. 그 뒤: 뒤에 걸린 작업 · 막힌 것. 날짜·시각 글자 없음(188).
    cell('next', ready ? `시작할 수 있어요 ${ready}` : p.status === 'wait' ? `${(p.n ?? 1) - 1}단계 뒤` : '');
    cell(blocked ? 'bad' : 'after', blocked ? `막힌 것 ${blocked}` : held ? `뒤에 걸림 ${held}` : '');
  }
  wk.appendChild(grid);
  return [card, wk];
}
/** 작업 한 줄 — ☐/☑ · 담당 얼굴 칩 20(없으면 빨간 "담당 없음") · 이름 · 상태 점. "뒤에: ○○" 는 API 에 이름이 아직 없어 안 쓴다(솔라 after 이름 실으면). */
function taskRow(t, k, cast) {
  const row = el('div', 'tl__task'); row.dataset.status = k.status;
  const done = k.status === '통과';
  row.appendChild(el('span', 'tl__box', done ? '☑' : '☐'));
  if (k.seat) {
    const a = cast[k.seat] ?? summaries.hq?.cast?.[k.seat] ?? null;
    const chip = el('span', 'tl__face', a?.initial ?? String(k.seat).slice(0, 1)); chip.style.background = a?.color ?? 'var(--ink-4)'; chip.title = a?.name ?? k.seat;
    row.appendChild(withFace(chip, t.id, k.seat));
  } else row.appendChild(el('span', 'tl__face tl__face--none', '담당 없음'));
  const what = String(k.what ?? '').trim();
  const text = el('span', `tl__what${done ? ' tl__what--done' : ''}`, what && what !== NOT_YET ? what : '아직 쉬운 말로 안 적음');   // 자에 안 맞는 줄은 서버가 NOT_YET 으로 준다 — 그 글자는 안 찍는다(결정 140)
  if (!what || what === NOT_YET) text.dataset.notyet = '1';
  row.appendChild(text);
  const dot = el('i', 'tl__dot'); dot.dataset.k = TASK_DOT[k.status] ?? 'idle'; dot.title = k.status; row.appendChild(dot);
  return row;
}

