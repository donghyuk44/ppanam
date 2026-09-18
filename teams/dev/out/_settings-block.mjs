/* (끼운 뒤 정본은 server/src/app.js — 이 파일은 _splice-settings.mjs 가 처음 끼운 판. 그 뒤 code-review 고침 둘(화면마다 새 상자 · 폭 바뀔 때 늘 자리 옮김)은 app.js 에만 있다.) */
/* ── 설정 탭 3판 — 일반 설정 꼴(헨리 ui-spec 15절 · 피그마 106:2 · fig-0918-settings-412-b, 보드 J45, 대표 09-18 "일반적인 설정 탭 구조가 맞아?") ──
 * 맨 위 내 프로필 줄, 그 밑 묶음 줄들 ›, 긴 글·상자는 안쪽 화면. 폰: 목록 → 누르면 안쪽(머리에 '‹ 설정'). PC: 왼쪽 묶음 목록(방 목록 자리 300) + 오른쪽 안쪽 화면.
 * 옛 판(권한 긴 글 맨 위 · 프로필 파일 경로 목록 · 모델 상자 열일곱 한 화면 — r27-settings-412-a)은 안쪽 화면으로 옮겼다. 낱말은 하영 사전 64~66행(멤버·모델·권한), 나머지 줄은 시안 글자 그대로.
 * 켜고 끄는 값(알림 방마다 · 밝기 · 글자 크기)은 이 브라우저(localStorage)에만 — 서버엔 안 간다. */
const SET_GROUPS = [
  { k: '', rows: [{ id: 'profile', me: true }] },
  { k: '알림', rows: [{ id: 'notify', t: '알림', s: '대표님이 보실 것만 · 방마다 켜고 끄기' }] },
  { k: '화면', rows: [{ id: 'display', t: '화면', s: '밝기(밝게 · 어둡게 · 폰 설정) · 글자 크기' }] },
  { k: '멤버', rows: [{ id: 'members', t: '멤버', s: '열일곱 프로필 카드 — 얼굴 · 한 줄 · 자기소개' }, { id: 'models', t: '모델', s: '자리별 엔진 · 모델 · 추론 강도 (다음 턴부터)' }] },
  { k: '회사', rows: [{ id: 'perms', t: '권한', s: '누가 무엇을 할 수 있나 — 대표님 · 나리 · 톰 · 팀' }, { id: 'words', t: '용어 사전', s: '화면 낱말 — 우리 말 → 사람 말' }, { id: 'world', t: '마을', s: '준비 중' }] },
  { k: '정보', rows: [{ id: 'info', t: '정보', s: '판 번호 · 저장소 · 도움말' }] },
];
const SET_TITLE = { profile: '내 프로필', notify: '알림', display: '화면', members: '멤버', models: '모델', perms: '권한', words: '용어 사전', info: '정보' };
const SET_KEYS = { mute: 'ppanam.notify.mute', theme: 'ppanam.theme', font: 'ppanam.font' };
let setPage = '';   // '' = 목록(폰에선 목록만, PC 는 목록 + 첫 안쪽)
const lsGet = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장소 없음 */ } };
const mutedTeams = () => { try { return new Set(JSON.parse(lsGet(SET_KEYS.mute, '[]'))); } catch { return new Set(); } };
/** 밝기·글자 크기 — html 에 data-theme(light·dark·'' = 폰 설정) · data-font(small·large·''), CSS 가 받는다. 처음 열 때 한 번, 고르면 바로. */
function applyDisplay() {
  const pick = lsGet(SET_KEYS.theme);   // '' = 폰 설정 → 폰의 prefers-color-scheme 을 그대로 옮겨 놓는다(index.html 머리 한 줄이 첫 칠 전에 같은 일을 한다)
  document.documentElement.dataset.theme = pick || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.font = lsGet(SET_KEYS.font);
}
applyDisplay();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!lsGet(SET_KEYS.theme)) applyDisplay(); });

