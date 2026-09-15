// 자리별 상주 세션.
//
// 방의 모든 자리(실무·내부감사·운영·총괄)가 자기 claude 프로세스를 갖는다. 서브에이전트가 아니다 —
// 부르는 사람이 없어도 존재하고, 사회자(server/conductor.mjs)가 차례를 주면 말한다. 외부감사(codex)만
// bus/outside.mjs 가 턴마다 띄운다. 이렇게 바꾼 이유는 대표의 말이다: "실제 참여자로 하기로 했잖아",
// "서로 대화 안 하는데?" — 서브에이전트는 부를 때만 태어나 답을 돌려주고 죽는다. 방을 못 듣고 서로 못 부른다.
//
// 인격은 --append-system-prompt 로 각자 붙는다. CLAUDE.md 하나를 공유해도 동화되지 않는다 (영상 ①이 계정을
// 나눈 이유가 이것이었다). 프로세스마다 PPANAM_TEAM 과 PPANAM_ACTOR 가 들어가고, 훅은 그 값으로 화자를 정한다.
//
// 기록은 하지 않는다. 훅이 한다. 여기서 stdout 에서 읽는 것은 세션 id, "지금 일하는 중인가", 그리고
// 답을 기다리는 턴(일지)의 결과뿐이다.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawn as spawnProc } from 'node:child_process';
import {
  ROOT, emit, listTeams, isOffice, paths, endRound, startRound, readCast, readState, readRoadmap, listRounds,
  readLog, quiet, RELAY_QUIET, appendJournal, journalPrompt, collectJournals, writeTurn, readProgress, progressFresh, progressText,
  isForeign, engineName, roomRules, listApprovals, takeVillage,
} from '../bus/bus.mjs';
import { listRequests } from '../bus/requests.mjs';
import { toolPhrase } from './public/toollabel.js';
// 대화 기록은 훅이 한다(위 주석) — 이건 다른 층이다. usage·total_cost_usd 는 stdout 의 result 메시지에만
// 실려 오고 훅은 그 원시 스트림을 못 본다. 그래서 여기서만 뜰 수 있는 토큰 장부(T1, 대표 09-16 "톰 역할
// 토큰을 걱정했는데 지금은 잴 수가 없다").
import { recordUsage } from './usage.mjs';

const STORE = path.join(ROOT, 'state', 'sessions.json');

/**
 * 이 시간 동안 아무 신호(스트림 이벤트 — 도구 호출·출력)가 없으면 죽은 것으로 본다.
 * 턴 시작부터 재던 때는 15분 넘게 편집 중이던 테라를 "응답하지 않아" 로 잘랐다 (R13, 2026-09-13 03:52).
 * 일하는 중이면 이벤트가 계속 오므로 타이머는 마지막 이벤트에서 다시 잰다 — 진짜 무응답만 죽는다 (대표 결정 17).
 */
const TURN_TIMEOUT = Number(process.env.PPANAM_TURN_TIMEOUT || 15 * 60_000);
/** 조립한 시스템 프롬프트의 상한(문자). 넘으면 일지부터 줄인다 — 다 기억시키면 느려지고 나빠진다. */
const PROMPT_CAP = Number(process.env.PPANAM_PROMPT_CAP || 12_000);
/** 세션이 뜰 때 붙이는 일지 문단 수. */
const JOURNAL_PARAS = Number(process.env.PPANAM_JOURNAL_PARAS || 5);
/** 라운드가 끝날 때 일지 한 문단을 기다리는 시간. */
const JOURNAL_TIMEOUT = Number(process.env.PPANAM_JOURNAL_TIMEOUT || 3 * 60_000);

/**
 * --bare 를 쓰지 않는다. 훅을 아예 로드하지 않아 아무것도 기록되지 않는다.
 * --verbose 는 --output-format stream-json 이 요구한다 (없으면 기동 자체가 거부된다).
 */
const ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--forward-subagent-text',
];

const sessions = new Map();   // "team:actor" → session
const closing = new Map();    // team → { verdict, summary } — 이 방의 모든 자리가 놀면 닫는다
const closingNow = new Set();  // closeRound 가 도는 중인 방 — 일지를 받는 동안 새 지시를 받지 않는다

/** 이 방이 닫히는 중인가. 그동안 온 지시는 거절한다 — 받아놓고 reset 으로 지우면 성공처럼 보이는 유실이다 (레오 감사). */
export const isClosing = (team) => closing.has(team) || closingNow.has(team);
const turnEndListeners = [];  // (team, actor) → void — 사회자가 다음 차례를 주려고 듣는다

/** 어느 자리의 턴이 끝나면 부른다. 사회자가 쌓인 차례를 그때 준다. */
export function onTurnEnd(fn) { turnEndListeners.push(fn); }

const keyOf = (team, actor) => `${team}:${actor}`;

/** 방 주인 — 작전실이면 실무, 총괄실이면 총괄, 비서실이면 세라(teams.json 의 owner, 결정 132). 대표의 지시가 먼저 가는 자리. */
export const ownerOf = (team) => roomRules(team).owner;

/** 이 방에서 claude 세션을 갖는 자리. outside(codex)·boss·system 은 아니다. */
export function claudeActors(team) {
  const agents = readCast(team).agents ?? {};
  return Object.keys(agents).filter((a) => agents[a]?.model === 'claude');
}

/* ── 세션 id 보관 ── */

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}
function writeStore(all) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}
/** 예전 형식({팀: id})은 그 방 주인의 것이다. */
function storedId(team, actor) {
  const all = readStore();
  return all[keyOf(team, actor)] ?? (actor === ownerOf(team) ? all[team] : null) ?? null;
}
function rememberId(team, actor, id) {
  const all = readStore();
  if (all[keyOf(team, actor)] === id) return;
  all[keyOf(team, actor)] = id;
  delete all[team];
  writeStore(all);
}
function forgetId(team, actor) {
  const all = readStore();
  let changed = false;
  if (keyOf(team, actor) in all) { delete all[keyOf(team, actor)]; changed = true; }
  if (actor === ownerOf(team) && team in all) { delete all[team]; changed = true; }
  if (changed) writeStore(all);
}

/* ── 인격 조립 ── */

