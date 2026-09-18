/* ── 타임라인 탭 (타임라인 계획-0916 2절 · 헨리 ui-spec 13절 3판-b · 결정 187·188) — 팀 → 단계(프로젝트) → 작업 나무 + 주 칸.
 * 재료는 /api/timeline 하나(솔라 cc23d69: bus.weeksOf·timelineTeamOf — rounds.jsonl 실측 주 묶기 + work.json 작업). 옛 순서 칸 띠(loadDashboardBand, /api/dashboard)는 버렸다(계획 4절 7).
 * 폰 412: 팀마다 카드 둘 — 나무 카드(머리 + 줄) + 얇은 주 칸 카드(기둥 넷: 지난 주 · 이번 주 · 다음 · 그 뒤). 날짜 글자는 지난 주·이번 주 머리 둘뿐, 앞일 칸엔 없다(188).
 * 맨 위는 우리의 목표 한 장(14절). 낱말은 하영 아홉(사전 111~125행)·ui-spec 13절 안.
 */
let tlMark = '';
const TASK_DOT = { '통과': 'done', '진행': 'live', '감사 대기': 'wait', '대기': 'idle', '막힘': 'bad', '안 함': 'off' };   // 상태 점(ui-spec 13절): 완료 초록 · 진행 중 먹 · 검토 기다림 놋쇠 · 대기 회색 · 막힘 빨강
const STATUS_WORD = { '통과': '완료', '진행': '진행 중', '감사 대기': '검토 기다림' };   // 보드 값 → 대표 화면 글자(하영 보통 말 표, req_d29407c3). 없는 값은 그대로.
const weekMD = (key) => { const [, m, d] = String(key).split('-'); return `${Number(m)}/${Number(d)}`; };   // '2026-09-07' → '9/7' — 지난 주·이번 주 머리에만
const shortTitle = (s) => String(s ?? '').split(/\s*(?:—|∥|\()\s*/)[0].trim() || String(s ?? '');   // 단계 제목 첫 구분 기호 앞까지 — 전문이 자에 안 맞을 때의 대안
/** 단계 제목 — 전문에서 "(결정 N…)" 꼬리만 떼고 자에 맞으면 그대로(헨리 3판-c 는 '—' 뒤까지 다 보인다), 안 맞으면 첫 구분 기호 앞까지. 원문은 title 에. */
const stageTitle = (s) => { const full = String(s ?? '').replace(/\s*\((?:결정\s*)?\d[^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim(); return full && bossOk(full) ? full : shortTitle(s); };   // 괄호 안 번호 꼬리 '(결정 N…)'·'(187: …)' 는 뗀다(하영 req_d29407c3 ②)
/** 자를 지난 줄인가 — 서버가 자에 안 맞는 글을 NOT_YET 으로 주니 그 글자는 안 찍는다(140). */
const okText = (s) => { const v = String(s ?? '').trim(); return v && v !== NOT_YET ? v : null; };
/** 그 시각이 든 주의 월요일 날짜(YYYY-MM-DD, 우리 시각) — 서버 bus.weekKeyOf 와 같은 식(서울 자정 → 그 요일만큼 물러남 → +9시간 해서 읽음). 작업 doneAt 을 주 칸에 놓는 데 쓴다. */
const tlWeekKey = (ts) => { const ms = Date.parse(ts); if (Number.isNaN(ms)) return null; const OFF = 9 * 3600_000; const day0 = Math.floor((ms + OFF) / DAY) * DAY - OFF; const dow = new Date(day0 + OFF).getUTCDay(); return new Date(day0 - ((dow + 6) % 7) * DAY + OFF).toISOString().slice(0, 10); };
function loadDashboard() {
  return fetch('/api/timeline').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((r) => {
    const body = $('dashBody');
    for (const id of ['dashBand', 'dashGates']) { const n = $(id); n.replaceChildren(); n.hidden = true; }   // 옛 띠·문 상자는 비우고 숨긴다(빈 상자가 회색 줄로 남는다, 1280 실측)
    if (!r) { body.replaceChildren(el('p', 'tcard__quiet', '타임라인 로딩 실패 — 서버 재시작 필요')); return; }
    const wide = window.innerWidth >= 700;   // 폴드 750·PC 1280: 팀 카드 하나에 왼쪽 나무(폴드 300 · PC 480, CSS) + 오른쪽 기둥 넷(13절). 폰 412: 카드 둘.
    const mark = JSON.stringify([wide, r.weeks, r.goal ?? null, (r.teams ?? []).map((t) => [t.id, t.destination ?? null, t.signals, (t.projects ?? []).map((p) => [p.n, p.status, p.weeks, (p.tasks ?? []).map((k) => [k.id, k.status, k.seat, k.ready, k.doneAt, k.what, (k.after ?? []).map((a) => a?.what ?? a)])])])]);
    if (tlMark === mark) return;   // 안 바뀌었으면 다시 안 그린다(펼친 줄이 닫히지 않게)
    tlMark = mark;
    body.replaceChildren();
    // 맨 위 — 우리의 목표 한 장(14절 · 결정 207): 슬로건 → 이번 달성 목표 → 팀별(팀 · 팀 목표 · 지금). 값은 서버가 goal.md·order.md 를 읽어 자로 거른 것(솔라 8684e22) — 안 맞는 줄은 안 낸다.
    // '대표님이 시킨 일' 카드(34회차, 하영 ahead-five.md 손 글 다섯 줄)는 뺐다 — 3판 시안에 없고 사람이 손으로 적는 칸이라(계획 6절 컷, 나리 대리 결정 · 헨리 09-18). 그 자리가 목표 한 장.
    body.append(...goalCards(r.goal, wide));
    // 기둥 넷 — 지난 주(마지막 지난 주 키) · 이번 주 · 다음 · 그 뒤. 이번 주에 회차가 없으면 이번 주 칸은 날짜 없이 '이번 주'.
    const weeks = r.weeks ?? [];
    const thisW = weeks.find((w) => w.label === '이번 주') ?? null;
    const past = weeks.filter((w) => w.label !== '이번 주');
    const prevW = past.length ? past[past.length - 1] : null;
    const cols = [
      { key: prevW?.key ?? null, head: prevW ? `지난주 ${weekMD(prevW.key)}` : '지난주' },   // '지난주' 한 낱말 — 하영 아홉(사전 111~125행, 표준국어대사전 표제어)
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
/** 우리의 목표 한 장(14절) — PC·폴드는 카드 하나(눈썹 → 슬로건 → 이번 달성 목표 → 팀별 표), 폰은 카드 둘(슬로건 + 이번 목표 / 팀별 표). 값이 없거나 자에 안 맞으면 그 줄은 없다. */
function goalCards(g, wide) {
  if (!g) return [];
  const slogan = okText(g.slogan), goalNow = okText(g.goalNow);
  const teamsG = (g.teams ?? []).map((x) => ({ ...x, goal: okText(x.goal), now: okText(x.now) })).filter((x) => x.goal || x.now);
  if (!slogan && !goalNow && !teamsG.length) return [];
  const top = el('section', 'dash__card tl__goal');
  if (slogan || goalNow) {
    top.appendChild(el('div', 'dash__k', '우리의 목표'));
    if (slogan) top.appendChild(el('div', 'tl__slogan', slogan));
    if (goalNow) { top.appendChild(el('div', 'dash__k tl__goalk', '이번 달성 목표')); top.appendChild(el('div', 'tl__goalNow', goalNow)); }
  }
  const teamRow = (x, into) => {
    const name = el('span', 'tl__gteam'); const tile = el('span', 'card__tile', String(x.name ?? '?').slice(0, 1)); tile.style.background = teamColor(x.id); name.append(tile, el('b', null, x.name));
    into.append(name, el('span', 'tl__ggoal', x.goal ?? ''), el('span', 'tl__gnow', x.now ?? ''));
  };
  const first = slogan || goalNow ? [top] : [];
  if (!teamsG.length) return first;
  if (wide) {
    const table = el('div', 'tl__gteams');
    for (const h of ['팀', '팀 목표', '지금']) table.appendChild(el('span', 'tl__gh', h));
    for (const x of teamsG) teamRow(x, table);
    top.appendChild(table); return [top];
  }
  // 폰(14절 3판-e, 나리 대리) — 슬로건 + 이번 달성 목표만 펼치고, 팀별은 '팀별 · 팀 목표 · 지금 — 더보기' 접힌 줄 하나(카드 꼴 38). 누르면 팀마다 카드 하나 여섯 장이 그 자리에, 글자는 '접기'(사전 1절 더보기·접기). 그래야 주 칸이 첫 화면에 든다.
  const fold = el('details', 'tl__gfold');
  const sum = el('summary', 'dash__card tl__gfold__row'); sum.append(el('span', 'dash__k', '팀별 · 팀 목표 · 지금'), el('span', 'tl__gfold__k'));   // '더보기'/'접기' 글자는 CSS ::after(열림 상태 따라)
  fold.appendChild(sum);
  for (const x of teamsG) { const c = el('section', 'dash__card tl__goal tl__goal--team'); const t = el('div', 'tl__gteams'); teamRow(x, t); c.appendChild(t); fold.appendChild(c); }
  return [...first, fold];
}
/** 팀 머리 — 팀 타일 · 이름 · 팀 목표 한 줄(order.md 첫 줄, 자 통과분) · 이번 주 요약 칩 셋(끝난 초록 · 막힘 · 담당자 없음 — 0 은 회색, 1 이상은 빨강). 폰·PC 같은 부품. */
function timelineHead(t) {
  const head = el('div', 'tl__head');
  const tile = el('span', 'card__tile', String(t.name ?? '?').slice(0, 1)); tile.style.background = teamColor(t.id);
  head.appendChild(tile);
  const names = el('span', 'tl__names'); names.appendChild(el('b', 'tl__name', t.name));
  const dest = okText(t.destination); if (dest) names.appendChild(el('span', 'tl__dest', dest));
  head.appendChild(names);
  const sig = t.signals ?? {};
  const chips = el('div', 'tl__chips');
  // 글자는 하영 아홉(사전 111~125행) — 머리 '이번 주 요약', 숫자 셋 이름은 '끝난 · 막힘 · 담당자 없음'
  chips.appendChild(el('span', 'tl__chips-k', '이번 주 요약'));
  for (const [label, n, k] of [['끝난', sig.done ?? 0, 'good'], ['막힘', sig.blocked ?? 0, 'bad'], ['담당자 없음', sig.unassigned ?? 0, 'bad']]) {
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
    for (const p of passed) { const d = el('div', 'tl__stage tl__stage--pass', `${p.n}단계 ${stageTitle(p.title)}`); d.title = p.title; fold.appendChild(d); }
    // 돈 주의 합 — 그 주에 돈 끝난 단계들의 회차 수 · ✓ 수
    // 막대 글자에 회차 수는 없다(헨리, 13절 낱말 줄) — 그 주에 통과한 단계 수 '✓ N' 만
    const sum = (key) => { if (!key) return ''; let ok = 0; for (const p of passed) if (p.weeks?.[key]?.pass) ok++; return ok ? `✓ ${ok}` : ''; };
    row(fold, [tlCell('pass', sum(prev.key)), tlCell('pass', sum(cur.key)), blank(), blank()]);
  }
  for (const p of open) {
    const left = el('div', `tl__stage tl__stage--${p.status ?? 'none'}`);
    const title = el('span', 'tl__title', p.n != null ? `${p.n}단계 ${stageTitle(p.title)}` : p.title); title.title = p.title;
    left.appendChild(title);
    if (p.status === 'now') left.appendChild(pill('진행 중', 'live'));
    const tasks = p.tasks ?? [];
    const doneThisWeek = tasks.filter((k) => k.status === '통과' && inWeek(k.doneAt, cur.key)).length;   // 통과인 것만 — 다시 열린 작업의 옛 doneAt 은 안 센다(code-review)
    const bar = (w, thisWeek) => (!w ? '' : w.pass ? '✓' : thisWeek && p.status === 'now' ? `끝난 ${doneThisWeek}` : '');   // 회차 수 없이(헨리) — 통과한 주 '✓', 진행 중 단계의 이번 주 '끝난 N'
    if (p.status === 'wait' && p.n != null) row(left, [blank(), blank(), tlCell('next', `${p.n - 1}단계 뒤`), blank()]);
    else row(left, [tlCell('now', bar(prev.key ? p.weeks?.[prev.key] : null, false)), tlCell('now', bar(cur.key ? p.weeks?.[cur.key] : null, true)), blank(), blank()]);
    if (p.status !== 'now' && p.n != null) continue;   // 대기 단계는 제목만(계획 2절)
    // 작업 줄 — 안 끝난 것부터, 끝난 것(☑)은 접지 않고 뒤에 줄로(헨리 diff 12절) + 그 주 칸에 ✓(doneAt 이 지난주·이번 주면). 진행 중은 이번 주 "하는 중", 감사 대기는 놋쇠, 시작 가능은 다음 칸, 뒤에 걸림은 그 뒤 칸, 막힘은 빨강.
    for (const k of tasks.filter((x) => x.status !== '통과')) {
      const cells = [blank(), blank(), blank(), blank()];
      if (k.status === '진행') cells[1] = tlCell('now', '진행 중');
      else if (k.status === '감사 대기') cells[1] = tlCell('wait', '검토 기다림');
      else if (k.status === '막힘') cells[1] = tlCell('bad', '막힘');
      else if (k.ready) cells[2] = tlCell('next', '시작할 수 있어요');
      else if (k.status === '대기') cells[3] = tlCell('after', afterNames(k) ?? '앞 일 남음');   // 그 뒤 칸 점선 칩엔 걸린 작업 이름(13절)
      row(taskRow(t, k, cast), cells);
    }
    for (const k of tasks.filter((x) => x.status === '통과')) row(taskRow(t, k, cast), [tlCell('pass', inWeek(k.doneAt, prev.key) ? '✓' : ''), tlCell('pass', inWeek(k.doneAt, cur.key) ? '✓' : ''), blank(), blank()]);
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
    for (const p of passed) { const d = el('div', 'tl__stage tl__stage--pass', `${p.n}단계 ${stageTitle(p.title)}`); d.title = p.title; fold.appendChild(d); }
    card.appendChild(fold);
  }
  for (const p of open) {
    const row = el('div', `tl__stage tl__stage--${p.status ?? 'none'}`);
    const title = el('span', 'tl__title', p.n != null ? `${p.n}단계 ${stageTitle(p.title)}` : p.title); title.title = p.title;
    row.appendChild(title);
    if (p.status === 'now') row.appendChild(pill('진행 중', 'live'));
    card.appendChild(row);
    // 작업 줄 — 진행 중 단계와 '단계 없음' 묶음만 펼친다. 대기 단계는 제목만(계획 2절). 안 끝난 것부터, 끝난 것(☑)은 접지 않고 뒤에 줄로(헨리 diff 12절).
    if (p.status === 'now' || p.n == null) {
      const tasks = p.tasks ?? [];
      for (const k of tasks.filter((x) => x.status !== '통과')) card.appendChild(taskRow(t, k, cast));
      for (const k of tasks.filter((x) => x.status === '통과')) card.appendChild(taskRow(t, k, cast));
    }
  }
  // ── 주 칸 카드 ── 줄 = 단계(지난 주·이번 주에 돈 것, 진행 중, 대기), 칸 넷. 지난 것은 실측 막대(회차 수 · ✓), 앞은 날짜 없는 칩.
  const wk = el('section', 'dash__card tl__weeks'); wk.dataset.team = t.id;
  const grid = el('div', 'tl__grid');
  grid.appendChild(el('span', 'tl__gh tl__gh--first', ''));
  for (const c of cols) grid.appendChild(el('span', 'tl__gh', c.head));
  const [prev, cur] = cols;
  const thisKey = cur.key;
  const rows = projects.filter((p) => p.status !== 'pass' || (prev.key && p.weeks?.[prev.key]?.pass) || (thisKey && p.weeks?.[thisKey]?.pass));   // 끝난 단계는 그 두 주에 통과한 것만 줄로(막대 글자가 ✓ 뿐이라)
  for (const p of rows) {
    grid.appendChild(el('span', 'tl__gl', p.n != null ? `${p.n}단계` : '단계 없음'));
    const tasks = p.tasks ?? [];
    const doneThisWeek = thisKey ? tasks.filter((k) => k.status === '통과' && k.doneAt && tlWeekKey(k.doneAt) === thisKey).length : 0;
    // 칸 하나에 칩 여럿이 세로로 선다(헨리 3판-c 폰) — 단계 막대 하나 + 작업 칩들
    const cells = [[], [], [], []];
    const chip = (i, kind, text) => { if (text) cells[i].push(el('i', `tl__bar tl__bar--${kind}`, text)); };
    // 막대 글자 — 회차 수 없이(헨리): 통과한 주 '✓', 진행 중 단계의 이번 주 '끝난 N'(이번 주 doneAt 수 — 지난주 칸엔 안 붙인다, code-review)
    const bar = (w, { thisWeek = false } = {}) => (!w ? '' : w.pass ? '✓' : thisWeek && p.status === 'now' ? `끝난 ${doneThisWeek}` : '');
    chip(0, p.status === 'pass' ? 'pass' : 'now', bar(prev.key ? p.weeks?.[prev.key] : null));
    chip(1, p.status === 'pass' ? 'pass' : 'now', bar(thisKey ? p.weeks?.[thisKey] : null, { thisWeek: true }));
    if (p.status === 'wait' && p.n != null) chip(2, 'next', `${p.n - 1}단계 뒤`);
    // 작업 칩 — 진행 중은 이번 주 '진행 중', 감사 대기는 놋쇠, 막힘은 빨강 · 시작할 수 있는 것은 다음 칸 · 뒤에 걸린 것은 그 뒤 칸에 걸린 작업 이름. 날짜·시각 글자 없음(188).
    if (p.status === 'now' || p.n == null) for (const k of tasks) {
      if (k.status === '진행') chip(1, 'now', '진행 중');
      else if (k.status === '감사 대기') chip(1, 'wait', '검토 기다림');
      else if (k.status === '막힘') chip(1, 'bad', '막힘');
      else if (k.ready) chip(2, 'next', '시작할 수 있어요');
      else if (k.status === '대기') chip(3, 'after', afterNames(k) ?? '앞 일 남음');
    }
    for (const list of cells) { const s = el('span', 'tl__cell tl__cell--stack'); s.append(...list); grid.appendChild(s); }
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
    row.appendChild(el('span', 'tl__seat', a?.name ?? k.seat));   // 얼굴 옆 이름 — 얼굴만으론 누군지 모른다(대표 09-18 14:5x "타임라인 쪽 누가 하는지 알 수가 없어")
  } else row.appendChild(el('span', 'tl__face tl__face--none', '담당자 없음'));
  const what = okText(k.what);
  const stack = el('span', 'tl__whatStack');
  // 자에 안 맞는 글은 안내 글자 대신 작업 이름 그대로(60자 넘으면 줄임표) — 하영 req_d29407c3 ①. 서버가 whatRaw 를 실으면 그걸(솔라), 없으면 빈 줄.
  const raw = String(k.whatRaw ?? '').trim();
  const text = el('span', `tl__what${done ? ' tl__what--done' : ''}`, what ?? (raw.length > 60 ? raw.slice(0, 59).trimEnd() + '…' : raw));   // 자에 안 맞는 줄은 서버가 NOT_YET 으로 준다 — 그 글자는 안 찍는다(결정 140)
  if (!what) text.dataset.notyet = '1';
  stack.appendChild(text);
  // "뒤에: ○○" — 아직 안 끝난 뒤 작업 이름(솔라 after, 자 통과분). 끝난 작업엔 안 붙인다.
  const after = afterNames(k);
  if (!done && after) stack.appendChild(el('span', 'tl__after', `뒤에: ${after}`));
  row.appendChild(stack);
  const dot = el('i', 'tl__dot'); dot.dataset.k = TASK_DOT[k.status] ?? 'idle'; dot.title = STATUS_WORD[k.status] ?? k.status; row.appendChild(dot);
  return row;
}
/** 뒤에 걸린 작업 이름들 — after[].what 중 자를 지난 것만, '·' 로. 없으면 null. */
function afterNames(k) { const names = (k.after ?? []).map((a) => okText(a?.what)).filter(Boolean).map(stripNums); return names.length ? names.join(' · ') : null; }
/** 괄호 안 번호 꼬리 '(203~212)'·'(결정 N)' 를 화면에서 뗀다 — 상자·'뒤에' 줄(하영 req_d29407c3 ②). 작업 이름 본문은 보드 글자라 안 건드린다. */
function stripNums(s) { return String(s ?? '').replace(/\s*\((?:결정\s*)?\d[^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim(); }