/** 묶음 목록 한 벌 — 폰에선 설정 본문에, PC 에선 방 목록 자리(.rail)에 선다(placeSetNav). */
const setNav = el('nav', 'setnav'); setNav.id = 'setNav'; setNav.setAttribute('aria-label', '설정');
function placeSetNav() {
  const pc = matchMedia('(min-width: 820px)').matches;
  const home = pc ? document.querySelector('.rail') : $('setBody');
  if (setNav.parentNode !== home) home.appendChild(setNav);
  if (pc && !setPage && view === 'settings') openSetPage('profile', { quiet: true });   // PC 는 오른쪽이 비지 않게 첫 줄
}
matchMedia('(min-width: 820px)').addEventListener('change', () => { if (view === 'settings') { placeSetNav(); renderSetIn(); } });

function renderSetNav() {
  setNav.replaceChildren();
  setNav.appendChild(el('div', 'setnav__head', '설정'));   // PC 방 목록 판 머리 자리 — 폰에선 숨김(윗줄에 이미 '설정')
  const boss = summaries.hq?.cast?.boss ?? { name: '함동혁(댄)', initial: '함' };
  for (const g of SET_GROUPS) {
    if (g.k) setNav.appendChild(el('div', 'setnav__k', g.k));
    const card = el('div', 'setnav__card');
    for (const r of g.rows) {
      const b = el('button', 'setnav__row'); b.type = 'button'; b.dataset.page = r.id;
      b.setAttribute('aria-current', String(setPage === r.id));
      if (r.me) {
        const av = withFace(el('span', 'setnav__face', boss.initial ?? '함'), 'hq', 'boss'); av.style.background = boss.color ?? FALLBACK.color;
        b.appendChild(av);
        const body = el('span', 'setnav__body'); body.appendChild(el('b', 'setnav__t', boss.name)); body.appendChild(el('span', 'setnav__s', '대표 · 내 프로필 보기')); b.appendChild(body);
      } else {
        const body = el('span', 'setnav__body'); body.appendChild(el('b', 'setnav__t', r.t)); body.appendChild(el('span', 'setnav__s', r.s)); b.appendChild(body);
      }
      b.appendChild(el('span', 'setnav__go', '›'));
      b.addEventListener('click', () => { if (r.id === 'world') { location.hash = `#${active ?? 'hq'}/world`; return; } openSetPage(r.id); });
      card.appendChild(b);
    }
    setNav.appendChild(card);
  }
}
function openSetPage(id, { quiet = false } = {}) {
  setPage = id;
  $('settings').dataset.page = id;
  for (const b of setNav.querySelectorAll('.setnav__row')) b.setAttribute('aria-current', String(b.dataset.page === id));
  renderSetIn();
  if (!quiet && !matchMedia('(min-width: 820px)').matches) { $('setBody').scrollTop = 0; $('phoneTitle').textContent = SET_TITLE[id] ?? '설정'; }
}
function closeSetPage() {
  setPage = ''; $('settings').dataset.page = '';
  for (const b of setNav.querySelectorAll('.setnav__row')) b.setAttribute('aria-current', 'false');
  $('phoneTitle').textContent = '설정';
  renderSetIn();
}

async function loadSettings() {
  const body = $('setBody');
  let inner = $('setIn');
  if (!inner) { inner = el('div', 'setin'); inner.id = 'setIn'; body.appendChild(inner); }
  placeSetNav();
  renderSetNav();
  $('settings').dataset.page = setPage;
  $('setBack').onclick = closeSetPage;   // 폰 안쪽 화면 머리 '‹ 설정'
  renderSetIn();
}

/** 안쪽 화면 하나 — 머리(폰 '‹ 설정' + 이름) + 내용. */
async function renderSetIn() {
  const inner = $('setIn'); if (!inner) return;
  inner.replaceChildren();
  $('setTitle').textContent = setPage ? (SET_TITLE[setPage] ?? '설정') : '설정';
  $('setSub').textContent = setPage ? '' : '내 프로필 · 알림 · 화면 · 멤버 · 회사 · 정보';
  $('setBack').hidden = !setPage;
  if (!setPage) return;
  const fn = SET_PAGES[setPage];
  if (fn) await fn(inner);
}

