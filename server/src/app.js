// 작전실 화면.
//
// 대화록은 지워지지 않는다. 라운드 경계는 구분선일 뿐이고,
// 위로 스크롤하면 지난 라운드가 계속 나온다.
//
// server/src/app.js 가 원본이다. `npm run build:public` 이 이 내용을 server/public/app.js 로
// 옮긴다 — public 쪽을 직접 고치면 다음 build 가 덮어써서 잃는다.

import * as World from '/world/world.js';
import { toolLabel, toolPhrase, baseName, ga } from '/toollabel.js';
import { findOutPaths, linkOutPaths } from '/outlink.js';
import { notificationsOf, blockedOf, pausedMs, delegated, deciders } from '/notify.js';
import { dayWord, timeWord, clockWord, spanWord } from '/when.js';
import { parseMention } from '/mention.js';
import { bossOk, doingWord, gateLine, NOT_YET } from '/bosswords.js';   // doingWord·gateLine — 자(boss-words-check)가 화면과 같은 글을 재게 공용. NOT_YET 은 화면에 안 찍는다(opus ④) — 서버가 그 글자로 준 줄을 거르는 데만 쓴다
import { teamCard, verdictCard } from '/card.js';   // 카드 부품(C6) — 팀 상황 카드는 채팅 맨 위·대시보드·비서실 세 곳(C7), 판정 카드는 방의 도장 자리(G3)

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
let infra = null;             // 밑바닥 넷 — 서버가 2분마다 재서 준다(boot.infra · ws infra). blockedOf 의 입력
let pauses = [];              // 멈춘 구간(state/pauses.json, boot.pauses) — 기다린 시간·늦음에서 뺀다
let delegation = null;        // 위임(state/delegation.json, boot.delegation, 결정 136) — 종 배지가 위임 중엔 돈·바깥만 센다(나리 결정 ②)
let done = { since: null, items: [], fetchedAt: 0, more: false };   // 누가 뭘 했나(/api/done) — 관제탑 ②. more = "더 보기" 펼침(오늘 안에서만 — 어제는 보고서)
let work = { data: null, fetchedAt: 0 };   // 작업 보드(/api/work = bus.timelineOf, state/work.json) — 대시보드 맨 위 보드 블록(카드-체계 1-1) · 타임라인 탭. 404 면 블록이 안 뜬다
const cards = { byTeam: {}, fetchedAt: {}, inflight: {}, waiting: {} };   // 팀 상황 카드 재료(/api/card/<팀>, 솔라 C5 — card.js 머리 JSDoc 모양). 30초 캐시, waiting = fetch 끝나면 부를 화면들(솔라 감사 ②). 채팅 맨 위·대시보드·비서실이 같은 재료
let requestsAll = [];         // 요청 블록 접은 목록 (6-1절) — 관제탑 요청 탭·전체 탭 타일
let requestsLoaded = false;
let requestsFetchedAt = 0;
let requestsFetching = null;
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

/** 이 방 사람들 — 대표와, 옮겨온 말 때문에 빌려 온 총괄(from) 은 뺀다. 나리(system)는 세션이 있는 방(N1 — 총괄실, cast model 있음)에서만 사람이고, 다른 방의 system 은 로밍 자리라 뺀다(대표 12:2x "대시보드에 멤버쪽 나리가 없다", 톰 배분). 헤더 둘째 줄·상태 칩이 같은 명단을 쓴다. */
/* 얼굴 열일곱(결정 131 · 헨리 req_99dbd1fe, C7) — teams/design/out/faces/<팀>-<자리>.png(대표 boss.png · 나리 hq-system.png), 서버가 /out/design/faces/ 로 내준다.
 * 이름표(.av 32×32)·칩(.chip)·사람 카드 머리에 <img> 를 얹고 머리글자는 밑에 남긴다 — 그림이 없거나 못 읽으면 img 가 빠져 머리글자만 보인다(헨리 ①). 크기·둥글기는 CSS(.chip img, 클레멘타인 d61339a). */
// 결정 197(대표 18:28 "내가 고른 게 아닌데") — 도트(faces/)가 아니라 대표가 고른 초상(portraits/picks-0916.json). 칩엔 128px 판(portraits/chip128, 장당 35KB 아래 — 394px chip/ 은 장당 25만 바이트라 방 하나에 4MB, 나리 apr_654ef2a7).
const FACE_DIR = '/out/design/portraits/chip128/';
const faceFile = (team, id) => (id === 'boss' ? 'boss.png' : id === 'system' ? 'hq-system.png' : `${team === 'sera' ? 'hq' : team}-${id}.png`);
function withFace(node, team, id) {
  if (!team || !id) return node;
  const img = document.createElement('img');
  img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
  img.addEventListener('error', () => img.remove());
  img.src = FACE_DIR + faceFile(team, id);
  node.appendChild(img);
  return node;
}
// 비서실(sera)만 나리(system)를 세션(model) 없이도 세운다 — 머리에 세라·나리 둘(사용성-0916 표 7, 34회차). 다른 방의 안내 자리는 세션 있을 때만.
const roomAgents = () => Object.entries(cast.agents ?? {}).filter(([id, a]) => id !== 'boss' && !a.from && (id !== 'system' || a.model || active === 'sera'));

/**
 * 자리의 살아 있음. 세션이 있나(듣는 중), 일하는 중인가, 지금 차례가 잡혀 있나.
 * codex 자리는 세션이 없다 — 부를 때만 프로세스가 뜬다. 사회자가 돌리는 중이면 busy, 차례가 잡혔으면 turn, 아니면
 * off 다. 쉬는 codex 를 "듣는 중" 으로 그렸었다 (레오 R15 감사).
 */
const STATE_LABEL = { off: '오프라인', idle: '대기', busy: '진행 중', turn: '답변 대기' };   // 사전 0-3 폴드7 QA 표(3aa853b): 수신 중 → 대기   // "일하는 중" 은 관제탑 알약과 같은 글자(하영 ③)
function stateOf(id) {
  const c = summary.conductor ?? {};
  const a = cast.agents?.[id];
  // 다른 회사 엔진 자리(결정 77) — 세션이 없어 부를 때만 온다. 안 부른 동안은 '오프라인' 이 아니라 '대기'(사전 3-1 "부를 때만 와요") — 방 머리 "레오 오프라인" 을 대표가 "안 열렸다" 로 읽으셨다(09-16 17:1x).
  if (a?.model === 'gpt' || a?.model === 'gemini') return c.outsideBusy ? 'busy' : (c.pending ?? []).some((p) => p.startsWith(id + ':')) ? 'turn' : 'idle';
  // 비서실의 나리(system)는 세션이 총괄실에 산다(노랑 손) — 그 방 cast 엔 model 이 없어 늘 '오프라인' 이 됐다. hq 세션으로 본다(사용성-0916 표 7).
  const s = id === 'system' && active === 'sera' ? (summaries.hq?.sessions?.system ?? summary.sessions?.[id]) : summary.sessions?.[id];
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
/**
 * 접힌 말풍선 — "개발 방에 답함 · 펼치기" 한 줄, 누르면 원문 말풍선(C15 인용 꼴의 부품, 카카오톡 답장은 모양만 참고). 로밍 답(meta.roam)과 인용(meta.quote) 둘 다 이걸 쓴다.
 * 접힌 줄에 방 이름표 — 그 방 채팅으로 건너뛰는 문(jump 가 있으면).
 */
function foldBubble(label, inner, jump = null) {
  const d = el('details', 'bub bub--fold');
  const s = el('summary', 'bub__sum');
  s.appendChild(el('span', 'bub__foldk', label));
  s.appendChild(el('span', 'bub__foldgo', '펼치기'));
  d.appendChild(s);
  const body = el('div', 'bub__folded'); body.appendChild(inner);
  if (jump?.team) { const go = el('button', 'bub__jump', `${teams.find((t) => t.id === jump.team)?.room ?? jump.team} 열기`); go.type = 'button'; go.addEventListener('click', () => jumpTo(jump.team, jump.event ?? null)); body.appendChild(go); }
  d.appendChild(body);
  d.addEventListener('toggle', () => { s.querySelector('.bub__foldgo').textContent = d.open ? '접기' : '펼치기'; });
  return d;
}

function bubble(text, team = active) {
  const n = el('div', 'bub');
  const src = String(text ?? '');
  const blocks = [];
  // 코드블록과 표(연속된 | 줄)를 떼어 접는다
  let body = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => { blocks.push(['코드', code]); return `\u0000${blocks.length - 1}\u0000`; });
  // 표는 머리줄 + 구분선(|---|) 이 있어야 표다. '|' 로 시작하는 줄 둘만으로 판정하면 일반 문장을 잡아먹는다 (레오 감사, 2026-09-12).
  body = body.replace(/(?:^|\n)([ \t]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-{3,}[ \t|:-]*(?:\n(?:[ \t]*\|[^\n]*(?:\n|$))*)?)/g, (m, tbl) => { blocks.push(['표', tbl.trim()]); return `\n\u0000${blocks.length - 1}\u0000`; });
  // 호명 표시(결정 128) — 첫머리 "@이름" 또는 "이름," 을 그 사람 색으로 굵게. 판별은 mention.js — 관제탑 카드 표시(bus.peopleOf)와 같은 것을 본다.
  let mentionHtml = '';
  const mm = parseMention(body);
  if (mm) {
    const hitId = Object.keys(cast.agents ?? {}).find((id) => cast.agents[id]?.name === mm.name);
    const hit = hitId ? cast.agents[hitId] : null;
    // 불린 이름은 박스(칩) — 대표 09-16 11:0x "이런 박스 안에 이름 넣는 거 괜찮다. 이름 멘션할 때 잘 안 보이더라고"(C13). 받았나는 markMentions 가 뒤에 채운다(data-mention).
    if (hit) { mentionHtml = `<span class="mention mchip" data-mention="${escapeHtml(hitId)}" style="--c:${hit.color ?? FALLBACK.color}">@${escapeHtml(mm.name)}</span>${mm.sep === ',' ? '' : escapeHtml(mm.sep)}`; body = body.slice(mm.full.length); }
  }
  let html = escapeHtml(body)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^[ \t]*[-*]\s+/gm, '· ');
  // 산출물 경로는 링크로 (대표 결정 36). 이스케이프한 뒤라 경로엔 &<>" 가 없고, url 은 encodeURIComponent 를 거쳤다.
  html = linkOutPaths(html, team, outAnchor);
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const [kind, content] = blocks[Number(i)];
    return `<details class="bub__fold"><summary>${kind} 보기</summary><pre>${escapeHtml(content)}</pre></details>`;
  });
  // 호명을 떼어 낸 뒤엔 앞 공백을 남긴다 — trim() 이 "톰, 코드" 의 쉼표 뒤 공백을 먹어 "톰,코드" 로 붙었다(나리 usability-0916 U6).
  n.innerHTML = mentionHtml + (mentionHtml ? html.trimEnd() : html.trim());
  // 그림은 말풍선 안에, md·글은 눌러 펼쳐 읽게. 여섯 개까지 — 나머지는 링크로 족하다.
  for (const f of findOutPaths(body, team).filter((f) => f.kind !== 'file').slice(0, 6)) n.appendChild(outFileNode(f));
  return n;
}

const outAnchor = (f) => `<a class="outa" href="${f.url}" target="_blank" rel="noopener">${f.raw}</a>`;

const fmtSize = (n) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);

/**
 * 산출물 하나 — 링크, 그림은 그 자리에, md·글은 펼치면 서버(/out/<팀>/…)에서 읽어 온다 (대표 결정 36).
 * 발언 밑과 승인 카드가 같은 것을 쓴다. 파일이 없으면 그렇다고 — 모르면서 승인하게 두지 않는다.
 */
