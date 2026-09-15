// 카드 부품 — 팀 상황 카드 · 판정 카드 · 결재 카드 (나리 카드-체계-0916.md 1~3절).
//
// 방에 뜨는 카드와 탭에 뜨는 카드는 같은 부품, 같은 재료(5절 원칙). 이 파일은 DOM 노드만 만든다 —
// 재료를 가져오지도, 붙이지도 않는다. 붙이는 쪽(app.js·비서실·팀 방)이 /api/card/<팀> 을 받아 teamCard() 에 넣는다.
// 글자는 하영 card-words.md 맨 위 "2판 고침" 머리가 정본(대표 07:4x 표준어 잣대) — 알약 진행 중/차단됨/승인 대기,
// 판정 승인/반려/보류, 단추 승인/반려. 대표가 보는 글은 전부 bossOk(결정 140) 를 지난다 — 안 맞으면 NOT_YET 을 옅게 찍고
// 원문은 접는다. 사람 이름(who)·시각·단계 수는 문장이 아니라 검사 안 한다(card-words 1절 꼬리 줄).
// 모양은 card.css — 임시. 색·글꼴·간격 토큰은 클레멘타인(C4) 이 준다.
//
// 의존성 없음(bosswords.js 만). 브라우저 전용 ESM.
//
// /api/card/<팀> 이 주는 모양 (솔라) — teamCard(d) 의 입력:
//
// {
//   team: 'dev', name: '개발', color: '#8a7320',
//   state: 'working' | 'blocked' | 'boss',          // 알약 글자: 진행 중 / 차단됨 / 승인 대기 (둘 이상이면 boss > blocked > working)
//   at: '2026-09-15T22:31:57.553Z',                  // 갱신 시각 — 화면은 Asia/Seoul 로 "오전 7:31" 꼴
//   doing: { who: '테라', text: '…' } | null,        // 상황판 doing 첫 줄
//   done: [{ who: '솔라', text: '…', file: 'out/m9-status.md' | null }],   // 0~3, file 있으면 누르면 열림(onOpen(file))
//   blocked: [{ text: '…', who: '나리' | null }],    // 0~2, who = 누가 풀 수 있나. 빨간 띠
//   boss: { id: 'apr_…', text: '…' } | null,         // 대표님이 할 동작 하나 + 단추 둘(승인 · 반려) → onDecide(id, 'PASS'|'REVISE')
//   stage: { n: 10, total: 11, round: 32 } | null,   // 꼬리 "10/11 단계 · 32회차 · 자세히 →"(onOpen(null) 로 팀 방)
// }

import { bossOk, NOT_YET } from '/bosswords.js';

/* ── 글자 — card-words.md 2판 머리 ── */

const STATE_WORD = { working: '진행 중', blocked: '차단됨', boss: '승인 대기' };
const BLOCK_WORD = { doing: '진행 중', done: '된 것', blocked: '막힌 것', boss: '승인 대기' };
const VERDICT_WORD = { PASS: '승인', REVISE: '반려', FAIL: '보류' };
const BTN = { PASS: '승인', REVISE: '반려' };
const MORE = '자세히 →';
const RAW = '원문';
const DETAIL = '자세히';
const PROXY_LINE = '나리·제리 검토 중';   // 대표님 몫(C) 이 아닌 카드의 단추 자리 — N 은 목록을 그리는 쪽이 안다

/* ── 작은 도구들 ── */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** 우리 시각 "오전 7:31". 기록의 ts 는 세계표준시라 그대로 읽으면 새벽이 오후가 된다(결정 101) — 시간대를 박아 둔다. */
function clock(ts) {
  const d = new Date(ts ?? NaN);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' });
}

/** <time> 한 개 — 있을 때만. */
function timeNode(ts) {
  const s = clock(ts);
  if (!s) return null;
  const t = el('time', 'card__time', s);
  t.dateTime = new Date(ts).toISOString();
  return t;
}