const SET_PAGES = {
  /* 내 프로필 — 2-1절 프로필 카드(대표 것): 얼굴 · 이름 · 대표 · 오늘 정한 것 · 정할 것(대시보드와 같은 셈) */
  profile(box) {
    const boss = summaries.hq?.cast?.boss ?? { name: '함동혁(댄)', initial: '함', title: '대표' };
    const card = el('div', 'setin__card setin__me');
    const av = withFace(el('div', 'setin__face', boss.initial ?? '함'), 'hq', 'boss'); av.style.background = boss.color ?? FALLBACK.color;
    card.appendChild(av);
    const nm = el('div', 'setin__name'); nm.appendChild(el('b', null, boss.name)); nm.appendChild(el('span', null, boss.title ?? '대표')); card.appendChild(nm);
    const today = summaries.hq?.people?.boss?.todayDecisions ?? 0;
    card.appendChild(el('div', 'setin__line', `정할 것 ${bossItems().mine.length} · 오늘 정한 것 ${today}`));
    box.appendChild(card);
  },
  /* 알림 — 종은 대표님이 보실 것만(사전 200행). 방마다 켜고 끄기: 끈 방의 알림은 종 목록·배지에서 빠진다(이 브라우저만). */
  notify(box) {
    box.appendChild(el('div', 'setin__k', '종에 오는 것'));
    const c1 = el('div', 'setin__card'); c1.appendChild(setRow('대표님이 보실 것만', '결재 · 답변 대기 · 차단됨 — 보고는 종에 안 와요', null)); box.appendChild(c1);
    box.appendChild(el('div', 'setin__k', '방마다'));
    const c2 = el('div', 'setin__card');
    const mute = mutedTeams();
    for (const t of teams) {
      const on = !mute.has(t.id);
      const sw = el('button', 'setin__sw', on ? '켬' : '끔'); sw.type = 'button'; sw.setAttribute('aria-pressed', String(on));
      sw.addEventListener('click', () => { const m = mutedTeams(); if (m.has(t.id)) m.delete(t.id); else m.add(t.id); lsSet(SET_KEYS.mute, JSON.stringify([...m])); renderBossBadge(); renderSetIn(); });
      c2.appendChild(setRow(t.room ?? t.name, on ? '종에 와요' : '종에 안 와요', sw));
    }
    box.appendChild(c2);
  },
  /* 화면 — 밝기 셋 중 하나(밝게 · 어둡게 · 폰 설정) · 글자 크기 셋 */
  display(box) {
    box.appendChild(el('div', 'setin__k', '밝기'));
    const c1 = el('div', 'setin__card');
    c1.appendChild(setChoice([['light', '밝게'], ['dark', '어둡게'], ['', '폰 설정']], lsGet(SET_KEYS.theme), (v) => { lsSet(SET_KEYS.theme, v); applyDisplay(); renderSetIn(); }));
    box.appendChild(c1);
    box.appendChild(el('div', 'setin__k', '글자 크기'));
    const c2 = el('div', 'setin__card');
    c2.appendChild(setChoice([['small', '작게'], ['', '보통'], ['large', '크게']], lsGet(SET_KEYS.font), (v) => { lsSet(SET_KEYS.font, v); applyDisplay(); renderSetIn(); }));
    box.appendChild(c2);
  },
  /* 멤버 — 9절 U1 카드 열일곱(대표 → 총괄실 → 마케팅 → 개발 → 디자인 → 경영): 얼굴 · 이름 · 직책 · 팀 · 한 줄 · 자기소개 100자 + "…더보기" → 300자 "접기"(결정 244, 사전 84행).
   * 자기소개는 intro.json(하영) 에서 by 가 '본인' 인 사람만, 초안은 칸 비움(나리 대리) — 대표는 자기소개 줄이 없다. 얼굴을 누르면 사람 카드(지금 하는 일 자리). */
  async members(box) {
    let intro = [];
    try { const r = await fetch('/out/marketing/world-bible/40-persona/intro.json'); if (r.ok) intro = (await r.json()).people ?? []; } catch { /* 없으면 자기소개 줄 없음 */ }
    const introOf = (name) => { const p = intro.find((x) => x.name === name && x.by === '본인'); return p ? { short: p.short ?? '', long: p.long ?? '' } : null; };
    const grid = el('div', 'setin__people');
    const HQ_SEATS = new Set(['chief', 'system', 'secretary', 'outside']);
    const seen = new Set();
    const boss = summaries.hq?.cast?.boss;
    if (boss) grid.appendChild(memberCard({ team: 'hq', teamWord: '전체', id: 'boss', a: boss, intro: null, door: false }));
    for (const t of [...teams].sort((a, b) => (a.id === 'hq' ? -1 : b.id === 'hq' ? 1 : 0))) {
      for (const [seat, a] of Object.entries(summaries[t.id]?.cast ?? {})) {
        if (seat === 'boss' || !a?.name || seen.has(a.name)) continue;
        seen.add(a.name);
        const shared = t.id === 'hq' || (HQ_SEATS.has(seat) && seat !== 'outside');
        grid.appendChild(memberCard({ team: t.id, teamWord: shared ? '전체' : t.name, id: seat, a, intro: introOf(a.name), door: true }));
        if (seat === 'system' && a.cliName && !seen.has(a.cliName)) { seen.add(a.cliName); grid.appendChild(memberCard({ team: t.id, teamWord: '전체', id: NARAE, a: naraeOf(a), intro: introOf(a.cliName), door: true })); }   // 나래 — 두 사람(결정 218)
      }
    }
    box.appendChild(grid);
  },
  /* 모델 — 자리마다 엔진 · 모델 · 추론 강도(결정 69, castRow). 사람마다 한 줄, 총괄실을 먼저 돌아 거기 줄만(대표 08:5x "중복 배치"). */
  models(box) {
    box.appendChild(el('div', 'setin__k', '자리별 엔진 · 모델 · 추론 강도 — 다음 턴부터'));
    const card = el('div', 'setin__card');
    const HQ_SEATS = new Set(['chief', 'system', 'secretary']);
    const seen = new Set();
    for (const t of [...teams].sort((a, b) => (a.id === 'hq' ? -1 : b.id === 'hq' ? 1 : 0))) {
      for (const [seat, a] of Object.entries(summaries[t.id]?.cast ?? {})) {
        if (seat === 'boss' || !a.model) continue;
        const name = a.name ?? seat;
        if (seen.has(name)) continue; seen.add(name);
        const row = el('div', 'setin__row setin__row--model');
        const body = el('span', 'setin__body'); body.appendChild(el('b', 'setin__t', name)); body.appendChild(el('span', 'setin__s', `${t.id === 'hq' || HQ_SEATS.has(seat) ? '전체' : t.name} · ${a.title ?? ''}`)); row.appendChild(body);
        row.appendChild(castRow(t, seat, a));
        card.appendChild(row);
      }
    }
    box.appendChild(card);
  },
  /* 권한 — 대표용 한 장(teams/hq/out/권한.md, 나리) 그대로. 바꾸는 손은 대표(settings.json)라 읽기만. */
  async perms(box) {
    const card = el('div', 'setin__card setin__md set__md'); card.textContent = '로딩 중'; box.appendChild(card);
    try { const r = await fetch('/out/hq/' + encodeURIComponent('권한.md')); card.replaceChildren(r.ok ? mdLite(await r.text()) : el('p', null, '권한 표 없음')); } catch { card.textContent = '권한 표 없음'; }
  },
  /* 용어 사전 — 하영(teams/marketing/out/opsroom-words.md) 그대로 펼쳐서. */
  async words(box) {
    const card = el('div', 'setin__card setin__md set__md'); card.textContent = '로딩 중'; box.appendChild(card);
    try { const r = await fetch('/out/marketing/opsroom-words.md'); card.replaceChildren(r.ok ? mdLite(await r.text()) : el('p', null, '사전 없음')); } catch { card.textContent = '사전 없음'; }
  },
  /* 정보 — 판 번호(서버가 아는 커밋)·저장소·도움말. 서버가 안 주면 그 줄은 '모름'. */
  async info(box) {
    const card = el('div', 'setin__card');
    let ver = null; try { const r = await fetch('/api/version'); if (r.ok) ver = await r.json(); } catch { /* 없음 */ }
    card.appendChild(setRow('판 번호', ver?.commit ? `${String(ver.commit).slice(0, 7)}${ver.branch ? ' · ' + ver.branch : ''}` : '모름', null));
    card.appendChild(setRow('저장소', 'ppanam', null));
    const help = el('a', 'setin__link', '열기'); help.href = '/out/hq/' + encodeURIComponent('규칙.md'); help.target = '_blank'; help.rel = 'noopener';
    card.appendChild(setRow('도움말', '살아 있는 규칙 한 장', help));
    box.appendChild(card);
  },
};