function outFileNode(f) {
  const box = el('div', 'outf'); box.dataset.kind = f.kind;
  const a = el('a', 'outa', `${f.team}/${f.root ?? 'out'}/${f.rel}`); a.href = f.url; a.target = '_blank'; a.rel = 'noopener';
  box.appendChild(a);
  if (f.missing) { box.appendChild(el('span', 'outf__miss', ' — 파일 없음')); return box; }
  if (f.size != null) box.appendChild(el('span', 'outf__meta', ` ${fmtSize(f.size)}`));
  if (f.kind === 'image') {
    const link = el('a'); link.href = f.url; link.target = '_blank'; link.rel = 'noopener';
    const img = el('img', 'outf__img'); img.src = f.url; img.alt = f.rel; img.loading = 'lazy';
    img.addEventListener('error', () => { link.replaceWith(el('span', 'outf__miss', ' — 이미지 없음')); });
    link.appendChild(img);
    box.appendChild(link);
  } else if (f.kind === 'md' || f.kind === 'text') {
    const d = el('details', 'outf__fold');
    d.appendChild(el('summary', null, '읽기'));
    const pre = el('pre'); d.appendChild(pre);
    d.addEventListener('toggle', async () => {
      if (!d.open || pre.dataset.loaded) return;
      pre.dataset.loaded = '1';
      pre.textContent = '로딩 중';
      try { const r = await fetch(f.url); pre.textContent = r.ok ? await r.text() : `읽지 못했습니다 (${r.status})`; }
      catch (e) { pre.textContent = `읽지 못했습니다 — ${e.message}`; }
    });
    box.appendChild(d);
  }
  return box;
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
  loadThreeLines(() => renderRail());   // 팀별 세 줄 정본이 오면(바뀌면) 한 번 더 — 60초 캐시라 매번 안 받는다

  for (const t of teams) {
    const s = summaries[t.id] ?? {};
    const b = el('button', 'team');
    b.type = 'button';
    b.dataset.id = t.id;
    b.setAttribute('aria-current', String(t.id === active));

    const dot = el('span', 'team__dot');
    // 대표를 부른 방(bossCall)도 빨간 점 — 배지만 알고 레일은 몰랐다 (독립검수 #9).
    dot.dataset.s = s.needsBoss || s.bossCall ? 'alert' : s.phase === 'running' ? 'running' : 'idle';
    b.appendChild(dot);

    const body = el('span', 'team__body');
    body.appendChild(el('span', 'team__name', t.name));
    // 왼쪽 팀 줄 — "31회차 · 9단계" 는 대표님께 뜻이 없다(사용성-0916 표 4, 34회차): 지금 하는 일 한 줄(사람 말) — 팀별 세 줄 정본의 '지금', 없으면 상황판 하는 것 첫 줄, 둘 다 자에 안 맞으면 상태 말 하나
    const nowLine = [three.byTeam[t.id]?.now, s.progress?.doing?.[0]].map((v) => String(v ?? '').trim()).find((v) => bossOk(v));
    const sub = nowLine ?? (s.phase === 'running' ? '진행 중' : s.logCount ? '대기' : '시작 전');
    const subEl = el('span', 'team__sub', sub); subEl.title = sub;
    body.appendChild(subEl);
    b.appendChild(body);

    const badge = el('span', 'team__badge');
    if (s.needsBoss || s.bossCall) {
      badge.textContent = '대표님';
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
  // 검수 #4 — 폰 위 띠는 가로로 밀리는데 힌트가 없어 화면 밖 방(디자인·경영재무)을 모른다. 지금 방을 보이게 밀고,
  // 밖에 안 읽은 게 있으면 띠 오른쪽에 "밖 N" 을 붙인다(CSS 페이드와 함께).
  const cur = nav.querySelector('[aria-current="true"]');
  if (cur?.scrollIntoView) { try { cur.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch { /* 옛 브라우저 */ } }
  const hidden = teams.filter((t) => t.id !== active && (unread[t.id] > 0 || summaries[t.id]?.needsBoss || summaries[t.id]?.bossCall)).length;
  const more = $('railMore');
  if (more) { more.hidden = !hidden || nav.scrollWidth <= nav.clientWidth + 4; more.textContent = `더 ${hidden}`; }
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
/** 방 하나가 대표 차례인 이유 — 한 줄. */
function bossWhyOf(t) {
  const s = summaries[t.id] ?? {};
  if (s.needsBoss) return BOSS_WHY[s.needsBossWhy] ?? '답변 필요';
  if (s.bossCall) return `${ga(s.cast?.[s.bossCall.by]?.name ?? s.bossCall.by)} 불렀습니다 · ${ago(s.bossCall.ts)}`;
  return '';
}
/**
 * 종 — 모든 탭 오른쪽 위 (네이버 폰 화면 기준, 결정 34). 누르면 **알림 패널** (결정 68 — "배지만 있고 내용이 없으면 대충 구현").
 * 목록은 notify.js notificationsOf 가 요약·승인에서 만든다(계약 event-schema 3절 "알림 패널"): 대표 차례 → 승인 대기 → 막힘 → 보고.
 * 배지 숫자는 안 읽은 것 중 **대표 손이 필요한 것**(mine — 보고·B·위임 중 대리될 것은 패널에만, 나리 결정 ② 09-15), 빨강은 그중 급한 것(대표 차례·승인·막힘).
 * 읽음은 브라우저가 기억한다(localStorage) — 새 저장소 없음.
 */
const READ_KEY = 'ppanam.notify.read';
const BELL_EMPTY = '보실 것 없어요. 팀이 일하는 중이에요.';   // 종 빈 줄 — 하영 사전 7판 3-1 247행 글자 그대로(나리 34회차, "확인할 항목 없음" 은 기계 말)
const readIds = () => { try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]')); } catch { return new Set(); } };
const saveRead = (set) => { try { localStorage.setItem(READ_KEY, JSON.stringify([...set].slice(-500))); } catch { /* 저장소 없음 */ } };
const notifications = () => notificationsOf({ teams, summaries, approvals }, { read: readIds(), delegation });
function markRead(ids) { const r = readIds(); for (const id of ids) r.add(id); saveRead(r); renderBossBadge(); }

function renderBossBadge() {
  const { items, unread: n, urgent } = notifications();
  const bell = $('bell');
  bell.dataset.n = String(n);
  bell.dataset.urgent = urgent ? '1' : '0';
  const num = $('bellN');
  num.hidden = n === 0;
  num.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
  $('bossBadge').title = n ? `안 읽은 알림 ${n}` : (items.length ? `알림 ${items.length} · ${BELL_EMPTY}` : BELL_EMPTY);
  if (!$('bellMenu').hidden) renderBellMenu();
}
// 화면 글자는 하영 사전(teams/marketing/out/opsroom-words.md 3절 확정본, 결정 43 ⑥·100) 그대로 — 여기서 새로 짓지 않는다. 회차·단계·계획표·결재·낸 것·검토 결과.
const BOSS_WHY = { blocked: '검토 필요 — 반려 뒤 중단', attempts: '검토 필요 — 3회 반려', silent: '24시간 이상 활동 없음' };
const KIND_LABEL = { boss: '정하실 것', approval: '결재', blocked: '차단됨', report: '보고' };
function renderBellMenu() {
  const m = $('bellMenu');
  m.replaceChildren();
  // 목록은 대표님 몫만(사용성-0916 표 6, 34회차) — 정하실 것·결재·막힘(mine) + "톰·제리가 보는 중 N건" 한 줄(U3). 보고(오늘 대표를 부른 말 전부)는 뺐다 — 실측 R34: 마흔 줄 넘게 서서 종을 열어도 읽을 수 없었다. 보고는 방에 있다.
  const items = notifications().items.filter((it) => it.mine || it.id === 'approval:theirs');
  // 머리 — "알림" + 설정(자리만) + 모두 읽음
  const head = el('div', 'nt__head');
  head.appendChild(el('b', null, '알림'));
  const tools = el('div', 'nt__tools');
  const all = el('button', 'nt__all', '모두 읽음'); all.type = 'button';
  all.disabled = !items.some((it) => it.unread);
  all.addEventListener('click', (e) => { e.stopPropagation(); markRead(items.map((it) => it.id)); renderBellMenu(); });
  const gear = el('button', 'nt__gear', '⚙'); gear.type = 'button'; gear.title = '알림 설정(준비 중)'; gear.disabled = true;
  tools.append(all, gear);
  head.appendChild(tools);
  m.appendChild(head);
  if (!items.length) { m.appendChild(el('div', 'bell__empty', BELL_EMPTY)); return; }
  let lastKind = null;
  for (const it of items) {
    if (it.kind !== lastKind) { m.appendChild(el('div', `nt__kind nt__kind--${it.kind}`, KIND_LABEL[it.kind] ?? it.kind)); lastKind = it.kind; }
    const row = el('button', `nt__row${it.unread ? ' is-unread' : ''}`); row.type = 'button';
    row.dataset.kind = it.kind;
    // ① 누가 — 팀 색 아바타 + 이름. 자리가 없는 항목(막힘)은 방 아이콘.
    const a = it.by ? summaries[it.team]?.cast?.[it.by] : null;
    const av = el('span', 'nt__av', a?.initial ?? (it.teamName ?? '?').slice(0, 1));
    if (it.by) withFace(av, it.team, it.by);
    av.style.background = a?.color ?? 'var(--ink-4)';
    row.appendChild(av);
    const body = el('span', 'nt__body');
    const who = el('span', 'nt__who');
    who.appendChild(el('b', null, it.name ?? it.by ?? it.teamName));
    who.append(` · ${it.teamName}`);
    body.appendChild(who);
    // ② 무슨 일 — 한 줄 · ③ 언제
    body.appendChild(el('span', 'nt__text', it.text));
    body.appendChild(el('span', 'nt__when', it.ts ? ago(it.ts) : ''));
    row.appendChild(body);
    // ④ 오른쪽 미리보기 — out/ 그림이 있으면 썸네일, 없으면 방 아이콘
    const side = el('span', 'nt__side');
    if (it.thumb) { const img = document.createElement('img'); img.src = it.thumb; img.alt = ''; img.loading = 'lazy'; side.appendChild(img); }
    else side.appendChild(el('span', 'nt__room', (teams.find((t) => t.id === it.team)?.name ?? '?').slice(0, 2)));
    // ⑤ 안 읽음 점
    if (it.unread) side.appendChild(el('i', 'nt__dot'));
    row.appendChild(side);
    row.addEventListener('click', () => {
      markRead([it.id]); closeBell();
      const t = it.target ?? {};
      // 승인 카드는 모든 탭 맨 위(#approvals)에 떠 있다 — 관제탑 첫 화면으로 가면 보인다.
      if (t.view === 'tower') {
        if (it.kind === 'approval' && !t.approval) { theirsOpen = true; renderApprovals(); }   // "톰·제리가 보는 중 N건" — 띠의 접힌 줄을 편다(U3·U4)
        setView('tower'); setTowerTab(it.kind === 'approval' ? 'all' : 'asks');
      }
      else jumpTo(t.team, t.event ?? null);
    });
    m.appendChild(row);
  }
}
const closeBell = () => { $('bellMenu').hidden = true; };
$('bossBadge').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = $('bellMenu');
  if (m.hidden) { renderBellMenu(); m.hidden = false; } else closeBell();
});
document.addEventListener('click', (e) => { if (!$('bell').contains(e.target)) closeBell(); });
$('railMore')?.addEventListener('click', () => { const nav = $('teams'); nav.scrollTo({ left: nav.scrollWidth, behavior: 'smooth' }); });

/* ── 가운데 머리 ── */

function renderHead() {
  const t = teams.find((x) => x.id === active);
  $('roomName').textContent = t?.room ?? '채팅';   // 방 이름은 teams.json room("개발 방") — 하영 사전 0-1 (덤) 작전실 → 팀 방
  // 총괄실은 대표와의 1:1 이라 라운드가 없다. 늘 열려 있다.
  const office = t?.kind === 'office';
  // 라운드가 "있다" 는 번호가 아니라 phase 다. 번호는 닫힌 뒤에도 남아서, 번호로 그리면 닫힌 방이
  // "R14 · 라운드 닫기 · 입력 가능" 으로 보이고 보내면 409, 닫으면 두 번 닫힌다 (Fable 재점검, 2026-09-12).
  const open = office || summary.phase === 'running' || summary.phase === 'blocked';
  const blocked = !office && summary.phase === 'blocked';
  document.title = open && !office ? `${summary.round}회차 · ${t?.name ?? '채팅'}` : (t?.room ?? '채팅');
  const turns = bossTurns().n;
  if (turns) document.title = `(${turns}) ` + document.title;   // 탭 제목에도 — 다른 창에 있어도 보이게

  // 글자는 하영 사전 3-2 그대로. 표에 없는 두 줄(멈춤 띠·회차 없음 안내)은 1절 낱말(회차·답·멈춤)로만 조립 — 하영에게 표에 더해 달라고 부탁함(R25).
  // office 방의 주인은 teams.json 의 owner — 총괄실은 톰, 비서실(결정 132)은 세라. 비서실 줄 글자는 하영 확정 전 임시.
  const owner = t?.owner ?? 'chief';
  $('rnum').textContent = office ? `대표님과 ${who(owner).name}` : open ? `${summary.round}회차` : '—';
  $('rtitle').textContent = office
    ? (owner === 'chief' ? '여기서 한 말을 톰이 팀에 나눠요' : `${who(owner).name}가 다섯 팀 상황을 요약해서 알려 드려요`)
    : blocked
      ? `대표님 답을 기다려요 — 검토에서 멈춤이 났어요. 여기에 답을 적으면 ${summary.round}회차가 이어져요`
      : open
        ? (summary.topic ? `${summary.milestone}단계 — ${summary.topic}` : `${summary.milestone}단계`)
        : '진행 중인 회차 없음';
  const c = summary.conductor ?? {};
  const turnNote = c.flow ? `검토 중 · ${who(c.flow.waiting ?? c.flow.step).name} 차례` : c.pending?.length ? `차례: ${c.pending.map((p) => who(p.split(':')[0]).name).join(', ')}` : '';
  $('rprog').textContent = [turnNote, open && summary.attempt > 0 ? `반려 ${summary.attempt}회` : ''].filter(Boolean).join(' · ');
  app.dataset.alert = (open && summary.attempt > 0) || summary.needsBoss ? '1' : '0';

  renderWork();

  const rb = $('roundBtn');
  // 막힌 방(FAIL)은 대표가 말해 풀기 전엔 닫히지 않는다 — 버튼을 보여 주면 누르고 거부당한다 (가드 R13).
  rb.hidden = office || blocked;
  rb.textContent = open ? '회차 마무리' : '회차 시작';   // 사전 1절 확정 글자(마무리) — /마무리 와 같은 말(하영 req_1a45175b). L2 표 137행 '종료' 는 1절과 어긋나 1절을 따른다
  if (office) $('roundOpen').hidden = true;

  // 라운드 밖에서도 쓸 수 있다. 보내면 첫 줄이 주제로 채워진 열기 폼이 뜨고, 열리면 그 말이 첫 지시로 들어간다 (결정 19).
  // 전에는 잠겨 있어 "고장" 으로 보였다.
  const input = $('input');
  input.disabled = false;
  const ownerName = cast.agents?.guide?.name ?? '팀장';   // 그 방 실무(guide) 이름 — "실무" 는 없어지는 말(하영 0-2)
  input.placeholder = office
    ? `${who(owner).name}에게 말하기`   // 총괄실은 톰, 비서실은 세라(나리 실측 09-15: 비서실도 '톰에게' 였다)
    : blocked
      ? '답변 시 회차 재개'
      : open ? `${ownerName}에게 말하기` : '첫 메시지 = 주제';

  const crew = $('crew');
  crew.replaceChildren();
  for (const [id, a] of roomAgents()) {
    const c = withFace(el('div', 'chip', a.initial ?? '?'), a.from ?? active, id);
    c.style.background = a.color ?? FALLBACK.color;
    const st = stateOf(id);
    c.dataset.state = st;
    c.title = `${a.name} — ${a.title ?? ''} · ${STATE_LABEL[st]}`;   // 직책(title)만 — 하는 일(does)은 화면에 안 띄운다 (req_94013782)
    crew.appendChild(c);
  }
}

/**
 * 누가 지금 무엇을 하는가 — 헤더 둘째 줄과 라운드 줄의 생존 표시 (결정 28 ①·31 ①, 독립검수 #5).
 * 둘째 줄은 자리마다 "테라 작업 중 · 솔라 듣는 중 · 레오 자는 중" — 폰에서는 상태 칩이 숨으니 이 글자가 전부다.
 * 라운드 줄은 일하는 세션이 있으면 항상 "테라 작업 중 · 마지막 신호 2분 전". 시각은 30초마다 다시 센다.
 * 총괄실도 일한다 — 라운드 번호가 0 이라고 숨기지 않는다.
 */
function renderWork() {
  const states = roomAgents().map(([id, a]) => [id, a, stateOf(id)]);
  const off = ws?.readyState !== 1 ? '연결 끊김 — 재연결 중 · ' : '';
  $('roomWho').textContent = off + states.map(([, a, st]) => `${a.name} ${STATE_LABEL[st]}`).join(' · ');

  const busy = states.filter(([, , st]) => st === 'busy');
  const work = $('rwork');
  work.hidden = !busy.length;
  if (!busy.length) { work.textContent = ''; return; }
  const sessions = summary.sessions ?? {};
  // 마지막 신호 — 서버가 세션의 스트림 이벤트(도구 호출·출력)를 받은 시각. codex 자리는 신호 시각이 없다.
  const signals = busy.map(([id]) => sessions[id]?.lastSignal).filter(Boolean).map((ts) => new Date(ts).getTime());
  const queued = busy.reduce((n, [id]) => n + (sessions[id]?.queued ?? 0), 0);
  work.textContent = [
    `${busy.map(([, a]) => a.name).join('·')} 진행 중`,
    signals.length ? moved(Math.max(...signals)) : '',
    queued ? `기다리는 말 ${queued}` : '',
  ].filter(Boolean).join(' · ');
}
setInterval(renderWork, 30_000);

/* ── 오른쪽 상황판 ── */

/**
 * 결정 140 — 대표가 보는 글 한 줄은 자(bosswords.js)에 맞아야 낸다. 안 맞으면 **"요약 없음" 을 찍지 않는다**(적대검수 opus ④: 가린 글은 읽을 수 있는 글이 아니다) —
 * 그 팀의 '진행 중' 첫 줄(하영 팀별-세줄, 팀장 확인분)이 있으면 그 줄을 대신 내고(원문은 title 에), 그것도 없으면 null — 부르는 쪽이 그 줄·행을 안 그린다.
 * 세 근원(상황판 줄 · 결재 제목 · 누가 뭘 했나)이 전부 이 하나를 지난다.
 */
function bossLine(text, cls, team = null) {
  const s = String(text ?? '');
  if (bossOk(s)) return el('span', cls, s);
  const alt = team ? three.byTeam[team]?.now : null;
  if (alt && bossOk(alt)) { const w = el('span', cls, alt); w.title = s; w.dataset.alt = '1'; return w; }
  return null;
}
/** 상황판 한 칸의 줄들 — 자에 맞는 줄만, 사이는 " / ". 다 걸리면 none 글자(빈 칸은 안 지어 쓴다). */
function bossLines(lines, none) {
  const s = el('span');
  const ok = lines.filter((l) => bossOk(l));
  if (!ok.length) { s.textContent = none; return s; }
  ok.forEach((l, i) => { if (i) s.append(' / '); s.append(l); });
  return s;
}
/** 행 하나에 bossLine 을 넣되, 낼 글이 없으면 그 행을 통째로 빼는 데 쓴다 — true 면 붙였다. */
const putLine = (row, text, cls, team = null) => { const n = bossLine(text, cls, team); if (!n) return false; row.appendChild(n); return true; };
/** 결재 제목 — 올린 사람이 --boss 로 적은 한 줄(r.boss)이 자에 맞으면 그것, 아니면 원문(r.what)을 재고, 둘 다 아니면 "아직 쉬운 말로 안 적음" + 원문 펼침. */
const bossTitle = (r) => bossOk(r.boss) ? r.boss : r.what;
/** 줄이 팀 이름으로 시작하나("총괄 · …", "경영: …") — 그러면 머리에 팀 이름을 또 안 붙인다(daily-words 1절, 폴드 QA #4). */
const startsWithTeam = (text, teamName) => !!teamName && new RegExp(`^\\s*${teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(팀)?\\s*[·:—\\-]`).test(String(text ?? ''));

function renderSide() {
  // 비서실(세라 방)은 상황판·회차·로드맵이 없다 — "상황판 없음 · 진행 중인 회차 없음 · 로드맵 없음" 빈 블록 셋을 대표가 보고 화냈다(나리 R32 ④). 참여·일지만 남긴다.
  const quiet = active === 'sera';
  for (const id of ['cardProgress', 'cardRound', 'cardRoadmap']) $(id).hidden = quiet;
  // 첫 카드 — 지금 어디까지 왔나 (결정 23, 계약 3절 "상황판"). 실무가 progress.mjs 로 쓴 것을 그대로. 안 썼으면 안 쓴 채로 보이게.
  const pg = $('cardProgress');
  pg.replaceChildren();
  pg.appendChild(el('div', 'card__k', '진행 상황'));
  const p = summary.progress;
  if (!p) {
    pg.appendChild(el('div', 'card__note', '상황판 없음'));
  } else {
    for (const [k, label] of [['doing', '지금'], ['blocked', '이슈'], ['boss', '대표님이 보실 것'], ['next', '다음']]) {
      const items = p[k] ?? [];
      const row = el('div', 'prog__row'); row.dataset.k = k; row.dataset.n = String(items.length);
      row.appendChild(el('div', 'prog__k', label));
      if (!items.length) row.appendChild(el('div', 'prog__none', '없음'));
      else { const ok = items.filter((it) => bossOk(it)); if (!ok.length) row.appendChild(el('div', 'prog__none', '없음')); else { const ul = el('ul', 'prog__list'); for (const it of ok) ul.appendChild(el('li', null, it)); row.appendChild(ul); } }   // 통과한 줄만(결정 140), 걸린 줄은 안 그림(opus ④)
      pg.appendChild(row);
    }
    pg.appendChild(el('div', `card__note${p.fresh === false ? ' prog__stale' : ''}`, `${p.at ? `${ago(p.at)} 갱신` : '갱신 시각 없음'}${p.by ? ' · ' + p.by : ''}${p.fresh === false ? ' · 이 회차 시작 전 것이라 낡았어요' : ''}`));
  }

  // 이 방이 낀 요청 블록 (6-1절 — 요청한 방·받는 방·총괄실 세 곳) — 열린 것만. 관제탑 요청 탭과 같은 카드(requestCard).
  const rq = $('cardRequests');
  const mine = requestsAll.filter((x) => x.status !== 'closed' && (active === 'hq' || x.from.team === active || x.to.team === active));
  rq.replaceChildren();
  rq.hidden = !mine.length;
  if (mine.length) {
    rq.appendChild(el('div', 'card__k', `다른 팀에 요청한 일 ${mine.length}`));
    for (const x of mine) rq.appendChild(requestCard(x, renderSide));
  }
  if (!requestsLoaded || Date.now() - requestsFetchedAt > 30_000) loadRequests().then((changed) => { if (changed && view === 'room') renderSide(); });

  // 이번 라운드
  const r = $('cardRound');
  r.replaceChildren();
  r.appendChild(el('div', 'card__k', '이번 회차'));
  if (summary.phase === 'running' || summary.phase === 'blocked') {
    r.appendChild(el('div', 'card__big', `${summary.round}회차`));
    if (summary.topic) r.appendChild(el('div', 'card__note', summary.topic));
    const dl = el('dl');
    for (const [k, v] of [
      ['단계', summary.milestone ? `${summary.milestone} / ${summary.milestonesTotal || '—'} 단계` : '—'],
      ['상태', summary.needsBoss ? '답변 필요' : summary.phase === 'running' ? '진행 중' : '대기'],
      // 대화록 N건 — 뺐다(하영 3-2: opsroom-content.md 3절)
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
    r.appendChild(el('div', 'card__note', summary.attempt ? `반려 ${summary.attempt}회 — 3회 시 대표 검토` : '반려 0회 — 3회 시 대표 검토'));
  } else {
    r.appendChild(el('div', 'card__note', '진행 중인 회차 없음'));
  }

  // 계획표
  const m = $('cardRoadmap');
  m.replaceChildren();
  m.appendChild(el('div', 'card__k', '로드맵'));
  if (roadmap.destination) {
    const d = el('div', 'dest');
    d.appendChild(el('div', 'dest__k', '목표'));
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
    m.appendChild(el('div', 'card__note', '로드맵 없음'));
  }
  if (roadmap.cutList?.length) {
    const c = el('div', 'cut');
    c.appendChild(el('div', 'cut__k', '제외'));
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
    if (a.from) continue;   // 빌려 온 총괄은 이 방 참여자가 아니다
    // 나리(system)도 참여에 든다 — 결정 129 로 사람. N1 뒤 총괄실 나리는 세션이 있어(cast model) 상태 점을 그리고, 다른 방의 system(로밍, model 없음)은 대표처럼 직책만 (대표 "프로필이 없네 나리", 비서실 09-14).
    const person = id === 'boss' || (id === 'system' && !a.model);
    const row = el('div', 'who__row');
    const av = withFace(el('div', 'chip', a.initial ?? '?'), a.from ?? active, id);
    av.style.background = a.color ?? FALLBACK.color;
    if (!person) av.dataset.state = stateOf(id);
    row.appendChild(av);
    const t = el('div', 'who__t');
    t.appendChild(el('div', 'who__n', a.name));
    t.appendChild(el('div', 'who__r', person ? (a.title ?? '') : `${a.title ?? ''} · ${STATE_LABEL[stateOf(id)]}`));
    row.appendChild(t);
    if (a.model) row.appendChild(el('div', 'who__m', a.model.toUpperCase()));
    if (id !== 'boss') { row.classList.add('door'); row.title = `${a.name} 카드`; row.addEventListener('click', () => openPersonPop(active, id)); }   // 참여 줄도 문
    c.appendChild(row);
  }

  // 일지 — 자리마다 어제 한 문단. 세션이 죽어도 이게 남는다.
  const j = $('cardJournal');
  j.replaceChildren();
  j.appendChild(el('div', 'card__k', '일지'));
  const entries = Object.entries(journal);
  if (!entries.length) {
    j.appendChild(el('div', 'card__note', '일지 없음 — 회차 마무리 시 생성'));
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
      // 판정 도장(영어 PASS·REVISE + 감사 본문 그대로)을 판정 카드로(G3, 카드-체계 2절 · 대표 07:0x "Pass Revise 이거 양식도 이상함"): 승인/반려/보류 · 누가 → 누구 · 사람 말 한 줄 · 자세히 접힘 · 반려면 반박 N/3.
      // 한 줄은 meta.line(서버가 주면) 아니면 본문 첫 줄 — 그게 "떨어뜨릴 이유" 로 시작하면 감사 글이라 한 줄 없음(카드가 '요약 없음' 을 찍고 자세히에 본문). 감사가 첫 줄에 사람 말 한 줄을 쓰는 건 판정 지시문 몫(계약 3절 verdict).
      lastActor = null;
      const v = e.meta?.verdict ?? 'REVISE';
      const body = String(e.text ?? '');
      const first = body.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
      const line = e.meta?.line ?? (/^(떨어뜨릴 이유|근거|반박)/.test(first) ? '' : first.split(/(?<=[.!?])\s|\s—\s(?=떨어뜨릴)/)[0]);
      const n = el('div', 'stamp' + (v === 'PASS' ? ' pass' : ''));   // 겉 상자는 그대로(정렬·간격), 안은 카드 부품
      n.appendChild(verdictCard({ verdict: v, from: a.name, to: who(e.meta?.target ?? 'guide').name, ts: e.ts, line, detail: body, attempt: v !== 'PASS' ? { n: e.meta?.attempt ?? 0, max: e.meta?.max ?? 3 } : null }));
      return n;
    }

    default: {
      const me = e.actor === 'boss';
      if (me && /올렸습니다: in\//.test(e.text ?? '')) lastUpload = { key: '' };   // 올린 파일이 방에 떴다 — 같은 파일 다시 올리기 막음을 푼다(결정 188: 60초가 아니라 '떴으면')
      const called = !me && e.actor !== 'system' && callsBoss(e.text);
      const cont = lastActor === e.actor && !called;
      lastActor = e.actor;
      const row = el('div', `row${me ? ' me' : ''}${cont ? ' cont' : ''}${called ? ' calls-boss' : ''}`);
      row.dataset.actor = e.actor;   // 멘션 "받았나"(markMentions) — 뒤에 이 사람 말이 있으면 답한 것
      // C16(대표 09-16 11:0x "서버 나리는 노랑, 너는 파랑 박스 안에 이름") — 나리(system) 말은 어느 손인지 meta.hand 로: 'server'(총괄실 세션) 노랑 · 'cli'(say.mjs --as system) 파랑. 서버가 아직 안 찍으면 색 없음
      if (e.actor === 'system' && e.meta?.hand) row.dataset.hand = e.meta.hand;
      const av = withFace(el('div', 'av', a.initial ?? '?'), e.meta?.from ?? active, e.actor);   // 이름표 32×32 r9 — 200px 얼굴을 cover 로(헨리 ①)
      av.style.background = a.color ?? FALLBACK.color;
      // 얼굴·이름은 문이다(결정 130 ① · 화면이-답하는-질문 "카드는 문") — 누르면 관제탑 사람 카드가 그 자리에 뜬다. 대표·system 은 카드가 없다(마을과 같다).
      // 나리(system 자리)도 문이 있다 — 결정 129 로 사람이 됐다. 세션이 없어 상태·일지는 비고 이름·직책만(나리 R25 "사람인데 문이 없는 자리").
      const door = (node) => { if (me) return; node.classList.add('door'); node.title = `${a.name} 카드`; node.addEventListener('click', () => openPersonPop(e.meta?.from ?? active, e.actor)); };
      door(av);
      row.appendChild(av);
      const stack = el('div', 'stack');
      if (!cont && !me) {
        const name = el('div', 'name');
        const nb = el('b', null, a.name); door(nb); name.appendChild(nb);
        name.append(' ' + hhmm(e.ts));
        // 총괄실에서 옮겨온 말 — 톰이 이 방 사람을 불렀다 (결정 21).
        if (e.meta?.from) name.appendChild(el('span', 'fromtag', `${teams.find((t) => t.id === e.meta.from)?.room ?? e.meta.from}에서`));
        stack.appendChild(name);
      }
      // 대표를 불렀다 — 멘션 표시 (결정 19-2).
      if (called) stack.appendChild(el('div', 'callmark', '@대표 멘션'));
      // 다른 방에 한 답(meta.roam:'dev' — 나리·세라 로밍, callHomeElsewhere 가 원본을 집 방에 남긴다)은 집 방 화면에서 접는다: "개발 방에 답함 · 펼치기"(대표 12:59 총괄실 "왜 테라 솔라한테 한 말이 여기서 보여?").
      // C15 인용(meta.quote)도 같은 부품(foldBubble) — 방·사람·시각 한 줄 + 펼치면 원문.
      const roam = e.meta?.roam && e.meta.roam !== active ? teams.find((t) => t.id === e.meta.roam) : null;
      if (roam) stack.appendChild(foldBubble(`${roam.room ?? roam.name}에 답함`, bubble(e.text, roam.id), { team: roam.id, event: e.id }));
      else stack.appendChild(bubble(e.text));
      // 비서실 카드(카드-체계 1절 "① 비서실 — 세라가 다섯 팀 카드를 올린다"): 말에 meta.cards:[팀…] 이 실리면 그 팀 카드를 말풍선 밑에 같은 부품으로(계약 3절 message).
      if (Array.isArray(e.meta?.cards) && e.meta.cards.length) {
        const wrap = el('div', 'bub__cards'); wrap.dataset.event = e.id;
        const draw = () => { wrap.replaceChildren(); for (const tid of e.meta.cards.slice(0, 6)) { const n = teamCardNode(tid, draw); if (n) wrap.appendChild(n); } };
        draw();
        stack.appendChild(wrap);
      }
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

// 문자열은 /toollabel.js 가 만든다 — node 에서도 돌려볼 수 있게 (bus/round.mjs check).
const groupLabel = (g, live) => `${who(g.actor).name} · ${toolLabel(g.items, live, 0)}`;   // 접힌 줄엔 수만 — 영어 파일 이름은 펼칠 때(폴드 QA #12)

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
  n.appendChild(el('div', 'quiet__t', '활동 없음'));
  const p = el('div', 'quiet__s');
  p.textContent = '회차 시작 후 주제 입력';
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
  markMentions();
  if (replace) feed.scrollTop = feed.scrollHeight;
}

function append(events) {
  const stick = atBottom();
  const q = stream.querySelector('.quiet');
  if (q) q.remove();
  const frag = document.createDocumentFragment();
  for (const e of events) drawWithDay(e, frag);
  stream.appendChild(frag);
  markMentions();
  if (stick) feed.scrollTop = feed.scrollHeight;
}

/**
 * 멘션 칩의 읽음 표시(C13). 화면에 있는 것만 본다: 그 칩 뒤에 불린 사람의 말풍선이 있거나 그 사람이 일하는 중이면 "@테라 · 읽음",
 * 아니면 이름만 "@테라". 대표 부름은 사람 카드의 bossAsk(서버 셈)가 따로 있다 — 여기는 칩 옆 작은 글자 하나.
 */
function markMentions() {
  const rows = [...stream.querySelectorAll('.row[data-actor]')];
  for (const chip of stream.querySelectorAll('.mention[data-mention]')) {
    const who = chip.dataset.mention;
    const myRow = chip.closest('.row');
    const answered = rows.some((r) => r.dataset.actor === who && r !== myRow && (myRow.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING));
    // 글자는 사전 3-2-1 "읽음" 하나(카카오톡·라인·슬랙 읽음 표시, 하영 결정 181 ②) — "받았어요" 는 우리가 지은 말이라 뺐다(대표 16:35 "뭔 소린지 이해가 안됨"). 안 읽었으면 글자 없음.
    const got = answered || stateOf(who) === 'busy';
    chip.dataset.got = answered ? 'ok' : got ? 'busy' : 'wait';
    chip.title = `${cast.agents?.[who]?.name ?? who}${got ? ' · 읽음' : ''}`;
    let s = chip.querySelector('.mention__got');
    if (!s) { s = el('span', 'mention__got'); chip.appendChild(s); }
    s.textContent = got ? '· 읽음' : '';
  }
}

/* ── 팀 전환 ── */

/** 다시 붙은 뒤 채우기(C14) — 보던 방을 다시 받는다. 서버가 막 뜨는 중이라 못 받으면 2초 뒤 다시(한 번 실패로 화면을 비우지 않는다). */
async function refill(tries = 0) {
  if (!active) return;
  const ok = await selectTeam(active);
  if (!ok) { if (tries < 5) setTimeout(() => refill(tries + 1), 2000); return; }
  if (view === 'tower') renderTower(); if (view === 'dashboard') loadDashboard(); if (view === 'analysis') loadAnalysis();
}

async function selectTeam(id) {
  // 주소는 여기서 건드리지 않는다. 팀과 화면이 같이 정해진 뒤에 한 번만 쓴다 —
  // 중간에 쓰면 히스토리에 지나가는 상태가 한 칸씩 남아 뒤로가기가 어긋난다.
  const prev = active;
  active = id;
  unread[id] = 0;
  // 서버가 막 뜨는 중이면 오류 JSON 이나 실패가 온다 — 그때 cast·events 를 undefined 로 덮으면 화면이 통째로 빈다(대표 13:11 총괄실 빈 화면의 한 길). 있던 것을 두고 false 로 돌아간다.
  // 그때 active 도 되돌린다 — 안 그러면 입력창은 새 방에 보내고 화면은 옛 방인 채로 갈린다(code-review 지적). 배너는 소켓이 끊겼을 때만, 아니면 짧게 한 줄.
  const r = await fetch(`/api/team?team=${encodeURIComponent(id)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r?.events || !r.cast) {
    active = prev;
    if (ws?.readyState !== 1) say('서버에 다시 연결 중…', 0); else say('방을 못 불러왔어요 — 잠시 뒤 다시');
    return false;
  }
  cast = r.cast; roadmap = r.roadmap; journal = r.journal ?? {};
  // /api/team 의 요약은 부팅·방송과 같은 모양(세션·차례 포함)이다. 레일·관제탑이 읽는 summaries 에도 넣어 둘이 어긋나지 않게.
  summary = r.summary; summaries[id] = r.summary;
  oldest = r.events[0]?.id ?? null;
  hasMore = r.more;
  $('loadMore').hidden = !hasMore;
  paint(r.events);
  renderRail(); renderHead(); renderSide();
  cards.fetchedAt[active] = 0; renderRoomCard();   // 방을 바꾸면 그 팀 카드를 새로(C7 — 채팅 맨 위 한 장)
  app.dataset.side = '0';
  $('scrim').hidden = true;
  return true;
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

let ws = null, retry = 0, everOpened = false, openedAt = 0, reconnectTimer = null;
// 다시 붙기(C14 — 대표 13:11 '총괄방에 대화 안 보여 버그 터진 듯': 13:12 재시작 뒤 화면이 안 붙어 ws 실패 245번). 간격 1·2·5·10초, 붙어서 5초를 버틴 뒤에야 처음으로 돌린다(붙자마자 끊기는 틈에 400ms 로 돌던 것).
const RECONNECT_MS = [1000, 2000, 5000, 10000];
window.ppanamDebug = { closeWs: () => ws?.close() };   // 사진용 — screen-shot.mjs 손질 줄에서 끊김을 흉내 낸다(C14 실측). 화면 동작엔 안 쓴다

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.onopen = () => {
    openedAt = Date.now();
    $('liveDot').dataset.on = '1';
    say(null);   // '서버에 다시 연결 중…' 지움
    if (active) renderWork();
    // 끊겼다 붙었다. 그 사이 발언은 소켓으로 안 왔다 — 보던 방을 다시 불러온다(마지막 사건 뒤를 채운다). 안 그러면 화면이 조용히 빠진다.
    if (everOpened && active) refill();
    everOpened = true;
  };
  ws.onclose = () => {
    $('liveDot').dataset.on = '0';
    if (active) renderWork();   // 폰에는 점만으로 모자라다 — 둘째 줄에 "끊김" 글자
    if (openedAt && Date.now() - openedAt > 5000) retry = 0;   // 오래 붙어 있다 끊긴 것 — 처음부터
    openedAt = 0;
    const wait = RECONNECT_MS[Math.min(retry, RECONNECT_MS.length - 1)];
    retry += 1;
    say(`서버에 다시 연결 중… ${Math.round(wait / 1000)}초 뒤`, 0);
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, wait);
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.kind === 'summaries') {
      summaries = msg.summaries ?? {};
      summary = summaries[active] ?? summary;
      World.onSummaries(summaries);
      renderRail(); renderHead(); renderSide();
      cards.fetchedAt[active] = 0; renderRoomCard();   // 요약이 바뀌면(상황판 갱신·결재·회차) 채팅 맨 위 카드도
      // 승인 대기 블록은 모든 탭 맨 위에 있다. 대기 건수가 움직였을 때만 목록을 다시 받는다 — 250ms 마다 받을 이유가 없다.
      const pend = Object.values(summaries).reduce((n, s) => n + (s.approvals?.pending ?? 0), 0);
      if (pend !== pendingMark) {
        pendingMark = pend;
        fetch('/api/approvals').then((r) => r.json()).then((a) => { approvals = a.pending ?? []; told = a.told ?? told; renderApprovals(); renderBossBadge(); if (view === 'tower') renderTower(); }).catch(() => {});
      } else if (view === 'tower') renderTower();
      // 대시보드는 summaries 랑 안 엮여 있어 매번 재 보되(파일 하나, 가볍다), 안 바뀌었으면 loadDashboard 안에서 다시 안 그린다.
      if (view === 'dashboard') loadDashboard();
      if (view === 'report') loadReport();   // 안 바뀌었으면 loadReport 안에서 다시 안 그린다(펼친 팀 줄이 닫히지 않게)
      // 분석은 값이 실제로 움직였을 때만 다시 불러온다. 250ms 마다 받아올 이유가 없다.
      if (view === 'analysis') {   // 다섯 팀 회차·상태·결재 수가 움직였을 때만(loadAnalysis 의 mark 와 같은 식)
        const mark = teams.map((t) => `${summaries[t.id]?.round}:${summaries[t.id]?.phase}`).join('|') + `|${approvals.length}`;
        if (mark !== anMark) loadAnalysis();
      }
      return;
    }
    // 세상의 시계 — 자리·루틴 (W2). 마을 탭만 본다 — 관제탑은 일 상태다 (결정 58).
    if (msg.kind === 'world') { World.onWorld(msg.world); return; }
    // 밑바닥 넷(서버·codex·세션·디스크) — blockedOf 의 infra 입력. 2분마다 재서 바뀌면 온다.
    if (msg.kind === 'infra') { infra = msg.infra ?? null; if (view === 'tower') renderTower(); return; }
    if (msg.kind === 'hello') {
      if (msg.world) World.onWorld(msg.world);
      // 붙을 때 받은 요약도 쓴다 — 전에는 world 만 쓰고 버려서, 다음 방송(어느 팀이든 요약이 바뀔 때)까지
      // 부팅 때 것이 남았다 (독립검수 #1).
      if (msg.summaries && active) {
        summaries = msg.summaries; summary = summaries[active] ?? summary;
        renderRail(); renderHead(); renderSide();
        cards.fetchedAt[active] = 0; renderRoomCard();   // 붙을 때도 카드 — 조용한 방은 다음 요약이 안 와서 빈 채로 남았다(솔라 감사 ①, 독립검수 #1 과 같은 자리)
      }
      return;
    }
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
  if (ms > 0) msgTimer = setTimeout(() => { box.hidden = true; }, ms);   // 0 이면 다음 말까지 남는다 (검수 #6)
}

// 라운드 밖에서 보낸 지시. 열기 폼의 주제가 이걸로 채워지고, 라운드가 열리면 첫 지시로 보낸다.
let pendingSay = null;

/** 열기 폼의 마일스톤 칸 — 로드맵에서 now 를, 없으면 첫 wait 를 미리 채우고 제목을 옆에 보인다 (검수 #6: 'M' 만 있어 뭔지 몰랐다). */
function suggestMilestone() {
  const ms = roadmap.milestones ?? [];
  const now = ms.find((m) => m.status === 'now') ?? null;
  const next = ms.find((m) => m.status !== 'pass') ?? null;
  return { pick: now ?? next, now: !!now, next };
}
const showOpen = (on, { topic = '' } = {}) => {
  $('roundOpen').hidden = !on;
  if (on) {
    const { pick, now } = suggestMilestone();
    $('roundTopic').value = topic;
    // 검수 #6 — 마일스톤은 로드맵 제목 목록에서 고른다(now 가 골라져 있고, 끝난 것은 '끝'). 주제를 비우면 고른 마일스톤 제목이 주제다.
    const sel = $('roundMs');
    sel.replaceChildren();
    for (const m of roadmap.milestones ?? []) {
      const o = document.createElement('option');
      o.value = String(m.n);
      o.textContent = `${m.n}. ${m.title}${m.status === 'pass' ? ' (완료)' : m.status === 'now' ? ' (지금)' : ''}`;
      if (m.status === 'pass') o.disabled = true;
      sel.appendChild(o);
    }
    if (!sel.options.length) { const o = document.createElement('option'); o.value = ''; o.textContent = '로드맵 없음'; sel.appendChild(o); }
    sel.value = pick ? String(pick.n) : '';
    sel.title = pick ? `${pick.n}단계 "${pick.title}"${now ? '' : ' — 앞 것이 끝나 다음 것. 착수는 톰·제리 결재가 먼저'}` : '로드맵 없음';
    $('roundTopic').placeholder = pick ? `비우면 "${pick.title.slice(0, 40)}" 가 주제` : '이번 회차';
    $('roundTopic').focus();
  } else pendingSay = null;
};

$('roundBtn').addEventListener('click', async () => {
  if (!active) return;
  const open = summary.phase === 'running' || summary.phase === 'blocked';
  if (!open) return showOpen($('roundOpen').hidden);

  // 판정은 감사역이 낸다. 여기서 닫는 건 판정 없이 라운드를 접는 것이다.
  if (!confirm(`${summary.round}회차를 마무리해요.\n\n대화 기록은 그대로 남고, 다음 회차는 새로 시작해요.`)) return;
  const r = await post('/api/round', { team: active, action: 'end' });
  if (!r.ok) say(r.data.error ?? '종료 실패');
  else if (r.data.deferred) say(`${cast.agents?.guide?.name ?? '팀장'}이 진행 중이에요. 이 말 끝나면 닫을게요.`, 10000);   // 하영 3-2 toast — 이름은 그 방 실무
  else if (r.data.accepted) say('종료 중 — 일지 수집', 10000);
});

$('roundCancel').addEventListener('click', () => showOpen(false));

$('roundOpen').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!active) return;
  const ms = String($('roundMs').value ?? '').trim();
  const picked = (roadmap.milestones ?? []).find((m) => String(m.n) === ms) ?? null;
  // 빈 주제는 지난 주제가 아니라 고른 마일스톤 제목이다 (검수 #6 — 물려받는 걸 알 수 없었다).
  const topic = $('roundTopic').value.trim() || picked?.title || '';
  const r = await post('/api/round', {
    team: active, action: 'start',
    topic: topic || null,
    milestone: ms === '' ? null : Number(ms),
  });
  if (!r.ok) {
    // 검수 #6 — CLI 문장이 6초 떴다 사라져 왜 안 열리는지 몰랐다. 사람 말로, 사라지지 않게(0 = 다음 말까지).
    const err = String(r.data.error ?? '');
    if (/B 승인|now 인 마일스톤이 없습니다/.test(err)) {
      const { next } = suggestMilestone();
      return say(next
        ? `앞 단계가 끝났어요. 다음은 ${next.n}단계 "${next.title}" — 단계 칸에서 ${next.n} 을 고르고 시작을 누르면 열려요. (다음 착수는 톰·제리 결재가 먼저라, 열린 뒤 그 결재를 걸어 주세요.)`
        : '마일스톤 전부 완료 — 로드맵 갱신 필요', 0);
    }
    if (/전부 pass/.test(err)) return say('마일스톤 전부 완료 — 로드맵 갱신 필요', 0);
    return say(err || '시작 실패', 0);
  }
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

/* ── @ 멘션 (C13 — 대표 09-16 11:04 "멘션하는 방법을 @ 하고 적는, 이런 명령스킬도 우리 채팅에 추가해줘").
 * 입력창에서 "@" 를 치면 그 방 사람 목록이 뜨고(위아래·Enter·클릭), 고르면 "@이름, " 이 들어간다 — 서버 판별(mention.js)이 이미 "@이름" 을 호명으로 읽으니 글자만 넣으면 된다.
 * 대표·나리(system)도 부를 수 있다(나리는 총괄실 세션이 그 방에 답한다, N1). ── */
const mentionPop = el('div', 'mpop'); mentionPop.hidden = true; mentionPop.setAttribute('role', 'listbox');
$('composer').appendChild(mentionPop);
let mentionSel = 0;
function mentionQuery() {
  const s = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, s);
  const m = /(^|\s)@([가-힣A-Za-z]{0,6})$/.exec(before);   // 커서 바로 앞의 "@…" — 낱말 중간의 @ 는 안 잡는다
  return m ? { start: s - m[2].length - 1, q: m[2] } : null;
}
function mentionPeople(q) {
  const list = Object.entries(cast.agents ?? {}).filter(([id, a]) => a?.name && id !== 'boss').map(([id, a]) => ({ id, ...a }));
  return list.filter((a) => !q || a.name.startsWith(q)).slice(0, 8);
}
function renderMentionPop() {
  const mq = mentionQuery();
  if (!mq) { mentionPop.hidden = true; return; }
  const people = mentionPeople(mq.q);
  if (!people.length) { mentionPop.hidden = true; return; }
  mentionSel = Math.min(mentionSel, people.length - 1);
  mentionPop.replaceChildren();
  people.forEach((a, i) => {
    const b = el('button', 'mpop__row'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === mentionSel));
    const dot = el('span', 'dot'); dot.style.background = a.color ?? FALLBACK.color; b.appendChild(dot);
    b.appendChild(el('b', null, a.name)); if (a.title) b.appendChild(el('span', 'mpop__t', a.title));
    b.addEventListener('mousedown', (e) => { e.preventDefault(); pickMention(a); });
    mentionPop.appendChild(b);
  });
  mentionPop.hidden = false;
}
function pickMention(a) {
  const mq = mentionQuery(); if (!mq) return;
  const after = input.value.slice(input.selectionStart ?? input.value.length);
  const ins = `@${a.name}, `;
  input.value = input.value.slice(0, mq.start) + ins + after.replace(/^,?\s*/, '');
  input.selectionStart = input.selectionEnd = mq.start + ins.length;
  mentionPop.hidden = true; mentionSel = 0; fitInput(); input.focus();
}
input.addEventListener('input', renderMentionPop);
input.addEventListener('blur', () => { setTimeout(() => { mentionPop.hidden = true; }, 120); });

// Enter 는 보내기, Shift+Enter 는 줄바꿈. 한글 조합 중(isComposing)의 Enter 는 조합 확정이라 보내지 않는다. 멘션 목록이 떠 있으면 위아래·Enter 는 목록 몫.
input.addEventListener('keydown', (e) => {
  if (!mentionPop.hidden && !e.isComposing) {
    const n = mentionPop.children.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionSel = (mentionSel + 1) % n; renderMentionPop(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); mentionSel = (mentionSel - 1 + n) % n; renderMentionPop(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const p = mentionPeople(mentionQuery()?.q ?? '')[mentionSel]; if (p) pickMention(p); return; }
    if (e.key === 'Escape') { mentionPop.hidden = true; return; }
  }
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

// 그림 올리기 (결정 130 ② — 대표가 방에 그림을 올릴 수 있어야 한다). 버튼 · 끌어다 놓기 · 붙여넣기 셋이 같은 길(C17, 대표 09-16 11:07 "채팅창에 바로 이미지 드랍해서 첨부하는 것").
// 올리는 동안 입력창 위에 미리보기 한 장 — 올라가면 방에 말풍선으로 뜬다(서버).
// 문서도 된다(C17 둘째, 대표 09-16 11:10 "pdf 같은 문서 첨부도 되야겠다") — pdf·md·txt·csv·docx·xlsx·pptx. 서버가 teams/<팀>/in/ 에 두고 "파일을 올렸습니다: in/…" 로 말하면 화면은 파일 카드(outFileNode). 서버 쪽 형식 허용은 솔라(/api/upload UPLOAD_MIME).
const UPLOAD_OK = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/(plain|markdown|csv)|application\/(vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))$/;
const uploadKind = (f) => /^image\//.test(f.type) ? '그림' : '파일';
let uploading = false, lastUpload = { key: '' };   // 같은 그림이 잇달아 세 번(대표 폰 14:11 — 올린 뒤 바로 안 보여 다시 누름, 나리): 올리는 중엔 막고, 같은 이름·크기는 **방에 뜰 때까지** 하나만(결정 188 — 60초가 아니라 '떴으면'). 뜨면 말풍선 그리는 쪽이 푼다.
async function uploadImage(f, { force = false } = {}) {
  if (!f || !active) return;
  // 브라우저가 type 을 비워 주는 것(md·txt·csv·docx·xlsx·pptx 가 OS 에 따라 그렇다)은 확장자로 채운다 — code-review 지적: 고르기 목록엔 있는데 여기서 거절되던 것
  const EXT_MIME = { md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  const mime = f.type || EXT_MIME[(f.name ?? '').split('.').pop()?.toLowerCase()] || '';
  if (!UPLOAD_OK.test(mime)) return say('그림(png·jpg·gif·webp)이나 문서(pdf·md·txt·csv·docx·xlsx·pptx)만');
  if (uploading) return say('올리는 중이에요 — 잠시만요', 0);
  const key = `${f.name ?? ''}|${f.size ?? 0}|${mime}`;
  if (key === lastUpload.key && !force) {   // 아직 방에 안 뜬 같은 파일 — 막되 길은 남긴다(대표가 일부러 두 번 올릴 수도 있다)
    const box = $('composerMsg'); clearTimeout(msgTimer); box.replaceChildren();
    box.append('방금 올린 파일이에요 — 곧 방에 떠요 · ');
    const b = el('button', 'composer__retry', '그래도 올리기'); b.type = 'button';
    b.addEventListener('click', () => uploadImage(f, { force: true }));
    box.appendChild(b); box.hidden = false;
    return;
  }
  uploading = true;
  const box = $('composerMsg');
  const pv = el('div', 'composer__pv');
  if (uploadKind(f) === '그림') { const img = el('img'); img.alt = f.name || '그림'; img.src = URL.createObjectURL(f); pv.appendChild(img); pv.dataset.url = img.src; }
  else pv.appendChild(el('b', null, f.name || '문서'));
  pv.appendChild(el('span', null, '업로드 중'));
  box.replaceChildren(pv); box.hidden = false;
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  }).catch(() => null);
  const done = () => { uploading = false; if (pv.dataset.url) URL.revokeObjectURL(pv.dataset.url); };
  if (!data) { done(); return say(`${uploadKind(f)} 로딩 실패`); }
  lastUpload = { key };   // 보내기 **전에** 건다 — 방 말풍선이 응답보다 먼저 와서 풀리는 수가 있다(code-review): 뒤에 걸면 다시 잠긴다
  const r = await post('/api/upload', { team: active, mime, name: f.name || null, data }).catch(() => null);   // name — 서버가 원래 파일 이름을 카드에 쓸 수 있게(지금은 안 봐도 됨)
  done();
  if (!r?.ok) { lastUpload = { key: '' }; return say(r?.data?.error ?? `${uploadKind(f)} 업로드 실패`); }
  say('업로드 완료 — 곧 방에 떠요');
}
$('uploadBtn').addEventListener('click', () => $('uploadFile').click());
$('uploadFile').addEventListener('change', () => { const f = $('uploadFile').files?.[0]; $('uploadFile').value = ''; uploadImage(f); });   // 같은 파일 다시 골라도 change 가 나게
// 끌어다 놓기 — 대화 창·입력창 어디든. 붙여넣기 — 클립보드의 그림(스크린샷 Cmd+V).
for (const zone of [$('feed'), $('composer')]) {
  zone.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); app.dataset.drop = '1'; } });
  zone.addEventListener('dragleave', () => { app.dataset.drop = '0'; });
  zone.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault(); app.dataset.drop = '0'; uploadImage(f); });
}
input.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((it) => it.kind === 'file');   // 그림이든 문서든 — 형식은 uploadImage 가 가른다
  if (!item) return;
  e.preventDefault(); uploadImage(item.getAsFile());
});

/* ── / 명령 (C13 — 대표 09-16 그림: 입력창 "/ 입력 시 명령어" 자리, 오르카 모양·구조 참고만). "/" 를 치면 명령 목록이 뜨고 고르면 그대로 실행.
 * 이름은 하영 사전 3-2-1(6a7a239, 나리 R32): /시작 /마무리 /검토 /스크린샷 /검색 다섯 + @ 는 '멘션'. 아직 길이 없는 것(스크린샷·검색)은 목록에 두되 '준비 중'. ── */
// 메뉴에 뜨는 한 줄도 사전 3-2-1 표 글자 그대로(하영 64f4f33) — 검토 줄의 이름만 이 방 외부 감사 이름으로.
const outsideName = () => Object.entries(cast.agents ?? {}).find(([id]) => id === 'outside')?.[1]?.name ?? '외부 감사';
const SLASH_COMMANDS = [
  { id: 'start', name: '시작', hint: '회차 시작 — 첫 줄이 주제가 돼요', run: () => { input.value = ''; fitInput(); showOpen(true, {}); } },
  { id: 'end', name: '마무리', hint: '회차 마무리 — 검토 결과가 있어야 닫혀요', run: () => { input.value = ''; fitInput(); $('roundBtn').click(); } },
  { id: 'review', name: '검토', hint: () => `검토 요청 — ${outsideName()}를 불러요`, run: () => { input.value = `${outsideName()}, 검토 부탁해요 — `; fitInput(); input.focus(); input.selectionStart = input.selectionEnd = input.value.length; } },
  { id: 'screenshot', name: '스크린샷', hint: '지금 화면 스크린샷 — 준비 중', disabled: true },
  { id: 'search', name: '검색', hint: '대화·파일 검색 — 준비 중', disabled: true },
  { id: 'mention', name: '멘션', hint: '@ 를 치면 이름 목록, 고르면 칩으로 들어가요', run: () => { input.value = '@'; fitInput(); input.focus(); input.selectionStart = input.selectionEnd = 1; renderMentionPop(); } },
];
const slashPop = el('div', 'mpop mpop--slash'); slashPop.hidden = true; slashPop.setAttribute('role', 'listbox');
$('composer').appendChild(slashPop);
let slashSel = 0;
const slashQuery = () => { const m = /^\/([가-힣A-Za-z ]*)$/.exec(input.value); return m ? m[1].trim() : null; };
const slashList = (q) => SLASH_COMMANDS.filter((c) => !q || c.name.includes(q) || c.id.startsWith(q.toLowerCase()));
function renderSlashPop() {
  const q = slashQuery();
  if (q == null) { slashPop.hidden = true; return; }
  const list = slashList(q);
  if (!list.length) { slashPop.hidden = true; return; }
  slashSel = Math.min(slashSel, list.length - 1);
  slashPop.replaceChildren();
  slashPop.appendChild(el('div', 'mpop__k', '명령어'));   // 메뉴 머리 — 대표 그림 글자 그대로(사전 3-2-1)
  list.forEach((c, i) => {
    const b = el('button', 'mpop__row'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === slashSel)); b.disabled = !!c.disabled;
    b.appendChild(el('b', null, `/${c.name}`)); b.appendChild(el('span', 'mpop__t', typeof c.hint === 'function' ? c.hint() : c.hint));
    b.addEventListener('mousedown', (e) => { e.preventDefault(); runSlash(c); });
    slashPop.appendChild(b);
  });
  slashPop.hidden = false;
}
function runSlash(c) { slashPop.hidden = true; slashSel = 0; if (c.disabled) return say(typeof c.hint === 'function' ? c.hint() : c.hint); c.run(); }
input.addEventListener('input', renderSlashPop);
input.addEventListener('blur', () => { setTimeout(() => { slashPop.hidden = true; }, 120); });
input.addEventListener('keydown', (e) => {
  if (slashPop.hidden || e.isComposing) return;
  const list = slashList(slashQuery() ?? '');
  if (e.key === 'ArrowDown') { e.preventDefault(); slashSel = (slashSel + 1) % list.length; renderSlashPop(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); slashSel = (slashSel - 1 + list.length) % list.length; renderSlashPop(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); if (list[slashSel]) runSlash(list[slashSel]); }
  else if (e.key === 'Escape') slashPop.hidden = true;
}, true);   // capture — 보내기(Enter) 핸들러보다 먼저

/** 못 보냈을 때(C14) — 입력창 위에 '못 보냈어요 · 다시 보내기' 단추. 글은 입력창에 돌려 두지 않고 단추가 쥔다 — 대표가 다시 치지 않게. */
function sayFailed(text, why) {
  const box = $('composerMsg');
  clearTimeout(msgTimer);
  box.replaceChildren();
  box.append(`못 보냈어요${why ? ` — ${why}` : ''} · `);
  const b = el('button', 'composer__retry', '다시 보내기'); b.type = 'button';
  b.addEventListener('click', () => { say('보내는 중', 0); sendSay(text); });
  box.appendChild(b);
  box.hidden = false;
}
async function sendSay(text) {
  // 말풍선은 여기서 그리지 않는다. 지시가 세션에 들어가면 훅이 남긴다.
  let r;
  try {
    r = await post('/api/say', { text, team: active });
  } catch {
    return sayFailed(text, '서버 연결 실패');
  }
  if (!r.ok) {
    if (r.data.needsRound) { input.value = text; fitInput(); say(r.data.error ?? '전송 실패'); pendingSay = text; showOpen(true, { topic: text.split('\n')[0].slice(0, 80) }); return; }
    sayFailed(text, r.data.error ?? null);
    return;
  }
  say(null);
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
// 속 이름은 그대로, 탭 글자만 표준어(카드-체계-0916 4절, 나리 R32): room=채팅 · tower=대시보드 · dashboard=타임라인 · report=리포트(둘째 탭 analysis) · settings=설정 · world=마을(숨김)
const VIEWS = new Set(['room', 'tower', 'dashboard', 'report', 'analysis', 'settings', 'world']);

// 주소에 팀과 화면을 함께 남긴다 (#marketing/tower). 새로고침해도, 뒤로 가도 보던 곳으로 돌아온다.
// 우리가 쓴 해시는 되읽지 않는다 — 안 그러면 화면을 바꿀 때마다 한 번 더 바꾸려 든다.
let hashByUs = false;

const syncHash = () => {
  if (!active) return;
  // 방도 #팀/room 으로 적는다 — 첫 화면이 현황이 된 뒤(U2) 맨 #팀 은 "화면 없음" 이라 새로고침이 방으로 안 돌아온다.
  const h = `${active}/${view}`;
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
  const shown = v === 'analysis' ? 'report' : v;   // 분석은 리포트의 둘째 탭 — 위 줄에선 리포트 단추가 켜진다
  for (const b of $('views').querySelectorAll('button')) {
    b.setAttribute('aria-current', String(b.dataset.view === shown));
    // 마을 탭은 숨겨 두고(index.html hidden — 대표 09-16 '마을은 최최최최후'), 설정의 숨김 링크나 주소(#팀/world)로 한 번 열면 그 뒤로 보인다.
    if (v === 'world' && b.dataset.view === 'world') b.hidden = false;
  }
  for (const b of document.querySelectorAll('#repTabs button, #anTabs button')) b.setAttribute('aria-current', String(b.dataset.view === v));
  if (v === 'tower') renderTower();
  if (v === 'dashboard') loadDashboard();
  if (v === 'report') loadReport({ force: true });
  if (v === 'analysis') loadAnalysis();
  if (v === 'settings') loadSettings();
  // 마을은 열려 있을 때만 그린다. 닫히면 rAF 를 멈춘다 — 관람은 공짜여야 한다.
  if (v === 'world') World.open({ teams, jump: jumpTo }).catch(() => {}); else World.close();
}

for (const b of document.querySelectorAll('#views button, #repTabs button, #anTabs button')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}

/* ══ 설정 — 권한 현황 · 낱말 사전 · 인격 파일 목록 · 숨김 화면(마을) (나리 R32, 카드-체계-0916 4절) ══ */

/** md 를 아주 얕게 DOM 으로 — 제목(#)·표(|)·문단만. 링크·굵게는 안 푼다(글자 그대로, textContent 라 안전). 설정 탭의 나리 표·하영 사전을 읽기 좋게 놓는 용도. */
function mdLite(text) {
  const box = el('div', 'set__md');
  let table = null, para = [];
  const flushPara = () => { if (para.length) { box.appendChild(el('p', null, para.join(' '))); para = []; } };
  const flushTable = () => { if (table) { box.appendChild(table); table = null; } };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim().startsWith('|')) {
      flushPara();
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;   // 구분 줄
      if (!table) { table = el('table'); table.dataset.head = '0'; }
      const tr = el('tr');
      for (const c of cells) tr.appendChild(el(table.dataset.head === '0' ? 'th' : 'td', null, c.replace(/\*\*|`/g, '')));
      table.appendChild(tr); table.dataset.head = '1';
      continue;
    }
    flushTable();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); box.appendChild(el('h3', null, h[2].replace(/\*\*|`/g, ''))); continue; }
    if (!line.trim()) { flushPara(); continue; }
    para.push(line.replace(/^[-*]\s+/, '· ').replace(/\*\*|`/g, ''));
  }
  flushPara(); flushTable();
  return box;
}
/** 파일 하나를 접힘 안에 — 열 때 한 번 읽는다(outFileNode 와 같은 버릇). */
function mdFold(label, url) {
  const d = el('details', 'set__fold');
  d.appendChild(el('summary', null, label));
  const body = el('div'); d.appendChild(body);
  d.addEventListener('toggle', async () => {
    if (!d.open || body.dataset.loaded) return;
    body.dataset.loaded = '1'; body.textContent = '로딩 중';
    try { const r = await fetch(url); body.replaceChildren(r.ok ? mdLite(await r.text()) : el('p', null, `읽지 못했어요 (${r.status})`)); }
    catch (e) { body.textContent = `읽지 못했어요 — ${e.message}`; }
  });
  return d;
}
async function loadSettings() {
  const body = $('setBody');
  body.replaceChildren();
  // ① 권한 현황 — 나리 표(teams/hq/out/권한-현황-0916.md)를 그대로. 바꾸는 손은 대표(settings.json)라 여기선 읽기만.
  body.appendChild(el('div', 'set__k', '권한'));
  const perm = el('div'); body.appendChild(perm); perm.textContent = '로딩 중';
  // 대표용 한 장(teams/hq/out/권한.md — 자리마다 되는 것·안 되는 것 한 줄, 나리 폴드 QA #22). 옛 권한-현황-0916.md 는 기록 문서라 대표 화면에 안 올린다
  fetch('/out/hq/' + encodeURIComponent('권한.md')).then(async (r) => { perm.replaceChildren(r.ok ? mdLite(await r.text()) : el('p', null, '권한 표 없음')); }).catch(() => { perm.textContent = '권한 표 없음'; });
  // ② 낱말 사전 — 하영(teams/marketing/out/opsroom-words.md). 길어서 접힘.
  body.appendChild(el('div', 'set__k', '용어'));
  body.appendChild(mdFold('용어 사전', '/out/marketing/opsroom-words.md'));
  // ③ 인격 — **사람 단위로 한 번씩**(열일곱 + 대표), 줄은 이름 · 직책 · 팀 · 파일(대표 09-16 08:5x "중복 배치가 너무 많다" — 자리 단위로 돌리니 나리가 여섯 번, 톰이 다섯 번 서고
  // 열한 줄이 없는 파일을 가리켰다, 나리 R32). 총괄실 사람(톰·제리·세라·나리)과 대표는 팀 칸에 '전체', 파일은 사람마다 하나(hq/·sera/ 밑). 없는 파일은 '없음' — 경로를 지어내지 않는다:
  // 있는지는 /api/actor 가 인격을 돌려주는가로 잰다(system·대표는 카드가 없어 404 → 없음). 이 규칙이 세계관 서브탭(U1)의 정본.
  body.appendChild(el('div', 'set__k', '프로필'));
  const ul = el('ul', 'set__list'); body.appendChild(ul);
  const people = new Map();   // 이름 → { name, title, teamWord, team, seat }. 총괄실을 먼저 돌아 톰·제리·세라·나리의 집이 hq 가 되게
  const HQ_SEATS = new Set(['chief', 'system', 'secretary']);
  for (const t of [...teams].sort((a, b) => (a.id === 'hq' ? -1 : b.id === 'hq' ? 1 : 0))) {
    for (const [seat, a] of Object.entries(summaries[t.id]?.cast ?? {})) {
      if (seat === 'boss') continue;
      const name = a.name ?? seat;
      if (people.has(name)) continue;
      const shared = t.id === 'hq' || HQ_SEATS.has(seat);
      // 세라의 파일은 teams/sera/secretary.md(비서실 세션, apr_078fa7fc) — 총괄실 cast 에도 서지만 파일은 sera/ 밑 하나
      people.set(name, { name, title: a.title ?? '', teamWord: shared ? '전체' : t.name, team: seat === 'secretary' && teams.some((x) => x.id === 'sera') ? 'sera' : t.id, seat });
    }
  }
  const row = (name, title, teamWord, file) => {
    const li = el('li'); li.append(`${name} · ${title || '—'} · ${teamWord} `);
    li.appendChild(el('code', null, file ?? '없음'));
    ul.appendChild(li);
  };
  row(summaries.hq?.cast?.boss?.name ?? '대표', '대표', '전체', null);   // 대표는 인격 파일이 없다 — 사람이다
  const list = [...people.values()];
  const files = await Promise.all(list.map((p) => fetch(`/api/actor?team=${encodeURIComponent(p.team)}&actor=${encodeURIComponent(p.seat)}`).then((r) => r.ok ? r.json() : null).then((r) => (r?.persona ? `teams/${p.team}/${p.seat}.md` : null)).catch(() => null)));
  list.forEach((p, i) => row(p.name, p.title, p.teamWord, files[i]));
  // ③-1 모델 — 자리마다 엔진·모델·추론 강도(결정 69, castRow). 사람 카드에서 여기로(나리 R32 ②). 세션이 있는 자리만(system·대표는 없다).
  body.appendChild(el('div', 'set__k', '모델 — 자리마다 엔진 · 모델 · 추론 강도 (다음 턴 적용)'));
  const ml = el('ul', 'set__list');
  const seen = new Set();   // 사람마다 한 줄(대표 08:5x "중복 배치") — 톰·제리·세라·나리는 방마다 cast 에 서지만 사람은 하나, 총괄실을 먼저 돌아 거기 줄만
  for (const t of [...teams].sort((a, b) => (a.id === 'hq' ? -1 : b.id === 'hq' ? 1 : 0))) {
    for (const [seat, a] of Object.entries(summaries[t.id]?.cast ?? {})) {
      if (seat === 'boss' || !a.model) continue;   // 나리(system)도 선다 — 세션 있는 방(총괄실)만(model 있음). N2: 나리 자리만 클로드 fable·코덱스 astra 까지(castOptions.bySeat.system, 서버 6f0fb5f)
      const name = a.name ?? seat;
      if (seen.has(name)) continue; seen.add(name);
      const li = el('li'); li.append(`${t.id === 'hq' || HQ_SEATS.has(seat) ? '전체' : t.name} · ${name} `);
      li.appendChild(castRow(t, seat, a));
      ml.appendChild(li);
    }
  }
  body.appendChild(ml);
  // ④ 숨김 화면 — 마을은 탭에서 뺐다(대표 09-16 '마을은 최최최최후'). 여기 링크로만.
  const hid = el('p', 'set__hidden');
  const a = el('a', null, '마을 열기'); a.href = `#${active ?? 'hq'}/world`; hid.append('마을(준비 중) ', a);
  body.appendChild(hid);
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
/** "N분 전에 움직임" — 결정 31 "안죽었어요" 의 자리(하영 3-1: 신호 → 움직임, 1시간 넘으면 "N시간째 조용함", 없으면 "오늘 움직임 없음"). */
/** 마지막 활동 시각 — 세션 신호(lastSignal, 서버 메모리라 재시작 직후엔 비어 있다)가 없으면 방 기록의 마지막 말·도구 줄(doing.ts·lastSaidAt)로. 새는 것 ⑥(나리 12:3x: 켜진 직후 '오늘 활동 없음' 이 틀린 글). */
const lastMove = (p) => p?.lastSignal ?? p?.doing?.ts ?? p?.lastSaidAt ?? null;
const moved = (ts) => {
  if (!ts) return '오늘 활동 없음';
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return '방금 활동';
  if (s < 3600) return `${Math.floor(s / 60)}분 전에 활동`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간째 조용함`;
  return `${Math.floor(s / 86400)}일째 조용함`;
};

/** 이름·값 표. 승인 카드의 "바뀌는 것" 이 쓴다. 값은 줄바꿈 그대로. */
function kvTable(rows) {
  const tb = el('table');
  for (const [k, v] of rows) {
    const tr = el('tr');
    tr.appendChild(el('td', null, k));
    const td = el('td');
    if (v instanceof Node) td.appendChild(v); else td.textContent = v ?? '';
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  return tb;
}

/**
 * 카드가 펼치는 "바뀌는 것" — 요청에 박힌 action 을 서버가 preview 로 푼 것 (결정 20-2).
 * 푸시면 브랜치·커밋·파일, 착수면 마일스톤과 통과 조건, 로드맵이면 마일스톤 표와 컷 목록. 못 읽었으면 그 사실을.
 */
function previewNode(r) {
  const a = r.action, p = r.preview;
  if (!a) return null;
  const box = el('div', 'apr__pv');
  // 미리보기가 없는 종류(request·proxy — bus.approvalPreview 가 아직 안 푼다)는 사실대로. 전엔 "옛 서버?" 라고 해서 대표가 서버를 다시 켰다(하네스 R25).
  if (!p) {
    if (a.type === 'request') { const to = a.to ?? {}; box.appendChild(kvTable([['요청', `${teams.find((t) => t.id === to.team)?.name ?? to.team ?? '?'} 팀 ${summaries[to.team]?.cast?.[to.actor]?.name ?? to.actor ?? ''}에게${a.mode === 'milestone' ? ' — 단계 끝까지(공동 프로젝트)' : ''}`], ...(a.why ? [['사유', a.why]] : []), ...(a.due ? [['기한', a.due]] : [])])); return box; }
    if (a.type === 'proxy') { box.appendChild(kvTable([['대리 결정', a.kind === 'approval' ? `대리 승인 여부 — 결재 ${a.ref}` : a.kind === 'unblock' ? `${a.team} 방의 멈춤을 대표님 대신 풀지` : `${a.team} 방의 물음에 대표님 대신 답할지`]])); return box; }
    box.appendChild(el('div', 'tcard__quiet', `이 종류(${a.type})는 아직 미리보기가 없어요 — 위 글이 전부예요.`)); return box;
  }
  if (p.error) { box.appendChild(el('div', 'err', `바뀌는 것을 읽지 못했습니다 — ${p.error}`)); return box; }
  if (a.type === 'push') {
    box.appendChild(kvTable([
      ['푸시', `origin/${p.branch} @ ${String(p.sha).slice(0, 8)} — 통과하면 서버가 정확히 이 커밋을 민다`],
      ['기준', p.base],
      ['커밋', p.count ? `${p.count}개\n` + p.commits.join('\n') + (p.count > p.commits.length ? '\n…' : '') : '(없음 — 기준과 같다)'],
      ['파일', p.files.length ? `${p.files.length}개 — ${p.files.slice(0, 12).join(', ')}${p.files.length > 12 ? ' …' : ''}` : '(없음)'],
    ]));
  } else if (a.type === 'milestone') {
    box.appendChild(kvTable([
      ['시작', `마일스톤 ${p.n} — ${p.title ?? ''}`],
      ['완료 조건', p.deliverable ?? '(로드맵에 없음)'],
    ]));
  } else if (a.type === 'roadmap') {
    const ms = el('div');
    for (const m of p.milestones) ms.appendChild(el('div', null, `${m.n}. ${m.title}${m.status ? ` (${m.status})` : ''}`));
    const cut = el('div');
    if (p.cutList.length) for (const c of p.cutList) cut.appendChild(el('div', null, `· ${c}`)); else cut.textContent = '(없음)';
    box.appendChild(kvTable([
      ['교체', `out/${p.file} → roadmap.json — 지금 로드맵은 통째로 바뀐다`],
      ['목표', p.destination ?? '(없음)'],
      [`마일스톤 ${p.milestones.length}`, ms],
      ['제외', cut],
    ]));
  } else {
    box.appendChild(el('div', null, `행동: ${a.type}`));
  }
  return box;
}

/* 결재 — 대표가 돌아왔을 때 200발언을 읽지 않고 이것부터 본다.
 * 맨 위 띠는 **한 줄씩**(헨리 approval 시안 1판-b · 현황 3판-b ③ — 나리 실측 r26-tower-all-412: 카드 하나가 원문까지 펼쳐져 첫 화면을 통째로 먹었다).
 * 줄 = 누가 · 어디 · 결재 기다림 · N분 전 → 주제 → [읽고 답하기]. 누르면 카드가 팝업으로(approvalCard) — 왜 → 바뀌는 것 → N이 쓴 원문 → 낸 것 → 확인 / 돌려보냄.
 * 누른 뒤엔 카드가 사라지지 않고 그 줄이 "됐어요 — 확인, 개발에 전해졌어요 · 밤 10:50" 로 남는다(evt_f054428919 "전송이 안 된 거야?" 의 답, 5판 3-5-1). 낱말은 하영 5판. */
const decidedLines = [];   // 이 화면에서 누른 것 — [{ id, text }] 새로 고침 전까지
const GRADE_WORD = { A: '자동 승인', B: '총괄이 봄', C: '대표 승인' };   // 하영 1절 120행·0-3 폴드7 QA 표 — 대표가 B·C 를 외울 이유가 없다
/** 시각을 때와 같이 — "아침 8:41 · 낮 12:13 · 새벽 3시 · 저녁 6시 · 밤 10:50"(하영 5판 3-5-1, 결정 101 우리 시각). :00 이면 "N시". */
function whenKo(ts) {
  const d = new Date(ts); if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours(), m = d.getMinutes();
  const part = h < 5 ? '새벽' : h < 10 ? '아침' : h < 14 ? '낮' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${part} ${hh}${m ? ':' + String(m).padStart(2, '0') : '시'}`;
}
function approvalHead(r) {
  const t = teams.find((x) => x.id === r.team);
  const who = (summaries[r.team]?.cast ?? {})[r.by]?.name ?? r.by;
  return `${who} · ${t?.name ?? r.team} · 승인 필요 · ${ago(r.ts)}`;
}
let theirsOpen = false;   // 띠의 "톰·제리가 보는 중 N건" 줄을 폈나 — 새로 그릴 때도 유지, 그 카드가 다 빠지면 다시 접힘
function renderApprovals() {
  const box = $('approvals');
  box.replaceChildren();
  if (!approvals.length && !decidedLines.length) { box.hidden = true; return; }
  box.hidden = false;
  // 대표 손이 필요한 카드(C — 위임 중엔 돈·바깥만)만 한 줄씩. B 와 위임 중 대리될 C 는 "톰·제리가 보는 중 N건" 한 줄로 접는다 —
  // 배지와 같은 잣대(나리 usability-0916 U3: 톰·제리 몫 B 카드가 대표 첫 화면 맨 위 190~270px 를 먹고 배지 0 과 다른 말을 했다).
  const dg = delegated(delegation);
  const mine = approvals.filter((r) => r.grade === 'C' && (!dg || r.proxyable === false));
  const theirs = approvals.filter((r) => !mine.includes(r));
  if (!theirs.length) theirsOpen = false;
  // 대표 몫(mine)이 없으면 판 자체를 안 띄운다(폴드 QA #1 — "결재 · 결재 대기 1건 · 보기" 판이 모든 탭 첫 줄에 늘 서서 리포트를 열어도 첫 줄이 결재였다). 총괄 몫 수는 종 목록에 있다
  if (!mine.length && !decidedLines.length) { box.hidden = true; return; }
  box.appendChild(el('div', 'approvals__k', mine.length ? `결재 ${mine.length}건` : '결재'));
  const line = (r) => {
    const row = el('button', 'apr apr--line'); row.type = 'button';
    const head = el('span', 'apr__head');
    const g = el('span', 'apr__g', GRADE_WORD[r.grade] ?? r.grade); g.dataset.g = r.grade; g.title = grades[r.grade]?.desc ?? '';
    head.appendChild(g);
    head.appendChild(el('span', 'apr__team', approvalHead(r)));
    row.appendChild(head);
    // 제목은 --boss 한 줄, 아니면 원문을 잰다(결정 140). 둘 다 안 맞으면 "요약 없음" 대신 '{팀} 결재' — 원문은 팝업 카드의 펼침에(opus ④)
    if (!putLine(row, bossTitle(r), 'apr__what')) row.appendChild(el('span', 'apr__what', `${teams.find((x) => x.id === r.team)?.name ?? r.team} 결재`));
    row.appendChild(el('span', 'apr__go', mine.includes(r) ? '확인' : '읽기'));
    row.addEventListener('click', () => openApprovalPop(r));
    return row;
  };
  for (const r of mine) box.appendChild(line(r));
  if (theirs.length) {
    const fold = el('button', 'apr apr--fold'); fold.type = 'button'; fold.setAttribute('aria-expanded', String(theirsOpen));
    fold.appendChild(el('span', 'apr__what', `결재 대기 ${theirs.length}건`));   // 사전 0-3 폴드7 QA 표: 검토 중 → 결재 대기(검토는 감사 동작 이름)
    fold.appendChild(el('span', 'apr__go', theirsOpen ? '접기' : '보기'));
    fold.addEventListener('click', () => { theirsOpen = !theirsOpen; renderApprovals(); });
    box.appendChild(fold);
    if (theirsOpen) for (const r of theirs) box.appendChild(line(r));
  }
  for (const d of decidedLines) box.appendChild(el('div', 'apr apr--done', d.text));
}
function openApprovalPop(r) {
  closePop();
  const scrim = el('div', 'scrim pop__scrim'); scrim.addEventListener('click', closePop);
  const pop = el('div', 'pop pop--apr'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '결재');
  const x = el('button', 'pop__x', '×'); x.type = 'button'; x.title = '닫기'; x.addEventListener('click', closePop);
  pop.appendChild(x);
  pop.appendChild(approvalCard(r));
  document.body.append(scrim, pop);
  x.focus();
}
/** 글의 첫 문장 한 줄 — 첫 줄에서 문장 끝(. ! ? 뒤 공백이나 끝)까지. "index.mjs" 같은 안쪽 점은 안 자른다. 마침표 없이 160자를 넘는 줄은 거기서 …(그러면 원문 칸이 뒤에 그대로 뜬다). */
function oneLine(s) {
  const line = String(s ?? '').split(/\n/).map((x) => x.trim()).find(Boolean) ?? '';
  const m = line.match(/^.*?[.!?](?=\s|$)/);
  const one = (m ? m[0] : line).trim();
  return one.length > 160 ? one.slice(0, 159).trimEnd() + '…' : one;
}
/** 결재 카드 — approval 시안 1판-b 순서: 머리(누가·어디·결재 기다림·N분 전) → 주제 → 왜 → 바뀌는 것 → N이 쓴 원문 → 낸 것 → 확인 / 돌려보냄 → 안내 두 줄. */
function approvalCard(r) {
  const card = el('div', 'apr apr--card');
  const head = el('div', 'apr__head');
  const g = el('span', 'apr__g', GRADE_WORD[r.grade] ?? r.grade); g.dataset.g = r.grade; g.title = grades[r.grade]?.desc ?? '';
  head.appendChild(g);
  head.appendChild(el('span', 'apr__team', approvalHead(r)));
  if (r.note) {
    const link = el('button', 'apr__link', '채팅 열기'); link.type = 'button';
    link.addEventListener('click', () => { closePop(); jumpTo(r.team, r.note); });
    head.appendChild(link);
  }
  card.appendChild(head);
  // 주제·왜 에 적힌 out/… 경로는 링크 (결정 36). 이스케이프 뒤에 잇는다 — 말풍선과 같은 순서.
  const linked = (cls, text) => { const d = el('div', cls); d.innerHTML = linkOutPaths(escapeHtml(text), r.team, outAnchor); return d; };
  // 제목 — --boss 한 줄이 자에 맞으면 그것, 아니면 원문을 잰다. 안 맞으면 "아직 쉬운 말로 안 적음" 이 서고 원문(r.what)은 바로 아래 펼침에(결정 140 · 사용성-0916 3절 2).
  // 카드는 단추가 아니라 진짜 <details> 를 쓴다 — 띠의 한 줄(apr--line)은 단추라 bossLine 의 눌러 펼침.
  const title = bossTitle(r), titleOk = bossOk(title);
  card.appendChild(titleOk ? linked('apr__what', title) : el('div', 'apr__what', `${teams.find((x) => x.id === r.team)?.name ?? r.team} 결재`));   // "요약 없음" 대신 '{팀} 결재', 원문은 바로 밑 펼침(opus ④)
  if (!titleOk || title !== r.what) { const fold = el('details', 'apr__fold'); fold.appendChild(el('summary', null, '원문')); fold.appendChild(linked('apr__detail', r.what)); card.appendChild(fold); }
  // 왜 — 대표 원문이 있으면 그 말부터(세라 자리, 결정 98 — 아직 세라가 안 바꾼 카드는 요청자 글 첫 문장 한 줄). 원문 칸은 그대로, 줄이지 않는다(5판 3-5-1 "N이 쓴 원문").
  // R31 ①(나리): 왜와 원문이 같은 글로 두 번 찍히지 않게 — 왜는 한 줄, 원문은 그 한 줄보다 긴 것이 있을 때만(같으면 칸 숨김). 왜가 주제와 같은 글이면 그 칸도 숨긴다.
  const detail = r.detail || '';
  const why = detail ? oneLine(detail) : '사유 없음 — 요청자에게 문의';   // 안 적힌 때의 글은 하영 196행
  if (why.trim() !== (r.what ?? '').trim()) {
    card.appendChild(el('div', 'apr__k', '사유'));
    card.appendChild(linked('apr__why', why));
  }
  const pv = previewNode(r);
  if (pv) { card.appendChild(el('div', 'apr__k', '변경 사항')); card.appendChild(pv); }
  if (detail && detail.trim() !== why.trim()) {
    const who = (summaries[r.team]?.cast ?? {})[r.by]?.name ?? r.by;
    card.appendChild(el('div', 'apr__k', `${who}이 쓴 원문`));
    card.appendChild(linked('apr__detail', detail));
  }
  // 산출물 — 그림이 있어야 "가" 를 누를 수 있다 (대표 결정 36). 서버가 stat 한 목록: 없는 파일은 없다고 뜬다.
  if (r.artifacts?.length) {
    const arts = el('div', 'apr__arts');
    arts.appendChild(el('div', 'apr__artsk', `낸 것 ${r.artifacts.length}`));
    for (const f of r.artifacts) arts.appendChild(outFileNode(f));
    card.appendChild(arts);
  }
  if (r.grade === 'C') {
    // 위임 중(결정 136)이고 톰·제리가 대리할 수 있는 카드 — 단추 위에 한 줄, 단추는 그대로(R31 ②, 나리 · 톰 apr_e3e08ac8 반려: 대표가 누르는 길은 안 닫는다). 돈·바깥(proxyable false)은 단추만.
    const proxied = delegated(delegation) && !!r.proxyable;
    if (proxied) card.appendChild(el('div', 'apr__proxy', `지금은 ${deciders(delegation)}가 정해요 · 직접 누르셔도 돼요`));
    const act = el('div', 'apr__act');
    const err = el('div', 'apr__err'); err.hidden = true;
    const reasonBox = el('input', 'apr__reason'); reasonBox.type = 'text'; reasonBox.placeholder = '사유 — 한 줄'; reasonBox.hidden = true;
    const decide = async (d) => {
      const reason = d === 'REVISE' ? reasonBox.value.trim() : '';
      if (d === 'REVISE' && !reason) { reasonBox.hidden = false; reasonBox.focus(); return; }
      const res = await post('/api/approvals', { id: r.id, decision: d, reason });
      if (!res.ok) { err.textContent = res.data.error ?? '실패 — 다시 시도'; err.hidden = false; return; }
      const t = teams.find((x) => x.id === r.team);
      decidedLines.unshift({ id: r.id, text: `됐어요 — ${d === 'PASS' ? '승인' : '반려'}, ${t?.name ?? r.team}에 전해졌어요 · ${whenKo(Date.now())}` });
      approvals = approvals.filter((x) => x.id !== r.id);
      closePop(); renderApprovals(); renderBossBadge();
    };
    for (const d of ['PASS', 'REVISE']) {
      const b = el('button', null, d === 'PASS' ? '승인' : '반려'); b.type = 'button'; b.dataset.d = d;   // 하영 79행 — 승인/반려 가 아니라 확인/돌려보냄
      b.addEventListener('click', () => decide(d));
      act.appendChild(b);
    }
    reasonBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); decide('REVISE'); } });
    card.appendChild(act);
    card.appendChild(reasonBox);
    card.appendChild(err);
    card.appendChild(el('div', 'apr__hint', proxied
      ? '반려 시 사유 한 줄 입력. 되돌리기는 답하기'   // 위임 중엔 10분이 아니라 바로 대리된다 — 그 줄만 뺀다(하영 331행 꼬리)
      : '반려 시 사유 한 줄 입력. 10분 무응답 시 대리 결정(비용·외부 제외) — 되돌리기는 답하기'));
  } else {
    // 누가 판정했고 누가 남았나 — 이름으로. 그리고 총괄실이 이 요청을 들었는가.
    const hq = summaries.hq?.cast ?? {};
    const nameOf = (id) => hq[id]?.name ?? id;
    // bus.needsOf 와 같은 규칙 — 작은 B 는 결정 자리 혼자(점검-0916 3-9), 결정 자리는 위임 중 나리(system, 대표 09-16) 아니면 톰. 톰·나리는 같은 칸이라 어느 쪽 판정이든 센다.
    const decider = delegated(delegation) && delegation?.to === 'system' ? 'system' : 'chief';
    const need = r.grade === 'B' ? (r.small ? [decider] : [decider, 'outside']) : (grades[r.grade]?.needs ?? []);
    const same = (a, b) => a === b || (['chief', 'system'].includes(a) && ['chief', 'system'].includes(b));
    const VERDICT_WORD = { PASS: '승인', REVISE: '반려', FAIL: '멈춤' };   // 하영 1절
    const done = r.decisions.map((x) => `${nameOf(x.by)} ${VERDICT_WORD[x.decision] ?? x.decision}`).join(' · ');
    const left = need.filter((w) => !r.decisions.some((x) => same(x.by, w))).map(nameOf).join('·');
    const heard = told[r.id]?.requested ? '총괄실 알림 완료' : '총괄실 알림 예정';
    card.appendChild(el('span', 'apr__wait', `${r.small ? `작은 것 — ${nameOf(decider)} 혼자 봐요 · ` : ''}${done ? done + ' · ' : ''}${left ? left + ' 답 기다림' : ''} · ${heard}`));
  }
  return card;
}