/**
 * 대표가 보는 글 한 줄. 자(bossOk)에 맞으면 그대로, 안 맞으면 NOT_YET 을 옅게 찍고 원문은 <details> 로 접는다.
 * raw=false 면 원문 펼침을 안 붙인다 — 결재 카드처럼 카드 자체에 원문 펼침이 따로 있을 때.
 */
function said(text, { raw = true } = {}) {
  const box = el('div', 'card__text');
  const t = String(text ?? '').trim();
  if (bossOk(t)) { box.textContent = t; return box; }
  box.dataset.notyet = '1';
  box.appendChild(el('span', 'card__notyet', NOT_YET));
  if (raw && t) {
    const d = el('details', 'card__raw');
    d.appendChild(el('summary', null, RAW));
    d.appendChild(el('div', 'card__rawtext', t));
    box.appendChild(d);
  }
  return box;
}

/** 첫 문장 한 줄 — app.js oneLine 과 같은 규칙(첫 줄에서 첫 마침표까지). */
function firstSentence(s) {
  const line = String(s ?? '').split(/\n/).map((x) => x.trim()).find(Boolean) ?? '';
  const m = line.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : line).trim();
}

/** 산출물 주소 — 'out/m9-status.md' → /out/<팀>/m9-status.md (서버 /out/ 경로). */
const outUrl = (team, file) => `/out/${encodeURIComponent(team)}/${String(file).replace(/^out\//, '').split('/').map(encodeURIComponent).join('/')}`;

/** 블록 하나 — 머리 글자 + 줄들. 줄이 없으면 null(비어 있는 블록은 안 그린다). */
function block(kind, items) {
  if (!items.length) return null;
  const sec = el('section', 'card__block'); sec.dataset.block = kind;
  sec.appendChild(el('span', 'card__label', BLOCK_WORD[kind]));
  const list = el('div', 'card__items');
  for (const it of items) list.appendChild(it);
  sec.appendChild(list);
  return sec;
}

/** "{사람} · {글}" 한 줄. who 없으면 글만. */
function personLine(who, textNode) {
  const row = el('div', 'card__item');
  if (who) { row.appendChild(el('span', 'card__who', who)); row.appendChild(el('span', 'card__sep', '·')); }
  row.appendChild(textNode);
  return row;
}

/** 단추 둘 — 승인 · 반려. onDecide(id, 'PASS'|'REVISE'). */
function decideButtons(id, onDecide) {
  const row = el('div', 'card__btns');
  for (const k of ['PASS', 'REVISE']) {
    const b = el('button', 'card__btn', BTN[k]); b.type = 'button'; b.dataset.decide = k;
    b.addEventListener('click', (e) => { e.stopPropagation(); onDecide?.(id, k); });
    row.appendChild(b);
  }
  return row;
}

/* ── 1. 팀 상황 카드 ── */

/**
 * 팀 하나에 카드 하나. 블록 순서: 머리 → 진행 중 → 된 것 → 막힌 것 → 승인 대기 → 꼬리. 비어 있는 블록은 안 그린다.
 * @param {object} d  /api/card/<팀> 의 응답(맨 위 주석 모양)
 * @param {{ onOpen?: (file: string|null) => void, onDecide?: (id: string, decision: 'PASS'|'REVISE') => void }} [h]
 *   onOpen(file) — 된 것의 파일을 눌렀다. onOpen(null) — 꼬리 "자세히 →"(팀 방으로).
 * @returns {HTMLElement}
 */