/**
 * 인격 파일. teams/<팀>/<자리>.md — 없으면 공용 .claude/agents/<자리>.md 의 본문(frontmatter 제거).
 * 실무·총괄은 서브에이전트가 아니라 frontmatter 가 없고, 내부감사·운영도 이제 같다.
 */
export function personaOf(team, actor) {
  try { const s = fs.readFileSync(path.join(paths(team).dir, `${actor}.md`), 'utf8').trim(); if (s) return s; } catch { /* 없다 */ }
  try {
    const s = fs.readFileSync(path.join(ROOT, '.claude', 'agents', `${actor}.md`), 'utf8');
    return s.replace(/^---[\s\S]*?\n---\n/, '').trim() || null;
  } catch { return null; }
}

/**
 * 확정 조항의 해석 부분. teams/<팀>/decisions.md 는 대표 원문과 해석을 분리해 둔다 — 붙이는 것은 해석이다.
 * 원문까지 매번 실으면 크기가 돌아온다(out/m2-memory.md). 원문은 파일에 있고 필요할 때 읽는다.
 */
function decisionsOf(team) {
  let s;
  try { s = fs.readFileSync(path.join(paths(team).dir, 'decisions.md'), 'utf8'); } catch { return null; }
  const out = [];
  for (const part of s.split(/\n(?=## )/).slice(1)) {
    const title = part.split('\n')[0].replace(/^## /, '').trim();
    const m = /\*\*해석\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*대표 원문\*\*|$)/.exec(part);
    if (m) out.push(`- ${title}: ${m[1].trim().replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  return out.length ? out.join('\n') : null;
}

/** 일지의 최근 문단들. teams/<팀>/journal/<자리>.md — 최신이 맨 위다. 없으면 null. */
export function journalOf(team, actor, n = JOURNAL_PARAS) {
  let s;
  try { s = fs.readFileSync(path.join(paths(team).dir, 'journal', `${actor}.md`), 'utf8'); } catch { return null; }
  const paras = s.split(/\n(?=## )/).map((p) => p.trim()).filter((p) => p.startsWith('## '));
  if (!paras.length) return null;
  return { text: paras.slice(0, n).join('\n\n'), total: paras.length };
}

/**
 * 일지 맨 위 문단의 첫 문장 — 마을 카드의 "어제 한 줄"(결정 13). 일지 지시문이 첫 문장을 "나는 …" 으로 시키므로 그 자리의
 * 오늘 마음가짐이 한 줄로 온다. 머리(## …)를 떼고, 공백이 따라오는 마침표·물음표·느낌표에서 자른다 — `bus/outside.mjs` 의
 * 점이나 `2.6초` 는 안 자른다. 없으면 null. 관제탑 개인 카드(M2)도 이걸 쓴다.
 */
const journalFirstCache = new Map();   // file → { size, mtimeMs, value }
export function journalFirstSentence(team, actor) {
  // 요약(summaryOf)이 250ms 마다 열다섯 자리를 묻는다 — 파일이 안 바뀌었으면 지난 답이다.
  const file = path.join(paths(team).dir, 'journal', `${actor}.md`);
  let st;
  try { st = fs.statSync(file); } catch { journalFirstCache.delete(file); return null; }
  const hit = journalFirstCache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.value;
  const j = journalOf(team, actor, 1);
  let value = null;
  if (j) {
    const body = j.text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
    const m = body ? /^[\s\S]*?[.!?。](?=\s|$)/.exec(body) : null;
    value = body ? (m ? m[0] : body).trim().slice(0, 200) : null;
  }
  journalFirstCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, value });
  return value;
}

/**
 * 마을의 캐릭터 카드가 보여줄 만큼만 — 인격 파일의 첫 줄(누구인가)과 "## 너라는 사람"(codex 는 "당신이라는 사람") 절.
 * 감사 기준·절차는 싣지 않는다. 카드는 사람을 보여주는 것이지 매뉴얼이 아니다.
 */
export function personaCard(team, actor) {
  const src = personaOf(team, actor);
  if (!src) return null;
  const body = src.replace(/^---[\s\S]*?\n---\n/, '');
  const title = (/^# (.+)$/m.exec(body)?.[1] ?? '').trim();
  const identity = (/^(?:너는|당신은) [^\n]+$/m.exec(body)?.[0] ?? '').replace(/\*\*/g, '').trim();
  const sec = /\n## (?:너|당신)(?:이)?라는 사람\n([\s\S]*?)(?=\n## |$)/.exec(body);
  const who = sec ? sec[1].trim() : null;
  return { title, identity, who };
}

/**
 * 책장 (결정 116 ① — teams/hq/out/점검-0916.md 3-2 "배선 0" 지적). teams/<팀>/shelf.md — "읽을 것 3~5개(경로)
 * + 안 읽을 것" 목록. 대화록을 통째로 붓는 대신 이 절이 경로를 손가락으로 가리킨다. 팀마다 다르고, 없는 팀도 있다
 * (없으면 그냥 건너뛴다 — 에러 내지 않는다). 안 변하는 것(인격 다음)이라 앞쪽, 캐시 순서(결정 116 ③)를 따른다.
 */
export function shelfOf(team) {
  try {
    const s = fs.readFileSync(path.join(paths(team).dir, 'shelf.md'), 'utf8').trim();
    return s || null;
  } catch { return null; }   // 이 팀엔 책장이 없다 — 정상
}

/**
 * 지금 이 방 — 라운드 브리프. 라운드마다 세션이 새로 뜨므로 여기 붙는다. 인격 파일은 대표만 고치는 것(C)이라
 * 장치가 바뀐 것(자리 = 프로세스, 호명으로 부른다)은 여기서 말한다.
 */
export function briefOf(team, actor) {
  const cast = readCast(team).agents ?? {};
  const me = cast[actor]?.name ?? actor;
  const people = Object.entries(cast)
    .filter(([id]) => id !== 'boss' && id !== 'system')
    .map(([id, a]) => `${a.name}(${id}${isForeign(a.model) ? ', 다른 회사 모델' : ''})`).join(' · ');
  const lines = ['## 지금 이 방', `너는 ${me}(${actor})다. 이 방 사람: ${people}. 대표: ${cast.boss?.name ?? '대표'}.`];
  if (isOffice(team)) {
    const roomName = listTeams().find((t) => t.id === team)?.room ?? '이 방';
    lines.push(`${roomName}은 라운드가 없다 — 늘 열려 있다.`);
    // 비서실(결정 98·132) — 세라의 재료는 다섯 팀 상황 파일·승인 목록·요청 블록. 대표에게 요약해 보고하는 게 이 방의 전부다.
    if (roomRules(team).owner === 'secretary') lines.push('', ...secretaryBriefLines());
  } else {
    const st = readState(team);
    const rm = readRoadmap(team);
    const m = rm.milestones?.find((x) => x.n === st.milestone);
    const last = listRounds(team)[0];
    lines.push(st.phase !== 'idle'
      ? `라운드 ${st.round} · 마일스톤 ${st.milestone}${m ? ` "${m.title}" — 통과 조건: ${m.deliverable}` : ''}${st.topic ? ` · 주제: ${st.topic}` : ''}${st.phase === 'blocked' ? ' · FAIL 로 막혀 있다. 대표 판단 대기' : ''}`
      : '지금 열린 라운드가 없다.');
    if (rm.cutList?.length) lines.push(`컷리스트(이번엔 하지 않는 것): ${rm.cutList.join(' / ')}`);
    if (last) lines.push(`직전 라운드 ${last.round}: ${last.verdict ?? '판정 없음'}${last.summary ? ' — ' + last.summary : ''}`);
    // 상황판 (결정 23) — 팀원 모두가 읽고, 실무는 턴 끝·닫기마다 쓴다. 파일이 없거나 낡았으면 그렇다고 말한다.
    lines.push('', ...progressLines(team, actor === ownerOf(team)));
  }
  lines.push('방의 모든 자리는 각자 살아 있는 세션이다. Agent 툴(서브에이전트)로 동료를 부르지 마라 — 첫머리에 이름을 부르면 그가 답한다("안젤, …"). 외부감사도 같다. 너에게 온 말은 ⟦들려주기⟧ 로 들어오며 이미 대화록에 있다. 방에 남길 말이 없으면 (패스) 한 마디만.');
  return lines.join('\n');
}

/**
 * 세라의 재료 (결정 98·132) — 다섯 팀 상황 파일(progress)·대기 승인·열린 요청 블록을 그대로 늘어놓는다.
 * 추리고 사람 말로 옮기는 건 세라(대표에게 쓸 때) 몫이다 — 여기서는 자르거나 다듬지 않는다.
 */
function secretaryBriefLines() {
  const lines = ['## 다섯 팀 상황 (결정 98 재료 — 요약해 보고하는 것 말고는 이 방에 안 씀)'];
  for (const t of listTeams().filter((x) => x.kind !== 'office')) {
    const p = readProgress(t.id);
    lines.push(`### ${t.room ?? t.name} (${t.id})`, p ? progressText(p) : '아직 상황판이 없다.');
  }
  const approvals = listApprovals({ status: 'pending' });
  lines.push('', `### 대기 승인 ${approvals.length}건`);
  for (const a of approvals) lines.push(`- [${a.grade}] ${a.team} — ${a.what}`);
  if (!approvals.length) lines.push('- 없음');
  const requests = listRequests().filter((r) => r.status !== 'closed');
  lines.push('', `### 열린 요청 블록 ${requests.length}건`);
  for (const r of requests) lines.push(`- ${r.from.team} → ${r.to.team}: ${r.what}${r.goal ? ' — ' + r.goal : ''} (${r.status})`);
  if (!requests.length) lines.push('- 없음');
  // 이 값은 세션이 켜질 때(시스템 프롬프트) 한 번 박힌다 — 재개(resume)로 오래 사는 세션은 턴마다 다시 안 받는다(테라 감사, R25).
  lines.push('', '이 값은 세션이 켜질 때 것이다. 보고 전에 다시 읽어라 — `teams/<팀>/progress.json` · `node bus/approve.mjs --list` · `node bus/request.mjs --list`.');
  return lines;
}

/**
 * 상황판 절 (결정 23) — teams/<팀>/progress.json 을 프롬프트 글로. 순수(파일 값 → 줄) 부분은 bus.progressText — check 가 돌려본다.
 * @param owner 실무인가 — 실무에게만 "네가 쓴다" 한 줄
 */
function progressLines(team, owner) {
  const p = readProgress(team);
  const fresh = progressFresh(team);
  const head = `## 상황판 (teams/${team}/progress.json${p?.at ? ` · ${p.by ?? '?'} 가 ${p.at.slice(0, 16).replace('T', ' ')} 에 갱신${fresh ? '' : ' — 이 라운드 시작 전이라 낡았다'}` : ' · 아직 없다'})`;
  const body = p ? progressText(p) : '아직 상황판을 안 썼다.';
  const rule = owner ? `실무인 너는 턴 끝마다·라운드 닫기 전에 이 파일을 갱신한다: node bus/progress.mjs --team ${team} --doing "…" --blocked "…" --boss "…" --next "…" (준 항목만 바뀜, --clear <항목> 으로 비움).` : '이 파일은 실무가 쓴다. 틀린 게 보이면 방에서 실무에게 말해라.';
  return [head, body, rule];
}

/**
 * 시스템 프롬프트 = 인격 + 책장 + 확정 조항(해석) + 일지(최근) + 라운드 브리프. 조립 함수는 이것 하나다 —
 * 층을 더 쌓지 않는다(순순빌리지는 메타데이터+시스템+기억+상호작용이 쌓여 꼬였다, docs/cases.md 6).
 * 책장은 인격 바로 뒤 — 안 변하는 것을 앞에 두는 캐시 순서(결정 116 ③). 상한을 넘으면 일지 문단부터
 * 줄이고, 그래도 넘으면 책장을 잘라낸다(책장은 보통 짧아 여기까지 오는 일은 드물다).
 */
export function assemblePrompt(team, actor) {
  const persona = personaOf(team, actor);
  const shelfFull = shelfOf(team);
  const decisions = decisionsOf(team);
  const brief = briefOf(team, actor);
  let paras = JOURNAL_PARAS;
  let shelfLen = shelfFull ? shelfFull.length : 0;
  for (;;) {
    const j = paras > 0 ? journalOf(team, actor, paras) : null;
    const shelf = shelfFull && shelfLen > 0
      ? (shelfLen < shelfFull.length ? shelfFull.slice(0, shelfLen).trim() + `\n…(길어서 잘림, 전문은 teams/${team}/shelf.md)` : shelfFull)
      : null;
    const parts = [
      persona,
      shelf ? `## 책장 (teams/${team}/shelf.md — 읽을 것 경로 + 안 읽을 것. 여기 없는 건 \`node tools/library.mjs find <낱말>\`로 찾는다)\n${shelf}` : null,
      decisions ? `## 확정 조항 (대표 원문의 해석 — 원문은 teams/${team}/decisions.md)\n${decisions}` : null,
      j ? `## 네 일지 (최근 ${Math.min(paras, j.total)}문단 / 전체 ${j.total} — teams/${team}/journal/${actor}.md)\n${j.text}` : null,
      brief,
    ].filter(Boolean);
    const text = parts.join('\n\n---\n\n');
    if (text.length <= PROMPT_CAP) return text;
    if (paras > 0) { paras -= 1; continue; }
    if (shelfLen > 0) { shelfLen = Math.max(0, shelfLen - 500); continue; }
    return text;   // 일지도 0, 책장도 0 — 더 줄일 게 없다. 있는 그대로 낸다
  }
}

/* ── 기동 ── */

function spawnFor(team, actor) {
  const cast = readCast(team).agents?.[actor] ?? {};
  const prior = storedId(team, actor);
  const args = prior ? [...ARGS, '--resume', prior] : [...ARGS];

  // 자리마다 다른 모델. cast.json 의 llm 이 우선, 없으면 방의 모델 (state/teams.json).
  const model = cast.llm ?? listTeams().find((t) => t.id === team)?.model;
  if (model) args.push('--model', model);
  // 추론 강도 (결정 69) — cast.json 의 effort. 없으면 플래그를 안 붙여 엔진 기본. 대표가 관제탑에서 바꾸면 다음 턴에 여기로 들어온다.
  if (cast.effort) args.push('--effort', cast.effort);

  const prompt = assemblePrompt(team, actor);
  if (prompt) args.push('--append-system-prompt', prompt);

  // 자리마다 다른 도구. 감사역은 고치지 않는다 — 감사역이 고치면 감사가 아니다.
  if (Array.isArray(cast.disallow) && cast.disallow.length) args.push('--disallowedTools', ...cast.disallow);

  const child = spawn('claude', args, {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    // 훅은 이 두 값으로 방과 화자를 정한다. 자리별 세션이 각자 이름으로 기록되는 것은 전적으로 이 두 줄 덕분이다.
    env: { ...process.env, PPANAM_TEAM: team, PPANAM_ACTOR: actor },
  });

  const s = {
    team, actor, child,
    id: prior ?? null,
    busy: false,
    queue: [],          // [{ text, resolve }]
    buf: '',
    stderr: '',
    timer: null,
    startedAt: new Date().toISOString(),
    resumed: !!prior,   // --resume 으로 떴다. 첫 턴이 성공하기 전에 죽으면 그 id 가 문제다
    firstOk: false,     // 이 프로세스에서 턴이 한 번이라도 끝났나
    inflight: null,     // 지금 보내진 턴 { text, resolve } — 프로세스가 죽으면 한 번 다시 보낼 수 있게
    closing: false,     // stop() 이 불렸다. 프로세스가 끝날 때까지 맵에 남는다 — 그 사이 온 턴은 아래에
    pendingAfterClose: [],
  };

  child.stdout.on('data', (d) => { s.buf += d; drain(s); });
  child.stderr.on('data', (d) => { s.stderr = (s.stderr + d).slice(-4000); });

  child.on('error', (e) => die(s, `${name(s)} 세션을 띄우지 못했습니다 — ${e.message}`));
  child.on('close', (code, signal) => {
    if (s.closing) { onClosed(s); return; }
    if (sessions.get(keyOf(team, actor)) !== s) return;
    sessions.delete(keyOf(team, actor));
    clearTimeout(s.timer);
    const why = s.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200);
    const how = (signal ? `${signal} 로 죽음` : `code ${code}`) + (why ? ' — ' + why : '');
    // 턴 도중에 죽었다(result 없이 끝남 — kill -9·크래시·code 0 으로 조용히). 8단계 ② "세션이 죽으면 자동 재개": 같은 턴을 새 세션으로 **한 번** 다시 보낸다 —
    // 줄 선 턴도 같이 옮긴다. 전엔 "다음 차례에 다시 붙습니다" 한 줄 남기고 그 턴을 버렸다(R26: 재시작이 첫 턴을 죽여 방에 한 말이 통째로 사라짐).
    // 저장된 id 로 이어붙이려다 첫 턴도 못 끝냈으면 그 id 가 썩은 것 — 버리고 새 세션으로(안 그러면 id 가 영영 남아 그 뒤 모든 턴이 같은 이유로 죽는다).
    // 두 번째도 죽으면 그때 버린다(조용히가 아니라 note 로). 판단은 순수 함수 deathPlan — round.mjs check 가 돌려본다.
    const plan = deathPlan({ inflight: !!s.inflight, retried: !!s.inflight?.retried, resumed: s.resumed, firstOk: s.firstOk });
    if (plan.rotten) forgetId(team, actor);
    if (plan.action === 'retry') {
      const turn = s.inflight;
      turn.retried = true;
      note(team, `${name(s)} 세션이 끊겼습니다 (${how}). ${plan.rotten ? '저장된 세션을 버리고 ' : ''}새 세션으로 같은 차례를 한 번 다시 보냅니다.`, { sessionRetry: { actor, kind: turn.kind ?? null, rotten: plan.rotten, why: how.slice(0, 160) } });
      const fresh = spawnFor(team, actor);
      fresh.queue.push(...s.queue);
      s.queue = []; s.inflight = null;   // 옮겼다 — settle 이 버리지 않게
      write(fresh, turn);
      return;
    }
    if (plan.action === 'drop') {
      note(team, `${name(s)} 세션이 두 번 끊겼습니다 (${how}) — 이 차례(${s.inflight.kind ?? '말'})를 버립니다. 다음 지시로 이어집니다.`, { sessionRetry: { actor, kind: s.inflight.kind ?? null, gaveUp: true, why: how.slice(0, 160) } });
    } else if (code !== 0 || signal) {
      note(team, `${name(s)} 세션이 끊겼습니다 (${how}). 다음 차례에 다시 붙습니다.`);
    }
    // 종료 코드와 무관하게 — result 없이 조용히 끝나도(code 0) 기다리던 답과 줄 선 턴을 정리한다.
    // 안 그러면 sendAndWait 가 영원히 기다린다 (레오 감사, 2026-09-12).
    settle(s);
    maybeFinishClose(team);
  });

  child.stdin.on('error', () => { /* 자식이 먼저 죽은 경우 */ });

  sessions.set(keyOf(team, actor), s);
  return s;
}

const name = (s) => readCast(s.team).agents?.[s.actor]?.name ?? s.actor;

/**
 * 세션이 끝났을 때 무엇을 하나(8단계 ②) — 순수. 턴 도중이었고 아직 한 번도 다시 안 보냈으면 'retry', 이미 한 번 다시 보낸 턴이면 'drop',
 * 턴 도중이 아니었으면 'none'. rotten 은 저장된 id 로 이어붙이려다 첫 턴도 못 끝낸 경우 — 그 id 를 버려야 한다.
 * @param { inflight, retried, resumed, firstOk }
 * @returns { action: 'retry'|'drop'|'none', rotten }
 */
export function deathPlan({ inflight, retried, resumed, firstOk }) {
  const rotten = !!(inflight && resumed && !firstOk);
  if (!inflight) return { action: 'none', rotten: false };
  return { action: retried ? 'drop' : 'retry', rotten };
}

function die(s, message) {
  if (sessions.get(keyOf(s.team, s.actor)) === s) sessions.delete(keyOf(s.team, s.actor));
  clearTimeout(s.timer);
  try { s.child.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
  note(s.team, message);
  settle(s);
  maybeFinishClose(s.team);
}

/**
 * 프로세스가 어떤 식으로든 끝났다. 기다리던 답은 null 로 풀고, 줄 선 턴은 버린다(말하고 버린다).
 * 턴 도중이었으면 사회자에게도 "턴 끝" 을 알린다(8단계 ②) — 전엔 result 때만 알려서 죽은 턴이 사회자의 inflight 에 남아
 * 다음 재시작 때 옛 차례로 되살아났다. 버린 것은 버린 것으로 남아야 한다.
 */
function settle(s) {
  const done = s.inflight;
  s.inflight = null;
  s.busy = false;
  done?.resolve?.(null);
  dropped(s);
  if (done) for (const fn of turnEndListeners) { try { fn(s.team, s.actor); } catch { /* 듣는 쪽 사정 */ } }
}

/** 닫히던 프로세스가 끝났다. 이제야 맵에서 뺀다. 닫히는 동안 온 턴이 있으면 그제야 새 프로세스를 띄운다. */
function onClosed(s) {
  if (sessions.get(keyOf(s.team, s.actor)) === s) sessions.delete(keyOf(s.team, s.actor));
  settle(s);
  const pend = s.pendingAfterClose ?? [];
  s.pendingAfterClose = [];
  if (pend.length) {
    const fresh = spawnFor(s.team, s.actor);
    fresh.queue.push(...pend.slice(1));
    write(fresh, pend[0]);
  }
}

/** 줄 서 있던 턴이 버려졌으면 말한다. 조용히 사라지는 것이 가장 나쁘다. */
function dropped(s) {
  if (s.queue.length) note(s.team, `${name(s)}에게 대기 중이던 턴 ${s.queue.length}건을 버렸습니다.`);
  for (const q of s.queue) q.resolve?.(null);
  s.queue = [];
}

/** 시스템 안내. 화면에서 가장 약하게 표시되는 줄이다 (event-schema 3절). meta 는 기계가 읽는 칸(sessionRetry 등). */
function note(team, text, meta = null) {
  try { emit(team, { actor: 'system', type: 'note', text, ...(meta ? { meta } : {}) }); } catch { /* 기록 실패는 삼킨다 */ }
}

/* ── stdout 읽기 ── */

function drain(s) {
  const lines = s.buf.split('\n');
  s.buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    // 살아 있다는 신호다. 일하는 중이면 타이머를 여기서 다시 잰다.
    if (s.busy) arm(s);

    if (msg.session_id && msg.session_id !== s.id) {
      s.id = msg.session_id;
      rememberId(s.team, s.actor, s.id);
    }

    if (msg.type === 'result') {
      clearTimeout(s.timer);
      s.busy = false;
      s.firstOk = true;
      const done = s.inflight;
      s.inflight = null;
      if (msg.subtype && msg.subtype !== 'success') {
        note(s.team, `${name(s)}이 이번 턴을 끝내지 못했습니다 (${msg.subtype}).`);
      }
      try { recordUsage(s.team, s.actor, readState(s.team).round, msg); } catch { /* 장부 실패는 턴을 막지 않는다 */ }
      done?.resolve?.(typeof msg.result === 'string' ? msg.result : '');
      if (closing.has(s.team)) { dropped(s); maybeFinishClose(s.team); return; }
      next(s);
      // 대표가 모델·강도를 바꿨다 (결정 69) — 도는 턴은 안 끊고, 쌓인 것까지 다 끝난 뒤 내린다. 다음 send 가 새 인자로 다시 띄운다(id 는 남긴다).
      // 그 뒤 차례는 그대로 준다 — 닫히는 중의 send 는 pendingAfterClose 로 갔다가 새 프로세스가 받는다(onClosed).
      if (!s.busy && s.restartAfterTurn) { s.restartAfterTurn = false; stop(s.team, s.actor); }
      if (!s.busy) for (const fn of turnEndListeners) { try { fn(s.team, s.actor); } catch { /* 듣는 쪽 사정 */ } }
    }
  }
}

/* ── 보내기 ── */

/** 무응답 타이머를 (다시) 잰다. 턴을 보낼 때, 그리고 스트림 이벤트가 올 때마다. 그 시각이 화면의 "마지막 신호" 다 (결정 31). */
function arm(s) {
  s.lastSignal = Date.now();
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    // "무응답" 이 아니다 — 신호가 없었던 것이고, 다음 지시가 오면 새 세션으로 이어진다 (결정 31 ③).
    die(s, `${name(s)} — ${Math.round(TURN_TIMEOUT / 60_000)}분 동안 신호 없음(도구 호출도 출력도). 세션을 닫았습니다. 다음 지시로 이어집니다.`);
  }, TURN_TIMEOUT);
}

