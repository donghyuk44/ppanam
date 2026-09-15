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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findOutPaths, outItem } from '../server/public/outlink.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEAMS_PATH = path.join(ROOT, 'state', 'teams.json');

export const EVENT_TYPES = new Set([
  'message', 'enter', 'tool', 'verdict',
  'round_start', 'round_end', 'milestone', 'note',
]);
export const VERDICTS = new Set(['PASS', 'REVISE', 'FAIL']);

/**
 * 마일스톤당 허용되는 반박 횟수. 넘으면 자동 FAIL — 사람을 부른다.
 * 라운드가 아니라 마일스톤의 것이다. 라운드를 닫고 다시 열면 0 으로 돌아가던 시절에 R10·R11 이 각각 3회를 채우고도
 * 같은 마일스톤이 이어졌다 (2026-09-12). 0 으로 돌리는 것은 감사 PASS 와 대표의 재개뿐이다 (대표 결정, 2026-09-13).
 */
export const MAX_ATTEMPTS = 3;

/* ── 보호 브랜치 ──
 *
 * 실행자가 밀지 않고, 푸시 요청에 묶이지 않는 브랜치 — 원격의 기본 브랜치다. 메인 병합은 C 등급이라 B 로 우회할
 * 수 없어야 한다. 'main'·'master' 를 박아 두면 기본 브랜치 이름이 다른 저장소(이 저장소가 그렇다)에서 아무것도
 * 못 막는다 (대표 결정 9, 2026-09-13). 원격 HEAD 를 모르면 null — 부르는 쪽은 막는 쪽으로 처리한다.
 * (`git remote set-head origin -a` 로 잡힌다.)
 */
export function protectedBranch() {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^refs\/remotes\/origin\/(.+)$/.exec(ref)?.[1] ?? null;
  } catch { return null; }
}

/** 이 브랜치·SHA 를 푸시 요청에 묶어도 되는가. 안 되면 던진다. approve.mjs 가 HEAD 를 읽어 부른다. */
export function pushAction(branch, sha, remote = 'origin') {
  if (!branch || branch === 'HEAD') throw new Error('분리된 HEAD 는 푸시 대상이 될 수 없습니다. 브랜치를 체크아웃하세요.');
  const guarded = protectedBranch();
  if (!guarded) throw new Error('원격 기본 브랜치를 모릅니다 (refs/remotes/origin/HEAD 없음). git remote set-head origin -a 뒤에 다시 요청하세요.');
  if (branch === guarded) throw new Error(`'${branch}' 는 원격 기본 브랜치라 B 로 밀 수 없습니다. 메인 병합은 C 등급 — 대표가 직접 합니다.`);
  return { type: 'push', remote, branch, sha };
}

/** 지금 HEAD 의 SHA — 판정 카드에 박는다 (결정 63). git 이 없거나 저장소가 아니면 null. */
export function headSha() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

/**
 * 푸시 문 (대표 결정 63) — 톰·제리는 "올려도 되나" 를 보지 코드를 감사하지 않는다. 그래서 B 푸시는 그 방의 외부감사가
 * 그 커밋을 PASS 한 뒤에만 걸 수 있다. 순수 함수: 현재 라운드의 이벤트와 밀 SHA. 이 라운드의 **마지막** 외부감사 카드(stale 아닌 것)가
 * PASS 이고 그 meta.sha 가 같아야 한다. 요청(requestApproval)과 실행자(executor.mjs) 둘 다 본다. 못 열면 이유 문장, 열리면 null.
 */
export function pushGateError(events, sha, { actor = 'outside' } = {}) {
  const cards = (events ?? []).filter((e) => e.type === 'verdict' && e.actor === actor && !e.meta?.stale);
  if (!cards.length) return '이 라운드에 외부감사 판정 카드가 없습니다 — 레오 PASS 뒤에 푸시를 요청합니다 (결정 63).';
  const last = cards[cards.length - 1];
  if (last.meta?.verdict !== 'PASS') return `외부감사의 마지막 판정이 ${last.meta?.verdict ?? '?'} 입니다 — PASS 뒤에 푸시를 요청합니다 (결정 63).`;
  if (!last.meta?.sha) return '외부감사 PASS 카드에 SHA 가 없습니다(문 전의 카드) — 다시 감사받은 뒤 요청합니다 (결정 63).';
  if (last.meta.sha !== sha) return `외부감사가 PASS 한 것은 ${last.meta.sha.slice(0, 8)} 인데 밀려는 것은 ${String(sha).slice(0, 8)} 입니다 — PASS 뒤에 커밋했으면 다시 감사받습니다 (결정 63).`;
  return null;
}

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
 * 턴의 종류를 말하는 표시. 들려주기 안에 들어간다.
 *   ⟦판정 요청⟧ <대상>  — 답의 첫 줄이 PASS/REVISE/FAIL 이면 훅이 판정 카드로 남긴다 (모든 엔진이 같은 규약).
 *   ⟦일지⟧             — 답은 대화록에 남지 않는다. 서버가 받아 journal/<자리>.md 에 붙인다.
 * 훅은 UserPromptSubmit 에서 종류를 state/turn/<방>.<자리> 에 적고 Stop 에서 읽는다 — 에이전트가 기억할 규칙이 아니다.
 */
export const TURN_VERDICT = '⟦판정 요청⟧';
export const TURN_JOURNAL = '⟦일지⟧';
/**
 * 일지 차례의 지시문 — 클로드 자리(server/session.mjs journalAll)와 codex 자리(bus/outside.mjs --turn journal)가 같은 문장을 받는다.
 * 첫 문장은 "나는 …" 한 줄 — 일지는 정체성의 연결고리라(대표 지시 2026-09-13) 마을 카드가 그 한 줄을 "어제" 로 보여준다(결정 13).
 * 둘이 다른 문장을 받으면 codex 자리의 일지에만 그 줄이 없다 (M1 인격 이음, 2026-09-13).
 */
export const journalPrompt = (round) => `${TURN_JOURNAL} 라운드 ${round} 이 끝난다. 네 말투로 한 문단(3~6줄)을 써라. 첫 문장은 네가 누구인지 한 줄("나는 …" — 이름·기질·지금 마음가짐), 그다음 이번 라운드에서 배운 것·판단한 이유·버린 시도·막힌 곳·사람들과 있었던 일. 파일 이름·완료율·다음 할 일 목록은 쓰지 마라 — 그건 git 이 안다. 남길 일이 없어도 첫 문장은 쓴다.`;
/**
 * 일지 걷기 — 한 번 묻고, 못 받은 자리에게만 한 번 더 (M1 인격 이음, 2026-09-13).
 * once(actor) 는 받았으면 true. 시간 초과·빈 답·(패스) 는 전부 false — 조용히 0 으로 세지 않고 note 로 남긴다.
 * 세션·codex 를 모르는 순수 함수라 round.mjs check 가 가짜 once 로 돌려 본다 (레오 REVISE R19: 재시도 경로가 실측된 적이 없었다).
 */
export async function collectJournals(actors, once, { note = () => {}, nameOf = (a) => a, round = null } = {}) {
  const first = await Promise.all(actors.map(once));
  const missed = actors.filter((a, i) => !first[i]);
  let retried = 0;
  let still = [];
  if (missed.length) {
    note(`일지를 못 받은 자리: ${missed.map(nameOf).join(', ')} — 한 번 더 묻습니다.`);
    const second = await Promise.all(missed.map(once));
    retried = second.filter(Boolean).length;
    still = missed.filter((a, i) => !second[i]);
    if (still.length) note(`두 번 물어도 일지를 못 받았습니다: ${still.map(nameOf).join(', ')} — 라운드 ${round} 일지 없이 닫습니다.`);
  }
  return { got: first.filter(Boolean).length + retried, missed, still };
}
/**
 * 한 번 더 부르기(8단계 ① — codex 를 강제로 죽여도 1회 재시도). fn(attempt) 가 던지면: fatal(e) 이 참(계정 한도 같은 것)이면 그대로 던지고,
 * 아니면 onRetry(e, attempt) 를 부른 뒤 다시. tries 번 다 실패하면 마지막 오류에 attempts·gaveUp 을 붙여 던진다.
 * 엔진을 모르는 순수 함수라 round.mjs check 가 가짜 fn 으로 돌려본다 — outside.mjs 는 등록된 방에서만 돌아 거기서 못 잰다.
 */
export async function withRetry(fn, { tries = 2, fatal = () => false, onRetry = () => {} } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fn(attempt); }
    catch (e) {
      last = e;
      if (fatal(e)) throw e;
      if (attempt < tries) await onRetry(e, attempt);
    }
  }
  last.attempts = tries; last.gaveUp = true;
  throw last;
}
export function turnKindOf(text) {
  const s = String(text ?? '');
  if (s.includes(TURN_JOURNAL)) return 'journal';
  if (s.includes(TURN_VERDICT)) return 'verdict';
  return null;
}
export const TURN_DIR = path.join(ROOT, 'state', 'turn');
// 파일 이름에 세션 id 가 들어간다. 같은 방·자리에 세션이 둘(닫히는 것과 새것)이면 한 파일을 덮어썼다 (레오 감사, 2026-09-12).
// 서버가 턴을 stdin 에 쓰기 전에 먼저 적고(session.mjs write), 훅의 UserPromptSubmit 도 적는다 — 비동기 훅이 늦어도 서버 것이 있다.
const turnFile = (team, actor, sid) => path.join(TURN_DIR, sid ? `${team}.${actor}.${String(sid).replace(/[^A-Za-z0-9_-]/g, '_')}` : `${team}.${actor}`);
export function writeTurn(team, actor, kind, extra = '', sid = null) {
  fs.mkdirSync(TURN_DIR, { recursive: true });
  fs.writeFileSync(turnFile(team, actor, sid), extra ? `${kind}:${extra}` : kind);
}
export function takeTurn(team, actor, sid = null) {
  const parse = (s) => { const i = s.indexOf(':'); return i < 0 ? { kind: s, extra: '' } : { kind: s.slice(0, i), extra: s.slice(i + 1) }; };
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
  const drop = (f) => { try { fs.unlinkSync(f); } catch { /* 없다 */ } };
  const plainFile = turnFile(team, actor, null);
  if (sid) {
    const f = turnFile(team, actor, sid);
    const s = read(f);
    if (s != null) {
      drop(f);
      // 서버가 세션 id 를 아직 모를 때(첫 턴) 적은 일반 마커가 같은 턴의 것이면 같이 치운다. 내용이 다르면 남의 것이다 —
      // 무조건 지우면 다른 세션의 마커가 사라진다 (레오 감사, 2026-09-12).
      if (read(plainFile) === s) drop(plainFile);
      return parse(s);
    }
  }
  const s = read(plainFile);
  if (s == null) return null;
  drop(plainFile);
  return parse(s);
}

/** 판정의 첫 줄 규약. PASS/REVISE/FAIL 한 단어면 그 판정, 아니면 null. */
export function splitVerdictLine(text) {
  const [first, ...rest] = String(text ?? '').split('\n');
  const v = first.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (VERDICTS.has(v)) return { verdict: v, body: rest.join('\n').trim() || String(text) };
  return null;
}