/** 안쪽 줄 하나 — 제목 · 밑줄 · 오른쪽 손잡이(스위치·링크, 없으면 비움) */
function setRow(t, s, right) {
  const row = el('div', 'setin__row');
  const body = el('span', 'setin__body'); body.appendChild(el('b', 'setin__t', t)); if (s) body.appendChild(el('span', 'setin__s', s)); row.appendChild(body);
  if (right) row.appendChild(right);
  return row;
}
/** 셋 중 하나 고르기 — 고른 줄엔 ✓ */
function setChoice(opts, cur, onPick) {
  const wrap = el('div');
  for (const [v, label] of opts) {
    const b = el('button', 'setin__row setin__pick', null); b.type = 'button'; b.setAttribute('aria-pressed', String(v === cur));
    b.appendChild(el('span', 'setin__t', label)); b.appendChild(el('span', 'setin__check', v === cur ? '✓' : ''));
    b.addEventListener('click', () => onPick(v));
    wrap.appendChild(b);
  }
  return wrap;
}
/** 멤버 카드 하나(9절 U1) — 얼굴 · 이름 · 직책 · 팀 · 한 줄(cast does) · 자기소개(100자 + …더보기 → 300자 접기) */
function memberCard({ team, teamWord, id, a, intro, door }) {
  const card = el('div', 'mcard'); card.dataset.actor = `${team}:${id}`;
  const top = el('div', 'mcard__top');
  const av = withFace(el('div', 'mcard__face', a.initial ?? (a.name ?? '?').slice(0, 1)), team, id); av.style.background = a.color ?? FALLBACK.color;
  if (door) { av.classList.add('door'); av.title = `${a.name} 카드`; av.addEventListener('click', () => openPersonPop(team, id)); }
  top.appendChild(av);
  const nm = el('div', 'mcard__name'); nm.appendChild(el('b', null, a.name)); nm.appendChild(el('span', null, [a.title, teamWord].filter(Boolean).join(' · ')));
  top.appendChild(nm);
  card.appendChild(top);
  if (a.does && id !== 'boss') card.appendChild(el('div', 'mcard__line', a.does));   // 대표는 한 줄 인격·자기소개가 없다(9절 — 사람이다)
  if (intro?.short) {
    const p = el('div', 'mcard__intro');
    const txt = el('span', null, intro.short);
    p.appendChild(txt);
    if (intro.long && intro.long !== intro.short) {
      const more = el('button', 'mcard__more', '…더보기'); more.type = 'button';   // 인스타그램처럼 넷째 줄 끝에 이어 붙는다 — 글자는 사전 84행 '더보기'·'접기'
      let open = false;
      more.addEventListener('click', () => { open = !open; txt.textContent = open ? intro.long : intro.short; more.textContent = open ? ' 접기' : '…더보기'; });
      p.appendChild(more);
    }
    card.appendChild(p);
  }
  return card;
}