/* 서브 탭 넷 (결정 40·50) — 전체(첫 화면) · 팀(카드 다섯) · 개인(열넷 + 대표) · 요청(M3). 마지막에 본 탭을 기억한다. */
const TOWER_TABS = new Set(['all', 'teams', 'people', 'asks']);
let towerTab = (() => { try { return localStorage.getItem('ppanam.towerTab'); } catch { return null; } })();
if (!TOWER_TABS.has(towerTab)) towerTab = 'all';

function setTowerTab(tab) {
  if (!TOWER_TABS.has(tab)) tab = 'all';
  towerTab = tab;
  try { localStorage.setItem('ppanam.towerTab', tab); } catch { /* 사생활 모드 — 기억 못 해도 된다 */ }
  renderTower();
}
for (const b of $('towerTabs').querySelectorAll('button')) b.addEventListener('click', () => setTowerTab(b.dataset.tab));

/** 상태 알약 — 다섯 상태 = 색 셋 (헨리 설계 6절). k: boss(빨간 바탕) · bad(빨간 테두리) · live · idle */
function pill(text, k) { const p = el('span', 'pill', text); p.dataset.k = k; return p; }

/** 요청 블록 목록 — 4초 안에 또 부르면 그물망 안 던진다. 새로 받아 왔을 때만 true (다시 그리라는 신호). */
function loadRequests() {
  if (Date.now() - requestsFetchedAt < 4000) return Promise.resolve(false);
  if (requestsFetching) return requestsFetching;
  requestsFetching = fetch('/api/requests').then((r) => r.json()).then((data) => {
    requestsAll = data.requests ?? [];
    requestsLoaded = true;
    requestsFetchedAt = Date.now();
    requestsFetching = null;
    return true;
  }).catch(() => { requestsFetching = null; return false; });
  return requestsFetching;
}

