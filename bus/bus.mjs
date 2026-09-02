// 이벤트 버스 코어.
//
// 세 가지가 서로 다르다는 점이 이 파일의 전제다.
//
//   1. AI 컨텍스트  — 라운드마다 비운다. 에이전트는 현재 라운드의 이벤트만 읽는다.
//   2. 대화록       — 절대 비우지 않는다. teams/<팀>/log.jsonl 에 영원히 쌓인다.
//                     사람이 위로 스크롤하면 반년 전 대화도 나와야 한다.
//   3. 산출물       — 마일스톤의 결과물. teams/<팀>/out/ 에 파일로 남는다.
//
// 서버는 log.jsonl 을 tail 해서 새 줄만 브라우저로 밀어준다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEAMS_PATH = path.join(ROOT, 'state', 'teams.json');

export const EVENT_TYPES = new Set([
  'message', 'enter', 'tool', 'verdict',
  'round_start', 'round_end', 'milestone', 'note',
]);
export const VERDICTS = new Set(['PASS', 'REVISE', 'FAIL']);

/** 라운드당 허용되는 반박 횟수. 넘으면 자동 FAIL — 사람을 부른다. */
export const MAX_ATTEMPTS = 3;

/* ── 총괄 배달 ──
 *
 * 총괄이 대표의 지시를 팀에 옮길 때, 요약만 보내면 팀에는 근거가 남지 않는다.
 * 나중에 감사역이 "이 지시의 근거가 어디 있냐"고 물었을 때 답할 것이 총괄의
 * 요약뿐이면 그건 근거가 아니다. 요약은 반드시 무언가를 떨어뜨린다.
 *
 * 그래서 원문과 해석을 한 봉투에 넣되, 훅이 받는 즉시 두 개의 이벤트로 가른다.
 * 한 말풍선 안에 두 블록으로 두면 언젠가 섞인다. 스키마가 강제해야 한다.
 */
export const RELAY_ORIGIN = '⟦대표 원문 — 손대지 않음⟧';
export const RELAY_ASSIGN = '⟦총괄 배분⟧';

/**
 * 이미 대화록에 있는 말을 다른 세션의 귀에 넣을 때 붙이는 표시.
 *
 * 외부감사가 한 말은 그가 직접 대화록에 남긴다. 그 말을 실무가 들으려면 실무
 * 세션에도 넣어줘야 하는데, 그대로 넣으면 훅이 대표 말풍선으로 또 남긴다.
 * 이 표시가 붙은 것은 훅이 기록하지 않는다 — 말한 사람이 이미 남겼기 때문이다.
 *
 * 이게 없으면 둘은 서로의 말을 못 듣는다. 대화가 아니라 각자 독백이 된다.
 */
export const RELAY_QUIET = '⟦들려주기 — 기록하지 않음⟧';

export const isQuietRelay = (text) => String(text ?? '').startsWith(RELAY_QUIET);

/**
 * 하네스가 세션에 밀어넣는 블록을 걷어낸다.
 *
 * 백그라운드 작업 완료 알림 같은 것은 대표가 한 말이 아닌데, 프롬프트로 들어오기
 * 때문에 UserPromptSubmit 훅이 대표 발언으로 남긴다. 그러면 감사역이 그걸
 * 대표 지시로 읽는다. 사람이 쓴 부분만 남기고, 남는 게 없으면 빈 문자열이다.
 */