function write(s, turn) {
  s.busy = true;
  s.inflight = turn;
  s.turnStartedAt = Date.now();
  // 턴의 종류(판정·일지)는 stdin 에 쓰기 전에 적는다. 훅의 UserPromptSubmit 도 적지만 비동기라 늦을 수 있다.
  if (turn.kind) { try { writeTurn(s.team, s.actor, turn.kind, turn.extra ?? '', s.id); } catch { /* 훅이 적는다 */ } }
  arm(s);

  s.child.stdin.write(JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: turn.text }] },
  }) + '\n');
}

function next(s) {
  if (s.busy || !s.queue.length) return;
  write(s, s.queue.shift());
}

/* ── 생존 알림 (대표 결정 31 ②) ──
 * "적어도 5분에 한 번은 '저 작업 중이에요 안 죽었어요'". 일하는 중인데 이만큼 방에 아무 줄도 안 남으면 서버가
 * 대신 한 줄 남긴다. 그 줄이 대화록에 남으니 다음 알림은 다시 5분 뒤다. 참여자에게는 안 들려준다(meta.alive —
 * conductor.unheard 가 건너뛴다). 대표 화면용이다. */
const ALIVE_NOTE_MS = Number(process.env.PPANAM_ALIVE_NOTE_MS || 5 * 60_000);