/** 일지에 한 문단 붙인다 — 최신이 맨 위. 첫 줄이 머리(## …)가 아니면 붙여 준다. */
export function appendJournal(team, actor, text, { round = null } = {}) {
  const body = String(text ?? '').trim();
  if (!body || /^\(?패스\)?[.·\s]*$/.test(body)) return false;
  const cast = readCast(team).agents ?? {};
  const name = cast[actor]?.name ?? actor;
  const date = new Date().toISOString().slice(0, 10);
  const head = `## ${date} · 라운드 ${round ?? readState(team).round} · ${name}`;
  const para = body.startsWith('## ') ? body : `${head}\n\n${body}`;
  const dir = path.join(paths(team).dir, 'journal');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${actor}.md`);
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* 첫 문단 */ }
  fs.writeFileSync(file, para + '\n\n' + old);
  return true;
}

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
  return addressees(text, cast, { except })[0] ?? null;
}

/**
 * 한 발언이 부른 사람 전부, 부른 순서대로. 첫머리뿐 아니라 문단(빈 줄) 첫머리의 호명도 본다.
 * "대표님, … / 안젤, … / 다니엘, …" 에서 첫 24자만 보면 안젤·다니엘은 안 깨어 대표가 "죽어 있는 것 같다" 고 봤다
 * (하영 진단, 2026-09-13 — 대표 결정 22). 같은 사람은 한 번만.
 */
export function addressees(text, cast, { except = null } = {}) {
  const out = [];
  const paras = String(text ?? '').split(/\n\s*\n/);
  for (const p of paras) {
    const head = p.trim().slice(0, 24);
    for (const [id, a] of Object.entries(cast ?? {})) {
      if (id === except || id === 'system' || !a?.name || out.includes(id)) continue;
      // 이름을 정규식에 그대로 넣으면 "함동혁(댄)" 의 괄호가 그룹이 되어 영영 안 잡힌다.
      if (new RegExp('^' + escapeRegExp(a.name) + '\\s*(씨|님)?\\s*[,，、:·]').test(head)) { out.push(id); break; }
    }
  }
  return out;
}
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 대표를 불렀나. 캐스트의 대표 이름 외에 "대표님·대표·댄" 도 호명이다 — 사람들은 이름보다 직함으로 부른다. */
export function callsBoss(text, cast) {
  if (addressees(text, cast).includes('boss')) return true;
  return /(^|\n\s*\n)\s*(대표님|대표|댄)\s*(씨|님)?\s*[,，、:·]/.test(String(text ?? ''));
}
/**
 * 결정이 필요한 말의 표 (결정 52) — 물음표 · "정해 주세요·골라·답해" + 대표에게 해 달라는 부탁(결정 66: 주세요·주시면·해 주세요·부탁·허용·실행).
 * 헨리 "zip 받아 풀어 주시면" 이 보고로 빠지면 대표가 못 본다. 이게 없으면 대표를 불렀어도 보고다 — "올렸습니다·됐습니다".
 */
export const ASK_RE = /[?？]|정해\s*주|골라|답해|주세요|주시면|해\s*주|부탁|허용|실행/;
/**
 * 대표에게 결정을 청했나 (결정 52) — 대표를 부른 **그 문단** 안에 물음이 있어야 한다. 종 배지(`bossCall`)는 이것만 본다.
 * "대표님, 정리했습니다." 는 보고라 종이 안 울리고 관제탑 "오늘 보고" 줄로 간다 — 하영·헨리 보고가 승인 요청으로 읽힌 09-13 건.
 * 다른 사람 문단의 물음은 대표 것이 아니다 — "대표님, 보고드립니다.\n\n솔라, 이 수치 맞아?" 는 솔라에게 물은 것 (레오 REVISE, R23).
 * 이름 없는 다음 문단도 안 센다 — 전엔 앞 문단의 상대에게 이어진다고 봤는데, 톰의 "대표님, 비교가 나왔습니다. … (셋째 문단) 그때 정해 주시면 됩니다" 와
 * 세라가 비서실 캐스트 밖 사람에게 한 "나리, 검토 부탁해요" 가 대표 차례로 서서 대표 종에 넷이 남았다(나리 결정 ①, 09-15 — 대표 물음
 * "결재 알림 왜 안 없어지냐"). 글 가운데의 "대표님" 은 0 — 문단 첫머리 호명만.
 */
export function asksBoss(text, cast) {
  return String(text ?? '').split(/\n\s*\n/).some((p) => callsBoss(p, cast) && ASK_RE.test(p));
}
/**
 * 대표에게 한 그 문단 — 인용은 첫 줄이 아니라 대표에게 한 말이어야 한다. "헨리, 셌어. …" 로 시작하는 말의 넷째 문단이 "대표님, 한 줄요 — …" 였는데
 * 관제탑 내 차례·종·자정 마감이 첫 줄을 보여 줘 "클레멘타인이 헨리한테 한 말이 대표 차례로 선다" 로 읽혔다(나리 09-15). asksBoss 와 같은 선으로
 * 대표를 부르며 물은 문단을 찾고, 없으면(부르기만 했으면) 대표를 부른 첫 문단, 그것도 없으면 원문.
 */
export function bossParagraph(text, cast) {
  const called = String(text ?? '').split(/\n\s*\n/).filter((p) => callsBoss(p, cast));
  return called.find((p) => ASK_RE.test(p)) ?? called[0] ?? String(text ?? '');
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
  // 문구는 대표 결정 46 (09-13) — C 는 방향만, 방향 안의 일은 B + 그 팀 감사 토론. docs/event-schema.md 6절 표와 같은 글.
  A: { label: '자동', needs: [],                   desc: '브랜치 안 커밋 · 산출물 쓰기 · 라운드 열고 닫기 · 감사역 부르기' },
  B: { label: '총괄', needs: ['chief', 'outside'], desc: '방향 안의 일 — 원격 푸시 · 다음 마일스톤 착수 · 팀 사이 요청 · 세션 재시작 · 마일스톤 순서 조정 · 인격 파일 재생성 · 화면 문구 · 브랜딩 글' },
  C: { label: '대표', needs: ['boss'],             desc: '방향만 — 로드맵 목적지 변경 · 컷 리스트 · 비용 상한 · 외부 발송 · 본책 병합' },
};
export const APPROVALS_PATH = path.join(ROOT, 'state', 'approvals.jsonl');

function appendApproval(line) {
  fs.mkdirSync(path.dirname(APPROVALS_PATH), { recursive: true });
  fs.appendFileSync(APPROVALS_PATH, JSON.stringify(line) + '\n');
}

/** 요청과 판정 줄을 접어서 요청 하나당 상태 하나로 만든다. */
export function listApprovals({ team = null, status = null } = {}) {
  const byId = new Map();
  for (const l of readJSONLCached(APPROVALS_PATH)) {
    if (l.kind === 'request') {
      byId.set(l.id, { ...l, decisions: [], status: l.grade === 'A' ? 'passed' : 'pending', decidedAt: l.grade === 'A' ? l.ts : null });
      continue;
    }
    if (l.kind === 'void') {
      // 지우지 않는다. 무효라고 한 줄 더 쓴다 — 대화록과 같은 원칙.
      const r = byId.get(l.id);
      if (r) { r.status = 'void'; r.decidedAt = l.ts; r.voidReason = l.reason ?? ''; }
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

export function requestApproval(team, { by = 'guide', grade, what, detail = '', action = null, files = [] }) {
  const g = String(grade || '').toUpperCase();
  if (!APPROVAL_GRADES[g]) throw new Error(`등급은 A / B / C 중 하나여야 합니다.`);
  if (!what?.trim()) throw new Error('무엇을 승인받을지가 비어 있습니다.');
  // 카드에 붙일 산출물 — teams/<팀>/out/ 기준 상대 경로. 요청 시 있어야 한다 (대표 결정 36).
  const outs = (files ?? []).map((f) => String(f).trim().replace(/^out\//, '')).filter(Boolean);
  for (const f of outs) {
    const file = outFile(team, f);
    if (!file || !fs.existsSync(file)) throw new Error(`teams/${team}/out/${f} 이 없습니다. 산출물은 out/ 에 두고 그 안의 경로로 적습니다.`);
  }
  // 푸시 문 (결정 63) — 이 라운드에 그 SHA 를 본 외부감사 PASS 카드가 있어야 한다. 총괄실은 라운드가 없어 못 건다.
  if (action?.type === 'push') {
    if (isOffice(team)) throw new Error('총괄실에서는 푸시를 걸 수 없습니다 — 팀 방에서 외부감사 PASS 뒤에 겁니다 (결정 63).');
    const bad = pushGateError(readContext(team), action.sha);
    if (bad) throw new Error(bad);
  }
  const rec = {
    kind: 'request', id: 'apr_' + crypto.randomBytes(4).toString('hex'),
    ts: new Date().toISOString(), team, by, grade: g, what: what.trim(), detail: String(detail ?? '').trim(),
    round: readState(team).round || 0,
    // 실행 대상을 요청에 묶는다. 푸시라면 그때의 브랜치·SHA 다. 실행자는 이 값만 믿는다 —
    // 자유 텍스트를 정규식으로 훑어 "푸시인가"를 짐작하지 않는다 (레오 감사, 2026-09-02).
    ...(action ? { action } : {}),
    ...(outs.length ? { files: outs } : {}),
  };
  // 방에도 남긴다 — 화면에서 가장 약한 줄이지만, 나중에 "언제 요청했나"를 찾을 수 있어야 한다.
  // 그 줄의 id 를 레코드에 박아 카드의 "방에서 보기" 가 요청자 원문으로 건너간다 (결정 20-2).
  const ev = emit(team, {
    actor: by, type: 'note',
    text: `승인 요청 [${g}] ${rec.what}${g === 'A' ? ' — 자동 통과' : ''}`,
    meta: { approval: rec.id, grade: g },
  });
  rec.note = ev.id;
  appendApproval(rec);
  return listApprovals().find((r) => r.id === rec.id);
}

/**
 * 카드가 펼칠 "바뀌는 것" — 요청에 박힌 action 을 지금 상태로 푼다 (결정 20-2). 큐 파일에는 안 쓴다.
 * 읽을 때마다 git·파일을 보므로 API 가 카드를 줄 때만 부른다. 못 읽으면 { error } — 모르면서 승인하게 두지 않는다.
 */
export function approvalPreview(r) {
  const a = r.action;
  if (!a) return null;
  try {
    if (a.type === 'push') {
      const g = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      let base = null;
      try { base = g(['rev-parse', '--verify', '--quiet', `${a.remote ?? 'origin'}/${a.branch}`]) && `${a.remote ?? 'origin'}/${a.branch}`; } catch { /* 원격에 아직 없는 브랜치 */ }
      if (!base) { const p = protectedBranch(); base = p ? `origin/${p}` : null; }
      if (!base) return { error: '비교할 기준 브랜치를 모릅니다 (origin/HEAD 없음)' };
      const count = Number(g(['rev-list', '--count', `${base}..${a.sha}`])) || 0;
      const commits = g(['log', '--format=%s', '--max-count=8', `${base}..${a.sha}`]).split('\n').filter(Boolean);   // 제목은 앞 8개만
      const files = g(['diff', '--name-only', `${base}...${a.sha}`]).split('\n').filter(Boolean);
      return { branch: a.branch, sha: a.sha, base, count, commits, files };
    }
    if (a.type === 'milestone') {
      const m = (readRoadmap(r.team).milestones ?? []).find((x) => x.n === a.n);
      return m ? { n: a.n, title: m.title ?? a.title ?? null, deliverable: m.deliverable ?? null } : { error: `마일스톤 ${a.n} 이 로드맵에 없습니다` };
    }
    if (a.type === 'roadmap') {
      const src = path.resolve(paths(r.team).out, path.basename(String(a.file)));
      const p = JSON.parse(fs.readFileSync(src, 'utf8'));
      if (!Array.isArray(p.milestones)) return { error: `${path.basename(src)}: milestones 가 배열이 아닙니다` };
      return {
        file: path.basename(src),
        destination: p.destination ?? null,
        milestones: p.milestones.map((m) => ({ n: m.n, title: m.title ?? '', status: m.status ?? null })),
        cutList: Array.isArray(p.cutList) ? p.cutList : [],
      };
    }
    // request·proxy 는 여기서 안 푼다 — app.js previewNode 가 action 을 그대로 받아 사람 말로 보여준다(a848f88, R25).
    // 여기서 값을 채우면 화면의 !p 특수 분기가 안 타서 오히려 "행동: request" 로 퇴화한다.
    return null;
  } catch (e) {
    return { error: String(e.message).slice(0, 160) };
  }
}

/**
 * 카드가 펼칠 산출물 (대표 결정 36 — "그림이 없는데 어떻게 승인해"). 요청의 files(--out)와 what·detail 에 적힌
 * out/… 경로를 모아 지금 상태로 stat 한다. 큐 파일에는 안 쓴다. 없는 파일은 missing — 모르면서 승인하게 두지 않는다.
 */
export function approvalArtifacts(r) {
  const items = new Map();
  const add = (f) => { if (!items.has(`${f.team}/${f.rel}`)) items.set(`${f.team}/${f.rel}`, f); };
  for (const f of r.files ?? []) add(outItem(r.team, String(f).replace(/^out\//, '')));
  for (const f of findOutPaths(`${r.what ?? ''}\n${r.detail ?? ''}`, r.team)) add(f);
  return [...items.values()].map((f) => {
    const file = f.root === 'in' ? inFile(f.team, f.rel) : outFile(f.team, f.rel);
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      return { ...f, size: st.size, at: st.mtime.toISOString() };
    } catch { return { ...f, missing: true }; }
  });
}

/**
 * GET /out/<팀>/<경로> 가 여는 실제 파일. teams/<팀>/out/ 밖(..)·숨김 파일·없는 팀은 null.
 * 읽기 전용 내보내기다 — 서버는 이 경로로 쓰지 않는다 (대표 결정 36).
 */
export function outFile(team, rel) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(team ?? '')) || !teamExists(team)) return null;
  const parts = String(rel ?? '').split('/');
  if (!parts.length || parts.some((s) => !s || s === '..' || s.startsWith('.'))) return null;
  const dir = paths(team).out;
  const file = path.join(dir, ...parts);
  return file.startsWith(dir + path.sep) ? file : null;
}

/**
 * GET /in/<팀>/<경로> 가 여는 실제 파일 — 대표가 방에 올린 그림(결정 130 ②). teams/<팀>/in/ 밖(..)·숨김 파일·없는 팀은 null.
 * out/ 과 같은 경계(outFile), 폴더만 다르다 — 여기도 서버가 이 경로로 쓰지 않는다(업로드 저장만 새 파일 이름으로).
 */
export function inFile(team, rel) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(team ?? '')) || !teamExists(team)) return null;
  const parts = String(rel ?? '').split('/');
  if (!parts.length || parts.some((s) => !s || s === '..' || s.startsWith('.'))) return null;
  const dir = paths(team).in;
  const file = path.join(dir, ...parts);
  return file.startsWith(dir + path.sep) ? file : null;
}

export function voidApproval(id, reason = '') {
  const r = listApprovals().find((x) => x.id === id);
  if (!r) throw new Error(`그런 요청이 없습니다: ${id}`);
  appendApproval({ kind: 'void', id, reason: String(reason ?? '').trim(), ts: new Date().toISOString() });
  return listApprovals().find((x) => x.id === id);
}

export function decideApproval(id, { by, decision, reason = '', team = null, proxy = null }) {
  const r = listApprovals().find((x) => x.id === id);
  if (!r) throw new Error(`그런 요청이 없습니다: ${id}`);
  if (r.status !== 'pending') throw new Error(`이미 끝난 요청입니다 (${r.status}).`);
  const d = String(decision || '').toUpperCase();
  if (!['PASS', 'REVISE'].includes(d)) throw new Error('판정은 PASS 또는 REVISE 입니다.');
  const needs = APPROVAL_GRADES[r.grade].needs;
  if (!needs.includes(by)) throw new Error(`등급 ${r.grade} 는 ${needs.join('·')} 이(가) 판정합니다. '${by}' 는 아닙니다.`);
  // B 의 chief·outside 는 총괄실 사람이다 — 톰과 제리. 'outside' 라는 자리 이름은 방마다 있어서
  // 개발팀의 레오가 제리 몫의 대조를 기록할 수 있었다 (Fable 감사가 격리 실행으로 뚫었다, 2026-09-02).
  // 판정하는 프로세스가 자기 방을 같이 대야 한다. 대표(boss)는 방이 없다.
  if ((by === 'chief' || by === 'outside') && team !== 'hq') {
    throw new Error(`등급 ${r.grade} 의 ${by} 판정은 총괄실에서만 합니다 (지금 방: ${team ?? '없음'}).`);
  }
  if (r.decisions.some((x) => x.by === by)) throw new Error(`${by} 는 이미 판정했습니다.`);
  // 대리 결정 (결정 85) — by 는 boss 지만 정한 건 톰·제리다. 줄에 남겨 아침에 대표가 뒤집을 수 있게.
  appendApproval({ kind: 'decision', id, by, decision: d, reason: String(reason ?? '').trim(), ts: new Date().toISOString(), ...(proxy ? { proxy } : {}) });
  const after = listApprovals().find((x) => x.id === id);
  if (after.status !== 'pending') {
    emit(r.team, {
      actor: 'system', type: 'note',
      text: `${proxy ? '대리 결정 — ' : ''}승인 ${after.status === 'passed' ? '통과' : '반려'} [${r.grade}] ${r.what}${reason ? ' — ' + reason : ''}`,
      meta: { approval: id, grade: r.grade, status: after.status, ...(proxy ? { proxy } : {}) },
    });
  }
  return after;
}

/* ── 대리 결정 (대표 결정 85) — 대표가 10분 넘게 답이 없으면 톰·제리 둘의 합의로 ── */
export const PROXY_WAIT_MS = Number(process.env.PPANAM_PROXY_WAIT_MS || 10 * 60_000);
/** ④ 돈 나가는 것·바깥으로 나가는 것은 대리 대상이 아니다 — 낱말로 거른다(보수적으로). C 승인에도, 방의 물음(answer)에도 같은 선. 순수. */
// 낱말 하나로 거르면 같이 걸리는 말이 있다 — "외부" 는 우리 자리 이름 "외부 감사"(다섯) 에 걸려 헨리의 도면 승인이 밤새 대리 후보에서 빠졌다(하네스 R24).
// "돈" 은 "서버가 돈다" 에 걸린다. 그래서 외부 는 뒤에 감사 가 안 올 때만, 돈 은 뒤에 다·되·된·돌 이 안 올 때만.
// ".claude 밑" 도 대표만 — 결정 136 원문 "돈·바깥·.claude 는 대표만"(제리 REVISE apr_4fb49ab6: 8b1661c 가 셋 중 .claude 를 빠뜨렸다). 훅·settings.json 은 그 경로가 글에 있을 때.
export const proxyForbidden = (text) => /비용|상한|결제|돈(?![다되된돌])|유료|과금|외부(?!\s?감사)|발송|메일|공개|병합|\.claude/.test(String(text ?? ''));
/**
 * C 카드가 대리 대상인가 — 낱말 검사는 **what(무엇)** 과 action 에만. detail(요청자의 설명 글)은 안 훑는다 — 설명에 "돈·바깥이 아니라 대리 대상" 이라 적은 로드맵 카드가
 * '돈' 에 걸려 후보에서 빠졌다(톰 09-15, apr_1bf1b266 — 결정 111 때 '외부 감사' 로 겪은 그 병). 부정어("아니라") 뒤를 빼는 식은 또 다른 낱말에 걸린다.
 * 돈·바깥 부탁은 what 에 있어야 부탁이고(설명에 숨긴 것은 톰·제리가 대리 판정하며 읽는다), 구조 있는 것은 action.type(cost·send·merge)이 거른다. 방의 물음(answer)은 그 말 전체 그대로.
 */
export function proxyEligible(r) {
  if (!r || r.grade !== 'C' || r.status !== 'pending') return false;
  if (['cost', 'send', 'merge'].includes(r.action?.type)) return false;
  return !proxyForbidden(r.what ?? '');
}
/** 대표가 마지막으로 말한 지 얼마나 됐나(ms) — 어느 방이든. 대표가 방금 말했으면 대리는 안 한다. 말한 적 없으면 Infinity. */
export function bossQuietFor(now = Date.now()) {
  let last = 0;
  for (const t of listTeams()) {
    const log = readLog(t.id);
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.type === 'message' && e.actor === 'boss' && !e.meta?.via) { last = Math.max(last, new Date(e.ts).getTime()); break; }
    }
  }
  return last ? now - last : Infinity;
}
/**
 * 지금 대리로 정할 수 있는 대표 차례 — [{ key, kind, team, ref, what, since }]. 10분 넘게 기다린 것만, 대표가 10분 넘게 조용할 때만.
 * kind: approval(C 대기) · unblock(FAIL 로 막힘) · answer(결정을 청한 말에 답 없음). 순수한 부분은 overdue() — check 가 돌려본다.
 */
export function overdue(items, { now = Date.now(), wait = PROXY_WAIT_MS } = {}) {
  return items.filter((it) => it.since && now - new Date(it.since).getTime() >= wait);
}
/* ── 위임 스위치 (결정 136 · 나리 09-15 — 대표 원문 "일단 승인버튼 눌렀는데 다음부턴 너가 처리해") ──
 * state/delegation.json { "to": "system", "until": "2026-09-16T01:00:00Z", "decision": 136 }. until 안이면 C 카드가 대리 후보에 **바로** 든다(10분·대표 조용 조건 없이),
 * 대리 판정 note 에 "대리 — 나리 위임 136" 이 붙는다. 돈·바깥(proxyForbidden)은 그대로 대표만. until 이 지나면 파일이 있어도 평소대로. 나리는 --decide 를 못 하니 이게 제일 짧은 길.
 */
const DELEGATION_PATH = path.join(ROOT, 'state', 'delegation.json');
/** 순수 — 파일 내용이 지금 살아 있는 위임인가. until 이 없거나 지났으면 null. check 가 돌린다. */
export function delegationActive(d, now = Date.now()) {
  if (!d || typeof d !== 'object') return null;
  const until = Date.parse(d.until ?? '');
  if (!Number.isFinite(until) || now >= until) return null;
  return { to: d.to ?? 'system', until: new Date(until).toISOString(), decision: d.decision ?? null };
}
export function readDelegation(now = Date.now()) { return delegationActive(readJSON(DELEGATION_PATH, null), now); }
/** note·판정 이유 꼬리 — " — 대리, 나리 위임 136". 위임이 없으면 빈 문자열. */
export function delegationTag(now = Date.now()) {
  const d = readDelegation(now);
  if (!d) return '';
  const who = d.to === 'system' ? (readCast('hq').agents?.system?.name ?? '나리') : (readCast('hq').agents?.[d.to]?.name ?? d.to);
  return ` — 대리, ${who} 위임${d.decision != null ? ' ' + d.decision : ''}`;
}

export function proxyCandidates({ now = Date.now(), wait = PROXY_WAIT_MS, withExcluded = false, delegation = readDelegation(now) } = {}) {
  const items = [], excluded = [], immediate = [];
  const quiet = bossQuietFor(now) >= wait;
  const result = () => {
    const due = quiet ? overdue(items, { now, wait }) : [];
    return withExcluded ? { items: [...immediate, ...due], excluded: quiet ? overdue(excluded, { now, wait }) : [] } : [...immediate, ...due];
  };
  for (const r of listApprovals({ status: 'pending' })) {
    if (r.grade !== 'C') continue;
    const it = { key: `approval:${r.id}`, kind: 'approval', team: r.team, ref: r.id, what: r.what, since: r.ts };
    // ④ 돈·바깥은 후보가 아니다 — 대표만(위임 중에도). 빠진 것도 돌려줘 총괄실에 한 줄 남기게(조용히 사라지지 않게). 위임 중이면 나머지는 기다리지 않고 바로
    (!proxyEligible(r) ? excluded : delegation ? immediate : items).push(it);
  }
  if (!quiet && !immediate.length) return withExcluded ? { items: [], excluded: [] } : [];
  for (const t of listTeams()) {
    if (isOffice(t.id)) continue;
    const st = readState(t.id);
    const log = readLog(t.id);
    if (st.phase === 'blocked') {
      const fail = [...log].reverse().find((e) => e.round === st.round && e.type === 'verdict' && e.meta?.verdict === 'FAIL');
      items.push({ key: `unblock:${t.id}:${st.round}`, kind: 'unblock', team: t.id, ref: String(st.round), what: `${t.name} 방이 FAIL 로 막힘${fail ? ' — ' + String(fail.text).split('\n')[0].slice(0, 80) : ''}`, since: fail?.ts ?? st.startedAt });
    }
    const s = teamSummary(t.id);
    if (s.bossCall) {
      const call = log.find((e) => e.id === s.bossCall.id);
      // 물음도 같은 선(④) — "유료 결제를 허용해 주세요" 를 질문 경로로 대리하면 금지선을 우회한다 (레오 REVISE R23). 그건 대표만.
      const it = { key: `answer:${s.bossCall.id}`, kind: 'answer', team: t.id, ref: s.bossCall.id, what: `${readCast(t.id).agents?.[s.bossCall.by]?.name ?? s.bossCall.by}: ${bossParagraph(call?.text, readCast(t.id).agents ?? {}).replace(/\s+/g, ' ').slice(0, 120)}`, since: s.bossCall.ts };
      (proxyForbidden(call?.text) ? excluded : items).push(it);
    }
  }
  return result();
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

/**
 * 파일이 바뀌지 않았으면 지난번 파싱 결과를 돌려준다.
 *
 * 서버는 250ms 마다 다섯 방의 요약을 만든다. 그때마다 대화록 전체를 파싱하면(teamSummary → readLog)
 * 대화록이 자랄수록 서버가 느려진다 — "하루종일 대화" 를 요구한 시스템에서 치명적이다 (Fable 재점검, 2026-09-12).
 * 크기·수정 시각이 같으면 같은 파일이다. 돌려주는 배열은 공유되므로 고치지 않는다.
 */
const jsonlCache = new Map();   // file → { size, mtimeMs, rows }
function readJSONLCached(file) {
  let st;
  try { st = fs.statSync(file); } catch { jsonlCache.delete(file); return []; }
  const hit = jsonlCache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.rows;
  const rows = parseJSONL(safeRead(file));
  jsonlCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, rows });
  return rows;
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

/**
 * 방의 규칙 셋(결정 132, 계약 0절) — state/teams.json 의 owner · speakers · only. 없으면 열린 방.
 * 비서실(sera)은 { owner:'secretary', speakers:['boss','secretary'], only:['message'] } — 세라의 보고와 대표 말만 남는다.
 */
export function roomRules(id) {
  const t = listTeams().find((x) => x.id === id) ?? {};
  return {
    owner: t.owner ?? (t.kind === 'office' ? 'chief' : 'guide'),
    speakers: Array.isArray(t.speakers) && t.speakers.length ? t.speakers : null,
    only: Array.isArray(t.only) && t.only.length ? t.only : null,
  };
}
/** 이 사건이 이 방에 기록될 수 있나 — 순수(규칙 → 참/거짓). emit 이 쓰고 check 가 돌린다. */
export function allowedIn(rules, { actor = 'system', type = 'message' } = {}) {
  if (rules.speakers && !rules.speakers.includes(actor)) return false;
  if (rules.only && !rules.only.includes(type)) return false;
  return true;
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
    in: path.join(dir, 'in'),
  };
}

/* ── 상태 ── */

// attempt 는 지금 라운드의 마일스톤 값(화면·CLI 가 읽는 것), attempts 는 마일스톤 키별 값 — 라운드를 닫아도 남고 다음 startRound 가 물려받는다.
const BLANK_STATE = {
  round: 0, milestone: 0, phase: 'idle', topic: null,
  attempt: 0, attempts: {}, startedAt: null, endedAt: null,
};

export function readState(team) {
  const file = readJSON(paths(team).state, null);
  if (file) return { ...BLANK_STATE, ...file };
  // 파일이 없다 — 지워졌거나(round.json 은 git 에 없다. 이 커밋을 받은 체크아웃에서 사라진다) 처음이다.
  // 대화록이 진실이므로 거기서 되살린다. 라운드 경계는 round_start / round_end 이벤트다.
  return deriveState(team);
}

/**
 * 대화록만으로 라운드 상태를 되살린다. round.json 은 이 값의 캐시일 뿐이다.
 *
 * 마지막 경계가 round_start 면 열린 라운드다 — 번호·마일스톤·주제는 그 이벤트에 있다. 마지막 경계가 round_end 면
 * 닫힌 라운드다. 반박 횟수는 마일스톤의 것이라 대화록 전체를 훑는다 — 판정 카드의 meta.attempt 가 그 시점의 값이고,
 * PASS 카드와 대표의 재개 note 가 0 으로 돌린다.
 * (레오 감사, 2026-09-12: gitignore 만으로는 받는 쪽의 열린 라운드를 지키지 못한다.)
 */
export function deriveState(team) {
  const log = readLog(team);
  const attempts = {};
  for (const x of log) {
    const m = x.milestone ?? 0;
    if (x.type === 'verdict' && !x.meta?.stale) {
      if (x.meta?.verdict === 'PASS') attempts[m] = 0;
      else if (typeof x.meta?.attempt === 'number') attempts[m] = Math.min(Math.max(attempts[m] ?? 0, x.meta.attempt), MAX_ATTEMPTS);
    }
    if (x.type === 'note' && x.meta?.resumed) attempts[m] = 0;
  }
  let i = log.length - 1;
  for (; i >= 0; i--) if (log[i].type === 'round_start' || log[i].type === 'round_end') break;
  if (i < 0) return { ...BLANK_STATE, attempts };
  const e = log[i];
  if (e.type === 'round_end') {
    return { ...BLANK_STATE, round: e.round ?? 0, milestone: e.milestone ?? 0, phase: 'idle', endedAt: e.ts, attempts };
  }
  let phase = 'running';
  for (let j = i + 1; j < log.length; j++) {
    const x = log[j];
    if (x.type === 'verdict' && !x.meta?.stale && x.meta?.verdict === 'FAIL') phase = 'blocked';
    // 대표가 말해서 풀렸다 (resumeRound 가 남기는 note)
    if (x.type === 'note' && x.meta?.resumed) phase = 'running';
  }
  const milestone = e.milestone ?? 0;
  return {
    ...BLANK_STATE,
    round: e.round ?? 0, milestone, phase,
    topic: e.meta?.topic ?? null, attempt: attempts[milestone] ?? 0, attempts, startedAt: e.ts, endedAt: null,
  };
}

export function writeState(team, patch) {
  return writeJSON(paths(team).state, { ...readState(team), ...patch });
}

export function readCast(team) {
  return readJSON(paths(team).cast, { agents: {} });
}

/* ── 상황판 progress.json (대표 결정 23) ──
 * 로드맵이 목적지라면 이건 현재 위치다. 실무가 턴 끝·닫기마다 bus/progress.mjs 로 갱신한다. 계약은 docs/event-schema.md 3절 "상황판".
 */
export const PROGRESS_KEYS = ['doing', 'blocked', 'boss', 'next', 'done'];
const progressPath = (team) => path.join(paths(team).dir, 'progress.json');
/** 파일 그대로가 아니라 계약 모양으로 — 옛 모양(issues·left)은 blocked·next 로 읽는다. 없으면 null. */
export function readProgress(team) {
  const raw = readJSON(progressPath(team), null);
  return raw ? normalizeProgress(raw) : null;
}
/** "(없음)"·"없음"·"—"·"-" 같은 자리표시 줄은 값이 아니다 — 상황판에 적힌 "(없음)" 이 관제탑에서 막힌 것 하나로 세어졌다(나리 실측 R25). */
// "없음 — 사람 손 기다림뿐" 처럼 뒤에 설명이 붙은 것도 없는 것이다(관제탑 412 실측 09-15: 개발·마케팅 줄 둘이 막힘으로 섰다). 바꾸면 notify.js PLACEHOLDER_RE 도.
export const isPlaceholderLine = (s) => /^\s*[(（]?\s*(없음|없어요|없다|n\/a|none|-|—|·)\s*[)）]?\s*[.。]?(\s*[—\-–:·,].*)?\s*$/i.test(String(s ?? ''));
export function normalizeProgress(raw) {
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim() && !isPlaceholderLine(x)) : []);
  return {
    at: raw.at ?? null, by: raw.by ?? null, round: raw.round ?? null,
    doing: list(raw.doing), blocked: list(raw.blocked ?? raw.issues), boss: list(raw.boss), next: list(raw.next ?? raw.left), done: list(raw.done),
  };
}
/**
 * 갱신 — 준 항목만 통째로 바뀌고 안 준 항목은 그대로. clear 에 든 항목은 빈다. 순수 부분(mergeProgress)은 check 가 돌려본다.
 * @param patch { doing?, blocked?, boss?, next?, done? } 배열 · @param clear 비울 항목 이름들
 */
export function mergeProgress(prev, patch, { clear = [], by = null, round = null, now = new Date() } = {}) {
  const base = prev ? normalizeProgress(prev) : normalizeProgress({});
  const out = { ...base, at: now.toISOString(), by: by ?? base.by, round: round ?? base.round };
  for (const k of PROGRESS_KEYS) {
    if (clear.includes(k)) out[k] = [];
    else if (Array.isArray(patch?.[k]) && patch[k].length) out[k] = patch[k].map((x) => String(x).trim()).filter(Boolean);
  }
  return out;
}
export function writeProgress(team, patch, opts = {}) {
  const next = mergeProgress(readJSON(progressPath(team), null), patch, { ...opts, round: opts.round ?? readState(team).round });
  writeJSON(progressPath(team), next);
  return next;
}
/** 프롬프트·화면용 네 줄 — "하는 것: a · b / 막힌 것: (없음) / 대표 차례: … / 다음: …". 순수. */
export function progressText(p) {
  const n = normalizeProgress(p ?? {});
  const line = (label, xs) => `${label}: ${xs.length ? xs.join(' · ') : '(없음)'}`;
  return [line('하는 것', n.doing), line('막힌 것', n.blocked), line('대표 차례', n.boss), line('다음', n.next)].join('\n');
}
/** 이 라운드 동안 갱신됐나 — round.mjs end 의 경고에 쓴다. 파일이 없거나 at 이 라운드 시작보다 앞이면 false. */
export function progressFresh(team) {
  const p = readProgress(team); const st = readState(team);
  if (!p?.at || !st.startedAt) return false;
  return new Date(p.at).getTime() >= new Date(st.startedAt).getTime();
}

/* ── 자리의 엔진·모델·추론 강도 (대표 결정 69) ──
 * 대표가 관제탑 개인 카드에서 고른다. cast.json 은 C 잠금 파일이라 화면 요청을 서버가 대신 쓴다(updateCastAgent).
 * 목록은 여기 하나 — 화면(/api/boot 의 castOptions)·검증·outside.mjs 가 같은 것을 본다. 계약은 docs/event-schema.md 1절.
 */
export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'];
export const CODEX_MODELS = ['gpt-5.6-sol', 'gpt-5.1'];
// Gemini 는 임시 외부 감사(대표 결정, 09-14 — codex 계정 한도 엿새). 명령줄이 없어 파일로 주고받는다(outside.mjs runGemini · 창은 하네스가 몬다).
export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.1-pro'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
export const ENGINES = ['claude', 'gpt', 'gemini'];
export const CAST_FIELDS = ['model', 'llm', 'codexModel', 'geminiModel', 'effort', 'fallback', 'suspended'];
/**
 * 중단(결정 118 ②) — 외부 감사 자리를 "지금 못 부른다" 로 명시한다. 값은 복귀 예정일 'YYYY-MM-DD'(또는 'none' → 해제). 조용히 빠지는 게 아니라
 * 상태다: 판정 흐름이 그 걸음을 건너뛰되 방에 note 를 남기고(CLAUDE.md "외부 모델이 연결돼 있지 않으면 작전실에 남긴다"), 라운드 기록에 outsideAudited:false 가 박힌다.
 */
export const SUSPEND_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * 폴백 — 기본 엔진이 못 돌면 누가 인계받나(결정 116 ② — codex 계정 하나가 끊겨 다섯 팀이 다 섰는데 어디에도 안 적혀 있었다).
 * 자리의 `fallback` 이 먼저(`'none'` 은 "대표께 올림" — 대신 안 부른다), 없으면 다른 회사 엔진 중 나머지 하나. 클로드 자리는 폴백이 없다.
 */
export const fallbackOf = (agent) => {
  if (agent?.fallback === 'none') return null;
  if (agent?.fallback) return agent.fallback;
  return agent?.model === 'gpt' ? 'gemini' : agent?.model === 'gemini' ? 'gpt' : null;
};
/**
 * 클로드가 아닌 다른 회사 엔진인가 — 'gpt'(codex) · 'gemini'. 뜻은 "외부 감사가 될 수 있는 것".
 * 비교가 흩어져 있으면 하나가 빠질 때 그 자리가 조용히 죽는다(결정 77 — codex 자리가 관제탑에서 늘 "쉼"). 'gpt' 를 직접 비교하지 말고 이것을 쓴다.
 */
export const isForeign = (model) => model === 'gpt' || model === 'gemini';
/** 사람 말로 부르는 엔진 이름 — 판정문 meta.engine 에는 부른 이름이 아니라 답한 것을 적는다(결정 78). */
export const engineName = (model) => (model === 'gpt' ? 'codex' : model === 'gemini' ? 'gemini' : model === 'claude' ? 'claude' : null);
/** 이 자리의 codex 모델 — 자리별 값이 먼저, 없으면 환경(전 자리 공통, 옛 길), 그것도 없으면 목록 첫 것. */
export const codexModelOf = (agent) => agent?.codexModel ?? process.env.PPANAM_CODEX_MODEL ?? CODEX_MODELS[0];
export const geminiModelOf = (agent) => agent?.geminiModel ?? GEMINI_MODELS[0];
/**
 * codex CLI 인자 — 순수, bus/outside.mjs 가 쓰고 round.mjs check 가 돌려본다.
 * 샌드박스는 읽기 전용으로 못 박는다 — 기본값에 맡겼더니 codex 0.154 가 워크트리에 시험 디렉터리와 수정을 남겼다(2026-09-12).
 * `exec resume` 는 --sandbox · -m · -o 를 받지 않는다(사용법 오류 exit 2) — 같은 뜻을 -c 로. 추론 강도는 둘 다 -c model_reasoning_effort(결정 69), 없으면 안 붙인다.
 */
export function codexArgs({ model, effort = null, resume = null, outPath = null }) {
  const eff = effort ? ['-c', `model_reasoning_effort=${effort}`] : [];
  return resume
    ? ['exec', 'resume', resume, '--skip-git-repo-check', '-c', `model=${model}`, '-c', 'sandbox_mode=read-only', ...eff, '-']
    : ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', model, ...eff, '-o', outPath, '-'];
}

/**
 * Antigravity CLI(agy) 인자 — 순수, bus/outside.mjs 가 쓰고 round.mjs check 가 돌려본다. 문서(antigravity.google/docs/cli/headless): `-p` 한 번 돌고 종료,
 * `--output-format json` 이면 stdout 에 { conversation_id, status, response, … } 한 덩어리, `--conversation <id>` 로 이어붙임, `--model`·`--effort`·`--print-timeout`.
 * 헤드리스는 승인이 필요한 도구를 기본 거부한다(soft-deny) — 감사역은 파일을 읽되 고치지 않으니 그 기본을 그대로 쓴다. `--dangerously-skip-permissions` 는 안 붙인다.
 */
export function agyArgs({ prompt, model, effort = null, resume = null, timeout = '5m', dir = null }) {
  // agy 는 --effort 가 필수(실측 09-14: "--model gemini-3.6-flash requires --effort (available: low, medium, high)"). 자리에 없으면 medium, 우리 xhigh 는 high 로.
  const eff = effort === 'xhigh' ? 'high' : (effort || 'medium');
  // --add-dir: 저장소를 작업 폴더로 명시한다 — cwd 만으로는 에이전트가 ~/.gemini/antigravity-cli 를 제 폴더로 알고 우리 파일을 "없다" 고 했다(실측 09-14).
  return ['-p', prompt, '--output-format', 'json', '--model', model, '--print-timeout', timeout, '--effort', eff,
    ...(dir ? ['--add-dir', dir] : []), ...(resume ? ['--conversation', resume] : [])];
}
/** agy 의 json 봉투에서 답과 대화 id. 순수 — 잘못된 JSON 이나 status 가 SUCCESS 가 아니면 throw. */
export function parseAgy(stdout) {
  let j; try { j = JSON.parse(String(stdout ?? '').trim()); } catch { throw new Error(`agy 출력이 JSON 이 아님 — ${String(stdout ?? '').replace(/\s+/g, ' ').slice(0, 160)}`); }
  if (j.status && j.status !== 'SUCCESS') throw new Error(`agy status ${j.status}${j.error ? ' — ' + String(j.error).slice(0, 160) : ''}`);
  return { answer: String(j.response ?? '').trim(), sessionId: j.conversation_id ?? null };
}

/**
 * 고쳐도 되는 값인가 — 못 고치면 이유, 되면 null. 순수 — round.mjs check 가 돌려본다.
 * @param actorId 자리 이름 · @param agent cast.json 의 그 자리(없으면 null) · @param patch { model?, llm?, codexModel?, effort? }
 */
export function castChangeError(actorId, agent, patch) {
  if (!agent) return `'${actorId}' 자리가 없습니다.`;
  if (actorId === 'boss' || actorId === 'system') return `'${actorId}' 는 사람이거나 장치라 엔진이 없습니다.`;
  const keys = Object.keys(patch ?? {}).filter((k) => patch[k] !== undefined);
  if (!keys.length) return '바꿀 값이 없습니다 (model · llm · codexModel · geminiModel · effort).';
  const bad = keys.find((k) => !CAST_FIELDS.includes(k));
  if (bad) return `'${bad}' 는 고칠 수 있는 값이 아닙니다 (model · llm · codexModel · geminiModel · effort).`;
  if (patch.model !== undefined) {
    if (!ENGINES.includes(patch.model)) return `엔진은 ${ENGINES.join(' · ')} 중 하나입니다: ${patch.model}`;
    // 외부감사만은 다른 회사 모델이어야 한다 — CLAUDE.md "클로드 둘이 사이좋게 같이 틀릴 때, 그건 다른 엔진에게만 보인다". codex 든 gemini 든 클로드만 아니면 된다.
    if (actorId === 'outside' && !isForeign(patch.model)) return '외부감사(outside)는 다른 회사 모델이어야 합니다 — 클로드가 외부감사인 척하지 않습니다 (CLAUDE.md).';
  }
  if (patch.llm !== undefined && !CLAUDE_MODELS.includes(patch.llm)) return `claude 모델은 ${CLAUDE_MODELS.join(' · ')} 중 하나입니다: ${patch.llm}`;
  if (patch.codexModel !== undefined && !CODEX_MODELS.includes(patch.codexModel)) return `codex 모델은 ${CODEX_MODELS.join(' · ')} 중 하나입니다: ${patch.codexModel}`;
  if (patch.geminiModel !== undefined && !GEMINI_MODELS.includes(patch.geminiModel)) return `gemini 모델은 ${GEMINI_MODELS.join(' · ')} 중 하나입니다: ${patch.geminiModel}`;
  if (patch.fallback !== undefined && patch.fallback !== 'none' && !isForeign(patch.fallback)) return `폴백은 다른 회사 엔진(gpt · gemini) 또는 'none'(대표께 올림)입니다: ${patch.fallback}`;
  if (patch.suspended !== undefined) {
    if (actorId !== 'outside') return `중단은 외부감사(outside) 자리에만 적습니다: ${actorId}`;
    if (patch.suspended !== null && patch.suspended !== 'none' && !SUSPEND_DATE_RE.test(String(patch.suspended))) return `중단은 복귀 예정일 'YYYY-MM-DD' 또는 'none'(해제)입니다: ${patch.suspended}`;
  }
  if (patch.effort !== undefined && !EFFORTS.includes(patch.effort)) return `추론 강도는 ${EFFORTS.join(' · ')} 중 하나입니다: ${patch.effort}`;
  return null;
}

/** 자리 값을 cast.json 에 쓴다 — 서버만 부른다. 돌려주는 것: { from, to, agent } (from·to 는 바뀐 값만). */
export function updateCastAgent(team, actorId, patch) {
  const cast = readCast(team);
  const agent = cast.agents?.[actorId] ?? null;
  const err = castChangeError(actorId, agent, patch);
  if (err) throw new Error(err);
  const from = {}, to = {};
  for (const k of CAST_FIELDS) {
    if (patch[k] === undefined) continue;
    const val = k === 'suspended' && patch[k] === 'none' ? null : patch[k];   // 중단 해제는 null 로 — 파일에 'none' 을 남기지 않는다
    if (val === (agent[k] ?? null)) continue;
    from[k] = agent[k] ?? null; to[k] = val; agent[k] = val;
  }
  if (Object.keys(to).length) writeJSON(paths(team).cast, cast);
  return { from, to, agent };
}

/** 목적격 조사 — 받침이 있으면 "을", 없으면 "를" (toollabel.js 의 ga 와 같은 규칙). "안젤를" 이 뜨지 않게. */
const eul = (name) => {
  const s = String(name ?? '');
  const c = s.charCodeAt(s.length - 1);
  const hangul = c >= 0xac00 && c <= 0xd7a3;
  return s + (hangul && (c - 0xac00) % 28 !== 0 ? '을' : '를');
};
/* ── codex 가 도는 중인가 ──
 * codex 자리는 claude 세션이 없어 busy 를 세션에서 못 읽는다. 사회자가 띄운 호출은 conductor.outsideBusy 로 보이지만 CLI(--ask) 호출은
 * 안 보여 관제탑에 "쉼" 으로 떴다 — 대표가 "레오 세션 초기화 했어?" 하고 물은 건(09-13 13:48). outside.mjs 가 codex 를 돌리는 동안
 * state/outside-running/<방>.<자리>.json 에 { pid, since } 를 두고 끝나면 지운다. 읽는 쪽은 pid 가 살아 있을 때만 참(죽은 표시는 무시).
 */
const runningDir = path.join(ROOT, 'state', 'outside-running');
const runningPath = (team, actor) => path.join(runningDir, `${team}.${actor}.json`);
export function markOutsideRunning(team, actor, pid = process.pid) {
  fs.mkdirSync(runningDir, { recursive: true });
  fs.writeFileSync(runningPath(team, actor), JSON.stringify({ pid, since: new Date().toISOString() }) + '\n');
}
export function clearOutsideRunning(team, actor) {
  try { fs.rmSync(runningPath(team, actor), { force: true }); } catch { /* 이미 없음 */ }
}
/** 도는 중이면 { pid, since }, 아니면 null. pid 가 죽었으면(SIGKILL 등으로 못 지운 표시) null. */
export function outsideRunning(team, actor) {
  let v; try { v = JSON.parse(fs.readFileSync(runningPath(team, actor), 'utf8')); } catch { return null; }
  if (!v?.pid) return null;
  try { process.kill(v.pid, 0); } catch { return null; }
  return v;
}

/* ── codex 계정 한도 — 쿨다운 ──
 * 외부 감사 다섯 자리가 한 ChatGPT 계정을 쓴다. 한도에 걸리면 "You've hit your usage limit … try again at Sep 20th, 2026 3:38 PM" 이 오고,
 * 그 뒤로 사회자가 조용할 때마다 codex 를 또 불러 5분마다 "부르지 못했습니다" 가 쌓였다(R25, 엿새). 한도 오류를 읽으면 state/outside-cooldown.json
 * 에 { until, reason, noted[] } 를 두고, 그때까지 침묵 차례는 codex 자리를 건너뛰고(conductor.quietest) 호명·판정은 방마다 한 번만 알린다(outside.mjs).
 * 계정이 하나라 파일도 하나 — 방·자리 구분 없음. until 이 지나면 없는 것과 같다.
 */
const cooldownPath = path.join(ROOT, 'state', 'outside-cooldown.json');
export const USAGE_LIMIT_RE = /usage limit/i;
/** 오류 문장에서 "try again at <시각>" 을 읽는다. 못 읽으면 지금부터 6시간 — 무한히 부르지 않게. 순수 함수. */
export function parseUsageLimit(message, now = Date.now()) {
  const s = String(message ?? '');
  if (!USAGE_LIMIT_RE.test(s)) return null;
  const m = /try again at ([A-Za-z]{3} \d{1,2}(?:st|nd|rd|th)?,? \d{4},? \d{1,2}:\d{2} ?[AP]M)/i.exec(s);
  let until = null;
  if (m) { const t = Date.parse(m[1].replace(/(\d)(st|nd|rd|th)/, '$1')); if (Number.isFinite(t)) until = t; }
  if (until == null || until <= now) until = now + 6 * 3600_000;
  return { until: new Date(until).toISOString(), reason: s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) };
}
export function setOutsideCooldown(cd) {
  fs.mkdirSync(path.dirname(cooldownPath), { recursive: true });
  fs.writeFileSync(cooldownPath, JSON.stringify({ until: cd.until, reason: cd.reason, noted: cd.noted ?? [] }) + '\n');
}
/** 쿨다운 중이면 { until, reason, noted[] }, 아니면 null(파일 없음·지남·깨짐). */
export function outsideCooldown(now = Date.now()) {
  let v; try { v = JSON.parse(fs.readFileSync(cooldownPath, 'utf8')); } catch { return null; }
  const t = Date.parse(v?.until ?? '');
  if (!Number.isFinite(t) || t <= now) return null;
  return { until: v.until, reason: v.reason ?? '', noted: Array.isArray(v.noted) ? v.noted : [] };
}
export function clearOutsideCooldown() {
  try { fs.rmSync(cooldownPath, { force: true }); } catch { /* 이미 없음 */ }
}

/* ── 방이 닫혀 있어도 채팅 (결정 127 ②, 대표가 직접 겪은 불편) ──
 * /api/say 는 라운드가 idle 이어도 이제 막지 않는다 — 하지만 훅(.claude/hooks/to-bus.mjs)은 그대로면 idle 일 때
 * 기록을 안 해서(잡담이 새어들지 않게 하려던 것) 대표 말도 실무 답도 대화록에서 사라진다. 서버가 깨우기 직전에
 * 이 표시를 켜면, 그 세션이 이번 턴 동안 훅을 통과한다. 잠깐(기본 10분)이면 스스로 꺼진다 — 계속 켜 두는
 * 스위치가 아니다. 방마다 하나 — 한 팀 안에서 idle 채팅이 동시에 여럿 열릴 일은 없다.
 */
const idleChatPath = (team) => path.join(ROOT, 'state', 'idle-chat', `${team}.json`);
export function allowIdleChat(team) {
  fs.mkdirSync(path.dirname(idleChatPath(team)), { recursive: true });
  fs.writeFileSync(idleChatPath(team), JSON.stringify({ at: Date.now() }));
}
export function idleChatAllowed(team, { maxAgeMs = 10 * 60_000 } = {}) {
  let at; try { at = JSON.parse(fs.readFileSync(idleChatPath(team), 'utf8'))?.at; } catch { return false; }
  return Number.isFinite(at) && Date.now() - at < maxAgeMs;
}

/** note 한 줄 — "대표가 테라를 opus·high 로 바꿨습니다". 바뀐 값만, 엔진은 이름으로. */
export function castChangeText(name, to) {
  const words = [];
  if (to.model) words.push(engineName(to.model) ?? to.model);
  if (to.llm) words.push(to.llm);
  if (to.codexModel) words.push(to.codexModel);
  if (to.geminiModel) words.push(to.geminiModel);
  if (to.effort) words.push(to.effort);
  if (to.fallback) words.push(to.fallback === 'none' ? '폴백 없음(대표께 올림)' : `폴백 ${engineName(to.fallback)}`);
  if ('suspended' in to) words.push(to.suspended ? `중단(${to.suspended} 복귀 예정)` : '중단 해제');
  return `대표가 ${eul(name)} ${words.join('·')} 로 바꿨습니다 — 다음 턴부터.`;
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
  // 방의 규칙(결정 132) — 비서실엔 대표·세라의 말만. 밖의 것은 오류가 아니라 버림(null): 훅·안내·승인 어느 길로 와도 못 들어온다. 버린 건 stderr 한 줄.
  const rules = roomRules(team);
  if (!allowedIn(rules, { actor: event.actor || 'system', type: EVENT_TYPES.has(event.type) ? event.type : 'message' })) {
    process.stderr.write(`emit 버림 ${team}/${event.actor || 'system'} ${event.type ?? 'message'}\n`);
    return null;
  }
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

/** 대화록 전체. 파일이 안 바뀌었으면 캐시다 — 돌려받은 배열을 고치지 않는다. */
export function readLog(team) {
  return readJSONLCached(paths(team).log);
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
  return ms.find((m) => m.status === 'now')?.n ?? null;
}

/**
 * 로드맵의 마일스톤 상태를 옮긴다. 사람도 세션도 roadmap.json 을 손으로 고치지 않는다 — 코드가 옮긴다.
 *   'pass' 는 라운드를 PASS 로 닫을 때(사실 기록), 'now' 는 "다음 마일스톤 착수" B 가 통과할 때(notifier),
 *   로드맵 전체 교체는 C 가 통과할 때. 컷리스트·로드맵 변경이 C 인 이유가 이것이다.
 * now 는 하나뿐이다 — 새로 now 가 되면 다른 now 는 wait 로.
 */
export function setMilestoneStatus(team, n, status) {
  const roadmap = readRoadmap(team);
  const ms = roadmap.milestones ?? [];
  const m = ms.find((x) => x.n === n);
  if (!m) return false;
  if (status === 'now') for (const x of ms) if (x.status === 'now' && x !== m) x.status = 'wait';
  m.status = status;
  writeJSON(paths(team).roadmap, roadmap);
  return true;
}

export function startRound(team, { topic = null, milestone = null } = {}) {
  const prev = readState(team);
  // 열린 라운드 위에 또 열면 앞 라운드는 round_end 도 rounds.jsonl 색인도 없이 사라진다.
  if (prev.phase === 'running' || prev.phase === 'blocked') {
    throw new Error(`이미 라운드 ${prev.round} 이 열려 있습니다. 먼저 닫으세요.`);
  }
  // 어느 마일스톤인가. 로드맵의 now 가 정한다. now 가 없으면(직전 것을 PASS 로 닫아 pass 가 됐다) 다음 착수는
  // B 승인이다 — 실무가 혼자 다음 것을 당겨오지 않는다. 번호를 명시하면(대표의 화면·터미널) 그건 대표 결정이다.
  const ms = readRoadmap(team).milestones ?? [];
  let target = milestone ?? nowMilestone(team);
  if (target == null) {
    if (!ms.length) target = prev.milestone || 1;   // 로드맵이 없는 방 — 번호만 이어간다
    else {
      const next = ms.find((m) => m.status !== 'pass');
      throw new Error(next
        ? `로드맵에 now 인 마일스톤이 없습니다. 다음(${next.n} ${next.title ?? ''})의 착수는 B 승인입니다 — node bus/approve.mjs --request B --next "다음 마일스톤 착수". 대표가 직접 열려면 마일스톤 번호를 지정하세요.`
        : '로드맵의 마일스톤이 전부 pass 입니다. 로드맵을 다시 짜세요 (/kickoff).');
    }
  }
  // 반박 횟수는 마일스톤의 것이다. 같은 마일스톤을 다시 열면 물려받는다 — 닫았다 여는 것으로 0 이 되지 않는다.
  const attempts = prev.attempts ?? {};
  const next = writeState(team, {
    round: nextRoundNumber(team),
    milestone: target,
    phase: 'running',
    topic: topic ?? prev.topic,
    attempt: Math.min(attempts[target] ?? 0, MAX_ATTEMPTS),
    attempts,
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
 * 이 라운드를 이 판정으로 닫아도 되는가. 안 되면 이유, 되면 null.
 *
 * R3·R6·R8 은 판정 카드 없이, 또는 REVISE 카드 뒤에 `end -v PASS` 로 닫혀 로드맵에 "마일스톤 1 통과" 가 찍혔다
 * (2026-09-12). "만든 사람이 판정하지 않는다" 가 산문에만 있었다. 여기서 막는다 (대표 결정, 2026-09-13).
 *   - PASS 는 이 라운드에 판정 카드가 있고, 마지막 카드가 PASS 이며, 그 뒤에 사회자의 판정 완료 note
 *     (meta.verdictFlow: 'pass') 가 있을 때만. 마지막이 REVISE·FAIL 이면 PASS 로 못 닫는다.
 *   - FAIL 로 막힌 방(blocked)은 대표가 말해 풀기 전엔 어떤 판정으로도 닫지 못한다.
 */
export function endRefusal(team, { verdict = null } = {}) {
  const state = readState(team);
  // round 번호가 아니라 phase 로 본다. 번호는 닫힌 뒤에도 남아 있어서, 번호만 보면 같은 라운드를
  // 두 번 닫고 배너·색인·세션 리셋이 두 번 난다 (Fable 재점검, 2026-09-12).
  if (!state.round || state.phase === 'idle') return '진행 중인 라운드가 없습니다.';
  if (state.phase === 'blocked') return `대표 판단 대기 중입니다 (라운드 ${state.round}, FAIL). 대표가 이 방에 말해 풀기 전엔 닫을 수 없습니다.`;
  if (String(verdict ?? '').toUpperCase() !== 'PASS') return null;
  const events = readLog(team).filter((e) => e.round === state.round);
  let last = -1;
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'verdict' && !events[i].meta?.stale) { last = i; break; }
  if (last < 0) return 'PASS 로 닫으려면 이 라운드에 판정 카드가 있어야 합니다. 감사역을 부르세요 (node bus/round.mjs verdict).';
  const v = events[last].meta?.verdict;
  if (v !== 'PASS') return `마지막 판정이 ${v} 입니다. PASS 로 닫을 수 없습니다.`;
  if (!events.slice(last + 1).some((e) => e.type === 'note' && e.meta?.verdictFlow === 'pass')) {
    return '판정 카드는 PASS 인데 사회자의 판정 완료 note 가 없습니다. 판정은 /verdict 흐름으로 받습니다 (node bus/round.mjs verdict).';
  }
  // 카드의 actor 를 본다(결정 118 ②) — 전에는 안 봐서 review 자리가 있는 방은 내부감사 클로드 혼자 PASS 로 단계를 넘길 수 있었다.
  // 외부감사 자리가 다른 회사 엔진이고 중단(suspended)이 아니면 그의 PASS 카드가 있어야 한다. 중단이면 없이 닫히되 기록에 outsideAudited:false 가 박힌다(endRound).
  const out = readCast(team).agents?.outside ?? null;
  if (out && isForeign(out.model) && !out.suspended && !auditorsOf(events).outsideAudited) {
    return `외부감사(${out.name ?? 'outside'})의 PASS 카드가 이 라운드에 없습니다 — 내부감사만으로는 PASS 로 닫지 못합니다 (CLAUDE.md). 외부 감사를 못 부르는 동안이면 그 자리를 중단(suspended)으로 적으세요 (결정 118 ②).`;
  }
  // 만든 사람이 판정하지 않는다(CLAUDE.md, 대표 지시 R25 "만든 사람이 자기 걸 통과시키는 것 막기") — 마지막 판정 카드를 낸 자리가
  // 이 라운드에 파일을 직접 고쳤으면(Edit·Write) 그건 자기 것을 통과시킨 것이다. 마지막 카드만 본다 — 다른(안 고친) 자리가
  // 그 뒤에 새로 PASS 를 내면 그게 새 "마지막 판정" 이 되어 스스로 풀린다(중단 없이도 회복). dev·design 처럼 review 자리가
  // 아예 없는 팀은 대개 이 자리가 안 걸린다 — "실무 둘이 서로 감사" 로 갈지는 별도 결정할 일(대표 C, 여기서 안 정한다).
  const lastActor = events[last].actor;
  if (buildersOf(events).has(lastActor)) {
    const name = readCast(team).agents?.[lastActor]?.name ?? lastActor;
    return `${name} 가 이 라운드에 직접 고쳤습니다(Edit·Write) — 만든 사람이 판정하지 않습니다 (CLAUDE.md). 다른 사람이 봐야 닫을 수 있습니다.`;
  }
  // 부분 성공은 통과가 아니다(8단계 실패 수습) — 판정 카드는 PASS 인데 물건이 없거나 비어 있으면 닫지 못한다.
  const art = artifactsOf(team, events);
  if (!art.paths.length) return `판정은 PASS 인데 이 라운드의 산출물이 없습니다 — 판정 대상 글에 out/ 경로가 없고 teams/${team}/out/ 에 이 라운드에 쓴 파일도 없습니다. 산출물은 파일로 남깁니다 (CLAUDE.md).`;
  const bad = art.paths.filter((a) => a.bytes === null || a.bytes === 0);
  if (bad.length) return `판정은 PASS 인데 산출물이 비었습니다 — ${bad.map((a) => `${a.path}(${a.bytes === null ? '없음' : '0바이트'})`).join(' · ')}. 부분 성공은 통과가 아닙니다. 파일을 채우거나, 판정 대상 글의 경로가 줄임말이면 실제 경로로 적어 다시 판정을 받으세요.`;
  return null;
}

/**
 * 이 라운드의 산출물(8단계) — 판정 시작 note 의 meta.target 에 적힌 out/ 경로 + 이 라운드 도구 줄이 teams/<팀>/out/ 밑에 쓴 파일.
 * 경로마다 크기를 잰다(없으면 null). 순수한 부분(글에서 경로 뽑기)은 artifactPathsIn — round.mjs check 가 돌려본다.
 * @returns { paths: [{ path, bytes }] } — path 는 방 기준(out/…), 다른 방 것이면 teams/<팀>/out/…
 */
export function artifactsOf(team, events) {
  const outDir = path.join(paths(team).dir, 'out');
  const found = new Map();   // 절대 경로 → 표시 경로
  const show = (abs) => abs.startsWith(outDir + path.sep) ? path.relative(paths(team).dir, abs) : path.relative(ROOT, abs);
  for (const e of events) {
    if (e.type === 'note' && e.meta?.verdictFlow === 'start') {
      for (const p of artifactPathsIn(e.meta.target ?? e.text)) {
        const abs = p.startsWith('teams/') ? path.join(ROOT, p) : path.join(paths(team).dir, p);
        found.set(abs, show(abs));
      }
    }
    if (e.type === 'tool' && ['Edit', 'Write', 'NotebookEdit'].includes(e.meta?.tool)) {
      // 훅이 남긴 절대 경로 — 서버가 다른 체크아웃(worktree)에서 돌아도 맞게 `/teams/<팀>/out/` 뒤만 쓴다
      const i = String(e.text ?? '').indexOf(`/teams/${team}/out/`);
      if (i >= 0) { const abs = path.join(outDir, String(e.text).slice(i + `/teams/${team}/out/`.length)); found.set(abs, show(abs)); }
    }
  }
  const out = [];
  for (const [abs, p] of found) {
    let bytes = null;
    try { const st = fs.statSync(abs); bytes = st.isFile() ? st.size : null; } catch { /* 없음 */ }
    out.push({ path: p, bytes });
  }
  return { paths: out };
}
/** 글에서 out/ 경로를 뽑는다 — `out/a.md` · `teams/dev/out/shots/x.png`. 확장자가 있는 것만(폴더·말 조각은 안 센다), 끝의 문장 부호는 뗀다. 순수. */
export function artifactPathsIn(text) {
  const out = new Set();
  const re = /(?:teams\/[\w-]+\/)?out\/[^\s·,，、;:()（）「」『』"'“”‘’\[\]<>]+/g;
  for (const m of String(text ?? '').matchAll(re)) {
    const p = m[0].replace(/[.。!?…]+$/, '');
    if (/\.[A-Za-z0-9]{1,8}$/.test(p)) out.add(p);
  }
  return [...out];
}

/** 이 라운드에 파일을 고친(Edit·Write·NotebookEdit) 자리들 — 그 자리의 판정 카드는 "만든 사람이 판정" 이 된다(대표 지시, R25). 순수 함수. */
export function buildersOf(events) {
  const s = new Set();
  for (const e of events) if (e.type === 'tool' && ['Edit', 'Write', 'NotebookEdit'].includes(e.meta?.tool)) s.add(e.actor);
  return s;
}

/** 닫을 수 없으면 사유를 방에 남기고 던진다. 서버(/api/round)는 미루기 전에, endRound 는 닫기 직전에 부른다. */
export function assertEndable(team, opts = {}) {
  const why = endRefusal(team, opts);
  if (!why) return;
  const state = readState(team);
  if (state.round && state.phase !== 'idle') {
    emit(team, { type: 'note', actor: 'system', text: `라운드 ${state.round} 닫기 거부${opts.verdict ? ' (' + String(opts.verdict).toUpperCase() + ')' : ''} — ${why}`, meta: { endRefused: true } });
  }
  throw new Error(why);
}

/**
 * 라운드를 닫는다.
 *
 * 대화록은 그대로 둔다 — 구분선이 하나 들어갈 뿐이다.
 * 비워지는 건 AI 컨텍스트뿐이고, 그건 다음 라운드부터 round 번호가
 * 달라지면서 자연히 끊긴다 (readContext 참고).
 */
/**
 * 누가 봤나 (결정 118 ①) — 이 라운드의 stale 아닌 판정 카드에서 감사자를 뽑는다. 순수 함수 — round.mjs check 가 돌린다.
 * 전에는 어디에도 안 남아 개발 1단계가 판정 카드 0장인 라운드에서 pass 가 됐고 파일만 봐서는 레오가 제대로 본 5단계와 구별이 안 됐다.
 * 20일에 codex 가 돌아오면 `outsideAudited:false` 로 박힌 단계만 다시 본다 — 그래서 이 칸이 있어야 한다.
 * @returns { auditors: [{ actor, verdict, sha, engine, ts }], outsideAudited } — 같은 자리는 마지막 카드 하나
 */
export function auditorsOf(events) {
  const last = new Map();
  for (const e of events) {
    if (e.type !== 'verdict' || e.meta?.stale) continue;
    last.set(e.actor, { actor: e.actor, verdict: e.meta?.verdict ?? null, sha: e.meta?.sha ?? null, engine: e.meta?.engine ?? null, ts: e.ts });
  }
  const auditors = [...last.values()];
  return { auditors, outsideAudited: auditors.some((a) => a.actor === 'outside' && a.verdict === 'PASS') };
}

export function endRound(team, { verdict = null, summary = null } = {}) {
  assertEndable(team, { verdict });
  const state = readState(team);

  emit(team, {
    type: 'round_end',
    actor: 'system',
    text: summary || `라운드 ${state.round} 종료${verdict ? ' · ' + verdict : ''}`,
    meta: { verdict },
  });

  // 누가 봤나 — 이 라운드의 판정 카드에서(결정 118 ①). 마일스톤 이벤트와 rounds.jsonl 행 둘 다에 박는다.
  const roundEvents = readLog(team).filter((e) => e.round === state.round);
  const { auditors, outsideAudited } = auditorsOf(roundEvents);
  const outsideSeat = readCast(team).agents?.outside ?? null;
  const outsideWhy = outsideAudited ? null : !outsideSeat ? 'no-seat' : outsideSeat.suspended ? 'suspended' : !isForeign(outsideSeat.model) ? 'not-foreign' : 'no-card';
  const artifacts = artifactsOf(team, roundEvents).paths;   // 무엇을 냈나(8단계) — PASS 면 endRefusal 이 이미 비어 있지 않음을 봤다

  // PASS 로 닫혔으면 이 마일스톤은 끝났다 — 사실 기록. 다음 것을 now 로 옮기는 것은 B 승인의 일이다.
  if (String(verdict ?? '').toUpperCase() === 'PASS' && state.milestone) {
    if (setMilestoneStatus(team, state.milestone, 'pass')) {
      emit(team, { type: 'milestone', actor: 'system', text: `마일스톤 ${state.milestone} 통과 — 로드맵에 pass 로 기록${outsideAudited ? '' : ' (외부 감사 없이 — ' + outsideWhy + ')'}`,
        meta: { index: state.milestone, auditors, outsideAudited, ...(outsideWhy ? { outsideWhy } : {}), artifacts } });
      // 닫힌 고리(대표 실측 09-14 — 마케팅이 6단계 통과 뒤 여섯 시간 섰다): now 가 없으면 startRound 가 B 승인을 요구하는데, B 를 올리려면 차례가,
      // 차례는 라운드가 있어야 온다. 닫는 이 순간이 "다음이 뭔지" 아는 유일한 때라 **여기서 B 요청을 자동으로 올린다.** 문(톰·제리)은 그대로다.
      // 통과하면 서버가 now 로 옮기고 라운드까지 연다(autoOpen — notifier.applyAction). 같은 방에 이미 착수 요청이 떠 있으면 또 안 올린다.
      const next = (readRoadmap(team).milestones ?? []).find((m) => m.status !== 'pass' && m.status !== 'now') ?? null;
      const dup = next && listApprovals({ team, status: 'pending' }).some((r) => r.action?.type === 'milestone' && r.action.n === next.n);
      if (next && !dup) {
        try {
          requestApproval(team, {
            by: 'guide', grade: 'B',
            what: `다음 마일스톤 착수 — ${next.n} ${next.title ?? ''}`.trim(),
            detail: `라운드 ${state.round} 이 마일스톤 ${state.milestone} 을 PASS 로 닫으며 서버가 올린 요청입니다. 통과하면 마일스톤 ${next.n} 을 now 로 옮기고 라운드를 엽니다.`,
            action: { type: 'milestone', n: next.n, title: next.title ?? null, autoOpen: true },
          });
        } catch (e) {
          emit(team, { type: 'note', actor: 'system', text: `다음 마일스톤 착수 요청을 올리지 못했습니다 — ${String(e.message).slice(0, 120)}. node bus/approve.mjs --request B --next 로 올리세요.` });
        }
      }
    }
  }

  const events = readLog(team).filter((e) => e.round === state.round);   // round_end·milestone 까지 센다
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
    // 누가 봤나(결정 118 ①) — 라운드당 한 줄이라 "외부 감사 없이 통과한 단계" 를 한 번에 뽑는다
    auditors, outsideAudited, ...(outsideWhy ? { outsideWhy } : {}),
    artifacts,   // 무엇을 냈나(8단계) — 경로와 크기
  }) + '\n');

  // 외부감사도 이 방의 참여자라 자기 세션을 갖는다. 라운드가 끝나면 같이 비운다 —
  // 비워지는 건 AI 컨텍스트뿐이라는 규칙은 다른 회사 모델에도 똑같이 적용된다.
  // (대화록은 그대로 남는다. 위 emit 이 이미 구분선을 그었다.)
  // 칸 이름은 외부감사가 `방`, 대표가 codex 로 바꾼 다른 자리는 `방:자리`(outside.mjs slotKey, 결정 69 ①) — 둘 다 지운다.
  // `방` 만 지우면 codex 가 된 실무의 세션이 다음 라운드로 이어진다(레오 REVISE R23).
  const outStore = path.join(ROOT, 'state', 'outside-sessions.json');
  try {
    const all = JSON.parse(fs.readFileSync(outStore, 'utf8'));
    const gone = Object.keys(all).filter((k) => k === team || k.startsWith(team + ':'));
    if (gone.length) {
      for (const k of gone) delete all[k];
      fs.writeFileSync(outStore, JSON.stringify(all, null, 2) + '\n');
    }
  } catch { /* 파일이 없으면 열린 세션도 없다 */ }

  writeState(team, { phase: 'idle', endedAt: new Date().toISOString() });
  return state.round;
}

/**
 * 감사 판정.
 * REVISE 는 반박 횟수를 올리고, 상한에 닿으면 FAIL 로 승격해 사람을 부른다.
 *
 * FAIL 은 멈춘다 — 인격 문장이 아니라 여기서. 방은 phase 'blocked' 가 되고, 그 뒤로는 판정을 낼 수 없다.
 * 대표가 이 방에 말을 하면 풀린다 (resumeRound). 개발팀 대화록 09-02: FAIL 두 번 뒤에도 작업이 이어졌고
 * 뒤이은 PASS 가 경고를 지웠다 — 규칙이 산문에만 있었다 (Fable 재점검, 2026-09-12).
 *
 * sha — 감사가 **본** 커밋. 부르는 쪽(outside.mjs)이 감사를 시작할 때 잡은 HEAD 를 넘긴다. 안 넘기면 지금 HEAD 인데, 그건
 * 감사 도중 들어온 커밋이 안 본 채로 찍히는 틈이다(레오 REVISE, R22) — 정식 경로는 늘 넘긴다. 푸시 문(결정 63)이 이 값을 본다.
 */
/** 지적의 열쇠 — 첫 줄에서 공백·문장 부호를 떼고 앞 40자. 같은 지적이 되풀이되는지 대충 본다(결정 84 ②). */
const issueKey = (t) => String(t ?? '').split('\n')[0].replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 40);
export const sameIssue = (a, b) => { const x = issueKey(a), y = issueKey(b); return !!x && x === y; };
/**
 * 이 REVISE 가 반박으로 세는가 (결정 84) — 받아들여 고친 지적은 반박이 아니다. 앞 REVISE(이 라운드) 가 없으면 갈린 게 아니다.
 * ① 앞 REVISE 뒤 고친 커밋 없이 같은 sha 로 다시 받았다("그건 틀렸다") · ② 같은 지적이 되풀이된다. 순수 — check 가 돌려본다.
 */
export function countsAsDispute(prev, { sha, text }) {
  if (!prev) return false;
  if (prev.meta?.sha && sha && prev.meta.sha === sha) return true;
  return sameIssue(prev.text, text);
}

export function recordVerdict(team, { actor, verdict, text, target = 'guide', round = null, sha = undefined, engine = null }) {
  const v = String(verdict || '').toUpperCase();
  if (!VERDICTS.has(v)) throw new Error(`판정은 ${[...VERDICTS].join(' / ')} 중 하나여야 합니다.`);
  const seen = sha === undefined ? headSha() : sha;
  // engine — 답한 엔진(결정 78, "codex · gpt-5.1" · "gemini · …"). 안 주면 자리의 엔진 이름. 라운드 기록의 auditors 가 이걸 모은다(결정 118).
  const eng = engine ?? engineName(readCast(team).agents?.[actor]?.model) ?? null;

  const state = readState(team);

  // 판정을 시작할 때의 라운드를 알고 왔는데 그 사이 라운드가 바뀌었다 — 외부감사가 5분 생각하는 동안
  // 라운드가 닫히고 다음이 열린 경우. 새 라운드의 반박 횟수를 올리면 안 되고, 새 라운드에 찍혀도 안 된다.
  // 자기 라운드 번호로 남기되 판정으로 세지 않는다. 지금 방이 막혀 있어도 마찬가지다 — 이건 옛 라운드의 말이다
  // (레오 감사, 2026-09-12: blocked 검사가 앞에 있어 예외가 났다).
  // 닫힌 방(idle)에 온 판정도 같다 — R12 는 닫힌 뒤에 카드 둘이 찍혔고 번호가 같아 판정으로 보였다 (2026-09-12).
  // 총괄실은 라운드가 없어 phase 가 늘 idle 이다 — 거기서는 이 검사를 하지 않는다.
  if ((round != null && round !== state.round) || (state.phase === 'idle' && !isOffice(team))) {
    return emit(team, {
      round: round ?? state.round, type: 'verdict', actor, text,
      meta: { verdict: v, target, attempt: 0, max: MAX_ATTEMPTS, stale: true, ...(eng ? { engine: eng } : {}) },
    });
  }
  if (state.phase === 'blocked') {
    throw new Error(`대표 판단 대기 중입니다 (라운드 ${state.round}, FAIL). 대표가 이 방에 말하면 풀립니다. 그 전엔 판정을 낼 수 없습니다.`);
  }

  let attempt = state.attempt || 0;
  let final = v;
  let counted = null;   // REVISE 만 — 반박으로 셌나 (결정 84)

  // 반박 카운터는 마일스톤의 것이다. 총괄실은 라운드가 없어 리셋될 길이 없는데
  // 제리의 대조 REVISE 가 여기 쌓여 총괄실이 대표 호출로 잠길 뻔했다 (Fable 감사, 2026-09-02).
  // 총괄실의 REVISE 는 그냥 REVISE 다 — 세지 않는다.
  if (!isOffice(team)) {
    if (v === 'REVISE') {
      // 받아들여 고친 지적은 반박이 아니다 (결정 84) — 이 라운드의 앞 REVISE 와 견줘 갈린 것(같은 sha 로 다시 · 같은 지적)만 센다.
      const prev = readLog(team).filter((e) => e.round === state.round && e.type === 'verdict' && e.meta?.verdict === 'REVISE' && !e.meta?.stale).at(-1) ?? null;
      counted = countsAsDispute(prev, { sha: seen, text });
      if (counted) {
        attempt = Math.min(attempt + 1, MAX_ATTEMPTS);
        if (attempt >= MAX_ATTEMPTS) final = 'FAIL';
      }
    }
    // 감사 PASS 는 이 마일스톤의 반박 횟수를 0 으로 돌린다 — 0 복귀는 이것과 대표의 재개뿐이다.
    if (v === 'PASS') attempt = 0;
    const attempts = { ...(state.attempts ?? {}), [state.milestone]: attempt };
    // 총괄실은 라운드가 없다 — 막을 것도 없다. FAIL 은 그냥 한 마디다.
    writeState(team, final === 'FAIL' ? { attempt, attempts, phase: 'blocked' } : { attempt, attempts });
  }

  const rec = emit(team, {
    type: 'verdict', actor, text,
    // sha — 감사가 본 커밋(감사 시작 때의 HEAD). B 푸시의 문이 이 값을 대조한다 (결정 63). counted — REVISE 가 반박으로 셌나 (결정 84).
    meta: { verdict: final, target, attempt, max: MAX_ATTEMPTS, sha: seen, ...(counted === null ? {} : { counted }), ...(eng ? { engine: eng } : {}) },
  });

  if (final === 'FAIL' && !isOffice(team)) {
    emit(team, {
      type: 'note', actor: 'system',
      text: v === 'REVISE'
        ? `반박 ${MAX_ATTEMPTS}회를 채웠습니다. 대표 판단이 필요합니다 — 이 방은 대표가 말할 때까지 멈춥니다.`
        : 'FAIL — 대표 판단이 필요합니다. 이 방은 대표가 말할 때까지 멈춥니다.',
      meta: { blocked: true },
    });
  }
  return rec;
}

/**
 * 대표가 말했다 — 막힌 방을 푼다. 반박 횟수는 0 으로, 라운드는 그대로 이어진다.
 * 대표의 다음 말이 곧 판단이다. 화면의 입력창이 대표의 것이므로 서버가 /api/say 에서 부른다.
 */
export function resumeRound(team, { text = null, proxy = null } = {}) {
  const state = readState(team);
  if (state.phase !== 'blocked') return null;
  writeState(team, { phase: 'running', attempt: 0, attempts: { ...(state.attempts ?? {}), [state.milestone]: 0 } });
  emit(team, {
    type: 'note', actor: 'system',
    // 대리 결정(결정 85)이면 그렇다고 남긴다 — 방에는 늘 "대리 결정" 이라는 말이 보여야 한다.
    text: `${proxy ? '대리 결정(톰·제리)으로' : '대표 판단으로'} 재개합니다. 반박 횟수를 0 으로 되돌립니다.${text ? ' — ' + String(text).replace(/\s+/g, ' ').slice(0, 80) : ''}`,
    meta: { resumed: true, ...(proxy ? { proxy } : {}) },
  });
  return readState(team);
}

/** "(패스)" 로 시작하는 말 — 말한 것이 아니다(peopleOf·bossCallOf 가 같은 선). */
export const isPassLine = (text) => /^\(패스\)/.test(String(text ?? '').trim());

/**
 * 말투 표본 발언 id 모음 (결정 44 ②③) — 참고 인물·표본 다섯 줄을 고르는 라운드에서, 표본 안에 여러 사람을
 * 부르며 묻는 문장이 실제 호명·질문으로 읽혀 종·막힘에 섰다(레오 R26 `evt_54daf02c54`·`evt_6c39d2149f`,
 * 나리 09-15 R27 보고서 "막힌 것"). 표본 문구만으로는 가려낼 수 없어서(둘째 판은 "기계 같음 검사" 글자도 없다) —
 * 옮긴 사람이 `note meta.sampleIds` 로 표시하면(blocked/resumed·proxyAnswer 와 같은 선) 그 발언만 호명·종·막힘 계산에서 뺀다.
 * 대화록은 고치지 않는다 — 새 note 로 정정만 붙인다.
 */
export function sampleIdsOf(log) {
  const s = new Set();
  for (const e of log) {
    if (e.type === 'note' && Array.isArray(e.meta?.sampleIds)) for (const id of e.meta.sampleIds) s.add(id);
  }
  return s;
}

/**
 * 이 라운드에서 대표에게 결정을 청했는데 그 뒤 대표가 말하지 않은 발언 — 화면의 종(호명 배지). 뒤에서 앞으로, round_start 까지만.
 * 순수 — teamSummary·peopleOf·자정 마감(nightlyOf)이 같은 함수로 센다(한 군데는 전부가 아니다). 대표 말·대리 답(결정 85)이 뒤에 있으면 답한 것.
 * 물은 사람이 그 뒤 다시 말했으면 그 물음은 지나간 것 — 답이 다른 길로 왔든 넘어갔든, 마지막 호명 발언이 답 끝난 뒤에도 서 있었다(나리 결정 ①, 09-15).
 * (패스) 는 말한 것이 아니다.
 * 상황판(progress.json)의 대표 차례 칸 `boss[]` 이 **비어 있으면 그 팀 대표 차례는 없다**(나리 결정 ③) — 실무가 답 끝났다고 칸을 비웠는데 방 발언이 살아남았다.
 * 상황판이 없는 방(null)은 대화록만 본다. 칸을 채우는 건 실무의 일(bus/progress.mjs --boss).
 * @param progress  readProgress(team) — { boss: [] } 면 null. 안 넘기면 대화록만
 */
export function bossCallOf(log, cast, { progress = null } = {}) {
  if (Array.isArray(progress?.boss) && progress.boss.length === 0) return null;
  let answered = false;
  const spokeAgain = new Set();   // 그 뒤에 다시 말한 사람
  const sampleIds = sampleIdsOf(log);   // 말투 표본 발언 — 실제 호명이 아니다
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'round_start') break;
    if (sampleIds.has(e.id)) continue;
    if (e.type === 'message' && e.actor === 'boss') answered = true;
    if (e.type === 'note' && e.meta?.proxyAnswer) answered = true;   // 톰·제리의 대리 답(결정 85)도 답이다
    if (answered || e.type !== 'message' || e.actor === 'boss' || e.actor === 'system') continue;
    // forbidden: 돈·바깥 물음이라 대리 못 함(proxyCandidates 와 같은 선 ④) — 위임 중 종 배지는 이것만 센다(나리 결정 ②)
    if (!spokeAgain.has(e.actor) && asksBoss(e.text, cast)) return { id: e.id, ts: e.ts, by: e.actor, forbidden: proxyForbidden(e.text) };
    if (!isPassLine(e.text)) spokeAgain.add(e.actor);
  }
  return null;
}

/** 팀 하나의 요약 — 왼쪽 레일의 계기판이 읽는 값. */
export function teamSummary(team) {
  const state = readState(team);
  const log = readLog(team);
  const roadmap = readRoadmap(team);

  // 마지막 발언 — 관제탑 카드의 본문. 도구 줄과 note 는 발언이 아니다: 마지막 줄을 그냥 집으면 카드가
  // "/Users/…/world.mjs" 를 보여 줬다 (독립검수 #10, 2026-09-13). 발언 뒤에 온 도구 줄은 따로 — "app.js 고치는 중".
  let last = null, lastTool = null;
  for (let i = log.length - 1; i >= 0 && !last; i--) {
    const e = log[i];
    if (e.type === 'message' || e.type === 'verdict') last = e;
    else if (e.type === 'tool' && !lastTool) lastTool = e;
  }
  const done = roadmap.milestones?.filter((m) => m.status === 'pass').length ?? 0;

  // 마지막 판정이 무엇이었는지 — FAIL 이면 레일에 경고가 뜬다. 같은 훑기로 이 라운드의 마지막 발언 시각과
  // "대표에게 결정을 청했는데 아직 답이 없는" 발언도 찾는다 — 부르기만 한 보고는 종이 아니다 (결정 52, asksBoss).
  let lastVerdict = null, lastSpokeAt = null;
  const cast = readCast(team).agents ?? {};
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'round_start') break;
    if (e.type === 'verdict' && lastVerdict == null) lastVerdict = e.meta?.verdict ?? null;
    if ((e.type === 'message' || e.type === 'verdict') && !lastSpokeAt) lastSpokeAt = e.ts;
  }
  const bossCall = bossCallOf(log, cast, { progress: readProgress(team) });   // 상황판 boss 칸이 비면 null(나리 결정 ③)
  const running = state.phase === 'running';
  const silentDay = running && lastSpokeAt != null && Date.now() - new Date(lastSpokeAt).getTime() > 24 * 3600_000;

  // 대표 차례인 이유. 마지막 판정이 아니라 상태다 (전에는 FAIL 뒤에 PASS 가 오면 경고가 꺼졌다).
  // blocked · 반박 상한 · 하루 넘게 말이 없는 열린 라운드 (대표 결정, 2026-09-13 G-UX).
  const needsBossWhy = state.phase === 'blocked' ? 'blocked'
    : (running && state.attempt >= MAX_ATTEMPTS) ? 'attempts'
      : silentDay ? 'silent' : null;

  return {
    ...state,
    lastVerdict,
    lastAt: last?.ts ?? null,
    lastText: last?.text ?? null,
    lastActor: last?.actor ?? null,
    // 마지막 발언 뒤의 도구 줄 — 누가 무엇을 만지는 중인가. 없으면 null.
    lastTool: lastTool ? { actor: lastTool.actor, tool: lastTool.meta?.tool ?? null, text: lastTool.text, ts: lastTool.ts } : null,
    lastSpokeAt,
    logCount: log.length,
    milestonesDone: done,
    milestonesTotal: roadmap.milestones?.length ?? 0,
    needsBoss: needsBossWhy != null,
    needsBossWhy,
    // 이 라운드에서 누가 대표를 불렀는데 그 뒤 대표가 말하지 않았다 — 화면의 호명 배지.
    bossCall,
  };
}

/** 발언의 첫 문장 — 공백이 따라오는 마침표·물음표·느낌표에서 자른다(session.journalFirstSentence 와 같은 규칙). 200자까지. */
export function firstSentence(text) {
  const body = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const m = /^[\s\S]*?[.!?。](?=\s|$)/.exec(body);
  return (m ? m[0] : body).trim().slice(0, 200);
}

/** 판정을 내는 자리 — `todayVerdict` 를 숫자로 주는 자리. 나머지는 null 이라 화면이 항목을 안 그린다. */
const JUDGES = new Set(['review', 'outside']);

/**
 * 사람별 집계 (대표 결정 40 · M2) — 관제탑 개인 탭 카드의 값 중 **대화록에서 나오는 것**. 계약은 docs/event-schema.md 3절 "사람별 집계".
 * 세션 상태(busy·lastSignal)와 일지 첫 문장은 서버가 얹는다 (server/index.mjs summaryOf) — 여기는 파일을 안 읽는 순수 함수라
 * `round.mjs check` 가 돌려본다. 대표는 `boss` 로 모양이 다르다(마지막 지시·오늘 지시 수). system 은 사람이 아니다.
 *
 * 뒤에서 앞으로 훑는다 — 마지막 발언·그 뒤의 도구 줄·이 라운드의 대표 호출은 최근 것이 먼저 나오고,
 * 오늘 밖으로 나갔고 모두의 마지막 발언을 찾았으면 더 볼 게 없다.
 * @param log  대화록(시간순)
 * @param cast cast.json 의 agents
 * @param now  "오늘" 의 기준 시각(ms) — 서버 프로세스의 현지 날짜
 * @param progress  상황판 — boss[] 이 비어 있으면 누구도 bossCall 이 아니다(bossCallOf 와 같은 선, 나리 결정 ③). 안 넘기면 대화록만
 */
export function peopleOf(log, cast, { now = Date.now(), progress = null } = {}) {
  const agents = cast ?? {};
  const boardEmpty = Array.isArray(progress?.boss) && progress.boss.length === 0;
  const ids = Object.keys(agents).filter((a) => a !== 'system' && a !== 'boss');
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const isToday = (ts) => new Date(ts).getTime() >= dayStart.getTime();
  const isPass = (e) => isPassLine(e.text);

  const people = Object.fromEntries(ids.map((a) => [a, {
    busy: false, alive: null, lastSignal: null, state: null, lastSaidAt: null, doing: null,
    todaySay: 0, todayVerdict: JUDGES.has(a) ? 0 : null, bossCall: null, journalFirst: null,
  }]));
  const boss = { lastSaidAt: null, lastText: null, todaySay: 0, todayDecisions: 0 };
  const unsaid = new Set([...ids, 'boss']);   // 마지막 발언을 아직 못 찾은 자리
  const spokeAgain = new Set();               // 이 라운드에서 그 뒤에 다시 말한 사람 — bossCallOf 와 같은 선(나리 결정 ①)
  const sampleIds = sampleIdsOf(log);         // 말투 표본 발언 — 실제 호명이 아니다

  let inRound = true, bossAnswered = false;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    const ts = e.ts ?? '';
    if (!isToday(ts) && !inRound && unsaid.size === 0) break;
    if (e.type === 'round_start') { inRound = false; continue; }
    const spoke = (e.type === 'message' || e.type === 'verdict') && !isPass(e);
    if (inRound && e.type === 'note' && e.meta?.proxyAnswer) bossAnswered = true;   // 톰·제리의 대리 답(결정 85) — teamSummary 와 같은 규칙

    if (e.actor === 'boss') {
      if (e.type !== 'message') continue;
      if (inRound) bossAnswered = true;
      // 총괄이 옮겨온 것(meta.via)은 대표가 이 방에서 친 말이 아니다 — 결정 파일 원문이 대표 카드의 "하는 일" 로 떴다 (R21).
      // dispatch.mjs lastBossSay 와 같은 규칙.
      if (e.meta?.via) continue;
      if (boss.lastSaidAt == null) { boss.lastSaidAt = ts; boss.lastText = String(e.text ?? '').slice(0, 200); unsaid.delete('boss'); }
      if (isToday(ts)) boss.todaySay += 1;
      continue;
    }
    const p = people[e.actor];
    if (!p) continue;
    // 마지막 발언 뒤에 온 도구 줄 — 뒤에서 훑으니 발언보다 먼저 만난 도구 줄이 "지금 만지는 것" 이다.
    if (e.type === 'tool') {
      if (p.lastSaidAt == null && !p.doing) p.doing = { tool: e.meta?.tool ?? null, text: e.text ?? '', ts };
      continue;
    }
    if (!spoke) continue;
    if (p.lastSaidAt == null) {
      p.lastSaidAt = ts; unsaid.delete(e.actor);
      if (!p.doing) p.doing = { text: firstSentence(e.text), ts };
    }
    if (isToday(ts)) {
      if (e.type === 'message') p.todaySay += 1;
      else if (p.todayVerdict != null) p.todayVerdict += 1;
    }
    // 이 라운드에서 대표에게 결정을 청했는데 그 뒤 대표가 말하지 않았다 — teamSummary.bossCall(bossCallOf)과 같은 판별(결정 52), 인용문만 더한다.
    // 그 사람이 그 뒤 다시 말했으면 지나간 물음(나리 결정 ①) — 마지막 말만 물음일 수 있다.
    if (inRound && !bossAnswered && !boardEmpty && !p.bossCall && e.type === 'message' && !sampleIds.has(e.id) && !spokeAgain.has(e.actor) && asksBoss(e.text, agents)) {
      p.bossCall = { id: e.id, ts, text: bossParagraph(e.text, agents).replace(/\s+/g, ' ').trim().slice(0, 80) };   // 인용은 대표에게 한 그 문단(나리 09-15)
    }
    if (inRound && e.type === 'message') spokeAgain.add(e.actor);
  }
  return { ...people, boss };
}

/** 신호가 이 안이면 턴이 끝났어도 "일하는 중" (결정 58 ① 의 "5분 내"). */
export const WORK_FRESH_MS = 5 * 60_000;

/**
 * 일 상태 (대표 결정 58 ①) — 관제탑 개인 카드의 알약. **마을 시계를 안 본다** — 일요일 저녁이라고 라운드 도는 사람이 "잠" 으로 떴다.
 * 먼저 맞는 것이 이긴다: working → bossCall → blocked → waiting → resting. 표는 docs/event-schema.md 3절 "일 상태".
 * 대표 부름이 신호 5분보다 앞인 이유 — 부르고 기다리는 사람은 방금 말했으니 신호가 늘 최근이라, 뒤에 두면 "일하는 중" 에 가려진다.
 * @param p     people[자리] — busy · alive(codex 는 null) · lastSignal · bossCall
 * @param phase 팀의 phase — running · blocked · idle (총괄실은 늘 idle)
 */
export function workStateOf(p, phase, now = Date.now()) {
  if (p.busy) return 'working';
  if (p.bossCall) return 'bossCall';
  if (phase === 'blocked') return 'blocked';
  if (p.lastSignal && now - new Date(p.lastSignal).getTime() < WORK_FRESH_MS) return 'working';
  if (p.alive || phase !== 'running') return 'waiting';
  return 'resting';
}

/**
 * 오늘 대표에게 한 말 (결정 50·52) — 관제탑 "전체" 의 "오늘 보고" 줄. 대표를 부른(`callsBoss`) 오늘의 발언을 최근 것부터 30건까지.
 * `ask` 는 결정이 필요한 말인가 — `asksBoss` 그대로(결정 52). 아니면 보고다. 종 배지(`bossCall`)도 같은 판별이라 종은 `ask` 인 것만.
 */
export function bossNotesOf(log, cast, { now = Date.now(), limit = 30 } = {}) {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const sampleIds = sampleIdsOf(log);   // 말투 표본 발언 — 대표에게 한 말이 아니다
  const out = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = log[i];
    if (new Date(e.ts ?? 0).getTime() < dayStart.getTime()) break;
    if (sampleIds.has(e.id)) continue;
    if (e.type !== 'message' || e.actor === 'boss' || e.actor === 'system' || !callsBoss(e.text, cast)) continue;
    const text = String(e.text ?? '').replace(/\s+/g, ' ').trim();
    out.push({ id: e.id, ts: e.ts, by: e.actor, text: text.slice(0, 160), ask: asksBoss(e.text, cast) });
  }
  return out;
}

/**
 * 한 것 — 한 목록 (결정 92 "누가 뭘 했나", M6 준비). 계약은 docs/event-schema.md 3절 "한 것 — 한 목록".
 * 지금 화면은 "오늘 몇 번 말했나"(수)와 "마지막 한 문장" 뿐이라 **누가 무엇을 끝냈는지**가 없다. 파일에는 다 있다 — 판정 카드·승인 판정·요청 블록·마일스톤·라운드 —
 * 그걸 사람에게 묶는 함수가 이것이다. `blockedOf` 와 짝: 평평한 목록 하나, 화면·보고서가 사람·라운드·날짜로 자른다.
 * 파일을 안 읽는 순수 함수 — `round.mjs check` 가 돌린다. 서버가 팀마다 부르고 합친다.
 *
 * @param log        대화록(시간순)
 * @param cast       cast.json 의 agents
 * @param since·until 창(ms 또는 ISO) — since ≤ ts < until. 기본은 오늘 0시 ~ 지금
 * @param approvals  이 팀의 승인 레코드 [{ id, grade, what, team, decisions:[{ by, decision, ts }] }] — 판정 한 줄이 "한 것" 하나
 * @param team       팀 id — 항목에 그대로
 * @returns 항목 [{ id, kind, team, by, ts, text, ref }] — ts 내림차순(최근 것이 위)
 *   kind: report(대표에게 보고 — 결정 안 청한 말) · verdict(판정 카드, ref=sha) · decision(승인 판정, ref=승인 id) · proxy(대리 결정) ·
 *         request(요청 블록 닫힘, ref=요청 id) · milestone(통과) · round(닫힘, ref=판정) ·
 *         commit(커밋 — Bash 도구 줄에 git commit, ref=없음) · file(산출물 파일 갱신 — Write/Edit 도구 줄이 teams/<팀>/out/ 을 가리킴, 같은 파일은 창 안 마지막 한 번만, ref=경로)
 *   커밋·산출물은 나리 결정(09-15, 위임 136) — "지금 세는 게 승인·판정 카드뿐이라 만든 사람은 안 보이고 감사만 보인다. 만든 게 한 것이다."
 */
/**
 * 앞날 띠 (대시보드 = "앞으로 언제 뭐가 되나", 헨리 시안 1판 dashboard.svg · 결정 128) — 한 팀의 단계들을 시간 위에 놓는다. 순수 — check 가 돌린다.
 * 지난 것(pass)은 없다(나리 규칙 — 현황과 안 겹치게). 예정 시각은 손으로 안 적는다 — timebox("2 라운드") × 이 팀 회차 평균 길이.
 *
 * @param roadmap   { milestones: [{ n, title, status, timebox }] }
 * @param state     round.json — { phase, round, milestone, startedAt }
 * @param rounds    rounds.jsonl 항목들(최근 것 먼저여도 된다) — startedAt·endedAt 으로 회차 길이
 * @param progress  progress.json(blocked[]·boss[]) 또는 null
 * @param now       ms
 * @returns { stages: [{ n, title, status, plannedFrom, plannedTo, late, blockedWhy, gate }], roundMs }
 *   status: running(지금 단계) · planned(잡힌 예정) · gated(대표 답 뒤 — gate 에 무엇) · blocked(FAIL 로 막힘)
 */
export const DEFAULT_ROUND_MS = 90 * 60_000;
/**
 * 멈춘 시간(state/pauses.json — [{ from, to, why }], 대표가 "쉬어라" 한 구간을 나리·톰이 손으로 적는다).
 * 늦음·기다림·회차 길이에서 뺀다 — 09-14 낮~09-15 밤(사용량 1%) 하루가 통째로 "41시간 늦음"·"33시간째" 로 대표 화면에 섰다(톰 09-15). 순수 — check 가 돌린다.
 */
export function readPauses() {
  const list = readJSON(path.join(ROOT, 'state', 'pauses.json'), []);
  return (Array.isArray(list) ? list : []).map((p) => ({ from: Date.parse(p.from), to: Date.parse(p.to), why: p.why ?? '' })).filter((p) => Number.isFinite(p.from) && Number.isFinite(p.to) && p.to > p.from);
}
/** a~b 사이에 멈춰 있던 ms — 구간이 겹친 만큼만. a·b 는 ms 또는 ISO. */
export function pausedMs(a, b, pauses = []) {
  const s = typeof a === 'number' ? a : Date.parse(a), e = typeof b === 'number' ? b : Date.parse(b);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  let sum = 0;
  for (const p of pauses) { const f = typeof p.from === 'number' ? p.from : Date.parse(p.from), t = typeof p.to === 'number' ? p.to : Date.parse(p.to); sum += Math.max(0, Math.min(e, t) - Math.max(s, f)); }
  return sum;
}
export function timeboxRounds(timebox) {
  const s = String(timebox ?? '').trim();
  if (!s || /대표/.test(s)) return null;                          // "대표 방향 뒤 정함" · "대표가 방식을 고른 뒤 2 라운드" — 대표가 열어야 센다
  if (/^반\s*라운드/.test(s)) return 0.5;
  const m = /(\d+(?:\.\d+)?)\s*라운드/.exec(s);
  return m ? Number(m[1]) : null;
}
export function roundLengthMs(rounds, { fallback = DEFAULT_ROUND_MS, n = 8, pauses = [] } = {}) {
  const lens = (rounds ?? []).filter((r) => r.startedAt && r.endedAt).map((r) => Date.parse(r.endedAt) - Date.parse(r.startedAt) - pausedMs(r.startedAt, r.endedAt, pauses)).filter((x) => Number.isFinite(x) && x > 0);
  const last = lens.slice(0, n);
  return last.length ? Math.round(last.reduce((a, b) => a + b, 0) / last.length) : fallback;
}
export function plansOf({ roadmap, state, rounds = [], progress = null, now = Date.now(), pauses = [] } = {}) {
  const roundMs = roundLengthMs(rounds, { pauses });
  const ms = (roadmap?.milestones ?? []).filter((m) => m.status !== 'pass').sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  const phase = state?.phase ?? 'idle';
  const blockedWhy = phase === 'blocked' ? (progress?.blocked?.[0] ?? 'FAIL 로 막힘 — 대표 판단 대기') : null;
  const stages = [];
  let cursor = null;   // 앞 단계가 끝나는 시각 — 다음 단계는 여기서 시작
  for (const m of ms) {
    // 지금 단계(status now — 착수 카드가 통과됐다)는 timebox 에 "대표" 가 있어도 문이 아니다 — 문은 이미 열렸다(나리 실측 09-15 23:10: 경영 2단계가 착수됐는데 '대표가 정한 뒤' 로 섰다).
    // timebox 가 아예 없으면 문이 아니라 **잡히지 않은 것** — 날짜 없이 'N단계' 만(지어내지 않는다). 문(gated)은 글자에 "대표" 가 있을 때만.
    const isNow = m.status === 'now' || m.n === state?.milestone;
    const tb = String(m.timebox ?? '').trim();
    const box = timeboxRounds(m.timebox) ?? (m.status === 'now' ? (Number(/(\d+(?:\.\d+)?)\s*라운드/.exec(tb)?.[1]) || 1) : null);
    const gate = box == null && /대표/.test(tb) ? tb : null;
    let from = null, to = null;
    if (box != null) {
      from = isNow ? (state?.startedAt && phase !== 'idle' ? Date.parse(state.startedAt) : now) : (cursor ?? now);
      to = from + box * roundMs;
      to += pausedMs(from, to, pauses);   // 예정 창 안에 멈춘 구간이 있으면 그만큼 뒤로 — 멈춤은 일한 시간이 아니다. 창 뒤의 멈춤은 late 에서 뺀다
      cursor = Math.max(to, now);
    }
    const late = isNow && to != null && now > to ? Math.max(0, now - to - pausedMs(to, now, pauses)) : 0;
    const status = isNow && blockedWhy ? 'blocked' : gate ? 'gated' : isNow ? 'running' : 'planned';
    stages.push({
      n: m.n, title: m.title, status, gate,
      plannedFrom: from != null ? new Date(from).toISOString() : null,
      plannedTo: to != null ? new Date(to).toISOString() : null,
      late, blockedWhy: isNow ? blockedWhy : null,
    });
  }
  return { stages, roundMs };
}

/**
 * 예정 작업 표(plan-table.md, 톰)의 '팀별 단계' 절을 서버가 roadmap 에서 만든다(톰 결정 09-14: "손으로 세는 건 썩는다"). 톰이 쓰는 건 위(대표님이 물으신 것)·아래(대표님 손에 있는 것) 둘뿐.
 * 순수 — check 가 돌린다. 세는 숫자 없음(헨리) — 단계 번호·낱말·시각만. 시각은 우리 시각(서울).
 */
const STATUS_WORD = { running: '하는 중', planned: '대기', gated: '대기(대표)', blocked: '막힘' };
export function stageTable(teamsOut, { now = Date.now() } = {}) {
  const hm = (iso) => { const t = Date.parse(iso ?? ''); if (!Number.isFinite(t)) return ''; const d = new Date(t + SEOUL_OFFSET_MS); const dd = Math.floor((t + SEOUL_OFFSET_MS) / 86_400_000) - Math.floor((now + SEOUL_OFFSET_MS) / 86_400_000); const clock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; return dd <= 0 ? `오늘 ${clock}` : dd === 1 ? `내일 ${clock}` : dd === 2 ? `모레 ${clock}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const rows = ['| 팀 | 지금 단계 | 상태 | 예정 | 다음 |', '| --- | --- | --- | --- | --- |'];
  for (const t of teamsOut) {
    const cur = t.stages.find((s) => s.status === 'running' || s.status === 'blocked');
    const rest = t.stages.filter((s) => s !== cur);
    const cell = (s) => (s == null ? '' : String(s).replace(/\|/g, '·').replace(/\n/g, ' '));
    const status = cur ? STATUS_WORD[cur.status] + (cur.blockedWhy ? ` — ${cur.blockedWhy}` : '') + (cur.late ? ` · ${Math.round(cur.late / 60000) < 60 ? Math.round(cur.late / 60000) + '분' : Math.round(cur.late / 3600_000) + '시간'} 늦음` : '') : t.stages.length ? '대기' : '단계 없음';
    const next = rest.map((s) => `${s.n != null ? s.n + '단계 ' : ''}${s.title}${s.status === 'gated' ? `(${s.gate})` : ''}`).join(' → ') || (t.stages.length ? '' : '계획표 — 대표가 연다');
    rows.push(`| ${cell(t.room ?? t.name)} | ${cur ? cell(`${cur.n}단계 ${cur.title}`) : cell(t.stages[0] ? `${t.stages[0].n}단계 ${t.stages[0].title}` : '')} | ${cell(status)} | ${cur?.plannedTo ? hm(cur.plannedTo) + '까지' : cur?.gate ?? ''} | ${cell(next)} |`);
  }
  return rows.join('\n');
}
/** 마크다운의 `## <제목>` 절 본문을 바꿔 끼운다 — 다음 `## ` 앞까지. 절이 없으면 끝에 붙인다. 순수. */
export function swapSection(md, heading, body) {
  const lines = String(md ?? '').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l.trim()));
  const block = [`## ${heading}`, '', body.trim(), ''];
  if (start < 0) return [...lines, '', ...block].join('\n');
  let end = start + 1; while (end < lines.length && !/^##\s/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n');
}