export function stripSystemBlocks(text) {
  return String(text ?? '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ip_reminder>[\s\S]*?<\/ip_reminder>/g, '')
    .trim();
}

/**
 * 이 말이 누구를 향한 것인가.
 *
 * 대화가 대화이려면 "질문에는 답이 온다"가 성립해야 한다. 지금 구조에서는
 * 다니엘이 안젤에게 물어도 안젤에게 차례가 가지 않아 각자 독백이 된다.
 * 첫머리에 이름이 나오면 그 사람에게 차례를 넘긴다.
 *
 * 서브에이전트는 스스로 등장할 수 없으므로, 실제로는 실무에게 "누가 답해야
 * 하는지"를 알려주는 방식으로 쓴다.
 */
export function addressee(text, cast, { except = null } = {}) {
  const head = String(text ?? '').trim().slice(0, 24);
  for (const [id, a] of Object.entries(cast ?? {})) {
    if (id === except || id === 'system' || !a?.name) continue;
    if (new RegExp('^' + a.name + '\\s*(씨|님)?\\s*[,，、:·]').test(head)) return id;
  }
  return null;
}
export const quiet = (text) => `${RELAY_QUIET}\n${text}`;

/**
 * 배달 봉투를 원문과 배분으로 가른다.
 * 봉투가 아니면 null 을 돌려준다 (보통의 지시는 그대로 대표 말풍선이 된다).
 */
export function splitRelay(text) {
  const s = String(text ?? '');
  const i = s.indexOf(RELAY_ORIGIN);
  const j = s.indexOf(RELAY_ASSIGN);
  if (i < 0 || j < 0 || j < i) return null;
  const origin = s.slice(i + RELAY_ORIGIN.length, j).trim();
  const assign = s.slice(j + RELAY_ASSIGN.length).trim();
  if (!origin) return null;
  return { origin, assign };
}

/* ── 승인 ──
 *
 * 대표가 자리를 비워도 팀이 달리려면 "무엇을 누가 승인하는가"가 등급으로 정해져 있어야 한다.
 * 책(에이전틱 코딩 15장)의 원칙 5 — 사람의 감독 지점은 병목이 아니라 큰 대가를 치르는
 * 실수를 막는 품질 게이트다. 아키텍처 결정·보안 변경·통합 지점·최종 검증은 사람 몫.
 *
 *   A 자동   실무 혼자.        브랜치 안 커밋, 산출물 쓰기, 라운드 열고 닫기, 감사역 부르기
 *   B 총괄   톰 결정 + 제리 대조. 둘 다 PASS 여야 한다.
 *                              원격 푸시, 다음 마일스톤 착수, 다른 팀에 일 넘기기, 세션 재시작
 *   C 대표   대표만.           메인 병합, 컷리스트·로드맵 변경, 비용 상한, 외부 발송, 인격 파일 수정
 *
 * 큐는 append-only 다 (state/approvals.jsonl). 요청 한 줄, 판정 한 줄씩 쌓이고 읽을 때 접는다.
 * 대화록과 같은 원칙 — 지우지 않는다.
 */
export const APPROVAL_GRADES = {
  A: { label: '자동', needs: [],                   desc: '브랜치 안 커밋 · 산출물 쓰기 · 라운드 열고 닫기 · 감사역 부르기' },
  B: { label: '총괄', needs: ['chief', 'outside'], desc: '원격 푸시 · 다음 마일스톤 착수 · 다른 팀에 일 넘기기 · 세션 재시작' },
  C: { label: '대표', needs: ['boss'],             desc: '메인 병합 · 컷리스트·로드맵 변경 · 비용 상한 · 외부 발송 · 인격 파일 수정' },
};
export const APPROVALS_PATH = path.join(ROOT, 'state', 'approvals.jsonl');

function appendApproval(line) {
  fs.mkdirSync(path.dirname(APPROVALS_PATH), { recursive: true });
  fs.appendFileSync(APPROVALS_PATH, JSON.stringify(line) + '\n');
}

/** 요청과 판정 줄을 접어서 요청 하나당 상태 하나로 만든다. */
export function listApprovals({ team = null, status = null } = {}) {
  const byId = new Map();
  for (const l of parseJSONL(safeRead(APPROVALS_PATH))) {
    if (l.kind === 'request') {
      byId.set(l.id, { ...l, decisions: [], status: l.grade === 'A' ? 'passed' : 'pending', decidedAt: l.grade === 'A' ? l.ts : null });
      continue;
    }
    if (l.kind === 'decision') {
      const r = byId.get(l.id);
      if (!r || r.status !== 'pending') continue;
      r.decisions.push(l);
      const needs = APPROVAL_GRADES[r.grade]?.needs ?? [];
      if (l.decision === 'REVISE') { r.status = 'revised'; r.decidedAt = l.ts; }
      else if (needs.every((who) => r.decisions.some((d) => d.by === who && d.decision === 'PASS'))) {
        r.status = 'passed'; r.decidedAt = l.ts;
      }
    }
  }
  let out = [...byId.values()];
  if (team) out = out.filter((r) => r.team === team);
  if (status) out = out.filter((r) => r.status === status);
  return out;
}

export function requestApproval(team, { by = 'guide', grade, what, detail = '' }) {
  const g = String(grade || '').toUpperCase();
  if (!APPROVAL_GRADES[g]) throw new Error(`등급은 A / B / C 중 하나여야 합니다.`);
  if (!what?.trim()) throw new Error('무엇을 승인받을지가 비어 있습니다.');
  const rec = {
    kind: 'request', id: 'apr_' + crypto.randomBytes(4).toString('hex'),
    ts: new Date().toISOString(), team, by, grade: g, what: what.trim(), detail: String(detail ?? '').trim(),
    round: readState(team).round || 0,
  };
  appendApproval(rec);
  // 방에도 남긴다 — 화면에서 가장 약한 줄이지만, 나중에 "언제 요청했나"를 찾을 수 있어야 한다.
  emit(team, {
    actor: by, type: 'note',
    text: `승인 요청 [${g}] ${rec.what}${g === 'A' ? ' — 자동 통과' : ''}`,
    meta: { approval: rec.id, grade: g },
  });
  return listApprovals().find((r) => r.id === rec.id);
}

export function decideApproval(id, { by, decision, reason = '' }) {
  const r = listApprovals().find((x) => x.id === id);
  if (!r) throw new Error(`그런 요청이 없습니다: ${id}`);
  if (r.status !== 'pending') throw new Error(`이미 끝난 요청입니다 (${r.status}).`);
  const d = String(decision || '').toUpperCase();
  if (!['PASS', 'REVISE'].includes(d)) throw new Error('판정은 PASS 또는 REVISE 입니다.');
  const needs = APPROVAL_GRADES[r.grade].needs;
  if (!needs.includes(by)) throw new Error(`등급 ${r.grade} 는 ${needs.join('·')} 이(가) 판정합니다. '${by}' 는 아닙니다.`);
  if (r.decisions.some((x) => x.by === by)) throw new Error(`${by} 는 이미 판정했습니다.`);
  appendApproval({ kind: 'decision', id, by, decision: d, reason: String(reason ?? '').trim(), ts: new Date().toISOString() });
  const after = listApprovals().find((x) => x.id === id);
  if (after.status !== 'pending') {
    emit(r.team, {
      actor: 'system', type: 'note',
      text: `승인 ${after.status === 'passed' ? '통과' : '반려'} [${r.grade}] ${r.what}${reason ? ' — ' + reason : ''}`,
      meta: { approval: id, grade: r.grade, status: after.status },
    });
  }
  return after;
}

/* ── 파일 ── */

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return value;
}
function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