/**
 * 알림 문장. 신호가 최근이면 "아직 작업 중 (N분째, 마지막: app.js 고치는 중)", 신호도 끊겼으면 그렇게 말한다 —
 * 서버가 아무것도 못 받았는데 "작업 중" 이라고 하면 거짓이다. 순수 함수라 check 가 돌려본다.
 * @param s   { name, actor, turnStartedAt, lastSignal }
 * @param log 그 방의 대화록
 */
export function aliveNoteText(s, log, now = Date.now()) {
  const mins = Math.max(1, Math.round((now - (s.turnStartedAt ?? now)) / 60_000));
  const sigAgo = now - (s.lastSignal ?? 0);
  if (sigAgo >= ALIVE_NOTE_MS) {
    return `${s.name} ${Math.round(sigAgo / 60_000)}분째 신호 없음 (도구 호출도 출력도) — ${Math.round(TURN_TIMEOUT / 60_000)}분이면 세션을 닫습니다`;
  }
  let tool = null;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (new Date(e.ts).getTime() < (s.turnStartedAt ?? 0)) break;
    if (e.type === 'tool' && e.actor === s.actor) { tool = e; break; }
  }
  return `${s.name} 아직 작업 중 (${mins}분째${tool ? `, 마지막: ${toolPhrase({ tool: tool.meta?.tool, text: tool.text })}` : ''})`;
}

