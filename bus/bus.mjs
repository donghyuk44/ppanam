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

export function startRound(team, { topic = null, milestone = null } = {}) {
  const prev = readState(team);
  const next = writeState(team, {
    round: (prev.round || 0) + 1,
    milestone: milestone ?? prev.milestone ?? 1,
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