export function parseJSONL(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 쓰기 도중 잘린 줄 */ }
  }
  return out;
}

/* ── 팀 ── */

export function listTeams() {
  const cfg = readJSON(TEAMS_PATH, { teams: [], default: null });
  return cfg.teams ?? [];
}

export function defaultTeam() {
  const cfg = readJSON(TEAMS_PATH, { teams: [], default: null });
  return cfg.default ?? cfg.teams?.[0]?.id ?? 'marketing';
}

export function teamExists(id) {
  return listTeams().some((t) => t.id === id);
}

/**
 * 방의 종류.
 *
 * 'team'   — 작전실. 라운드로 돌고, 로드맵과 마일스톤이 있다.
 * 'office' — 총괄실. 대표와 1:1 이라 라운드가 없다. 항상 열려 있다.
 *
 * 라운드가 없다는 건 훅의 기록 조건도 다르다는 뜻이다. 작전실은 라운드가 열려
 * 있을 때만 기록하지만(안 그러면 잡담이 다 흘러든다), 총괄실은 그 방 자체가
 * 대표와의 대화라 늘 기록한다.
 */
export function kindOf(id) {
  return listTeams().find((t) => t.id === id)?.kind ?? 'team';
}

export const isOffice = (id) => kindOf(id) === 'office';

export function paths(team) {
  const dir = path.join(ROOT, 'teams', team);
  return {
    dir,
    log: path.join(dir, 'log.jsonl'),
    rounds: path.join(dir, 'rounds.jsonl'),
    state: path.join(dir, 'round.json'),
    cast: path.join(dir, 'cast.json'),
    roadmap: path.join(dir, 'roadmap.json'),
    out: path.join(dir, 'out'),
  };
}

/* ── 상태 ── */

const BLANK_STATE = {
  round: 0, milestone: 0, phase: 'idle', topic: null,
  attempt: 0, startedAt: null, endedAt: null,
};