function renderTower() {
  renderApprovals();
  const grid = $('towerGrid');
  // 탭 줄의 작은 숫자 — 팀은 대표 차례인 팀 수, 개인은 대표를 부른 사람 수. 0 이면 숫자 없음 (헨리 설계 1절).
  const bossRooms = teams.filter((t) => summaries[t.id]?.needsBoss || summaries[t.id]?.bossCall).length;
  const callers = teams.reduce((n, t) => n + Object.entries(summaries[t.id]?.people ?? {}).filter(([id, p]) => id !== 'boss' && p.bossCall).length, 0);
  for (const b of $('towerTabs').querySelectorAll('button')) {
    b.setAttribute('aria-current', String(b.dataset.tab === towerTab));
    b.setAttribute('aria-selected', String(b.dataset.tab === towerTab));   // 재는 도구가 이 이름을 본다(나리 R25 — "하나도 선택 안 됨" 은 이 속성이 없어서였다)
    const n = b.querySelector('.tabs__n');
    if (!n) continue;
    const v = b.dataset.tab === 'teams' ? bossRooms : callers;
    n.hidden = !v; n.textContent = v ? String(v) : '';
  }
  grid.dataset.tab = towerTab;
  // 요청 블록은 승인 큐와 달리 요약 방송을 안 탄다(6-1절 — 대화록엔 시작·완료 한 줄뿐). 전체·요청·팀 탭(카드의 "다른 팀에 부탁한 일")에 있을 때만 받아 온다.
  if (towerTab !== 'people') loadRequests().then((changed) => { if (changed && view === 'tower') renderTower(); });
  if (towerTab === 'teams') return renderTowerTeams(grid);
  grid.replaceChildren();
  if (towerTab === 'all') return renderTowerAll(grid);
  if (towerTab === 'people') return renderTowerPeople(grid);
  return renderTowerAsks(grid);
}