export function teamCard(d, { onOpen, onDecide } = {}) {
  const card = el('article', 'card');
  card.dataset.card = 'team';
  card.dataset.team = d.team ?? '';
  card.dataset.state = STATE_WORD[d.state] ? d.state : 'working';

  // 머리 — 팀 색 점 · 이름 · 알약 · 시각
  const head = el('header', 'card__head');
  const dot = el('span', 'card__dot'); if (d.color) dot.style.setProperty('--dot', d.color);
  head.appendChild(dot);
  head.appendChild(el('span', 'card__name', d.name ?? d.team ?? ''));
  const pill = el('span', 'card__pill', STATE_WORD[card.dataset.state]); pill.dataset.state = card.dataset.state;
  head.appendChild(pill);
  const t = timeNode(d.at); if (t) head.appendChild(t);
  card.appendChild(head);

  // 진행 중 — 한 줄
  if (d.doing?.text) card.appendChild(block('doing', [personLine(d.doing.who, said(d.doing.text))]));

  // 된 것 — 0~3, 파일 있으면 누르면 열림
  const done = (d.done ?? []).slice(0, 3).map((x) => {
    const txt = said(x.text);
    if (!x.file) return personLine(x.who, txt);
    const a = el('a', 'card__link'); a.href = outUrl(d.team, x.file); a.target = '_blank'; a.rel = 'noopener';
    if (onOpen) a.addEventListener('click', (e) => { e.preventDefault(); onOpen(x.file); });
    // 글이 자에 안 맞으면 원문 펼침이 글 자리에 서니 링크로 감싸지 않는다(펼침을 누르면 링크가 열린다) — 옆에 "열기" 로
    if (txt.dataset.notyet) { const row = personLine(x.who, txt); a.textContent = '열기'; row.appendChild(a); return row; }
    a.appendChild(txt);
    return personLine(x.who, a);
  });
  const doneSec = block('done', done); if (doneSec) card.appendChild(doneSec);

  // 막힌 것 — 0~2, "{무엇이 왜} — {누가} 풀어요"
  const blocked = (d.blocked ?? []).slice(0, 2).map((x) => {
    const row = el('div', 'card__item');
    row.appendChild(said(x.text));
    if (x.who) row.appendChild(el('span', 'card__solver', `— ${x.who} 풀어요`));
    return row;
  });
  const blockedSec = block('blocked', blocked); if (blockedSec) card.appendChild(blockedSec);

  // 승인 대기 — 대표님이 할 동작 하나 + 단추 둘
  if (d.boss?.text) {
    const row = el('div', 'card__item card__item--boss');
    row.appendChild(said(d.boss.text));
    row.appendChild(decideButtons(d.boss.id, onDecide));
    card.appendChild(block('boss', [row]));
  }

  // 꼬리 — "10/11 단계 · 32회차 · 자세히 →" (옅게)
  if (d.stage || onOpen) {
    const foot = el('footer', 'card__foot');
    if (d.stage) {
      const bits = [];
      if (d.stage.n != null) bits.push(d.stage.total != null ? `${d.stage.n}/${d.stage.total} 단계` : `${d.stage.n}단계`);
      if (d.stage.round != null) bits.push(`${d.stage.round}회차`);
      foot.appendChild(el('span', 'card__stage', bits.join(' · ')));
    }
    if (onOpen) {
      const more = el('button', 'card__more', MORE); more.type = 'button';
      more.addEventListener('click', (e) => { e.stopPropagation(); onOpen(null); });
      foot.appendChild(more);
    }
    card.appendChild(foot);
  }

  return card;
}

/* ── 2. 판정 카드 — 방의 PASS·REVISE 도장을 이것으로 ── */

/**
 * @param {{ verdict: 'PASS'|'REVISE'|'FAIL', from: string, to: string, ts?: string, line: string, detail?: string, attempt?: { n: number, max: number }|null }} v
 *   line — 감사가 쓴 사람 말 한 줄(결정 140). "승인 — …"/"반려 — …" 꼴로 안 시작하면 머리 낱말을 앞에 붙인다.
 *   detail — 떨어뜨릴 이유 셋과 반박(감사 본문). 접힘.
 * @returns {HTMLElement}
 */