/** 우리 시각(서울, +09:00 고정 — 서머타임 없음)의 그날 0시를 UTC ms 로. 서버 프로세스의 TZ 와 무관하다 — 결정 101 의 아홉 시간 오류가 집계에서 다시 나지 않게(레오, R25). */
export const SEOUL_OFFSET_MS = 9 * 3600_000;
export const dayStartSeoul = (now = Date.now()) => Math.floor((now + SEOUL_OFFSET_MS) / 86_400_000) * 86_400_000 - SEOUL_OFFSET_MS;

export function doneOf(log, cast, { team = null, since = null, until = null, approvals = [], now = Date.now() } = {}) {
  const agents = cast ?? {};
  const s = since != null ? new Date(since).getTime() : dayStartSeoul(now);
  const u = until != null ? new Date(until).getTime() : now;
  const inWin = (ts) => { const t = new Date(ts ?? 0).getTime(); return t >= s && t < u; };
  const one = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = [];
  for (const e of log) {
    if (!inWin(e.ts)) continue;
    const m = e.meta ?? {};
    if (e.type === 'verdict') {
      if (m.stale) continue;   // 늦게 온 판정은 라운드가 안 받았다 — 한 것이 아니다
      out.push({ id: `verdict:${e.id}`, kind: 'verdict', team, by: e.actor, ts: e.ts, text: `${m.verdict ?? '판정'} — ${one(e.text, 120)}`, ref: m.sha ?? null });
    } else if (e.type === 'milestone') {
      out.push({ id: `milestone:${e.id}`, kind: 'milestone', team, by: null, ts: e.ts, text: one(e.text, 120), ref: m.index ?? null });
    } else if (e.type === 'round_end') {
      out.push({ id: `round:${e.id}`, kind: 'round', team, by: null, ts: e.ts, text: `라운드 ${e.round ?? '?'} 닫힘 — ${one(e.text, 100)}`, ref: m.verdict ?? null });
    } else if (e.type === 'note' && m.request && m.status === 'closed') {
      out.push({ id: `request:${m.request}`, kind: 'request', team, by: null, ts: e.ts, text: one(e.text, 160), ref: m.request });
    } else if (e.type === 'note' && m.proxy) {
      out.push({ id: `proxy:${e.id}`, kind: 'proxy', team, by: 'chief', ts: e.ts, text: one(e.text, 160), ref: m.approval ?? m.proxyAnswer ?? null });
    } else if (e.type === 'message' && e.actor !== 'boss' && e.actor !== 'system' && agents[e.actor] && callsBoss(e.text, agents) && !asksBoss(e.text, agents)) {
      out.push({ id: `report:${e.id}`, kind: 'report', team, by: e.actor, ts: e.ts, text: one(e.text, 160), ref: null });
    } else if (e.type === 'tool' && agents[e.actor]) {
      // 만든 것도 한 것이다(나리 09-15) — 커밋 한 줄(도구 줄엔 명령 첫 줄 160자뿐이라 -m 뒤 글자를 뽑는다), 산출물 파일 갱신(Write/Edit 가 out/ 을 가리킴)
      const tool = String(m.tool ?? ''), text = String(e.text ?? '');
      if (tool === 'Bash' && /\bgit commit\b/.test(text)) {
        const mm = /-m\s+(["'])(.*)$/.exec(text);
        let msg = mm ? mm[2] : null;
        if (msg) { const j = msg.indexOf(mm[1]); if (j >= 0) msg = msg.slice(0, j); }   // 여는 따옴표와 같은 것이 닫는 것 — 안에 든 다른 따옴표는 글자
        if (msg != null) msg = msg.replace(/[\s\\]+$/, '') || null;
        out.push({ id: `commit:${e.id}`, kind: 'commit', team, by: e.actor, ts: e.ts, text: `커밋 — ${msg ? one(msg, 120) : '(메시지 못 읽음)'}`, ref: null });
      } else if ((tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') && /\/teams\/[^/]+\/out\//.test(text)) {
        const rel = text.slice(text.indexOf('/teams/') + 1);   // teams/<팀>/out/… 부터
        const key = `file:${e.actor}:${rel}`;
        const i = out.findIndex((it) => it.id === key);
        const it = { id: key, kind: 'file', team, by: e.actor, ts: e.ts, text: `산출물 — ${one(rel.replace(/^teams\//, ''), 120)}`, ref: rel };
        if (i >= 0) out[i] = it; else out.push(it);   // 같은 파일을 여러 번 고쳐도 창 안 마지막 한 번
      }
    }
  }
  for (const r of approvals) {
    for (const d of r.decisions ?? []) {
      if (!inWin(d.ts)) continue;
      out.push({ id: `decision:${r.id}:${d.by}`, kind: 'decision', team: r.team ?? team, by: d.by, ts: d.ts, text: `승인 [${r.grade}] ${one(r.what, 100)} → ${d.decision}`, ref: r.id });
    }
  }
  out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return out;
}

/**
 * 멈춰 있던 구간 — 보고서 탭 "막힌 것 N · 한 것은 점, 멈춤은 빨간 띠"(헨리 report 1판 · 결정 80 ②). 순수 — check 가 돌린다.
 * 두 종류: FAIL 로 방이 막힌 구간(note meta.blocked → note meta.resumed, 안 풀렸으면 to: null) · 대표를 불렀는데 답이 없던 구간(asksBoss 말 → 그 뒤 첫 대표 말/대리 답, 없으면 to: null).
 * 창(since ≤ … < until)과 겹치는 것만 — 창 앞에서 시작해 창 안에서 풀린 것도 든다. from·to 는 ISO. text 는 왜 멈췄나 한 줄, by 는 사람(FAIL 은 null).
 * @returns [{ team, kind: 'fail'|'ask', from, to, text, by, ref }] — from 오름차순
 */
export function blockedSpansOf(log, cast, { team = null, since = null, until = null, now = Date.now(), pauses = [] } = {}) {
  const s = since != null ? new Date(since).getTime() : dayStartSeoul(now), u = until != null ? new Date(until).getTime() : now;
  const ms = (ts) => new Date(ts ?? 0).getTime();
  const one = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const spans = [];
  const sampleIds = sampleIdsOf(log);   // 말투 표본 발언 — 실제 막힘·물음이 아니다
  let fail = null;   // 열린 FAIL 구간
  let ask = null;    // 열린 물음 구간
  for (const e of log) {
    if (sampleIds.has(e.id)) continue;
    if (e.type === 'note' && e.meta?.blocked) { if (!fail) fail = { team, kind: 'fail', from: e.ts, to: null, text: one(e.text, 120), by: null, ref: e.id }; continue; }
    if (e.type === 'note' && e.meta?.resumed) { if (fail) { fail.to = e.ts; spans.push(fail); fail = null; } continue; }
    // 라운드가 닫히거나 새로 열리면 그 라운드의 막힘·물음은 거기서 끝난다(라운드 닫힘이 곧 풀림 — 마케팅 '반박 3회' 가 사흘째 열린 채 섰다, 나리 09-15). teamSummary 와 같은 선
    if (e.type === 'round_end' || e.type === 'round_start') { if (fail) { fail.to = e.ts; spans.push(fail); fail = null; } if (ask) { ask.to = e.ts; spans.push(ask); ask = null; } continue; }
    if (e.type === 'message' && e.actor === 'boss' && !e.meta?.via) { if (ask) { ask.to = e.ts; spans.push(ask); ask = null; } continue; }
    if (e.type === 'note' && e.meta?.proxyAnswer) { if (ask) { ask.to = e.ts; spans.push(ask); ask = null; } continue; }
    // 물은 사람이 그 뒤 다시 말하면 그 물음은 거기서 끝 — bossCallOf 와 같은 선(나리 결정 ①). 같은 말이 새 물음이면 바로 밑에서 다시 연다
    if (ask && e.type === 'message' && e.actor === ask.by && !isPassLine(e.text)) { ask.to = e.ts; spans.push(ask); ask = null; }
    if (!ask && e.type === 'message' && e.actor !== 'boss' && e.actor !== 'system' && cast?.[e.actor] && asksBoss(e.text, cast)) {
      ask = { team, kind: 'ask', from: e.ts, to: null, text: one(bossParagraph(e.text, cast), 120), by: e.actor, ref: e.id };
    }
  }
  if (fail) spans.push(fail);
  if (ask) spans.push(ask);
  // 멈춘 구간(state/pauses.json — 대표가 쉬어라 한 시간)은 막힘이 아니다 — 그 구간을 잘라낸다. 창 전체가 멈춤이면 막힌 것 0 (나리 09-15: 멈춘 하루가 '네 팀이 밤새 막혔다' 로 섰다)
  const clip = (sp) => {
    let pieces = [{ from: ms(sp.from), to: sp.to == null ? null : ms(sp.to) }];
    for (const p of pauses) {
      const pf = ms(p.from), pt = ms(p.to);
      if (!Number.isFinite(pf) || !Number.isFinite(pt) || pt <= pf) continue;
      pieces = pieces.flatMap(({ from, to }) => {
        const end = to ?? u;
        if (pt <= from || pf >= end) return [{ from, to }];
        const out = [];
        if (pf > from) out.push({ from, to: pf });
        if (pt < end) out.push({ from: pt, to });
        return out;
      });
    }
    return pieces.map((pc) => ({ ...sp, from: new Date(pc.from).toISOString(), to: pc.to == null ? null : new Date(pc.to).toISOString() }));
  };
  return spans.flatMap(clip).filter((sp) => ms(sp.from) < u && (sp.to == null || ms(sp.to) > s)).sort((a, b) => String(a.from).localeCompare(String(b.from)));
}