/* ── 현황 첫 화면 — 헨리 시안 2판(tower.svg) · 나리 '화면이 답하는 질문'(톰·제리 B): "지금 무슨 일이 벌어지고 있나".
 * 위에서 아래로 넷뿐 — ① 뭐가 막혔나(blockedOf, 대표 몫 아닌 것) ② 누가 뭘 했나(/api/done 오늘, 더 보기는 오늘 안에서만) ③ 내 차례(대표가 답할 것)
 * ④ 팀(단계 N/M · 회차, 누르면 상황판 네 칸 그대로, 한 번 더 = 카드). 없으면 그 칸이 사라진다. 막힌 것은 스크롤 없이.
 * 숫자는 넷뿐 — 막힌 것 수 · 내 차례 수 · 단계 N/M · 회차(결정 92 통계 타일 탈락). 낱말은 하영. ── */
const agoShort = (ts) => { const m = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60000)); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 60 * 36 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const forShort = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? '방금부터' : m < 60 ? `${m}분째` : m < 60 * 36 ? `${Math.round(m / 60)}시간째` : `${Math.round(m / 1440)}일째`; };
const dayStartSeoulMs = (ms) => Math.floor((ms + 9 * 3600_000) / 86_400_000) * 86_400_000 - 9 * 3600_000;

/** 누가 뭘 했나 — 창이 바뀌었거나 30초 지났으면 다시 받는다. 받으면 관제탑을 다시 그린다. 창은 늘 오늘 — "더 보기" 는 오늘 안에서 여섯을 넘긴 것(하영 내용 2판 9절 2: 어제는 보고서). */
function loadDone() {
  const since = dayStartSeoulMs(Date.now());
  if (done.since === since && Date.now() - done.fetchedAt < 30_000) return;
  done.since = since; done.fetchedAt = Date.now();
  fetch(`/api/done?since=${since}`).then((r) => r.json()).then((r) => { done.items = r.items ?? []; if (view === 'tower' && towerTab === 'all') renderTower(); else if (view === 'analysis') loadAnalysis(); const sl = $('statLine'); if (sl) sl.replaceChildren(statBand(dashStats(), 'line')); }).catch(() => {});   // 분석 첫 층 그림·채팅 머리 띠도 같은 점을 쓴다
}
/** 작업 보드 — 30초 캐시. 3판 '오늘 끝난 것' 은 여기 doneAt(오늘 통과로 바뀐 일, 결정 192)로 센다. /api/work 가 없으면 data 는 null. */
function loadWork() {
  if (Date.now() - work.fetchedAt < 30_000) return;
  work.fetchedAt = Date.now();
  fetch('/api/work').then((r) => (r.ok ? r.json() : null)).then((r) => { const had = !!work.data; work.data = r?.streams ? r : null; if ((had || work.data) && view === 'tower' && towerTab === 'all') renderTower(); const sl = $('statLine'); if (sl) sl.replaceChildren(statBand(dashStats(), 'line')); }).catch(() => {});
}
/* ── 팀 상황 카드(카드-체계-0916 1절 · C7) — 부품은 card.js teamCard, 재료는 /api/card/<팀>. 세 곳이 같은 것: 채팅 맨 위(그 팀 하나) · 대시보드 ④(다섯) · 비서실 말풍선(meta.cards). ── */

/**
 * 카드 재료 하나 — 30초 캐시. 받으면 기다리던 rerender 를 **전부** 부른다 — 채팅 카드와 대시보드 카드가 같은 팀을 거의 동시에 청하면
 * 나중 쪽은 캐시에 걸려 fetch 를 안 하는데, 그 콜백을 안 남기면 먼저 온 fetch 가 끝나도 나중 쪽 화면이 안 갱신됐다(솔라 감사 ②). 404·오류면 그 팀은 null 로 두고 안 그린다.
 */
function loadCard(team, rerender = null) {
  if (rerender) (cards.waiting[team] ??= new Set()).add(rerender);
  const at = cards.fetchedAt[team] ?? 0;
  if (Date.now() - at < 30_000) { if (!cards.inflight[team] && cards.byTeam[team] !== undefined) cards.waiting[team]?.delete(rerender); return; }   // 재료가 이미 있으면 부른 쪽이 지금 그린다
  cards.fetchedAt[team] = Date.now(); cards.inflight[team] = true;
  fetch(`/api/card/${encodeURIComponent(team)}`).then((r) => (r.ok ? r.json() : null)).then((d) => { cards.byTeam[team] = d && d.team ? d : null; })
    .catch(() => { cards.byTeam[team] = null; })
    .finally(() => { cards.inflight[team] = false; const w = cards.waiting[team] ?? new Set(); cards.waiting[team] = new Set(); for (const fn of w) { try { fn(); } catch { /* 한 화면이 실패해도 나머지는 그린다 */ } } });
}
/** 오늘 쓴 것(토큰 장부 T1) — /api/dashboard 의 teams[].usage 를 팀별로 60초 캐시. 팀 카드 꼬리 '오늘 쓴 것 N번 $X' 가 쓴다(나리: 현황 '오늘 쓴 것' 은 테라). */
const usage = { byTeam: {}, fetchedAt: 0 };
// 오늘 쓴 것 — 12:5x 에 잠시 숨겼던 것(장부가 세션 누적값을 그대로 더해 총괄 $329 중 $214 가 거품, 나리 대리 결정)을 솔라가 세션별 델타(server/usage.mjs withCostDeltas, 레오 33회차 통과)로 고쳐 다시 켠다(나리 34회차 첫 손, 17:2x).
const SHOW_USAGE = true;
function loadUsage(rerender = null) {
  if (Date.now() - usage.fetchedAt < 60_000) return;
  usage.fetchedAt = Date.now();
  fetch('/api/dashboard').then((r) => (r.ok ? r.json() : null)).then((r) => {
    let changed = false;
    for (const t of r?.teams ?? []) { const u = t.usage ?? null; if (JSON.stringify(u) !== JSON.stringify(usage.byTeam[t.id])) { usage.byTeam[t.id] = u; changed = true; } }
    if (changed && rerender) rerender();
  }).catch(() => {});
}
/**
 * 팀별 세 줄(진행 중·다음·예정) — 하영 teams/marketing/out/팀별-세줄.md 의 표(| 팀 | 지금 | 다음 | 그 뒤 | 팀장 답 |)를 읽는다(대표 15:1x, 나리 16:2x). 팀장이 맞다고 한 글자가 정본.
 * 60초 캐시. 앞으로 상황판에 같은 칸 셋(--now --next --after)이 생기면 거기서(솔라) — 이 1판은 손으로 쓴 파일.
 */
const three = { byTeam: {}, fetchedAt: 0 };
/** 앞으로 첫 층 — 대표님이 시킨 일 다섯(리뉴얼·프로필·마을·리포트·세라 앱) 한 줄씩(사용성-0916 표 8 · 하영 ahead-five.md 2판 — 값은 사람이 쓴다, 맡은 실무가 회차 닫을 때). 첫 표(| # | 일 | … 한 줄 | 자 |)의 굵은 글만, 자에 맞는 줄만. */
const ahead = { lines: [], fetchedAt: 0 };
function loadAheadFive(rerender = null) {
  if (Date.now() - ahead.fetchedAt < 60_000) return;
  ahead.fetchedAt = Date.now();
  fetch('/out/marketing/ahead-five.md').then((r) => (r.ok ? r.text() : '')).then((md) => {
    const next = [];
    let inTable = false, col = -1;
    for (const line of md.split('\n')) {
      if (!line.trim().startsWith('|')) { if (inTable) break; continue; }
      const c = line.split('|').slice(1, -1).map((s) => s.trim());
      if (c[0] === '#') { col = c.findIndex((h) => /한 줄/.test(h)); inTable = col > 0; continue; }
      if (!inTable || /^-+$/.test(c[0])) continue;
      const raw = c[col] ?? '';
      const text = (raw.match(/\*\*(.+?)\*\*/)?.[1] ?? raw).trim();
      if (bossOk(text)) next.push({ job: c[1] ?? '', text });
    }
    const changed = JSON.stringify(next) !== JSON.stringify(ahead.lines);
    ahead.lines = next;
    if (changed && rerender) rerender();
  }).catch(() => {});
}
function loadThreeLines(rerender = null) {
  if (Date.now() - three.fetchedAt < 60_000) return;
  three.fetchedAt = Date.now();
  fetch('/out/marketing/' + encodeURIComponent('팀별-세줄.md')).then((r) => (r.ok ? r.text() : '')).then((md) => {
    // 첫 표(| 팀 | 지금 | 다음 | 그 뒤 | 팀장 답 |)만 — 밑의 "재료 → 줄" 표는 머리가 "지금 ←" 라 다른 표다(첫 사진에서 그 표가 덮어썼다)
    const next = {};
    let inTable = false;
    for (const line of md.split('\n')) {
      if (!line.trim().startsWith('|')) { if (inTable) break; continue; }
      const c = line.split('|').slice(1, -1).map((s) => s.trim());
      if (c[0] === '팀') { inTable = c[1] === '지금' && c[2] === '다음'; continue; }
      if (!inTable || c.length < 4 || /^-+$/.test(c[0])) continue;
      const t = teams.find((x) => x.name === c[0] || x.room === c[0] || x.id === c[0]);
      if (t) next[t.id] = { now: c[1] || null, next: c[2] || null, later: c[3] || null };
    }
    const changed = JSON.stringify(next) !== JSON.stringify(three.byTeam);
    three.byTeam = next;
    if (changed && rerender) rerender();
  }).catch(() => {});
}
/** 카드 노드 — 재료가 아직 없으면 null. 문 셋: 파일 → 새 창, 자세히 → 그 팀 채팅, 결재 단추 → 기존 결재 팝업(사유 칸·대리 안내가 거기 있다 — 결정 길은 하나). */
function teamCardNode(team, rerender = null) {
  loadCard(team, rerender); if (SHOW_USAGE) loadUsage(rerender); loadThreeLines(rerender);
  const d0 = cards.byTeam[team];
  if (!d0) return null;
  const d = { ...d0, usage: SHOW_USAGE ? (d0.usage ?? usage.byTeam[team] ?? null) : null, three: d0.three ?? three.byTeam[team] ?? null };   // usage·three 는 서버가 카드 재료에 실으면 그것, 아니면 화면이 읽은 것
  // 이름·색은 화면이 아는 것으로 채운다 — 서버가 옛 판(2dacf61)이면 name 이 없어 카드 머리에 hq·dev 가 그대로 섰다(나리 R32 ③)
  const t = teams.find((x) => x.id === team);
  return teamCard({ ...d, name: d.name ?? t?.name ?? team, color: d.color ?? teamColor(team) }, {
    onOpen: async (file) => {
      if (file) { window.open(`/out/${encodeURIComponent(team)}/${String(file).replace(/^out\//, '').split('/').map(encodeURIComponent).join('/')}`, '_blank', 'noopener'); return; }
      if (team !== active) await selectTeam(team);
      setView('room');
    },
    onDecide: (id) => { const r = approvals.find((a) => a.id === id); if (r) openApprovalPop(r); else setView('tower'); },
  });
}
/** 채팅 맨 위 — 그 팀 카드 하나가 고정(카드-체계 1절 "어디에 뜨나 ③", 옛 '지금 하는 회차' 줄 자리). 총괄실·비서실은 상황판이 없어 안 그린다. */
/** 채팅 머리 띠 한 줄(ui-spec 12절 ③) — 대시보드 띠와 같은 값(dashStats). 방마다(총괄실·비서실도). 누르면 대시보드 그 블록. */
function renderStatLine() {
  const box = $('statLine');
  if (!box) return;
  loadDone(); loadWork();
  box.replaceChildren(statBand(dashStats(), 'line'));
}
function renderRoomCard() {
  renderStatLine();
  const box = $('roomCard');
  if (!box) return;
  const t = teams.find((x) => x.id === active);
  if (!t || t.kind === 'office' || t.id === 'sera') { box.hidden = true; box.replaceChildren(); return; }
  const node = teamCardNode(active, () => { if (view === 'room') renderRoomCard(); });
  box.replaceChildren();
  if (node) { box.appendChild(node); box.hidden = false; } else box.hidden = true;
}

/* ── 그림 부품 — 헨리 '숫자를 어떻게 보여 주나 — 한 벌'(numbers.md). 이 문서 밖 모양은 안 쓴다.
 * 진행 막대(높이 5, 채움 = 끝난 만큼, 옆에 N/M 하나) · 시간 띠(가로가 오늘 우리 시각, 한 것 = 점, 막힌 것 = 빨간 점, 멈춘 구간 = 빨간 띠) · 큰 숫자 셋 · 강조(그것만 색). */
const teamColor = (id) => summaries[id]?.cast?.[id === 'hq' ? 'chief' : 'guide']?.color ?? 'var(--ink-4)';
const seatColor = (team, by) => summaries[team]?.cast?.[by]?.color ?? summaries.hq?.cast?.[by]?.color ?? 'var(--ink-4)';
function progressBar(doneN, total, color) {
  const w = el('span', 'pbar'); w.title = `${doneN}/${total} 단계`;   // .bar 가 아니다 — 그건 방 머리(index.html header.bar)
  const f = el('span', 'pbar__fill'); f.style.width = `${total ? Math.round((doneN / total) * 100) : 0}%`; f.style.background = color; w.appendChild(f);
  return w;
}
/** 시간 띠 — start~end 를 가로 100% 로. marks [{ at, color, kind:'done'|'bad', title }], spans [{ from, to }](빨간 띠). 점은 8px, 손 올리면 한 줄. */
function timeBand(start, end, marks, spans = []) {
  const b = el('span', 'tband');
  const x = (t) => Math.min(100, Math.max(0, ((t - start) / Math.max(1, end - start)) * 100));
  for (const s of spans) { const sp = el('span', 'tband__span'); sp.style.left = `${x(s.from)}%`; sp.style.width = `${Math.max(1, x(s.to) - x(s.from))}%`; b.appendChild(sp); }
  for (const m of marks) { const d = el('span', `tband__dot tband__dot--${m.kind ?? 'done'}`); d.style.left = `${x(m.at)}%`; if (m.color && m.kind !== 'bad') d.style.background = m.color; if (m.title) d.title = m.title; b.appendChild(d); }
  return b;
}