function aliveNotes() {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (!s.busy || s.closing) continue;
    const log = readLog(s.team);
    const last = log[log.length - 1];
    if (last && now - new Date(last.ts).getTime() < ALIVE_NOTE_MS) continue;
    const text = aliveNoteText({ name: name(s), actor: s.actor, turnStartedAt: s.turnStartedAt, lastSignal: s.lastSignal }, log, now);
    try { emit(s.team, { actor: 'system', type: 'note', text, meta: { alive: true } }); } catch { /* 기록 실패는 삼킨다 */ }
  }
}
setInterval(aliveNotes, 30_000).unref();   // CLI(bus/cast.mjs)도 이 모듈을 읽는다 — 프로세스를 붙들지 않는다

function alive(s) {
  return s && !s.closing && s.child.exitCode === null && s.child.signalCode === null;
}

/**
 * 턴을 보낸다. 자리를 말하지 않으면 방 주인에게 — 대표의 지시가 가는 곳이다.
 * 말풍선은 여기서 만들지 않는다. 훅이 남긴다. 앞 턴이 안 끝났으면 줄을 세운다.
 */
export function send(team, text, actor = ownerOf(team), { kind = null, extra = '', internal = false } = {}) {
  if (isClosing(team) && !internal) return { refused: true, reason: '라운드가 닫히는 중입니다. 잠시 뒤 다시 보내세요.' };
  // codex 자리(대표가 바꿨을 수도, 결정 69 ①)에는 claude 세션이 없다 — 여기서 띄우면 그 자리 이름으로 claude 가 말한다. 귀에만 넣는 말(알림자·요청 블록·quiet)은
  // 대화록에 없어 codex 가 영영 못 듣고, 부른 쪽은 전달된 줄 안다(레오 FAIL R23). 그래서 **여기 한 군데서** 방에 note 로 남긴다 — codex 는 다음 차례에 커서로
  // 읽고, 호출부 넷(알림자·요청 블록·/api/say·사회자)은 그대로다 (대표 지시 "수도꼭지 한 군데만").
  const seat = readCast(team).agents?.[actor];
  if (isForeign(seat?.model)) {   // codex 든 gemini 든 — 여기 빠지면 그 자리에 넣은 말이 조용히 사라진다(결정 76 의 수도꼭지)
    const body = String(text ?? '').startsWith(RELAY_QUIET) ? String(text).slice(RELAY_QUIET.length).trim() : String(text ?? '').trim();
    const rec = emit(team, { actor: 'system', type: 'note', text: `${seat.name ?? actor}(${engineName(seat.model)} 자리) 귀에 넣을 말 — 방에 남깁니다: ${body}`, meta: { forCodex: actor } });
    return { queued: 0, noted: rec.id };
  }
  if (seat?.model !== 'claude') return { refused: true, reason: `${actor} 는 세션이 있는 자리가 아닙니다.` };
  return enqueue(team, actor, { text, resolve: null, kind, extra });
}