export function verdictCard(v) {
  const verdict = VERDICT_WORD[v.verdict] ? v.verdict : 'REVISE';
  const word = VERDICT_WORD[verdict];
  const card = el('article', 'card');
  card.dataset.card = 'verdict';
  card.dataset.verdict = verdict;

  // 머리 — 승인 / 반려 / 보류 · 누가 → 누구 · 시각
  const head = el('header', 'card__head');
  const pill = el('span', 'card__pill', word); pill.dataset.verdict = verdict;
  head.appendChild(pill);
  head.appendChild(el('span', 'card__name', `${v.from ?? ''} → ${v.to ?? ''}`));
  const t = timeNode(v.ts); if (t) head.appendChild(t);
  card.appendChild(head);

  // 한 줄 — 자는 감사가 쓴 원문에 재고, 화면엔 "승인 — …" 꼴로
  const raw = String(v.line ?? '').trim();
  const line = el('div', 'card__line');
  if (bossOk(raw)) line.textContent = raw.startsWith(word) ? raw : `${word} — ${raw}`;
  else line.appendChild(said(raw));
  card.appendChild(line);

  // 자세히(접힘) — 감사끼리 보는 글
  if (v.detail) {
    const d = el('details', 'card__fold');
    d.appendChild(el('summary', null, DETAIL));
    d.appendChild(el('pre', 'card__pre', String(v.detail)));
    card.appendChild(d);
  }

  // 꼬리 — 반려일 때만 "반박 N/3"
  if (verdict === 'REVISE' && v.attempt?.n != null) {
    card.appendChild(el('footer', 'card__foot', `반박 ${v.attempt.n}/${v.attempt.max ?? 3}`));
  }

  return card;
}

/* ── 3. 결재 카드 — 지금 것을 같은 체계로(임시) ── */

/**
 * @param {object} r  결재 요청(state/approvals.jsonl 의 request 한 줄: id · ts · team · grade · what · detail · files[] · boss?)
 *   머리 — r.boss(--boss 한 줄)가 자에 맞으면 그것, 아니면 r.what 을 재고, 둘 다 아니면 NOT_YET(원문은 자세히에).
 * @param {{ onDecide?: (id: string, decision: 'PASS'|'REVISE') => void }} [h]  단추는 r.grade === 'C' 일 때만
 * @returns {HTMLElement}
 */
export function approvalCard(r, { onDecide } = {}) {
  const card = el('article', 'card');
  card.dataset.card = 'approval';
  card.dataset.id = r.id ?? '';
  card.dataset.grade = r.grade ?? '';

  // 머리 — 무엇
  const head = el('header', 'card__head');
  const title = bossOk(r.boss) ? r.boss : r.what;
  const tt = said(title, { raw: false }); tt.classList.add('card__title');
  head.appendChild(tt);
  const t = timeNode(r.ts); if (t) head.appendChild(t);
  card.appendChild(head);

  // 왜 — 첫 문장 한 줄
  const why = firstSentence(r.detail);
  if (why) {
    const row = el('div', 'card__why');
    row.appendChild(el('span', 'card__label', '왜'));
    row.appendChild(said(why, { raw: false }));
    card.appendChild(row);
  }

  // 단추 — 대표님 몫(C)만. 아니면 "나리·제리 검토 중" 한 줄
  if (r.grade === 'C') card.appendChild(decideButtons(r.id, onDecide));
  else card.appendChild(el('div', 'card__proxy', PROXY_LINE));

  // 자세히(접힘) — 요청 원문 · 파일
  const d = el('details', 'card__fold');
  d.appendChild(el('summary', null, DETAIL));
  const body = [r.what, r.detail].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n\n');
  if (body) d.appendChild(el('pre', 'card__pre', body));
  const files = Array.isArray(r.files) ? r.files.filter(Boolean) : [];
  if (files.length) {
    const ul = el('ul', 'card__files');
    for (const f of files) {
      const li = el('li');
      const a = el('a', 'card__link', f); a.href = outUrl(r.team ?? '', f); a.target = '_blank'; a.rel = 'noopener';
      li.appendChild(a); ul.appendChild(li);
    }
    d.appendChild(ul);
  }
  card.appendChild(d);

  return card;
}