function renderTowerAll(grid) {
  // 대시보드 3판(헨리 ui-spec 12절 · 대표 답 ④ · 결정 192, req_7e1cff83): 위에서 아래로 넷 — 띠 큰 숫자 셋 → 정할 것 → 팀 다섯 → 오늘 끝난 것.
  // 뺀 것: 이슈 블록(막힌 것은 팀 카드의 빨간 띠로) · 작업 보드 · 최근 활동 · 시각. 숫자 하나 = 목록 하나 = 정본 하나(제안 2절).
  const goRoom = (t) => async () => { await selectTeam(t.id); setView('room'); };
  const { mine, fromBoard } = bossItems();
  loadDone(); loadWork();
  const stat = dashStats({ mine, fromBoard });
  const jump = (block) => () => { grid.querySelector(`[data-block="${block}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  // ① 띠 — 큰 숫자 셋(사전 191행 셈). 누르면 그 블록으로. 채팅 머리 한 줄(③)과 같은 값 하나(dashStats).
  grid.appendChild(statBand(stat, 'big', jump));

  // ② 정할 것 N — 결재(C)·물어봄·FAIL 판단 + 상황판 '대표님이 보실 것' 줄. 0 이면 "오늘은 없어요"(나리 상시 대리 188 뒤 기본 모양).
  const sec3 = el('section', 'dash__card'); sec3.dataset.block = 'mine'; if (stat.decide) sec3.dataset.alert = '1';
  sec3.appendChild(el('div', 'dash__k', `정할 것 ${stat.decide}`));
  if (!stat.decide) sec3.appendChild(el('div', 'dash__empty', '오늘은 없어요'));
  for (const it of mine) {
    const row = el('button', 'dash__row'); row.type = 'button';
    row.appendChild(el('b', null, `${it.teamName}${it.name ? ' · ' + it.name : ''} · ${it.kind === 'approval' ? '승인 필요' : it.kind === 'boss' ? '답변 필요' : '검토 필요'}`));
    putLine(row, it.text, 'dash__sub', it.team);   // 대표 몫은 행은 남기고(누를 수 있어야) 글만 — 없으면 머리 한 줄(opus ④)
    row.appendChild(el('span', 'dash__go', it.kind === 'approval' ? '확인' : '채팅 열기'));
    row.addEventListener('click', () => { markRead([it.id]); const tg = it.target ?? {}; if (it.kind === 'approval') { const r = approvals.find((a) => a.id === (tg.approval ?? String(it.id).split(':')[1])); if (r) openApprovalPop(r); else document.querySelector('.approvals')?.scrollIntoView({ block: 'start' }); } else jumpTo(tg.team ?? it.team, tg.event ?? null); });
    sec3.appendChild(row);
  }
  for (const b of fromBoard) {
    const row = el('button', 'dash__row'); row.type = 'button';
    if (!startsWithTeam(b.text, b.teamName)) row.appendChild(el('b', null, b.teamName));   // 줄이 이미 팀 이름으로 시작하면 머리를 안 붙인다(폴드 QA #4)
    if (!putLine(row, b.text, 'dash__sub', b.team)) continue;
    row.addEventListener('click', goRoom(teams.find((t) => t.id === b.team)));
    sec3.appendChild(row);
  }
  grid.appendChild(sec3);

  // ③ 팀 다섯 — 팀 카드(card.js teamCard: 진행 중·다음·예정 · 막힌 것 빨간 띠 · 머리 "누구 진행 중" · 꼬리 "끝난 수/전체 · 지금 N단계"). 재료가 아직이면 팀 이름 한 줄.
  const tl = el('section', 'dash__card'); tl.dataset.block = 'teams';
  tl.appendChild(el('div', 'dash__k', '팀 다섯'));
  const cardsBox = el('div', 'cards'); cardsBox.dataset.cards = 'team';
  for (const t of teams.filter((x) => x.id !== 'sera')) {
    const cardNode = teamCardNode(t.id, () => { if (view === 'tower' && towerTab === 'all') renderTower(); });
    cardsBox.appendChild(cardNode ?? el('div', 'dash__empty', `${t.name} — 불러오는 중`));
  }
  tl.appendChild(cardsBox);
  grid.appendChild(tl);

  // ④ 오늘 끝난 것 N — 사람 말 한 줄 + 팀 색 점. 정본은 /api/done 오늘(상황판 done + 판정 통과 + 결재·회차·글). 자에 안 맞는 줄은 안 낸다. 대표는 안 선다(톰).
  const sec2 = el('section', 'dash__card'); sec2.dataset.block = 'done';
  sec2.appendChild(el('div', 'dash__k', `오늘 끝난 것 ${stat.doneList.length}`));
  if (!stat.doneList.length) sec2.appendChild(el('div', 'dash__empty', done.fetchedAt ? '아직 없어요' : '불러오는 중'));
  const items = stat.doneList.slice(0, done.more ? 60 : 8);
  for (const it of items) {
    const row = el('button', 'dash__row dash__row--done'); row.type = 'button';
    const dot = el('span', 'dot'); dot.style.background = teamColor(it.team); row.appendChild(dot);
    row.appendChild(el('span', 'dash__sub', it.line));
    row.addEventListener('click', () => { if (it.kind === 'work') setView('dashboard'); else jumpTo(it.team, null); });   // 보드 일은 타임라인으로, 상황판 줄은 그 방으로(이벤트가 없다 — code-review)
    sec2.appendChild(row);
  }
  if (stat.doneList.length > 8) {
    const more = el('button', 'dash__more'); more.type = 'button'; more.textContent = done.more ? '접기' : '더 보기';
    more.addEventListener('click', () => { done.more = !done.more; renderTower(); });
    sec2.appendChild(more);
  }
  grid.appendChild(sec2);
}

/** 대표 몫 하나 — 정할 것의 재료(결재 C·물어봄·FAIL 판단 = blockedOf 의 waitOn boss, + 상황판 '보실 것' 줄). 대시보드 블록·띠·채팅 머리가 같은 것을 쓴다(code-review — 두 벌이면 갈린다). */
function bossItems() {
  const now = Date.now();
  const pendingAll = approvals.map((r) => ({ id: r.id, grade: r.grade, team: r.team, by: r.by, what: r.what, ts: r.requestedAt ?? r.ts }));
  const openReq = requestsAll.filter((r) => r.status !== 'closed');
  const mine = blockedOf({ teams, summaries, approvals: pendingAll, requests: openReq, infra }, { now, pauses }).filter((it) => it.waitOn === 'boss');
  const fromBoard = teams.flatMap((t) => (summaries[t.id]?.progress?.boss ?? []).map((text) => ({ team: t.id, teamName: t.name, text })));
  return { mine, fromBoard };
}
/**
 * 띠 큰 숫자 셋 — 사전 191행(결정 192)의 셈, 값은 하나(대시보드 띠·채팅 머리 한 줄이 같이 쓴다).
 *   정할 것 = 대표님이 정하거나 눌러야 다음으로 가는 일(결재 대기 + 답변 대기 + 상황판 '보실 것' 줄) · 막힌 것 = 누가 풀어야 넘어가는 일(팀 카드 막힌 것, 자 통과분) ·
 *   오늘 끝난 것 = 상황판 done 줄 + 오늘 통과 판정(작업 보드 doneAt 칸은 아직 없다 — 그 칸이 생기면 여기 한 줄로 바꾼다).
 */
function dashStats({ mine = null, fromBoard = null, day0 = dayStartSeoulMs(Date.now()) } = {}) {
  if (!mine || !fromBoard) ({ mine, fromBoard } = bossItems());
  const okLine = (s) => bossOk(String(s ?? '').trim());
  const stuck = teams.filter((t) => t.id !== 'sera').reduce((n, t) => {
    const d = cards.byTeam[t.id];
    const list = d ? (d.blocked ?? []).map((x) => x.text) : (summaries[t.id]?.progress?.blocked ?? []);
    return n + list.filter(okLine).length;
  }, 0);
  // 오늘 끝난 것 = 작업 보드에서 오늘 통과로 바뀐 일(doneAt — 톰 목표·사전 191행; 판정 PASS 가 advanceWorkOnPass 로 찍는다) + 상황판 done 줄(팀 카드 재료, 자 통과분 — 보드에 없는 일).
  // /api/done 전부(커밋·글·보고…)는 안 센다(실측 800줄). 손으로 '통과' 로 바꾼 옛 항목은 doneAt 이 없어 안 든다.
  const doneList = [];
  for (const s of work.data?.streams ?? []) {
    for (const it of s.items ?? []) {
      if (!it.doneAt || new Date(it.doneAt).getTime() < day0) continue;
      const line = String(it.what ?? '').trim();
      if (line && line !== NOT_YET && okLine(line)) doneList.push({ id: `work:${it.id}`, kind: 'work', team: it.team, line });
    }
  }
  for (const t of teams.filter((x) => x.id !== 'sera')) {
    const d = cards.byTeam[t.id];
    const lines = d ? (d.done ?? []).map((x) => x.text) : (summaries[t.id]?.progress?.done ?? []);
    for (const s of lines.filter(okLine)) doneList.push({ id: `board:${t.id}:${s}`, kind: 'board', team: t.id, line: s });
  }
  return { decide: mine.length + fromBoard.length, stuck, done: doneList.length, doneList };
}

/** 띠 한 줄 — size 'big'(대시보드: 카드 셋, 숫자 28/32) 또는 'line'(채팅 머리 한 줄 37, 숫자 15). 누르면 대시보드 그 블록. 글자는 사전 1절 "정할 것·막힌 것·오늘 끝난 것". */
function statBand(stat, size = 'big', jump = null) {
  const band = el('div', `stats stats--${size}`); band.dataset.block = 'stats';
  for (const [key, label, n] of [['mine', '정할 것', stat.decide], ['teams', '막힌 것', stat.stuck], ['done', '오늘 끝난 것', stat.done]]) {
    const b = el('button', 'stats__item'); b.type = 'button'; b.dataset.k = key; if (n) b.dataset.n = '1';
    b.appendChild(el('span', 'stats__k', label));
    b.appendChild(el('b', 'stats__n', String(n)));
    b.addEventListener('click', () => { if (jump) jump(key)(); else { setView('tower'); setTowerTab('all'); setTimeout(() => $('towerGrid').querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: 'start' }), 50); } });
    band.appendChild(b);
  }
  return band;
}

/* ── 개인 — 열넷 + 대표. 헨리 사람 카드 2판(person.svg). 데이터는 요약의 people ── */
function renderTowerPeople(grid) {
  const groupKey = (t) => `ppanam.towerGroup.${t}`;

  // 대표 카드 — 맨 위, 묶음 밖. 하영 표(opsroom-content.md 2절, 결정 47 ①): 대표가 자기 상태 알약·자기 통계(오늘 지시·결정·마지막 지시)를
  // 볼 이유가 없다 — 뺐다. 남는 건 ①③ 의 답, 승인 대기 · 차례인 방. (people.boss 의 지시·결정 수는 계약에 남고 화면만 안 쓴다.)
  const bossCast = summaries[teams[0]?.id]?.cast?.boss ?? { name: '함동혁(댄)', initial: '댄', color: '#8a7320', title: '대표', does: '사람' };
  const bc = el('div', 'pcard'); bc.dataset.boss = '1';
  bc.appendChild(pcardTop(bossCast, el('span'), { team: 'hq', id: 'boss' }));
  const { rooms } = bossTurns();
  bc.appendChild(el('div', 'pcard__doing', `결재 ${approvals.length} · 답 기다리는 방 ${rooms.length ? rooms.map((t) => t.name).join('·') : '없음'}`));
  grid.appendChild(bc);

  // 나리(system)는 비서실 묶음에만 — 세라·나리 둘(대표 16:5x "나리가 또 이리저리 팀마다 다 들어가있다", 결정 185). 여섯 방 cast 가 다 system 을 갖고
  // peopleOf 도 다 주지만(43daf85) 카드는 한 자리에만 세운다. 세션(노랑 손)은 hq 에 살아서 상태·하는 일은 hq 것을 쓴다 — 비서실 방엔 세라·대표 말만 남아 거기 people 은 비어 있다.
  // 세라(secretary)도 같은 뜻 — 총괄실 cast 의 비서 자리(model null)는 카드로 안 세운다, 총괄은 톰·제리 둘(나리 대리 결정, apr_b311eafb 덧).
  const NARI_HOME = 'sera';
  const SERA_SEATS = new Set(['system', 'secretary']);
  for (const t of teams) {
    const s = summaries[t.id] ?? {};
    const cast = { ...(s.cast ?? {}) };
    const people = Object.entries(s.people ?? {}).filter(([id]) => id !== 'boss' && cast[id] && !cast[id].from && (!SERA_SEATS.has(id) || t.id === NARI_HOME));
    if (t.id === NARI_HOME && cast.system) {
      const hq = summaries.hq ?? {};
      if (hq.cast?.system?.model) cast.system = { ...cast.system, ...hq.cast.system };   // 노랑 손(C16)은 hq cast 의 model 로 정해진다
      const ss = hq.sessions?.system;
      const p = hq.people?.system ?? s.people?.system ?? { state: ss?.busy ? 'working' : 'waiting', alive: !!ss?.alive, doing: null, lastSignal: null };
      const i = people.findIndex(([id]) => id === 'system');
      if (i >= 0) people[i] = ['system', p]; else people.push(['system', p]);
    }
    if (!people.length) continue;
    const box = el('details', 'pgroup');
    let open = true; try { open = localStorage.getItem(groupKey(t.id)) !== '0'; } catch { /* 기본은 펼침 */ }
    box.open = open;
    box.addEventListener('toggle', () => { try { localStorage.setItem(groupKey(t.id), box.open ? '1' : '0'); } catch { /* 무시 */ } });
    const head = el('summary', 'pgroup__head');
    head.appendChild(el('span', null, `${t.name} ${people.length}`));
    if (people.some(([, p]) => p.bossCall)) head.appendChild(el('i', 'pgroup__dot'));
    box.appendChild(head);
    const list = el('div', 'pgrid');
    for (const [id, p] of people) list.appendChild(personCard(t, id, cast[id], p));
    box.appendChild(list);
    grid.appendChild(box);
  }
}

/** 카드 1줄 — 칩 26px + 이름 · 자리 + 오른쪽 알약. */
function pcardTop(a, pillEl, face = null) {
  const top = el('div', 'pcard__top');
  const chip = el('div', 'chip pcard__chip', a.initial ?? '?'); chip.style.background = a.color ?? FALLBACK.color;
  if (face) withFace(chip, face.team, face.id);   // 사람 카드 얼굴 칸(헨리 ② — 띠·지름은 CSS 몫)
  top.appendChild(chip);
  const who = el('div', 'pcard__who');
  who.appendChild(el('b', null, a.name ?? '?'));
  if (a.title) who.appendChild(el('span', null, a.title));   // 전엔 role 의 앞 조각을 잘라 썼다 — 이제 title 이 그 조각이다
  top.appendChild(who);
  top.appendChild(pillEl);
  return top;
}
const firstLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || '완료 없음';

/**
 * 멈춘 이유 한 줄 — 알약(멈춤·쉬는 중·자리 비움)만으로는 "왜" 를 모른다. 일하는 중·대표님께 물어봄은 이유가 알약에 있으니 빈 문자열.
 * 글자는 하영 사전 3-1 "왜 멈췄나" 표 그대로 — 머리말 없이 이유만. 쉬는 중인데 세션까지 꺼져 있으면 " · 자리에 없어요" 를 붙인다.
 */
function whyStopped(t, p) {
  const s = summaries[t.id] ?? {};
  if (p.state === 'blocked') return BOSS_WHY[s.needsBossWhy] ?? '답변 필요';
  // 세션이 안 떠 있는 것(alive false)은 '재시작 필요' 가 아니다 — 서버가 켜진 직후엔 다 그렇고 첫 차례에 다시 뜬다(T2·sessions.json). 대표가 켠 직후 '다 죽었다' 로 읽으셨다(나리 12:3x, 새는 것 ⑥).
  // 글자는 사전 3-1 "왜 멈췄나" 표(266~274행)·517행 ⑥ 그대로 — "대기 — 멘션 시 응답"·"5분 이상 멘션 없음" 은 113행이 하네스 말로 짚은 것(대표 16:35 ③ 한국어 50점).
  if (p.state === 'waiting') return s.phase !== 'running' ? '지금 하는 회차가 없어요' : '누가 부르면 답해요';
  // 사전 "자리에 없어요 — 다시 켜야 해요" 는 안 쓴다 — 위 줄(새는 것 ⑥) 그대로, 꺼진 세션도 부르면 다시 뜬다.
  if (p.state === 'resting') return p.alive === null ? '부를 때만 와요 — 5분 넘게 안 불렀어요' : '부르면 와요';
  return '';
}

/** 일 상태 → 알약 글자·색 (결정 58 ①, 계약 3절 "일 상태"). 글자는 하영 사전 — 관제탑 셋·방 둘이 같은 글자. 서버의 people[자리].state — 마을 시계는 여기 없다. */
const WORK_PILL = { working: ['진행 중', 'live'], bossCall: ['답변 대기', 'boss'], blocked: ['차단됨', 'bad'], waiting: ['대기', 'idle'], resting: ['자리 비움', 'idle'] };

/**
 * 사람 카드 문 (결정 130 ① · 화면이-답하는-질문 "카드는 탭이 아니다. 문이다") — 방에서 얼굴·이름·참여 줄을 누르면
 * 관제탑의 그 사람 카드(personCard, 같은 부품)가 팝업으로 뜬다. 어디서든 두 번 안에 카드. 얼굴 그림·정사각형 모양은 129·130 시안 뒤 —
 * 지금은 카드 부품 그대로. 대표·system(나리)은 카드가 없다(마을과 같다). 요약이 아직 안 왔으면 상태 없이 이름·직책만.
 */
function openPersonPop(teamId, id) {
  const t = teams.find((x) => x.id === teamId); if (!t || id === 'boss') return;
  const s = summaries[teamId] ?? {};
  const a = s.cast?.[id] ?? (teamId === active ? cast.agents?.[id] : null); if (!a) return;
  closePop();
  const scrim = el('div', 'scrim pop__scrim'); scrim.addEventListener('click', closePop);
  const pop = el('div', 'pop'); pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', `${a.name} 카드`);
  const x = el('button', 'pop__x', '×'); x.type = 'button'; x.title = '닫기'; x.addEventListener('click', closePop);
  pop.appendChild(x);
  pop.appendChild(personCard(t, id, a, s.people?.[id] ?? { state: 'waiting' }));
  document.body.append(scrim, pop);
  x.focus();
}
function closePop() { for (const n of document.querySelectorAll('.pop, .pop__scrim')) n.remove(); }
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePop(); });

/* 사람 카드 — 헨리 시안 2판(person.svg, 9단계 ①): 줄 셋(이름·직책·알약 / 지금 하는 일 / N분 전에 움직임) + 있을 때만 붙는 줄 둘 —
 * ▸ 대표님께 물어봄(결정을 청한 것만, bossCall) · ◂ 대표님이 부르셨어요 → 받았나(bossAsk, 하영 2판 7절 ⑤). 쉬는 중·자리 비움은 짧게(왜 · 움직임 한 줄).
 * 발언 수·검토 결과 수·일지 줄은 없다(시안 메모). 엔진·모델 줄(결정 69)은 대표 손잡이라 맨 밑에 그대로. */
function personCard(t, id, a, p) {
  const card = el('div', 'pcard'); card.dataset.actor = `${t.id}:${id}`;
  if (id === 'system' && a?.model) card.dataset.hand = 'server';   // 서버 나리 — 이름 박스 노랑(C16, 대표 12:13 "카드 색은 C16 대로")
  const st = WORK_PILL[p.state] ?? WORK_PILL.waiting;
  if (p.bossCall) card.dataset.alert = '1';
  card.appendChild(pcardTop(a, pill(st[0], st[1]), { team: a?.from ?? t.id, id }));
  const why = whyStopped(t, p);   // "왜 멈췄나" — 하영 사전 3-1 그대로(대표 "왜 모두 멈춰있니? 대답해봐")
  const idle = p.state === 'waiting' || p.state === 'resting';
  if (idle) {
    // 쉬는 중 · 자리 비움 — 짧게 한 줄: 왜 · N분 전에 움직임(시안 노라·레오 줄)
    card.appendChild(el('div', 'pcard__why', [why, moved(lastMove(p))].filter(Boolean).join(' · ')));
  } else {
    // 2줄 지금 하는 일 — 마지막 발언 뒤 도구 줄이면 "app.js 고치는 중"(파일 도구만 — Bash 명령 글자(say.mjs…, null | sort…)가 그대로 섰다, 나리 R32 ①), 아니면 마지막 발언 첫 문장.
    // 사람 말 검사(결정 140)를 지난다 — 안 맞으면 "요약 없음" + 원문 펼침. 3줄 "N분 전에 움직임"(결정 31 안죽었어요).
    // bosswords.doingWord — 자와 같은 함수. 자에 안 맞으면 그 팀 진행 중 첫 줄, 그것도 없으면 '작업 중'("요약 없음" 은 안 찍는다, opus ④)
    if (!putLine(card, doingWord(p.doing, { live: p.busy, toolPhrase, firstLine }), 'pcard__doing', t.id)) card.appendChild(el('div', 'pcard__doing', '작업 중'));
    card.appendChild(el('div', 'pcard__nums', moved(lastMove(p))));
    if (why) card.appendChild(el('div', 'pcard__why', why));
  }
  // ▸ 대표님께 물어봄 — 물었는데 대표가 아직 답 안 했을 때만(결정 52 — 결정이 필요한 부름만). 누르면 그 말
  if (p.bossCall) {
    const c = el('button', 'pcard__call'); c.type = 'button';
    c.textContent = `▸ "${p.bossCall.text.slice(0, 48)}${p.bossCall.text.length > 48 ? '…' : ''}" · ${ago(p.bossCall.ts)}`;
    c.addEventListener('click', () => jumpTo(t.id, p.bossCall.id));
    card.appendChild(c);
  }
  // ◂ 대표님이 부르셨어요 → 받았나 — 이 라운드에서 대표가 이름을 부른 마지막 말(bossAsk). 답했으면 "답했어요 · N분 전", 아니면 지금 상태로: 일하는 중 = 받았어요, 답 쓰는 중 · 자리 비움 · 멈춤 = 못 와요 · 왜. 누르면 그 부름
  if (p.bossAsk) {
    const q = p.bossAsk;
    const got = q.replied ? `답했어요 · ${ago(q.replied)}` : p.busy || p.state === 'working' ? '읽음, 답변 중' : p.state === 'resting' || p.alive === false ? '자리 비움' : p.state === 'blocked' ? `부재${why ? ' · ' + why : ''}` : '읽음';
    const c = el('button', 'pcard__ask'); c.type = 'button'; c.dataset.k = q.replied || p.busy || p.state === 'working' ? 'ok' : 'bad';
    c.textContent = `◂ 대표님이 부르셨어요 · ${ago(q.ts)} → ${got}`;
    c.addEventListener('click', () => jumpTo(t.id, q.id));
    card.appendChild(c);
  }
  // 엔진 · 모델 · 추론 강도 줄(결정 69) — 사람 카드에 그대로 둔다(대표 14:1x "우리 팀원들 모델 바꾸는 거 갑자기 사라졌는데?", 결정 172). R32 에 설정 탭으로 옮겼던 걸 되돌림 — 설정 탭 것도 같이 둔다.
  // 규칙(장부 172): 대표가 쓰는 손잡이를 옮기거나 빼려면 대표께 먼저.
  card.appendChild(castRow(t, id, a));
  return card;
}
/**
 * 엔진 · 모델 · 추론 강도 줄 (결정 69, 계약 1절 "자리의 엔진·모델·추론 강도"). 엔진 알약은 보이되 못 누른다(엔진 바꾸기는 다음 갈래).
 * 모델·강도는 <select> — 폰에서 네이티브 선택기가 뜬다. 고르면 POST /api/cast, 서버가 cast.json 에 쓰고 방에 note. 지금 도는 턴은 안 끊는다.
 */
function castRow(t, id, a) {
  const row = el('div', 'pcard__cast');
  // 엔진 이름 ↔ cast.json model 값. gemini 는 임시 외부 감사(대표 결정 09-14 — codex 한도 엿새). 셋 다 여기 표 하나로.
  const ENGINE_OF = { claude: 'claude', gpt: 'codex', gemini: 'gemini' }, MODEL_OF = { claude: 'claude', codex: 'gpt', gemini: 'gemini' };
  const engine = ENGINE_OF[a.model] ?? null;
  if (!engine) return row;
  // 엔진 알약 셋(결정 69 ①) — 지금 것이 켜져 있고, 다른 쪽을 누르면 그 자리의 세션 종류가 바뀐다(다음 턴부터). 외부감사는 claude 로 못 간다(CLAUDE.md) — codex ↔ gemini 는 된다.
  const engines = el('span', 'pcard__engines'); engines.setAttribute('role', 'group'); engines.title = '엔진(다음 턴 적용)';
  const opts = castOptions ?? {};
  const locked = id === 'outside';
  for (const name of ['claude', 'codex', 'gemini']) {
    const b = el('button', 'pcard__engine', name); b.type = 'button';
    b.setAttribute('aria-pressed', name === engine ? 'true' : 'false');
    b.disabled = name === engine || (locked && name === 'claude');
    if (locked && name === 'claude') b.title = '외부 감사는 타사 모델 고정';
    else if (name !== engine) b.title = `${name} 로 바꾸기 — 다음 턴부터${name === 'gemini' ? ' (임시 외부 감사 — 파일로 주고받아 느림)' : ''}`;
    b.addEventListener('click', () => { if (!b.disabled) send({ model: MODEL_OF[name] }, { redraw: true }); });
    engines.appendChild(b);
  }
  row.appendChild(engines);
  // 목록은 자리별 예외(castOptions.bySeat — N2: 나리 자리만 클로드 fable·코덱스 astra, 대표 09-16 '서버 안에 있는 나리는 … fable 까지 … astra 까지 특별 카드')가 있으면 그것, 없으면 기본. 다른 자리는 그대로(fable 금지)
  const seatOpts = opts.bySeat?.[id] ?? {};
  const models = engine === 'codex' ? (seatOpts.codex ?? opts.codex ?? []) : engine === 'gemini' ? (seatOpts.gemini ?? opts.gemini ?? []) : (seatOpts.claude ?? opts.claude ?? []);
  const field = engine === 'codex' ? 'codexModel' : engine === 'gemini' ? 'geminiModel' : 'llm';
  const current = a[field] ?? (engine === 'claude' ? (teams.find((x) => x.id === t.id)?.model ?? models[0]) : models[0]);
  const modelSel = select(models, current, null);   // 값이 없으면 방 기본(state/teams.json)이 골라져 보인다 — 실제로 도는 모델
  modelSel.title = a[field] == null ? '방 기본값' : '모델';
  const effortSel = select(opts.efforts ?? [], a.effort ?? '', '기본');
  effortSel.title = '추론 강도';
  const msg = el('span', 'pcard__castmsg', '');
  const send = async (patch, { redraw = false } = {}) => {
    msg.textContent = '저장 중'; msg.dataset.bad = '0';
    try {
      const r = await fetch('/api/cast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team: t.id, actor: id, ...patch }) }).then((x) => x.json());
      if (r.error) { msg.textContent = r.error; msg.dataset.bad = '1'; return; }
      if (summaries[t.id]?.cast?.[id]) Object.assign(summaries[t.id].cast[id], r.agent);
      msg.textContent = Object.keys(r.to ?? {}).length ? (r.restart === 'after-turn' ? '저장됨(이번 턴 후)' : '저장됨(다음 턴)') : '유지';
      // 엔진이 바뀌면 모델 목록도 바뀐다 — 줄을 새로 그린다(요약 방송이 오기 전에).
      if (redraw && Object.keys(r.to ?? {}).length) row.replaceWith(castRow(t, id, summaries[t.id]?.cast?.[id] ?? r.agent));
    } catch { msg.textContent = '서버 응답 없음'; msg.dataset.bad = '1'; }
  };
  modelSel.addEventListener('change', () => { if (modelSel.value) send({ [field]: modelSel.value }); });
  effortSel.addEventListener('change', () => { if (effortSel.value) send({ effort: effortSel.value }); });
  row.append(modelSel, effortSel, msg);
  return row;
}
/** 작은 <select> — 값 목록 + 지금 값. blank 가 있으면 "값 없음" 자리를 맨 위에 둔다(고를 수는 없다 — 비우는 길은 없다). */
function select(values, current, blank) {
  const s = document.createElement('select'); s.className = 'pcard__sel';
  if (blank != null) { const o = document.createElement('option'); o.value = ''; o.textContent = blank; o.disabled = true; s.appendChild(o); }
  for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = v; s.appendChild(o); }
  s.value = values.includes(current) ? current : '';
  return s;
}
let castOptions = {};
// 일지 첫 문장·문단 펼치기(옛 사람 카드 5줄)는 헨리 2판에서 빠졌다 — 일지는 마을 카드(결정 13)와 /api/actor 에 그대로.

/* ── 요청 — 팀 사이 요청 블록 (결정 45 ①·49·51, 계약 6-1절). 대표가 누를 버튼은 없다(결정 46 — 방향 안의 일). ── */
const REQ_PILL = { open: ['진행 중', 'live'], done: ['완료', 'idle'], acked: ['읽음', 'idle'] };   // 하영 3-1 요청 탭 표
const openThreads = new Set();   // 스레드 전체를 펼쳐 둔 요청 id

function nameOfWho(who) {
  if (!who) return '?';
  if (who.team === 'hq') return summaries.hq?.cast?.chief?.name ?? '톰';
  const team = teams.find((t) => t.id === who.team)?.name ?? who.team;
  const name = summaries[who.team]?.cast?.[who.actor]?.name;
  return name ? `${team}·${name}` : `${team}/${who.actor}`;
}

function requestPill(r) {
  if (r.status === 'closed') return r.closedBy === 'stop' ? ['중단', 'bad'] : ['끝', 'idle'];
  return REQ_PILL[r.status] ?? REQ_PILL.open;
}

const REQ_LINE_LABEL = { goal: '요청', done: '완료', ack: '읽음', confirm: '확인', stop: '중단' };

function requestCard(r, rerender = renderTower) {
  const card = el('div', 'apr');
  const head = el('div', 'apr__head');
  const [pt, pk] = requestPill(r);
  head.appendChild(pill(pt, pk));
  const fromName = teams.find((t) => t.id === r.from.team)?.name ?? r.from.team;
  const toName = teams.find((t) => t.id === r.to.team)?.name ?? r.to.team;
  head.appendChild(el('span', 'apr__team', `${fromName} → ${toName} · ${ago(r.updatedAt)}`));
  card.appendChild(head);
  card.appendChild(el('div', 'apr__what', r.what));
  const bits = [];
  if (r.why) bits.push(`사유: ${r.why}`);
  if (r.due) bits.push(`기한 ${r.due}`);
  if (r.mode === 'milestone') bits.push('공동 프로젝트 — 단계 끝까지 열어 둠');
  if (r.goal) bits.push(`요청: ${r.goal}`);
  if (bits.length) card.appendChild(el('div', 'apr__detail', bits.join(' · ')));

  if (r.thread.length) {
    const showAll = openThreads.has(r.id);
    const lines = showAll ? r.thread : r.thread.slice(-3);
    const th = el('div', 'apr__arts');
    th.appendChild(el('div', 'apr__artsk', showAll ? `대화 ${r.thread.length}줄` : `최근 대화 (전체 ${r.thread.length}줄)`));
    // done 의 out/… 은 승인 카드와 같은 방식으로 링크가 된다 — 받는 쪽 팀의 out/ 기준.
    for (const line of lines) {
      const row = el('div', null);
      const label = REQ_LINE_LABEL[line.kind];
      const text = line.text ? linkOutPaths(escapeHtml(line.text), r.to.team, outAnchor) : '';
      row.innerHTML = `<b>${escapeHtml(nameOfWho(line.by) + (label ? ` · ${label}` : ''))}</b>${text ? ' ' + text : ''}`;
      th.appendChild(row);
    }
    if (r.thread.length > 3) {
      const more = el('button', 'apr__link', showAll ? '최근 3개' : '전체 보기'); more.type = 'button';
      more.addEventListener('click', () => { if (showAll) openThreads.delete(r.id); else openThreads.add(r.id); rerender(); });
      th.appendChild(more);
    }
    card.appendChild(th);
  }
  return card;
}

/* 요청 탭 — 세 겹(한 줄 → 펼친 줄 → 카드). 전엔 블록마다 카드를 다 펼쳐 한 화면에 16,686자·3,819px 가 섰다(나리 실측 R25 — "텍스트로만 구성하면 그게 대시보드야?").
 * 한 줄 = 알약 · 누가 → 누구 · 무엇 · N시간 전. 누르면 그 자리에서 카드(requestCard). 열린 것이 위, 닫힌 것은 아래로. */
const openAsks = new Set();
function renderTowerAsks(grid) {
  const box = el('section', 'dash__card');
  const open = requestsAll.filter((r) => r.status !== 'closed'), closed = requestsAll.filter((r) => r.status === 'closed');
  box.appendChild(el('div', 'dash__k', requestsAll.length ? `요청 — 진행 ${open.length} · 완료 ${closed.length}` : '요청'));
  if (!requestsAll.length) {
    box.appendChild(el('div', 'dash__empty', requestsLoaded ? '요청 없음' : '로딩 중'));
  } else {
    for (const r of [...open, ...closed]) {
      const row = el('button', 'dash__row'); row.type = 'button'; row.dataset.open = openAsks.has(r.id) ? '1' : '0';
      const head = el('span', 'dash__head');
      const [pt, pk] = requestPill(r);
      const fromName = teams.find((t) => t.id === r.from.team)?.name ?? r.from.team, toName = teams.find((t) => t.id === r.to.team)?.name ?? r.to.team;
      head.appendChild(el('b', null, `${fromName} → ${toName}`));
      head.appendChild(el('span', 'dash__stage', ago(r.updatedAt)));
      head.appendChild(pill(pt, pk));
      row.appendChild(head);
      row.appendChild(el('span', 'dash__sub', r.what));
      row.addEventListener('click', () => { if (openAsks.has(r.id)) openAsks.delete(r.id); else openAsks.add(r.id); renderTower(); });
      box.appendChild(row);
      if (openAsks.has(r.id)) { const o = el('div', 'dash__open'); o.appendChild(requestCard(r)); box.appendChild(o); }
    }
  }
  grid.appendChild(box);
}

/* ── 팀 — 팀 카드 다섯, 헨리 시안 2판-b(team.svg, 9단계 ①). 현황 ④ 팀 줄 → 펼친 줄(상황판 네 칸) → 이것(두 번 = 카드).
 * 위에서 아래로: 머리(팀 · 알약) · 단계 N/M 목록(끝난 것 채움 · 지금 굵은 테두리 + 회차 네모 · 남은 것 점선) · 이 회차(상황판 네 칸 글자 그대로)
 * · 다른 팀에 부탁한 일 N(있을 때만) · 사람(칩 · 이름 직책 · 하는 일 · N분 전에 움직임 · 알약). 카드 안에서 누르면 옆으로만 — 단계 → 계획표 카드 · 부탁한 일 → 요청 탭 · 사람 → 사람 카드.
 * 마지막 발언·진행 막대·상황 접기는 뺐다(시안에 없다). 맨 밑 말하기·회차 시작/마무리 줄은 대표 손잡이라 그대로 둔다. ── */
const ROOM_WORD = { hq: '총괄실', marketing: '마케팅팀', dev: '개발팀', design: '디자인팀', finance: '경영팀' };   // 하영 0-1 확정 방 이름
const roomWord = (t) => ROOM_WORD[t.id] ?? t.room ?? t.name;
function renderTowerTeams(grid) {
  const focus = document.activeElement;
  const keep = focus?.classList?.contains('tcard__in')
    ? { team: focus.dataset.team, pos: focus.selectionStart } : null;

  grid.replaceChildren();

  // 카드 순서 (검수 #12) — 대표 차례·부름 → 승인 대기 → 진행 중 → 대기, 총괄실은 맨 아래. 폰 첫 화면에 막힌 방이 먼저 오게.
  const rank = (t) => {
    const s = summaries[t.id] ?? {};
    if (t.kind === 'office') return 9;
    if (s.needsBoss || s.bossCall) return 0;
    if (s.approvals?.pending) return 1;
    if (s.phase === 'running' || s.phase === 'blocked') return 2;
    return 3;
  };
  const ordered = [...teams].filter((t) => t.id !== 'sera').sort((a, b) => rank(a) - rank(b));   // 비서실은 팀이 아니다(계획표·회차 없음)
  const stageWord = (m) => `${m.n}단계 ${String(m.title ?? '').split(/\s*(?:—|∥|\()\s*/)[0].trim()}`;   // 폰 폭 — 첫 구분 기호 앞까지(하영 1-1)

  for (const t of ordered) {
    const s = summaries[t.id] ?? {};
    const agents = s.cast ?? {};
    const office = t.kind === 'office';       // 총괄실은 라운드가 없다. 늘 열려 있다
    const running = office || s.phase === 'running' || s.phase === 'blocked';

    const card = el('div', 'tcard');
    card.dataset.alert = s.needsBoss || s.bossCall ? '1' : '0';

    // 머리 — 팀 이름(0-1 확정) · 알약. 글자는 현황 ④ 팀 줄과 같은 넷(하영 사전 3-1)
    const top = el('div', 'tcard__top');
    const name = el('span', 'tcard__name', roomWord(t));
    name.title = '채팅 열기';
    name.addEventListener('click', async () => { await selectTeam(t.id); setView('room'); });
    top.appendChild(name);
    top.appendChild(pill(
      s.needsBoss ? '답변 필요' : s.bossCall ? '답변 필요' : office ? '대표님과 톰' : s.phase === 'blocked' ? '차단됨' : running ? '진행 중' : '대기',
      s.needsBoss || s.bossCall ? 'boss' : s.phase === 'blocked' ? 'bad' : running ? 'live' : 'idle'));
    card.appendChild(top);
    // 부제 — "N단계 제목 · N회차" (+ 왜 대표 차례인가). 총괄실은 회차가 없다
    const sub = office ? '대표님과 톰. 여기서 한 말을 톰이 팀에 나눠요'
      : [s.round && s.milestone ? `${s.milestone}단계 ${s.milestoneTitle ?? ''}`.trim() : '진행 중인 회차 없음', s.round ? `${s.round}회차` : null, s.needsBoss ? (BOSS_WHY[s.needsBossWhy] ?? '답변 필요') : s.bossCall ? `${agents[s.bossCall.by]?.name ?? s.bossCall.by} · ${ago(s.bossCall.ts)}` : null].filter(Boolean).join(' · ');
    card.appendChild(el('div', 'tcard__sub', sub));

    // 단계 N/M — 계획표 그대로(도면 2겹). 지금 단계 오른쪽에 회차 네모(채움 = 닫힌 회차 · 초록 테두리 = 지금 · 회색 테두리 = 남은 것, timebox 회차 수만큼). 누르면 계획표 카드(방 오른쪽)
    if (!office) {
      const list = s.milestones ?? [];
      const total = s.milestonesTotal ?? list.length, done = s.milestonesDone ?? list.filter((m) => m.status === 'pass').length;
      card.appendChild(el('div', 'tcard__k', total ? `마일스톤 ${done}/${total}` : '마일스톤'));
      if (s.milestones && !list.length) card.appendChild(el('div', 'tcard__quiet', '로드맵 없음'));   // milestones 자체가 없으면 옛 서버(재시작 전) — 목록만 비워 둔다
      const ul = el('div', 'tcard__stages');
      for (const m of list) {
        const st = m.status === 'pass' ? 'pass' : m.status === 'now' || m.n === s.milestone ? 'now' : 'wait';
        const row = el('button', 'tcard__stage'); row.type = 'button'; row.dataset.st = st; row.title = `${m.n}단계 ${m.title}`;
        row.appendChild(el('span', null, st === 'now' ? `${stageWord(m)} · 지금` : stageWord(m)));
        if (st === 'now') {
          const boxes = el('span', 'tcard__rounds');
          const n = Math.max(1, Math.ceil(Number(/(\d+(?:\.\d+)?)\s*라운드/.exec(String(m.timebox ?? ''))?.[1] ?? 1))), used = Math.min(n, s.roundsInMilestone ?? 0);
          for (let i = 0; i < Math.max(n, used + (running ? 1 : 0)); i++) { const b = el('i'); b.dataset.k = i < used ? 'done' : i === used && running ? 'now' : 'rest'; boxes.appendChild(b); }
          boxes.title = `이 단계에 쓴 회차 ${used}${m.timebox ? ` · 로드맵 ${m.timebox}` : ''}`;
          row.appendChild(boxes);
        }
        row.addEventListener('click', async () => { await selectTeam(t.id); setView('room'); document.getElementById('cardRoadmap')?.scrollIntoView({ block: 'start' }); });
        ul.appendChild(row);
      }
      card.appendChild(ul);
    }

    // 이 회차 — 상황판 네 칸 글자 그대로(progress.json: 하는 것 · 막힌 것 · 대표님이 보실 것 · 다음). 현황 ④ 펼친 줄과 같은 넷. 없으면 "없어요"
    card.appendChild(el('div', 'tcard__k', '이번 회차'));
    const p = s.progress;
    if (!p) card.appendChild(el('div', 'tcard__quiet', office ? '총괄실 — 상황판 없음(승인·요청·리포트)' : '상황판 없음'));
    else {
      for (const [k, label] of [['doing', '지금'], ['blocked', '이슈'], ['boss', '대표님이 보실 것'], ['next', '다음']]) {
        const lines = p[k] ?? [];
        const kv = el('div', 'tcard__kv'); kv.dataset.k = k;
        kv.appendChild(el('b', null, label));
        kv.appendChild(bossLines(lines, '없어요'));
        card.appendChild(kv);
      }
      if (p.at) card.appendChild(el('div', 'tcard__quiet', `갱신 ${agoShort(p.at)}${p.by ? ' · ' + (agents[p.by]?.name ?? p.by) : ''}${p.fresh === false ? ' · 낡음' : ''}`));
    }

    // 다른 팀에 부탁한 일 N — 이 팀이 연 요청 블록 중 열린 것(요청 탭과 같은 목록). 누르면 요청 탭의 그 블록
    const asks = requestsAll.filter((r) => r.from?.team === t.id && r.status !== 'closed');
    if (asks.length) {
      card.appendChild(el('div', 'tcard__k', `다른 팀에 요청한 일 ${asks.length}`));
      for (const r of asks) {
        const row = el('button', 'tcard__ask'); row.type = 'button';
        const toName = teams.find((x) => x.id === r.to?.team);
        row.appendChild(el('b', null, `${roomWord(t)} → ${toName ? roomWord(toName) : r.to?.team} · ${r.what}`));
        const lastLine = r.thread?.[r.thread.length - 1];
        row.appendChild(el('span', null, `${requestPill(r)[0]}${lastLine?.text ? ' · ' + String(lastLine.text).replace(/\s+/g, ' ').slice(0, 60) : ''}`));
        row.addEventListener('click', () => { openAsks.add(r.id); setTowerTab('asks'); });
        card.appendChild(row);
      }
    }

    // 사람 — 그 방의 자리(대표·안내 빼고). 칩 · 이름 직책 · 지금 하는 일 · N분 전에 움직임 · 알약(사람 카드와 같은 글자). 누르면 사람 카드
    const people = Object.entries(s.people ?? {}).filter(([id]) => id !== 'boss' && agents[id] && !agents[id].from);
    if (people.length) {
      card.appendChild(el('div', 'tcard__k', '멤버'));
      for (const [id, pp] of people) {
        const a = agents[id];
        const row = el('button', 'tcard__person'); row.type = 'button'; row.dataset.actor = `${t.id}:${id}`;
        const chip = withFace(el('span', 'chip', a.initial ?? '?'), a.from ?? t.id, id); chip.style.background = a.color ?? FALLBACK.color; row.appendChild(chip);   // 빌려 온 자리(a.from)는 집 팀 파일(code-review)
        const who = el('span', 'tcard__pwho');
        const nm = el('b', null, a.name ?? id); if (a.title) nm.appendChild(el('small', null, ` ${a.title}`)); who.appendChild(nm);
        const working = pp.state === 'working';
        const doing = pp.doing ? (pp.doing.tool ? toolPhrase(pp.doing, pp.busy) : firstLine(pp.doing.text)) : '완료 없음';
        who.appendChild(el('span', null, `${doing.slice(0, 48)}${doing.length > 48 ? '…' : ''} · ${moved(lastMove(pp))}`));
        row.appendChild(who);
        const st = WORK_PILL[pp.state] ?? WORK_PILL.waiting;
        row.appendChild(pill(st[0], st[1]));
        row.addEventListener('click', () => openPersonPop(t.id, id));
        card.appendChild(row);
      }
    }

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
    box.placeholder = office ? `${agents[t.owner ?? 'chief']?.name ?? '톰'}에게 말하기` : s.phase === 'blocked' ? '답변 시 회차 재개' : running ? `${agents.guide?.name ?? '팀장'}에게 말하기` : '이번 회차';
    box.addEventListener('input', () => { draft[t.id] = box.value; });

    const fail = (m) => { err.textContent = m; err.hidden = false; };

    const doSay = async () => {
      const text = box.value.trim();
      if (!text) return;
      err.hidden = true;
      box.value = ''; draft[t.id] = '';
      const r = await post('/api/say', { team: t.id, text });
      if (!r.ok) { box.value = text; draft[t.id] = text; fail(r.data.error ?? '전송 실패'); }
    };

    const doRound = async () => {
      err.hidden = true;
      if (running) {
        if (!confirm(`${t.name}팀 ${s.round}회차를 마무리해요.\n\n대화 기록은 그대로 남아요.`)) return;
        const r = await post('/api/round', { team: t.id, action: 'end' });
        if (!r.ok) fail(r.data.error ?? '종료 실패');
        else if (r.data.deferred) fail(`${agents.guide?.name ?? '팀장'}이 진행 중이에요. 이 말 끝나면 마무리할게요.`);
        else if (r.data.accepted) fail('종료 중 — 일지 수집');
        return;
      }
      const topic = box.value.trim();
      const r = await post('/api/round', { team: t.id, action: 'start', topic: topic || null });
      if (!r.ok) return fail(r.data.error ?? '시작하지 못했어요.');
      box.value = ''; draft[t.id] = '';
    };

    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      (office || running) ? doSay() : doRound();
    });

    const btn = el('button', 'tcard__r', running ? '회차 마무리' : '회차 시작');   // 사전 1절 "28회차 마무리"
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

/* ══ 대시보드 (결정 128) ══ */

let dashMark = '';

/** teams/hq/out/plan-table.md 를 그대로 — 톰이 파일로 관리한다. 읽기만, 여기서 안 고친다.
 * 표 문법만 안다(머리·구분줄·데이터줄) — 이 파일이 쓰는 것 이상은 필요 없다. */
function mdToDom(text) {
  const box = el('div');
  const lines = String(text ?? '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) { box.appendChild(el(h[1].length === 1 ? 'h1' : 'h2', null, h[2])); i++; continue; }
    if (line.startsWith('|') && /^\|[\s:-]+\|/.test(lines[i + 1] ?? '')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const table = el('table');
      const thead = el('tr'); for (const c of head) thead.appendChild(el('th', null, c)); table.appendChild(thead);
      i += 2;
      while (i < lines.length && lines[i].startsWith('|')) {
        // 칸마다 머리글을 data-label 로 — 폰(819 이하)에서는 표가 줄마다 카드로 서고 머리글이 칸 앞에 붙는다(나리 실측 R25: 칸 다섯이 412 에서 한 자씩 세로로). 헨리 '앞날 띠' 전까지의 임시.
        const tr = el('tr'); cells(lines[i]).forEach((c, k) => { const td = el('td', null, c); td.dataset.label = head[k] ?? ''; tr.appendChild(td); }); table.appendChild(tr); i++;
      }
      box.appendChild(table); continue;
    }
    if (line.trim()) box.appendChild(el('p', null, line.trim()));
    i++;
  }
  return box;
}

/* ── 앞날 띠 (헨리 시안 1판 dashboard.svg · 결정 128) — 줄 = 팀, 칸 = 단계, 왼쪽부터 지금 단계 → 다음.
 * 결정 188(대표 09-16 17:0x "모든 시간 관련된거 다 폐기해"): 시간 눈금(오늘·내일·모레·이번 주)·"{날}까지"·"예정 대비 N분 지연"·"회차 평균 90분 × N회차 → 내일" 은
 * 우리가 timebox 로 지어낸 앞날이라 뺐다. 남는 건 사실뿐 — 단계 번호·제목·상태(진행·막힘·대표 결정 후)·담당 점. 칸은 순서대로 같은 폭.
 * 서버(bus.timelineOf) 의 plannedFrom/To·late 는 화면이 안 읽는다 — 걷는 건 솔라 몫. 누르면 왜(펼친 줄).
 */
const DAY = 86_400_000;
const seoulDayStart = (ms) => Math.floor((ms + 9 * 3600_000) / DAY) * DAY - 9 * 3600_000;   // 계약의 dayStartSeoul 과 같은 식 — 리포트의 '오늘·어제' 날 이름(사실)에만 쓴다
function loadDashboardBand(r) {
  const band = $('dashBand'), gates = $('dashGates');
  band.replaceChildren(); gates.replaceChildren();
  // 첫 층 — 대표님이 시킨 일 다섯, 한 줄씩(사용성-0916 표 8, 하영 ahead-five.md 2판). 팀 띠는 그 밑 둘째 층. 줄이 하나도 없으면 층을 안 그린다.
  loadAheadFive(() => loadDashboard());
  document.getElementById('dashAhead')?.remove();
  if (ahead.lines.length) {
    const first = el('section', 'dash__card'); first.id = 'dashAhead'; first.dataset.block = 'ahead';
    first.appendChild(el('div', 'dash__k', '대표님이 시킨 일'));
    for (const a of ahead.lines) first.appendChild(el('div', 'card__text', a.text));
    band.parentElement.insertBefore(first, band);
  }
  const wide = window.innerWidth >= 1180;
  const BOX_W = wide ? 14 : 18;   // 칸 폭(%) — 시간이 아니라 순서. 넘치면 오른쪽 끝에 붙는다(아래).
  // 글자는 하영 화면 글 틀 1판(teams/marketing/out/screen-text-frames.md 1-2 · 1-4 · 6절)에서 날·시·분·늦음 줄만 뺀 것(결정 188).
  const stageNo = (s) => (s.n != null ? `${s.n}단계` : s.title);
  const shortTitle = (s) => String(s.title ?? '').split(/\s*(?:—|∥|\()\s*/)[0].trim();   // 폰 폭 — 첫 구분 기호 앞까지(1-1)
  const openWhy = (row, text) => { const why = row.querySelector('.band__why'); if (why) { why.remove(); return; } const w = el('div', 'band__why'); w.textContent = text; row.appendChild(w); };
  const whyOf = (t, s) => {
    if (s.status === 'gated') return `로드맵 조건 — "${s.gate}"`;
    if (s.status === 'blocked') return s.blockedWhy ?? '';
    return `${stageNo(s)} ${s.title}`;   // 날짜를 지어내지 않는다(결정 188)
  };
  for (const t of r.teams ?? []) {
    const row = el('div', 'band__row'); row.dataset.team = t.id;
    const label = el('div', 'band__team');
    label.appendChild(el('b', null, t.room ?? t.name));
    const nowStage = t.stages.find((s) => s.status === 'running' || s.status === 'blocked');
    label.appendChild(el('span', null, nowStage ? `${nowStage.n}단계 ${shortTitle(nowStage)}` : '단계 없음'));   // 사전 1절 125행 — 단계(마일스톤은 0-3 후보로만, 폴드 QA #14)
    row.appendChild(label);
    const lane = el('div', 'band__lane'); lane.style.setProperty('--team', t.color ?? 'var(--ink-4)');
    lane.style.setProperty('--seg', '100%');   // 칸 선 없음 — 눈금이 없다(결정 188)
    if (!t.stages.length) {   // 빈칸 말 둘(1-2) — 계획표 파일이 없다 / 있는데 남은 단계가 없다. 대표 문이 아니다 — 총괄실 계획표는 톰이, 경영 다음 단계는 노라가 적는다(T7)
      const g = el('button', 'band__box band__box--gated', t.hasRoadmap === false ? '로드맵 없음' : '다음 단계 없음'); g.type = 'button'; g.style.left = '0'; g.style.width = '48%';
      g.addEventListener('click', () => openWhy(row, '로드맵 등록 시 표시'));
      lane.appendChild(g);
    }
    let cursorPct = 0;
    const boxW = Math.max(BOX_W, Math.min(wide ? 24 : 32, Math.floor(96 / Math.max(1, t.stages.length)) - 1));   // 단계가 적으면 넓게 — 글자가 잘리지 않게
    for (const s of t.stages) {
      let left = cursorPct, width = boxW;   // 순서대로 같은 폭 — 시각으로 자리를 정하지 않는다(결정 188)
      if (left + width > 100) width = 100 - left;
      if (width < 6) { left = Math.max(0, 100 - 6); width = 6; }
      cursorPct = left + width + 1;
      const b = el('button', `band__box band__box--${s.status}`); b.type = 'button';
      // 점선 칸 "N단계 — 대표님이 정한 뒤"(대표 문) · "N단계 — {무엇} 뒤"(다른 팀·다른 일 뒤, T4). 빨간 칸 "N단계 — 막힘 (이유)". 채움 "N단계". 날·지연은 없다(결정 188)
      const text = s.status === 'gated' ? `${stageNo(s)} — ${s.gateWhat ?? '대표 결정 후'}` : s.status === 'blocked' ? `${stageNo(s)} — 막힘${s.blockedWhy ? ' (' + s.blockedWhy + ')' : ''}` : stageNo(s);
      b.textContent = text; b.title = `${s.n != null ? s.n + '단계 ' : ''}${s.title}`;
      b.style.left = `${left}%`; b.style.width = `${width}%`;
      b.addEventListener('click', () => openWhy(row, `${whyOf(t, s)} — 로드맵은 현황 팀 카드에`));
      lane.appendChild(b);
    }
    row.appendChild(lane);
    // 담당 점 둘(1-3, 결정 128 "누가") — 그 팀의 둘, 머리글자 · 직책 색. 서버 owners(cast 에서 다른 회사 뺀 둘, 팀장 먼저)
    const who = el('div', 'band__who');
    for (const o of t.owners ?? []) { const d = el('i', null, o.initial); d.style.background = o.color ?? 'var(--ink-4)'; d.title = o.name; who.appendChild(d); }
    row.appendChild(who);
    band.appendChild(row);
  }
  // gated 단계만 — 결재·상황판 대표 차례는 관제탑 '내 차례' 에 있다(같은 것을 두 군데 두지 않는다, 톰 req_2749e30e). 없으면 칸이 사라진다.
  // 머리 글자는 하영 사전 4절 "대표님이 여실 단계"(09-15 23:57 — 전엔 사전 밖 말 '대표 답이 있어야 열리는 단계' 였다, R26 어긋남 다섯 중 마지막).
  const bg = (r.bossGates ?? []).filter((g) => g.kind === 'stage');
  if (bg.length) {
    gates.appendChild(el('div', 'gates__k', `대표 결정 대기 ${bg.length}`));
    // 꼬리가 두 번("— 대표가 고른 뒤 — 대표가 고른 뒤", 폴드 QA #16 — 로드맵 제목에 이미 든 조건을 서버가 한 번 더 붙임) → 하나로
    for (const g of bg) { const c = el('div', 'gates__card'); c.appendChild(el('b', null, teams.find((t) => t.id === g.team)?.name ?? g.team)); c.append(' ' + String(g.what ?? '').replace(/( — [^—]+?)\s*\1$/, '$1')); gates.appendChild(c); }
  }
}

async function loadDashboard() {
  const r = await fetch('/api/dashboard').then((r) => r.json()).catch(() => null);
  const body = $('dashBody');
  const mark = r ? `${r.at ?? ''}|${(r.teams ?? []).map((t) => t.stages.map((s) => `${s.n}${s.status}${s.plannedTo}${s.late > 0}`).join(',')).join(';')}|${(r.bossGates ?? []).length}|${window.innerWidth >= 1180}` : '';
  if (dashMark === mark) return;   // 안 바뀌었으면 다시 안 그린다(펼친 줄이 닫히지 않게 — 다른 탭과 같은 습관)
  dashMark = mark;
  if (r?.teams) loadDashboardBand(r);
  // 아래층 '예정 작업 표 (톰)' — 톰 문서(plan-table.md) 원문을 통째로 붙이던 것은 뺐다(폴드 QA #17 못 씀: 대표 화면에 작업 문서 원문·옛 말 "관제탑·방·마을"). 위 띠가 그 표다. 줄기 × 작은 일 표(작업보드)는 34회차.
  body.replaceChildren();
}

/* ══ 보고서 — "어제 하루가 어땠나" (나리 정본 · 헨리 report 1판 · 결정 80·81, 새 7단계) ══
 * 창은 서버 기본(어제 18시 → 오늘 9시, 우리 시각). 절 다섯 + 한마디 — 낱말은 하영 5판 3-5-1(report 24~118). 절 이름은 경영 틀이 오면 그쪽(5판 3-5-5).
 * 정하실 것은 현황 ③ 과 같은 목록(blockedOf waitOn boss — 같은 것을 두 군데서 다르게 세지 않는다), 나머지는 /api/report 아래층. */
let reportMark = '', reportFetchedAt = 0;
const openReport = new Set();   // 펼친 팀 줄
async function loadReport({ force = false } = {}) {
  // /api/report 는 다섯 방 대화록을 훑는다 — 요약이 바뀔 때마다가 아니라 30초에 한 번(탭을 새로 열면 바로)
  if (!force && reportMark && Date.now() - reportFetchedAt < 30_000) return;
  reportFetchedAt = Date.now();
  const r = await fetch('/api/report').then((r) => r.json()).catch(() => null);
  const body = $('repBody');
  if (!r) { body.replaceChildren(el('p', 'tcard__quiet', '리포트 로딩 실패 — 서버 재시작 필요')); return; }
  const mark = `${r.since}|${r.until}|${(r.done ?? []).map((t) => t.items.length).join(',')}|${(r.blocked ?? []).length}|${(r.proxy ?? []).length}|${approvals.length}|${(r.chief ?? '').length}`;
  if (reportMark === mark) return;
  reportMark = mark;
  renderReport(r);
}
/** 날짜 머리 — "9월 15일 밤"(보고서 이름, 시계 아님 — 5판 3-5-1 report 24~26). 창의 끝 날 + 지금 때. */
const dayKo = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
/** 창 한 줄 — "어제 저녁 6시 → 오늘 아침 9시". 오늘·어제가 아니면 날짜로. */
function windowKo(since, until) {
  const d0 = seoulDayStart(Date.now());
  const day = (t) => (seoulDayStart(t) === d0 ? '오늘' : seoulDayStart(t) === d0 - 86_400_000 ? '어제' : dayKo(t));
  return `${day(Date.parse(since))} ${whenKo(since)} → ${day(Date.parse(until))} ${whenKo(until)}`;
}
function renderReport(r) {
  const body = $('repBody');
  body.replaceChildren();
  const since = Date.parse(r.since), until = Date.parse(r.until), now = Date.now();
  $('repDate').textContent = `${dayKo(until)} ${whenKo(now).split(' ')[0]}`;
  $('repWindow').textContent = `${windowKo(r.since, r.until)} · 톰이 쓰고, 세라가 대표님 말로 고치고, 나리가 숫자를 맞춰 봤어요`;
  const teamOf = (id) => (r.teams ?? []).find((t) => t.id === id) ?? teams.find((t) => t.id === id) ?? { id, name: id };
  const colorOf = (id) => teamOf(id).color ?? teamColor(id);

  // ① 오늘 정하실 것 N — 현황 ③ 과 같은 목록(결재 C · 대표님께 물어봄 · 멈춤 + 상황판 '대표님이 보실 것'). 없으면 칸이 사라진다
  const pendingAll = approvals.map((a) => ({ id: a.id, grade: a.grade, team: a.team, by: a.by, what: a.what, ts: a.requestedAt ?? a.ts }));
  const mine = blockedOf({ teams, summaries, approvals: pendingAll, requests: requestsAll.filter((q) => q.status !== 'closed'), infra }, { now, pauses }).filter((it) => it.waitOn === 'boss');
  const fromBoard = teams.flatMap((t) => (summaries[t.id]?.progress?.boss ?? []).map((text) => ({ team: t.id, teamName: t.name, text })));
  if (mine.length || fromBoard.length) {
    const sec = el('section', 'dash__card rep__sec'); sec.dataset.block = 'mine'; sec.dataset.alert = '1';
    sec.appendChild(el('div', 'dash__k', `승인 필요 ${mine.length + fromBoard.length}`));
    for (const it of mine) {
      const row = el('button', 'dash__row'); row.type = 'button';
      row.appendChild(el('b', null, `${it.teamName}${it.name ? ' · ' + it.name : ''} · ${it.kind === 'approval' ? '승인 필요' : it.kind === 'boss' ? '답변 필요' : '검토 필요'}`));
      putLine(row, it.text, 'dash__sub', it.team);   // 대표 몫은 행은 남기고(누를 수 있어야) 글만 — 없으면 머리 한 줄(opus ④)
      row.appendChild(el('span', 'dash__go', it.kind === 'approval' ? '확인' : '채팅 열기'));
      row.addEventListener('click', () => { const tg = it.target ?? {}; if (it.kind === 'approval') { const a = approvals.find((x) => x.id === (tg.approval ?? String(it.id).split(':')[1])); if (a) openApprovalPop(a); } else jumpTo(tg.team ?? it.team, tg.event ?? null); });
      sec.appendChild(row);
    }
    for (const b of fromBoard) { const row = el('button', 'dash__row'); row.type = 'button'; if (!startsWithTeam(b.text, b.teamName)) row.appendChild(el('b', null, b.teamName)); if (!putLine(row, b.text, 'dash__sub', b.team)) continue; row.addEventListener('click', () => jumpTo(b.team, null)); sec.appendChild(row); }   // 머리는 팀 이름 한 번, 줄이 팀 이름으로 시작하면 머리 없음(폴드 QA #4) · 낼 글 없으면 행 없음(opus ④)
    body.appendChild(sec);
  }

  // ② 톰·제리가 대표님 대신 정했어요 — 창 안의 대리 결정(note meta.proxy). 되돌리시려면 방에 한마디(결정 85 ③)
  // 두 블록으로 가른다(나리 16:3x): 대표님이 직접 찍으신 C 카드(p.by === 'boss', 솔라 58a62fa) 는 "대표님이 정하신 것", 나머지(system·chief 대리)는 "대리 결정 — 되돌리기는 답하기"
  if ((r.proxy ?? []).length) {
    const groups = [
      { key: 'boss', title: '대표님이 정하신 것', items: (r.proxy ?? []).filter((p) => p.by === 'boss') },
      { key: 'proxy', title: '대리 결정 — 되돌리기는 답하기', items: (r.proxy ?? []).filter((p) => p.by !== 'boss') },
    ];
    for (const g of groups) {
      if (!g.items.length) continue;
      const sec = el('section', 'dash__card rep__sec'); sec.dataset.block = g.key;
      sec.appendChild(el('div', 'dash__k', g.title));
      for (const p of g.items) {
        const row = el('button', 'dash__row'); row.type = 'button';
        row.appendChild(el('b', null, `${teamOf(p.team).name} · ${whenKo(p.ts)}`));
        // 사람 말 한 줄(p.boss — --boss·--boss-line)이 있으면 그것, 없으면 머리말을 뗀 원문 → 자에 안 맞으면 행 없음("요약 없음" 대신, opus ④)
        if (!putLine(row, bossOk(p.boss) ? p.boss : String(p.text).replace(/^대리 결정[^—:]*[—:]\s*/, ''), 'dash__sub', p.team)) continue;
        row.appendChild(el('span', 'dash__go', '채팅 열기'));
        row.addEventListener('click', () => jumpTo(p.team, p.id));
        sec.appendChild(row);
      }
      if (sec.querySelector('.dash__row')) body.appendChild(sec);   // 다 걸리면 블록 자체를 안 그림
    }
  }

  // ③ 막힌 것 N · 한 것은 점, 멈춤은 빨간 띠 — 팀마다 시간 띠 한 줄(창 = 띠 가로), 그 밑에 멈춘 구간 하나씩(5판 3-5-3 ⑫: '멈춘 것' 이 아니라 '막힌 것' — 막힌 것 = 일)
  const spans = r.blocked ?? [];
  const sec3 = el('section', 'dash__card rep__sec'); sec3.dataset.block = 'band';
  sec3.appendChild(el('div', 'dash__k', `이슈 ${spans.length} · 점 = 완료, 빨간 띠 = 중단`));
  const axis = el('div', 'rep__axis'); axis.append(el('span', null, whenKo(since)), el('span', null, whenKo(until))); sec3.appendChild(axis);
  const bands = el('div', 'bands');
  for (const t of (r.teams ?? [])) {
    const line = el('div', 'bands__row');
    const lab = el('span', 'bands__who'); const d = el('span', 'dot'); d.style.background = colorOf(t.id); lab.appendChild(d); lab.append(t.room ?? t.name); line.appendChild(lab);
    const items = (r.done ?? []).find((x) => x.team === t.id)?.items ?? [];
    const marks = items.map((it) => ({ at: Date.parse(it.ts), color: colorOf(t.id), title: `${it.name ?? t.name} · ${it.text} · ${whenKo(it.ts)}` }));
    const sp = spans.filter((s) => s.team === t.id).map((s) => ({ from: Math.max(since, Date.parse(s.from)), to: s.to ? Math.min(until, Date.parse(s.to)) : until }));
    line.appendChild(timeBand(since, until, marks, sp));
    bands.appendChild(line);
  }
  sec3.appendChild(bands);
  sec3.appendChild(el('div', 'rep__legend', '점 = 완료 1건 · 빨간 띠 = 중단 시간 · 색 = 팀'));
  // 창이 통째로(또는 거의) 쉰 시간이면 막힌 것이 아니라 쉰 것 — 한 줄로(나리 09-15: 멈춘 하루가 '네 팀이 밤새 막혔다' 로 읽혔다). 서버도 그 구간은 띠에서 잘라냈다
  const rested = pausedMs(since, until, pauses);
  if (rested > 0) {
    const msOf = (v) => (typeof v === 'number' ? v : Date.parse(v));   // boot.pauses 는 ms
    const p = pauses.find((pz) => msOf(pz.to) > since && msOf(pz.from) < until);
    const whole = rested >= (until - since) * 0.95;
    sec3.appendChild(el('div', 'rep__rest', `${whole ? '이 구간은 중단' : `${forShort(rested).replace(/째$/, '')} 중단`} — ${p ? `${whenKo(p.from)} → ${whenKo(p.to)}${p.why ? ' · ' + String(p.why).split('(')[0].trim() : ''}` : ''}`));
  }
  for (const s of spans) {
    const row = el('button', 'dash__row rep__stuck'); row.type = 'button';
    const head = el('span', 'dash__head'); head.appendChild(el('i', 'dot dot--bad')); head.appendChild(el('b', null, `${s.teamName}${s.name ? ' · ' + s.name : ''} — ${s.text}`)); row.appendChild(head);
    const to = s.to ? Date.parse(s.to) : now;
    row.appendChild(el('span', 'dash__sub', `${whenKo(s.from)} → ${s.to ? whenKo(s.to) : '아직'}${s.to ? ' · 현재 재개' : ''}`));
    const w = el('span', 'wait'); w.appendChild(el('i', 'dot dot--bad')); w.append(forShort(Math.max(0, to - Date.parse(s.from) - pausedMs(s.from, to, pauses))).replace(/째$/, '')); row.appendChild(w);
    row.addEventListener('click', () => jumpTo(s.team, s.ref ?? null));
    sec3.appendChild(row);
  }
  body.appendChild(sec3);

  // ④ 팀마다 한 것 — 누르면 세 줄(한 것 · 막힌 것 · 검토 결과). 줄 = 팀 · N단계 제목 · N회차 · 진행 막대 N/M · 한 줄 · 그림
  const sec4 = el('section', 'dash__card rep__sec'); sec4.dataset.block = 'teams';
  sec4.appendChild(el('div', 'dash__k', '팀별 완료'));
  for (const t of (r.teams ?? [])) {
    const items = (r.done ?? []).find((x) => x.team === t.id)?.items ?? [];
    const made = items.filter((it) => it.kind !== 'verdict' && it.kind !== 'decision');
    const verdicts = items.filter((it) => it.kind === 'verdict');
    const imgs = (r.images ?? []).filter((im) => im.team === t.id).slice(0, 3);
    const row = el('button', 'dash__row rep__team'); row.type = 'button';
    const head = el('span', 'dash__head');
    const d = el('span', 'dot'); d.style.background = colorOf(t.id); head.appendChild(d);
    head.appendChild(el('b', null, t.room ?? t.name));
    head.appendChild(el('span', 'dash__stage', t.milestone ? `${t.milestone}단계 ${t.milestoneTitle ?? ''}`.slice(0, 22) + (t.round ? ` · ${t.round}회차` : '') : '단계 없음'));
    if (!t.office && t.total) { head.appendChild(progressBar(t.done, t.total, colorOf(t.id))); head.appendChild(el('span', 'bars__n', `${t.done}/${t.total}`)); }
    row.appendChild(head);
    row.appendChild(el('span', 'dash__sub', made.length ? made.slice(0, 2).map((it) => it.text.replace(/^(커밋|산출물) — /, '')).join(' · ') : '완료 없음'));
    if (imgs.length) { const th = el('span', 'rep__thumbs'); for (const im of imgs) { const img = el('img', 'rep__thumb'); img.src = im.url; img.alt = im.name; img.loading = 'lazy'; th.appendChild(img); } row.appendChild(th); }
    row.addEventListener('click', () => { if (openReport.has(t.id)) openReport.delete(t.id); else openReport.add(t.id); renderReport(r); });
    sec4.appendChild(row);
    if (openReport.has(t.id)) {
      const box = el('div', 'dash__open');
      const three = [
        ['한 것', made.length ? made.map((it) => it.text).join(' · ') : '없어요'],
        ['이슈', spans.filter((s) => s.team === t.id).map((s) => s.text).join(' · ') || '없어요'],
        ['검토 결과', verdicts.length ? verdicts.map((it) => `${it.text.split(' — ')[0]}(${it.name ?? it.by})`).join(' · ') : '없어요'],
      ];
      for (const [k, v] of three) { const kv = el('div', 'dash__kv'); kv.appendChild(el('b', null, `${k} —`)); kv.appendChild(el('span', null, v)); box.appendChild(kv); }
      sec4.appendChild(box);
    }
  }
  body.appendChild(sec4);

  // ⑤ 오늘 — 각 방이 먼저 할 일: 상황판 '다음' 첫 줄, 실무 이름으로
  const nexts = (r.teams ?? []).map((t) => ({ t, line: (r.next?.[t.id] ?? [])[0] })).filter((x) => x.line);
  if (nexts.length) {
    const sec5 = el('section', 'dash__card rep__sec'); sec5.dataset.block = 'next';
    sec5.appendChild(el('div', 'dash__k', '오늘 할 일'));
    for (const { t, line } of nexts) {
      const row = el('button', 'dash__row'); row.type = 'button';
      const head = el('span', 'dash__head'); const d = el('span', 'dot'); d.style.background = colorOf(t.id); head.appendChild(d); head.appendChild(el('b', null, t.guide ?? t.name)); row.appendChild(head);
      row.appendChild(el('span', 'dash__sub', line));
      row.addEventListener('click', () => jumpTo(t.id, null));
      sec5.appendChild(row);
    }
    body.appendChild(sec5);
  }

  // 한마디 — 사람 글(teams/hq/out/daily/<날짜>.md)이 있는 날만: 첫 머리 밑 첫 문단, 꼬리 "— 톰". 전부는 문(파일)
  if (r.chief) {
    const paras = String(r.chief).split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#'));
    const first = paras[0] ?? '';
    if (first) {
      const q = el('div', 'rep__word');
      q.append(first.replace(/\*\*/g, '').slice(0, 240));
      q.appendChild(el('span', 'rep__by', ' — 톰'));
      if (r.chiefFile) { const a = el('a', 'rep__more', '전체'); a.href = `/out/${r.chiefFile}`; a.target = '_blank'; a.rel = 'noopener'; q.appendChild(a); }
      body.appendChild(q);
    }
  }
}

/* ══ 분석 ══ */

let anMark = '';

/* ── 분석 = "왜 자꾸 이렇게 되나" — 헨리 분석 1판(analysis.svg, 09-16) · 하영 화면 글 틀 1판 3절 · 나리 정본 41~44행. 9단계 ③.
 * 다섯 팀을 같은 자로, 칸 셋 — ① 어디서 자꾸 막히나(틀 ㄴ: 돌려보낸 결재 — {팀} a건 중 b, 팀마다 같은 자 띠, 튀는 팀만 빨강) ② 무엇이 느려졌나(틀 ㄱ: 회차 길이 — 지난 → 이번, 위·아래 색)
 * ③ 같은 일이 몇 번째인가(틀 ㄷ: 회차 네모를 같은 자리에 겹침, 세 번째부터 빨강). 숫자는 늘 둘이 나란히 — 옛 타일(끝난 회차 N · 통과 N · 대화 기록 N)은 자기 통계·하나짜리라 안 온다(나리 R29 실측 ①③).
 * 세 겹: 그림 + 문장 → 누르면 그 자리에서 펼친 줄(어느 카드·어느 회차) → 결재 카드 / 방. 값은 /api/analysis?all=1 — 서버(bus.stuckOf·slowedOf·repeatsOf 순수)가 approvals·rounds·pauses 에서 센다. ── */
async function loadAnalysis() {
  const mark = teams.map((t) => `${summaries[t.id]?.round}:${summaries[t.id]?.phase}`).join('|') + `|${approvals.length}`;
  anMark = mark;
  const r = await fetch('/api/analysis?all=1').then((x) => x.json()).catch(() => null);
  if (!r || r.error) return;
  renderAnalysis(r);
}
const nthWord = (n) => { const w = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'][n]; return w ? `${w} 회째` : `${n}회째`; };   // 열까지는 말로(시안 "세 번째"), 그 뒤는 "18번째"
/** 회차 네모를 같은 자리에 겹친다(numbers ③ · 시안 ③) — 세 번째부터 빨강. 네모 수 = 값(나리 R29: 열둘에서 자르니 18·13·11 계단이 같은 높이였다) — 마흔 넘으면 마지막에 … */
function stackBoxes(n) {
  const shown = Math.min(n, 40);
  const s = el('span', 'an__stack'); s.style.setProperty('--n', String(shown)); s.title = `${n}번`;
  for (let i = 0; i < shown; i++) { const b = el('i'); b.style.setProperty('--i', String(i)); if (i >= 2) b.dataset.k = 'bad'; s.appendChild(b); }
  if (n > shown) s.appendChild(el('b', null, '…'));
  return s;
}
function anCard(head) { const c = el('section', 'an__card'); c.appendChild(el('div', 'dash__k', head)); return c; }
const anOpen = new Set();   // 펼친 줄 — "칸:열쇠"
function anRow(key, node, whyLines) {
  const row = el('button', 'an__row'); row.type = 'button'; row.dataset.open = anOpen.has(key) ? '1' : '0';
  row.appendChild(node);
  row.addEventListener('click', () => { if (anOpen.has(key)) anOpen.delete(key); else anOpen.add(key); loadAnalysis(); });
  const wrap = el('div', 'an__rowwrap'); wrap.appendChild(row);
  if (anOpen.has(key) && whyLines?.length) { const w = el('div', 'an__why'); for (const l of whyLines) w.appendChild(l); wrap.appendChild(w); }
  return wrap;
}
/** 결재 카드 문 — 대기 중이면 카드 팝업, 아니면 그 방으로(카드는 관제탑 결재 줄에만 산다). */
function cardLine(teamId, id, what, ts) {
  const b = el('button', 'an__line'); b.type = 'button';
  b.textContent = `${id} · ${String(what ?? '').slice(0, 60)}${ts ? ` · ${timeWord(ts, Date.now())}` : ''}`;
  b.addEventListener('click', async () => { const r = approvals.find((a) => a.id === id); if (r) openApprovalPop(r); else { await selectTeam(teamId); setView('room'); } });
  return b;
}

function renderAnalysis(r) {
  const body = $('anBody');
  body.replaceChildren();
  const now = Date.parse(r.now ?? '') || Date.now();
  const teamOf = (id) => teams.find((t) => t.id === id);
  const nameOf = (id) => { const t = teamOf(id); return t ? roomWord(t) : id; };

  // ① 어디서 자꾸 막히나 — 돌려보낸 결재: {팀} a건 중 b(다섯 팀 다, 같은 순서). 팀마다 같은 자(1건 = 같은 길이) — 옅은 띠 = 올린 결재, 짙은 띠 = 돌려보낸 것, 튀는 팀만 빨강(numbers ⑥)
  const c1 = anCard('반복 이슈');
  const stuck = r.stuck ?? [];
  const maxTotal = Math.max(1, ...stuck.map((s) => s.total));
  const sent = el('div', 'an__sentence');
  sent.append('반려 — ');
  stuck.forEach((s, i) => { const t = el('span', null, `${nameOf(s.team)} ${s.total}건 중 ${s.count}`); if (s.worst) t.dataset.k = 'bad'; sent.appendChild(t); if (i < stuck.length - 1) sent.append(' · '); });
  c1.appendChild(sent);
  for (const s of stuck) {
    const line = el('span', 'an__bandrow');
    const nm = el('span', 'an__team', nameOf(s.team)); if (s.worst) nm.dataset.k = 'bad'; line.appendChild(nm);
    const band = el('span', 'an__band');
    const all = el('i', 'an__band--all'); all.style.width = `${Math.round((s.total / maxTotal) * 100)}%`; all.style.background = teamColor(s.team); band.appendChild(all);
    const cnt = el('i', 'an__band--sent'); cnt.style.width = `${Math.round((s.count / maxTotal) * 100)}%`; cnt.style.background = s.worst ? 'var(--bad)' : teamColor(s.team); band.appendChild(cnt);
    line.appendChild(band);
    const m = el('span', 'an__m', `${s.total}건 중 ${s.count}`); if (s.worst) m.dataset.k = 'bad'; line.appendChild(m);
    c1.appendChild(anRow(`stuck:${s.team}`, line, s.ids.map((c) => cardLine(s.team, c.id, c.what, c.ts))));
  }
  body.appendChild(c1);

  // ② 무엇이 느려졌나 — 회차 길이: 지난 회차 → 이번 회차. 제일 나빠진 팀(빨강)과 제일 좋아진 팀(초록) — 시안은 둘. 지난 = 회색, 이번 = 위·아래 색, 같은 자
  const c2 = anCard('지연');
  const slowed = r.slowed ?? [];
  const picks = [];
  const worse = slowed.find((s) => s.dir === 'bad'), better = [...slowed].reverse().find((s) => s.dir === 'good');
  if (worse) picks.push(worse); if (better && better !== worse) picks.push(better);
  if (!picks.length && slowed[0]) picks.push(slowed[0]);
  if (!picks.length) c2.appendChild(el('div', 'panel__note', '비교 대상 없음 — 회차 2개 필요'));
  const maxMs = Math.max(1, ...picks.flatMap((s) => [s.prev, s.cur]));
  for (const s of picks) {
    const box = el('span', 'an__pair');
    const text = el('span', 'an__sentence', `${nameOf(s.team)} 회차 길이 — 지난 ${spanWord(s.prev)} → 이번 ${spanWord(s.cur)}`); text.dataset.k = s.dir; box.appendChild(text);
    for (const [label, ms, k] of [['지난', s.prev, 'same'], ['이번', s.cur, s.dir]]) {
      const l = el('span', 'an__bar'); l.appendChild(el('span', 'an__m', label));
      const bar = el('i'); bar.style.width = `${Math.max(2, Math.round((ms / maxMs) * 100))}%`; bar.dataset.k = k; l.appendChild(bar); box.appendChild(l);
    }
    if (s.pausedMs > 0) box.appendChild(el('span', 'an__note', `중단 ${spanWord(s.pausedMs)} 제외`));
    const why = [el('span', 'an__line', `${s.prevRound}회차 → ${s.curRound}회차 · 이번 회차 ${timeWord(s.curStartedAt, now)} 시작`)];
    c2.appendChild(anRow(`slowed:${s.team}`, box, why));
  }
  body.appendChild(c2);

  // ③ 같은 일이 몇 번째인가 — 같은 카드를 다시 올린 것 · 같은 단계를 여러 회차 돈 것. 회차 네모를 같은 자리에 겹침 — 세 번째부터 빨강(반박 세 번 = FAIL 과 같은 자). 많은 것 셋
  const c3 = anCard('반복 횟수');
  const repeats = (r.repeats ?? []).slice(0, 3);
  if (!repeats.length) c3.appendChild(el('div', 'panel__note', '반복 없음'));
  for (const p of repeats) {
    const box = el('span', 'an__rep');
    box.appendChild(stackBoxes(p.nth));
    // 회차가 이어지면 "13회차부터 20회차", 사이가 비면 "2회차부터 20회차 사이 18회차에 걸쳐"(나리 R29 — 개발 1단계는 9회차가 2단계였다, 이어진 것처럼 읽히면 열아홉으로 센다)
    const first = p.at[0], last = p.at[p.at.length - 1];
    const contiguous = p.kind === 'round' && last - first + 1 === p.at.length;
    const where = p.kind === 'card' ? p.at.map((ts) => clockWord(ts)).join(' · ') : contiguous ? `${first}~${last}회차` : `${first}회차부터 ${last}회차 사이 ${p.at.length}회차에 걸쳐`;
    const text = el('span', 'an__sentence', `${nameOf(p.team)} ${p.what} — ${where}, ${nthWord(p.nth)}${p.passed ? ' 승인' : ''}`);
    if (p.nth >= 3) text.dataset.k = 'bad';
    box.appendChild(text);
    const why = p.kind === 'card' ? p.ids.map((id, i) => cardLine(p.team, id, p.what, p.at[i])) : [el('span', 'an__line', `${p.at.map((n) => `${n}회차`).join(' · ')}`)];
    c3.appendChild(anRow(`rep:${p.team}:${p.what}`, box, why));
  }
  body.appendChild(c3);
}

/* ── 시작 ── */

const boot = await fetch('/api/boot').then((r) => r.json());
teams = boot.teams;
summaries = boot.summaries ?? {};
approvals = boot.approvals ?? [];
told = boot.told ?? {};
grades = boot.grades ?? {};
infra = boot.infra ?? null;
pauses = boot.pauses ?? [];
delegation = boot.delegation ?? null;
castOptions = boot.castOptions ?? {};
for (const t of teams) unread[t.id] = 0;
pendingMark = Object.values(summaries).reduce((n, s) => n + (s.approvals?.pending ?? 0), 0);
connect();

const [hashTeam, hashView] = location.hash.slice(1).split('/');
await selectTeam(teams.some((t) => t.id === hashTeam) ? hashTeam : boot.defaultTeam);
renderApprovals();
// 부팅 — 주소에 화면이 없으면 **현황 한 장**(관제탑 '전체' 탭 — 누르실 것·고르실 것·이 회차 된 것)이 첫 화면, 방은 두 번째(나리 usability-0916 U2:
// 총괄실 대화 벽이 첫 화면이라 대표가 30초 안에 할 일을 못 봤다, 결정 92). 전엔 대표 차례가 있을 때만 관제탑이었다(G-UX). 보던 방으로 돌아오는 건 주소(#팀/room)가 한다.
if (hashView == null) towerTab = 'all';
setView(hashView ?? 'tower');