/** 턴을 보내고 답(result)을 기다린다. 일지 턴처럼 서버가 답을 받아 써야 하는 경우. 세션이 죽으면 null. */
export function sendAndWait(team, text, actor = ownerOf(team), { kind = null, extra = '', internal = false } = {}) {
  if (isClosing(team) && !internal) return Promise.resolve(null);
  if (readCast(team).agents?.[actor]?.model !== 'claude') return Promise.resolve(null);   // codex 자리 — 위 send 와 같은 이유
  return new Promise((resolve) => enqueue(team, actor, { text, resolve, kind, extra }));
}

function enqueue(team, actor, turn) {
  let s = sessions.get(keyOf(team, actor));
  // 닫히는 중이다. 옛 프로세스가 끝나면 새로 띄워 보낸다 — 한 자리에 프로세스는 하나다.
  if (s?.closing) { s.pendingAfterClose.push(turn); return { queued: s.pendingAfterClose.length, closing: true }; }
  if (!alive(s)) s = spawnFor(team, actor);
  if (s.busy) { s.queue.push(turn); return { queued: s.queue.length }; }
  write(s, turn);
  return { queued: 0 };
}

/**
 * 한 자리의 상태. 화면의 "일하는 중" 과 사회자의 busy 검사가 읽는다.
 * lastSignal 은 10초 단위로 깎는다 — 요약은 값이 바뀔 때만 방송되는데, 출력 조각마다 시각이 바뀌면 초당 몇 번씩
 * 다섯 방 요약을 다시 보낸다. 화면은 "N분 전" 까지만 쓴다.
 */