export function readState(team) {
  return { ...BLANK_STATE, ...readJSON(paths(team).state, {}) };
}

export function writeState(team, patch) {
  return writeJSON(paths(team).state, { ...readState(team), ...patch });
}

export function readCast(team) {
  return readJSON(paths(team).cast, { agents: {} });
}

export function readRoadmap(team) {
  return readJSON(paths(team).roadmap, { destination: null, milestones: [], cutList: [] });
}

/* ── 대화록 ── */

/**
 * 이벤트 한 건을 대화록에 남긴다.
 *
 * 훅은 병렬로 실행되므로 여러 프로세스가 같은 파일에 동시에 쓴다.
 * appendFileSync 한 번으로 개행까지 붙여야 줄이 섞이지 않는다.
 */
export function emit(team, event) {
  const state = readState(team);
  const record = {
    id: 'evt_' + crypto.randomBytes(5).toString('hex'),
    ts: new Date().toISOString(),
    team,
    round: event.round ?? state.round ?? 0,
    milestone: event.milestone ?? state.milestone ?? 0,
    actor: event.actor || 'system',
    type: EVENT_TYPES.has(event.type) ? event.type : 'message',
    text: typeof event.text === 'string' ? event.text : String(event.text ?? ''),
    ...(event.meta ? { meta: event.meta } : {}),
  };
  const p = paths(team);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.log, JSON.stringify(record) + '\n');
  return record;
}

/** 대화록 전체. 큰 팀에서는 readTail 을 쓴다. */
export function readLog(team) {
  return parseJSONL(safeRead(paths(team).log));
}

/**
 * 대화록의 최근 limit 건. before 를 주면 그 이벤트보다 앞의 것들을 준다.
 * 위로 스크롤할 때 쓰는 페이지네이션.
 */
export function readTail(team, { limit = 200, before = null } = {}) {
  const all = readLog(team);
  const end = before ? all.findIndex((e) => e.id === before) : all.length;
  const stop = end < 0 ? all.length : end;
  const start = Math.max(0, stop - limit);
  return { events: all.slice(start, stop), more: start > 0, total: all.length };
}

/** 현재 라운드의 이벤트만. AI 에게 넘기는 컨텍스트가 이것이다. */
export function readContext(team) {
  const { round } = readState(team);
  if (!round) return [];
  return readLog(team).filter((e) => e.round === round);
}

/* ── 라운드 ── */

export function listRounds(team) {
  return parseJSONL(safeRead(paths(team).rounds)).reverse();
}

/**
 * 다음 라운드 번호.
 *
 * round.json 만 믿지 않는다. 그 파일이 지워지거나 되돌려지면 번호가 1로 돌아가
 * 대화록에 이미 있는 라운드와 충돌하기 때문이다. 기록에 남은 최대값도 함께 본다.
 */
function nextRoundNumber(team) {
  let max = readState(team).round || 0;
  for (const r of parseJSONL(safeRead(paths(team).rounds))) {
    if (typeof r.round === 'number' && r.round > max) max = r.round;
  }
  const log = readLog(team);
  for (let i = log.length - 1; i >= 0; i--) {
    if (typeof log[i].round === 'number' && log[i].round > max) max = log[i].round;
  }
  return max + 1;
}

/**
 * 로드맵이 지금 가리키는 마일스톤. 어디가 현재인지는 로드맵이 정한다.
 *
 * 이게 없으면 라운드가 직전 라운드의 번호를 물려받아, 로드맵은 3번을 하고 있는데
 * 라운드는 1번이라고 말하는 상태가 된다. 감사역이 무엇을 기준으로 볼지 알 수 없어진다.
 */
function nowMilestone(team) {
  const ms = readRoadmap(team).milestones ?? [];
  const now = ms.find((m) => m.status === 'now');
  if (now) return now.n;
  const wait = ms.find((m) => m.status !== 'pass');
  return wait ? wait.n : null;
}

export function startRound(team, { topic = null, milestone = null } = {}) {
  const prev = readState(team);
  const next = writeState(team, {
    round: nextRoundNumber(team),
    milestone: milestone ?? nowMilestone(team) ?? prev.milestone ?? 1,
    phase: 'running',
    topic: topic ?? prev.topic,
    attempt: 0,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });
  emit(team, {
    type: 'round_start',
    actor: 'system',
    text: `라운드 ${next.round} 시작 · 마일스톤 ${next.milestone}`,
    meta: { topic: next.topic },
  });
  return next;
}

