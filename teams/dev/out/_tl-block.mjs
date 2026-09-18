/* ── 타임라인 탭 (타임라인 계획-0916 2절 · 헨리 ui-spec 13절 3판-b · 결정 187·188) — 팀 → 단계(프로젝트) → 작업 나무 + 주 칸.
 * 재료는 /api/timeline 하나(솔라 cc23d69: bus.weeksOf·timelineTeamOf — rounds.jsonl 실측 주 묶기 + work.json 작업). 옛 순서 칸 띠(loadDashboardBand, /api/dashboard)는 버렸다(계획 4절 7).
 * 폰 412: 팀마다 카드 둘 — 나무 카드(머리 + 줄) + 얇은 주 칸 카드(기둥 넷: 지난 주 · 이번 주 · 다음 · 그 뒤). 날짜 글자는 지난 주·이번 주 머리 둘뿐, 앞일 칸엔 없다(188).
 * 첫 층 '대표님이 시킨 일'(34회차, 하영 ahead-five.md)은 그대로 위에. 낱말은 계획 2절 표준 낱말·ui-spec 13절 안 — 하영 낱말 아홉이 오면 그 글자로.
 */
let tlMark = '';
const TASK_DOT = { '통과': 'done', '진행': 'live', '감사 대기': 'wait', '대기': 'idle', '막힘': 'bad', '안 함': 'off' };   // 상태 점(ui-spec 13절): 완료 초록 · 진행 중 먹 · 감사 대기 놋쇠 · 대기 회색 · 막힘 빨강
const weekMD = (key) => { const [, m, d] = String(key).split('-'); return `${Number(m)}/${Number(d)}`; };   // '2026-09-07' → '9/7' — 지난 주·이번 주 머리에만
const shortTitle = (s) => String(s ?? '').split(/\s*(?:—|∥|\()\s*/)[0].trim() || String(s ?? '');   // 단계 제목은 첫 구분 기호 앞까지 — 뒤 꼬리(결정 번호·괄호)는 자에 걸리는 하네스 말(140). 전문은 title 에
/** 그 시각이 든 주의 월요일 날짜(YYYY-MM-DD, 우리 시각) — 서버 bus.weekKeyOf 와 같은 식(서울 자정 → 그 요일만큼 물러남 → +9시간 해서 읽음). 작업 doneAt 을 주 칸에 놓는 데 쓴다. */
const tlWeekKey = (ts) => { const ms = Date.parse(ts); if (Number.isNaN(ms)) return null; const OFF = 9 * 3600_000; const day0 = Math.floor((ms + OFF) / DAY) * DAY - OFF; const dow = new Date(day0 + OFF).getUTCDay(); return new Date(day0 - ((dow + 6) % 7) * DAY + OFF).toISOString().slice(0, 10); };
function loadDashboard() {
  loadAheadFive(() => loadDashboard());
  return fetch('/api/timeline').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((r) => {
    const body = $('dashBody');
    for (const id of ['dashBand', 'dashGates']) { const n = $(id); n.replaceChildren(); n.hidden = true; }   // 옛 띠·문 상자는 비우고 숨긴다(빈 상자가 회색 줄로 남는다, 1280 실측)
    if (!r) { body.replaceChildren(el('p', 'tcard__quiet', '타임라인 로딩 실패 — 서버 재시작 필요')); return; }
    const wide = window.innerWidth >= 700;   // 폴드 750·PC 1280: 팀 카드 하나에 왼쪽 나무(폴드 300 · PC 480, CSS) + 오른쪽 기둥 넷(13절). 폰 412: 카드 둘.
    const mark = JSON.stringify([wide, r.weeks, ahead.lines, (r.teams ?? []).map((t) => [t.id, t.signals, (t.projects ?? []).map((p) => [p.n, p.status, p.weeks, (p.tasks ?? []).map((k) => [k.id, k.status, k.seat, k.ready, k.doneAt, k.what])])])]);
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
    if (wide) {
      // 기둥 머리 한 줄(PC) — 왼쪽 "팀 · 단계 · 작업" + 칸 넷. 폰은 팀마다 주 칸 카드 머리에.
      const colsRow = el('div', 'tl__cols');
      colsRow.appendChild(el('span', 'tl__gh tl__gh--first', '팀 · 단계 · 작업'));
      for (const c of cols) colsRow.appendChild(el('span', 'tl__gh', c.head));
      body.appendChild(colsRow);
      for (const t of r.teams ?? []) body.appendChild(timelineTeamWide(t, cols));
    } else for (const t of r.teams ?? []) body.append(...timelineTeam(t, cols));
  });
}
/** 팀 머리 — 팀 타일 · 이름 · 이번 주 요약 칩 셋(끝난 것 초록 · 막힌 것 · 담당 없음 — 0 은 회색, 1 이상은 빨강). 폰·PC 같은 부품. */
function timelineHead(t) {
  const head = el('div', 'tl__head');
  const tile = el('span', 'card__tile', String(t.name ?? '?').slice(0, 1)); tile.style.background = teamColor(t.id);
  head.appendChild(tile);
  head.appendChild(el('b', 'tl__name', t.name));
  const sig = t.signals ?? {};
  const chips = el('div', 'tl__chips');
  for (const [label, n, k] of [['끝난 것', sig.done ?? 0, 'good'], ['막힌 것', sig.blocked ?? 0, 'bad'], ['담당 없음', sig.unassigned ?? 0, 'bad']]) {
    const c = el('span', 'tl__chip', `${label} ${n}`); c.dataset.k = n > 0 ? k : 'zero'; chips.appendChild(c);
  }
  head.appendChild(chips);
  return head;
}
/** 칸 하나 — 막대(kind: pass 초록 · now 먹 · next/after 점선 · wait 놋쇠 · bad 빨강) 또는 빈 칸. */
function tlCell(kind, text) { const s = el('span', 'tl__cell'); if (text) s.appendChild(el('i', `tl__bar tl__bar--${kind}`, text)); return s; }
/** PC 1280 — 팀 카드 하나: 머리 + 격자(왼쪽 나무 줄 · 오른쪽 칸 넷). 줄마다 칸이 붙는다(13절 표) — 끝난 단계 접힘 줄엔 돈 주의 합, 진행 중 단계엔 회차 수, 작업엔 상태대로 ✓·하는 중·감사 대기·시작할 수 있어요·뒤에 걸림·막힌 것. */
function timelineTeamWide(t, cols) {
  const cast = summaries[t.id]?.cast ?? {};
  const projects = t.projects ?? [];
  const passed = projects.filter((p) => p.status === 'pass');
  const open = projects.filter((p) => p.status !== 'pass');
  const [prev, cur] = cols;
  const inWeek = (ts, key) => !!(ts && key && tlWeekKey(ts) === key);
  const card = el('section', 'dash__card tl__card tl__card--wide'); card.dataset.team = t.id;
  card.appendChild(timelineHead(t));
  const grid = el('div', 'tl__wgrid');
  const row = (left, cells) => { grid.appendChild(left); for (const c of cells) grid.appendChild(c); };
  const blank = () => tlCell('none', '');
  if (passed.length) {
    const fold = el('details', 'tl__fold');
    fold.appendChild(el('summary', null, `✓ 끝난 단계 ${passed.length} · ${passed[0].n}~${passed[passed.length - 1].n}단계`));
    for (const p of passed) { const d = el('div', 'tl__stage tl__stage--pass', `${p.n}단계 ${shortTitle(p.title)}`); d.title = p.title; fold.appendChild(d); }
    // 돈 주의 합 — 그 주에 돈 끝난 단계들의 회차 수 · ✓ 수
    const sum = (key) => { if (!key) return ''; let n = 0, ok = 0; for (const p of passed) { const w = p.weeks?.[key]; if (w) { n += w.rounds; if (w.pass) ok++; } } return n ? `${n}회차 · ✓ ${ok}` : ''; };
    row(fold, [tlCell('pass', sum(prev.key)), tlCell('pass', sum(cur.key)), blank(), blank()]);
  }
  for (const p of open) {
    const left = el('div', `tl__stage tl__stage--${p.status ?? 'none'}`);
    const title = el('span', 'tl__title', p.n != null ? `${p.n}단계 ${shortTitle(p.title)}` : p.title); title.title = p.title;
    left.appendChild(title);
    if (p.status === 'now') left.appendChild(pill('진행 중', 'live'));
    const tasks = p.tasks ?? [];
    const doneThisWeek = tasks.filter((k) => k.status === '통과' && inWeek(k.doneAt, cur.key)).length;   // 통과인 것만 — 다시 열린 작업의 옛 doneAt 은 안 센다(code-review)
    const bar = (w, thisWeek) => (w ? `${w.rounds}회차${w.pass ? ' ✓' : thisWeek && p.status === 'now' && doneThisWeek ? ` · 끝난 것 ${doneThisWeek}` : ''}` : '');
    if (p.status === 'wait' && p.n != null) row(left, [blank(), blank(), tlCell('next', `${p.n - 1}단계 뒤`), blank()]);
    else row(left, [tlCell('now', bar(prev.key ? p.weeks?.[prev.key] : null, false)), tlCell('now', bar(cur.key ? p.weeks?.[cur.key] : null, true)), blank(), blank()]);
    if (p.status !== 'now' && p.n != null) continue;   // 대기 단계는 제목만(계획 2절)
    // 작업 줄 — 끝난 것 중 지난 주·이번 주에 끝난 건 그 주 칸에 ✓ 로 남고, 그 밖 끝난 것은 접힘. 진행 중은 이번 주 "하는 중", 감사 대기는 놋쇠, 시작 가능은 다음 칸, 뒤에 걸림은 그 뒤 칸, 막힘은 빨강.
    const recentDone = tasks.filter((k) => k.status === '통과' && (inWeek(k.doneAt, prev.key) || inWeek(k.doneAt, cur.key)));
    const oldDone = tasks.filter((k) => k.status === '통과' && !recentDone.includes(k));
    for (const k of tasks.filter((x) => x.status !== '통과')) {
      const cells = [blank(), blank(), blank(), blank()];
      if (k.status === '진행') cells[1] = tlCell('now', '하는 중');
      else if (k.status === '감사 대기') cells[1] = tlCell('wait', '감사 대기');
      else if (k.status === '막힘') cells[1] = tlCell('bad', '막힌 것');
      else if (k.ready) cells[2] = tlCell('next', '시작할 수 있어요');
      else if (k.status === '대기') cells[3] = tlCell('after', '뒤에 걸림');
      row(taskRow(t, k, cast), cells);
    }
    for (const k of recentDone) row(taskRow(t, k, cast), [tlCell('pass', inWeek(k.doneAt, prev.key) ? '✓' : ''), tlCell('pass', inWeek(k.doneAt, cur.key) ? '✓' : ''), blank(), blank()]);
    if (oldDone.length) {
      const fold = el('details', 'tl__fold tl__fold--tasks');
      fold.appendChild(el('summary', null, `☑ 끝난 작업 ${oldDone.length}`));
      for (const k of oldDone) fold.appendChild(taskRow(t, k, cast));
      row(fold, [blank(), blank(), blank(), blank()]);
    }
  }
  card.appendChild(grid);
  return card;
}
/** 팀 하나 — 카드 둘(나무 · 주 칸). 얼굴은 portraits/chip128(withFace), 담당이 비면 빨간 칩 "담당 없음". */
function timelineTeam(t, cols) {
  const cast = summaries[t.id]?.cast ?? {};
  const projects = t.projects ?? [];
  const passed = projects.filter((p) => p.status === 'pass');
  const open = projects.filter((p) => p.status !== 'pass');
  // ── 나무 카드 ──
  const card = el('section', 'dash__card tl__card'); card.dataset.team = t.id;
  card.appendChild(timelineHead(t));
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
    const doneThisWeek = thisKey ? tasks.filter((k) => k.status === '통과' && k.doneAt && tlWeekKey(k.doneAt) === thisKey).length : 0;
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