export function status(team, actor = ownerOf(team)) {
  const s = sessions.get(keyOf(team, actor));
  if (!s) return { alive: false, busy: false, queued: 0, sessionId: storedId(team, actor) };
  if (s.closing) return { alive: false, closing: true, busy: false, queued: s.pendingAfterClose.length, sessionId: storedId(team, actor) };
  const lastSignal = s.lastSignal ? new Date(Math.floor(s.lastSignal / 10_000) * 10_000).toISOString() : null;
  return { alive: true, busy: s.busy, queued: s.queue.length, sessionId: s.id, startedAt: s.startedAt, lastSignal };
}

/** 방의 모든 claude 자리 상태. */
export function statusAll(team) {
  return Object.fromEntries(claudeActors(team).map((a) => [a, status(team, a)]));
}

export const anyBusy = (team) => Object.values(statusAll(team)).some((x) => x.busy);

/** 밑바닥 재기(server/infra.mjs)용 — 메모리의 세션 중 프로세스는 끝났는데 맵에 남은 것이 좀비다. close 가 지우니 보통 0 이어야 한다. */
export function health() {
  let alive = 0, zombie = 0;
  for (const s of sessions.values()) {
    if (s.child.exitCode === null && s.child.signalCode === null) alive += 1; else zombie += 1;
  }
  return { alive, zombie };
}

/**
 * 한 자리의 세션을 닫는다. 세션 id 는 남겨두므로 다음 턴에 --resume 으로 이어붙는다.
 * stdin 만 닫고 잊으면 안 된다. 끝나기를 기다리고, 30초 안에 안 끝나면 SIGTERM, 10초 더 지나면 SIGKILL.
 */
export function stop(team, actor = ownerOf(team)) {
  const s = sessions.get(keyOf(team, actor));
  if (!s || s.closing) return false;
  s.closing = true;
  clearTimeout(s.timer);
  const c = s.child;
  try { c.stdin.end(); } catch { /* 이미 닫힘 */ }
  if (c.exitCode !== null || c.signalCode !== null) { onClosed(s); return true; }
  const t1 = setTimeout(() => { try { c.kill('SIGTERM'); } catch { /* 이미 죽음 */ } }, 30_000);
  const t2 = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* 이미 죽음 */ } }, 40_000);
  c.once('close', () => { clearTimeout(t1); clearTimeout(t2); });
  return true;
}

/**
 * 모델·강도가 바뀌었다 (결정 69) — 다음 턴부터 새 인자로. 놀고 있으면 지금 내리고('now'), 일하는 중이면 턴이 끝난 뒤('after-turn'),
 * 세션이 없으면 할 게 없다(null — 다음 send 가 어차피 cast.json 을 읽는다). id 는 남겨 --resume 으로 잇는다.
 */
export function restartAfterTurn(team, actor) {
  const s = sessions.get(keyOf(team, actor));
  if (!s || s.closing) return null;
  if (s.busy || s.queue.length) { s.restartAfterTurn = true; return 'after-turn'; }
  stop(team, actor);
  return 'now';
}

/** 방의 모든 자리를 닫는다 (id 는 남긴다). */
export function stopTeam(team) {
  for (const k of [...sessions.keys()]) if (k.startsWith(team + ':')) stop(team, k.slice(team.length + 1));
}

/**
 * 누가 일하는 중이면 지금 닫지 않는다. 방의 모든 자리가 놀면 라운드를 닫고 세션을 비운다.
 * 지금 닫으면 그 턴의 마지막 발언이 훅에서 버려진다. 일하는 중이 아니면 false — 부른 쪽이 바로 닫는다.
 */
export function closeWhenIdle(team, opts = {}) {
  if (!anyBusy(team)) return false;
  closing.set(team, { verdict: opts.verdict ?? null, summary: opts.summary ?? null, next: opts.next ?? null });
  return true;
}

function maybeFinishClose(team) {
  if (!closing.has(team) || anyBusy(team)) return;
  const o = closing.get(team);
  closing.delete(team);
  closeRound(team, o)
    .then((r) => emit(team, { actor: 'system', type: 'note', text: closedText(r), meta: { closed: r.round } }))
    .catch((e) => note(team, `라운드를 닫지 못했습니다 — ${e.message}`));
}

/** 닫힘 note 한 줄 — 바로 닫든 미뤄 닫든 같은 글. --next 로 이어 열렸으면(또는 못 열었으면) 그것도 여기에. */
export function closedText(r) {
  let s = `라운드 ${r.round} 닫힘 — 일지 ${r.journaled}편. 세션 컨텍스트를 비웠습니다.`;
  if (r.next) s += ` 라운드 ${r.next.round} 을 이어 엽니다 · 마일스톤 ${r.next.milestone}${r.next.topic ? ' — ' + r.next.topic : ''} (--next).`;
  else if (r.nextError) s += ` 닫았지만 다음 라운드를 열지 못했습니다 — ${r.nextError}`;
  return s;
}

/**
 * 라운드를 닫는 순서 — 일지, 닫기, 비우기. 이 순서라야 일지가 있다.
 *
 * 세 층 중 자라는 층이 일지다(인격은 불변, 라운드 컨텍스트는 비운다). 세션이 죽어도 어제를 인용할 수 있는
 * 유일한 길이다 — "AI티는 리셋에서 난다" (설계 점검 1항, docs/cases.md 2·5). 이번 라운드에 말한 자리에게만
 * 한 문단을 받는다. 답은 대화록에 안 남는다(훅이 ⟦일지⟧ 를 보고 건너뛴다). 외부감사는 outside.mjs 가 제 일지에 쓴다.
 */