/**
 * 라운드를 닫는다.
 *
 * 대화록은 그대로 둔다 — 구분선이 하나 들어갈 뿐이다.
 * 비워지는 건 AI 컨텍스트뿐이고, 그건 다음 라운드부터 round 번호가
 * 달라지면서 자연히 끊긴다 (readContext 참고).
 */
export function endRound(team, { verdict = null, summary = null } = {}) {
  const state = readState(team);
  if (!state.round) throw new Error('진행 중인 라운드가 없습니다.');

  emit(team, {
    type: 'round_end',
    actor: 'system',
    text: summary || `라운드 ${state.round} 종료${verdict ? ' · ' + verdict : ''}`,
    meta: { verdict },
  });

  const events = readLog(team).filter((e) => e.round === state.round);
  const p = paths(team);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.rounds, JSON.stringify({
    round: state.round,
    milestone: state.milestone,
    topic: state.topic,
    verdict,
    summary,
    attempts: state.attempt,
    eventCount: events.length,
    startedAt: state.startedAt,
    endedAt: new Date().toISOString(),
  }) + '\n');

  // 외부감사도 이 방의 참여자라 자기 세션을 갖는다. 라운드가 끝나면 같이 비운다 —
  // 비워지는 건 AI 컨텍스트뿐이라는 규칙은 다른 회사 모델에도 똑같이 적용된다.
  // (대화록은 그대로 남는다. 위 emit 이 이미 구분선을 그었다.)
  const outStore = path.join(ROOT, 'state', 'outside-sessions.json');
  try {
    const all = JSON.parse(fs.readFileSync(outStore, 'utf8'));
    if (team in all) {
      delete all[team];
      fs.writeFileSync(outStore, JSON.stringify(all, null, 2) + '\n');
    }
  } catch { /* 파일이 없으면 열린 세션도 없다 */ }

  writeState(team, { phase: 'idle', endedAt: new Date().toISOString() });
  return state.round;
}

/**
 * 감사 판정.
 * REVISE 는 반박 횟수를 올리고, 상한에 닿으면 FAIL 로 승격해 사람을 부른다.
 */
export function recordVerdict(team, { actor, verdict, text, target = 'guide' }) {
  const v = String(verdict || '').toUpperCase();
  if (!VERDICTS.has(v)) throw new Error(`판정은 ${[...VERDICTS].join(' / ')} 중 하나여야 합니다.`);

  const state = readState(team);
  let attempt = state.attempt || 0;
  let final = v;

  if (v === 'REVISE') {
    attempt += 1;
    writeState(team, { attempt });
    if (attempt >= MAX_ATTEMPTS) final = 'FAIL';
  }

  const rec = emit(team, {
    type: 'verdict', actor, text,
    meta: { verdict: final, target, attempt, max: MAX_ATTEMPTS },
  });

  if (final === 'FAIL' && v === 'REVISE') {
    emit(team, {
      type: 'note', actor: 'system',
      text: `반박 ${MAX_ATTEMPTS}회를 채웠습니다. 대표 판단이 필요합니다.`,
    });
  }
  return rec;
}

/** 팀 하나의 요약 — 왼쪽 레일의 계기판이 읽는 값. */
export function teamSummary(team) {
  const state = readState(team);
  const log = readLog(team);
  const last = log[log.length - 1] ?? null;
  const roadmap = readRoadmap(team);
  const done = roadmap.milestones?.filter((m) => m.status === 'pass').length ?? 0;

  // 마지막 판정이 무엇이었는지 — FAIL 이면 레일에 경고가 뜬다.
  let lastVerdict = null;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === 'verdict') { lastVerdict = log[i].meta?.verdict ?? null; break; }
    if (log[i].type === 'round_start') break;
  }

  return {
    ...state,
    lastVerdict,
    lastAt: last?.ts ?? null,
    lastText: last?.text ?? null,
    lastActor: last?.actor ?? null,
    logCount: log.length,
    milestonesDone: done,
    milestonesTotal: roadmap.milestones?.length ?? 0,
    needsBoss: lastVerdict === 'FAIL',
  };
}