export async function closeRound(team, opts = {}) {
  const state = readState(team);
  if (!state.round || state.phase === 'idle') throw new Error('진행 중인 라운드가 없습니다.');
  if (closingNow.has(team)) throw new Error('이미 닫는 중입니다.');
  closingNow.add(team);
  try {
    const journaled = await journalAll(team, state.round);
    const n = endRound(team, opts);
    reset(team);
    const out = { round: n, journaled };
    // --next (결정 25): 닫은 그 자리에서 다음 라운드를 연다 — 여는 손이 없어 방이 멈추던 일. PASS 로 닫아 now 가 없으면
    // startRound 가 거부한다(다음 착수는 B) — 그건 note 로만 남기고 닫힘은 그대로다.
    if (opts.next) {
      try { const s = startRound(team, { milestone: opts.next.milestone ?? null, topic: opts.next.topic ?? null, auditor: opts.next.auditor ?? null }); out.next = { round: s.round, milestone: s.milestone, topic: s.topic }; }
      catch (e) { out.nextError = e.message; }
    }
    return out;
  } finally {
    closingNow.delete(team);
  }
}

async function journalAll(team, round) {
  const spoke = new Set(readLog(team).filter((e) => e.round === round && (e.type === 'message' || e.type === 'verdict')).map((e) => e.actor));
  const cast = readCast(team).agents ?? {};
  const ask = (actor) => {
    // 일지는 정체성의 연결고리다 — 라운드가 바뀌고 컨텍스트가 비워져도 다음 세션이 이 문단을 읽고 '어제의 나' 를 잇는다 (대표 지시 2026-09-13).
    // 지시문은 bus.mjs 의 journalPrompt 하나 — codex 자리(outside.mjs)도 같은 문장을 받는다.
    const p = journalPrompt(round);
    if (isForeign(cast[actor]?.model)) return journalOutside(team, actor);
    return Promise.race([sendAndWait(team, quiet(p), actor, { kind: 'journal', internal: true }), new Promise((r) => setTimeout(() => r(null), JOURNAL_TIMEOUT))]);
  };
  const spoken = [...spoke].filter((a) => cast[a]?.model === 'claude' || isForeign(cast[a]?.model));
  // 마을 하루 상한(결정 6 · 8단계 ④) — 일지는 마을 턴이다(계획 15·마주침 30·일지 15 중 지금 있는 것). 자리마다 장부에서 하나씩 쓰고, 넘으면 그 자리는 건너뛴다 —
  // 조용히가 아니라 note 로. 걷기 전에 가르니 collectJournals 의 "한 번 더 묻습니다" 가 상한에 걸린 자리를 또 묻지 않는다.
  const { allowed, skipped, cap } = takeVillageFor(spoken, (a) => takeVillage('journal', { team, actor: a }));
  if (skipped.length) note(team, `마을 하루 상한(${cap.cap}회)에 닿아 일지 차례 ${skipped.length}건(${skipped.map((a) => cast[a]?.name ?? a).join('·')})을 건너뜁니다 — 라운드 ${round} 은 그 자리 일지 없이 닫습니다 (결정 6: 넘으면 마을 턴부터).`, { cap: { kind: 'village', used: cap.used, cap: cap.cap, skipped } });
  const actors = allowed;
  const once = async (a) => {
    try {
      const text = await ask(a);
      if (isForeign(cast[a]?.model)) return !!text;   // outside.mjs 가 제 일지에 썼다 — exit 0 일 때만 'ok', (패스)·빈 답은 exit 3 → null
      return appendJournal(team, a, text, { round });
    } catch { return false; }
  };
  // 못 받은 자리는 한 번 더 — 시간 초과·(패스)·빈 답은 전부 "일지 없음" 이고, 일지가 없으면 다음 세션이 어제를 잇지 못한다.
  // 걷는 순서·note 문구는 bus.mjs collectJournals 하나 — round.mjs check 가 같은 함수를 가짜 once 로 돌린다.
  const { got } = await collectJournals(actors, once, { note: (t) => note(team, t), nameOf: (a) => cast[a]?.name ?? a, round });
  return got;
}

/**
 * 마을 턴을 받을 자리 가르기(8단계 ④) — 순수. take(actor) 가 { ok, used, cap } 을 돌려주는 장부 호출이다. 앞에서부터 하나씩 쓰고, 처음 막힌 뒤로는 전부 건너뛴다(장부를 더 안 두드린다).
 * round.mjs check 가 가짜 take 로 돌려본다. @returns { allowed, skipped, cap: { used, cap } }
 */
export function takeVillageFor(actors, take) {
  const allowed = [], skipped = [];
  let cap = { used: 0, cap: 0 }, blocked = false;
  for (const a of actors) {
    if (blocked) { skipped.push(a); continue; }
    const r = take(a);
    cap = { used: r.used, cap: r.cap };
    if (r.ok) allowed.push(a); else { blocked = true; skipped.push(a); }
  }
  return { allowed, skipped, cap };
}

/** 외부감사의 일지는 outside.mjs 가 쓴다. 끝나기만 기다린다. exit 0 만 'ok' — (패스)·빈 답은 outside.mjs 가 exit 3 을 낸다. */
function journalOutside(team, actor = 'outside') {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnProc('node', [path.join(ROOT, 'bus', 'outside.mjs'), '--team', team, '--actor', actor, '--turn', 'journal'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch { return resolve(null); }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 이미 죽음 */ } resolve(null); }, JOURNAL_TIMEOUT);
    child.on('error', () => { clearTimeout(t); resolve(null); });
    child.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? 'ok' : null); });
  });
}

/**
 * 방의 세션을 전부 닫고 **세션 id 까지 버린다.** 라운드가 끝날 때 쓴다.
 * 비워지는 건 AI 컨텍스트뿐이다 (CLAUDE.md). id 를 남겨두면 다음 라운드가 지난 라운드 대화를 통째로 안고 시작한다.
 */
export function reset(team) {
  stopTeam(team);
  for (const a of claudeActors(team)) forgetId(team, a);
  const all = readStore();
  if (team in all) { delete all[team]; writeStore(all); }
}

export function stopAll() {
  for (const k of [...sessions.keys()]) { const i = k.indexOf(':'); stop(k.slice(0, i), k.slice(i + 1)); }
}
