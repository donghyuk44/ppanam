#!/usr/bin/env node
// 외부감사 — 다른 회사 모델이 이 방의 참여자로 앉는다.
//
//   node bus/outside.mjs --status
//   node bus/outside.mjs --team marketing --ask "이 산출물의 근거가 실재하는가"
//   node bus/outside.mjs --team marketing --turn called   사회자가 차례를 줄 때 (called·lull·lunch·third — 판정 없음)
//   node bus/outside.mjs --check "2 더하기 2는 5인가"      한 번만 묻고 끝 (기록 안 함)
//   node bus/outside.mjs --team marketing --reset          세션 버리기
//   node bus/outside.mjs --setup
//
// 이 자리가 존재하는 이유는 하나다.
// 클로드 둘이 사이좋게 같이 틀릴 때, 그건 다른 엔진에게만 보인다.
//
// **이 파일이 곧 그 참여자다.** 클로드 서브에이전트가 codex 를 대신 불러 답을 옮기면,
// 옮기는 순간 그건 다시 클로드의 말이 된다. 그래서 여기서 직접 대화록에 남긴다.
// 클로드는 부르기만 하고 본문에 손대지 않는다.
//
// 세션은 방마다 하나씩 유지된다 (codex exec resume). 외부감사도 대화를 기억한다.
// 라운드가 끝나면 버린다 — 비워지는 건 AI 컨텍스트뿐이라는 규칙은 여기에도 같다.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, emit, recordVerdict, readContext, readTail, readLog, readCast, readState, appendJournal,
  defaultTeam, teamExists, isOffice, VERDICTS, decideApproval, journalPrompt, headSha, codexModelOf, codexArgs,
  markOutsideRunning, clearOutsideRunning, outsideCooldown, setOutsideCooldown, parseUsageLimit, geminiModelOf, isForeign, fallbackOf, engineName,
} from './bus.mjs';
// 인격 조립은 클로드 자리와 같은 함수 하나로 — 인격 + 확정 조항 + 일지 + 라운드 브리프 (session.mjs 의 setInterval 은 unref 라 CLI 가 안 붙든다).
import { assemblePrompt, personaOf as seatPersonaOf } from '../server/session.mjs';

const run = promisify(execFile);
const TIMEOUT = Number(process.env.PPANAM_OUTSIDE_TIMEOUT || 300_000);
const API_MODEL = process.env.PPANAM_OUTSIDE_MODEL || 'gpt-5.1';

// codex 는 모델이 아니라 CLI 다. 그 안에서 도는 모델을 여기서 못 박는다 — 기본값에 얹어두면 어느 엔진이 판정했는지 기록에 남지 않는다.
// 모델은 자리별이다 (결정 69): cast.json 의 codexModel 이 먼저, 없으면 환경 PPANAM_CODEX_MODEL(옛 길, 전 자리 공통), 그것도 없으면 목록 첫 것.
// 추론 강도(effort)도 cast.json — 없으면 안 넘겨 codex 기본. 대표가 관제탑에서 바꾸면 다음 호출이 여기서 새로 읽는다.
// 어느 자리인가 — 기본은 외부감사(outside). 대표가 다른 자리를 codex 로 바꾸면(결정 69 ①) 사회자가 --actor <자리> 로 띄운다.
// 이 프로세스는 그 자리로 말하고(emit actor), 그 자리의 인격·일지·세션 칸을 쓴다. 자리 이름이 곧 화자다.
let ACTOR = 'outside';
const seatOf = (team) => readCast(team).agents?.[ACTOR] ?? null;
const codexModelFor = (team) => codexModelOf(seatOf(team));
const geminiModelFor = (team) => geminiModelOf(seatOf(team));
const effortFor = (team) => seatOf(team)?.effort ?? null;
// 이 자리의 엔진 — cast.json 의 model. 'gpt' 면 codex CLI, 'gemini' 면 파일로(runGemini). 라벨은 답한 것을 적는다(결정 78).
const engineKindOf = (team) => seatOf(team)?.model ?? 'gpt';
const engineLabel = (team, kind) => (kind === 'gemini' ? `gemini · ${geminiModelFor(team)}` : `codex · ${codexModelFor(team)}`);
const engineOf = (team) => engineLabel(team, engineKindOf(team));

const STORE = path.join(ROOT, 'state', 'outside-sessions.json');
// --debug: codex 의 stderr 머리말을 그대로 보여준다 — 세션 id 를 못 읽을 때 무엇이 오는지 보려고 (2026-09-13).
const DEBUG = process.argv.includes('--debug');

/* ── 세션 보관 ── */

const readStore = () => {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
};

function writeStore(all) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2) + '\n');
}

/** 세션 칸 이름 — 외부감사는 방 이름 그대로(옛 저장소 호환), 다른 자리는 "방:자리". */
const slotKey = (team) => (ACTOR === 'outside' ? team : `${team}:${ACTOR}`);

/** 예전 형식({팀: "세션id"})도 읽는다. engine 이 없으면 codex 것이다(gemini 이전에 쓴 칸). */
function slotOf(team) {
  const v = readStore()[slotKey(team)];
  if (!v) return null;
  return typeof v === 'string' ? { id: v, lastSeen: null, engine: 'gpt' } : { engine: 'gpt', ...v };
}

function remember(team, id, lastSeen, engine = 'gpt') {
  const all = readStore();
  all[slotKey(team)] = { id, lastSeen: lastSeen ?? slotOf(team)?.lastSeen ?? null, engine };
  writeStore(all);
}

function forget(team) {
  const all = readStore();
  if (!(slotKey(team) in all)) return false;
  delete all[slotKey(team)];
  writeStore(all);
  return true;
}

/* ── codex ── */

async function hasCodex() {
  try { await run('which', ['codex']); return true; } catch { return false; }
}

/**
 * codex 한 턴.
 *
 * 프롬프트는 인자가 아니라 stdin 으로 넘긴다. execFile 로는 stdin 을 닫을 수 없어
 * codex 가 입력을 영원히 기다린다 — spawn 으로 직접 쓰고 닫는다.
 * 최종 답은 -o 파일로 받는 쪽이 확실하다. 진행 상황은 stderr 로 나온다.
 *
 * 샌드박스는 건드리지 않는다. 기본값이 읽기 전용이고, 감사역은 고치면 안 된다.
 */
function runCodex(input, { resume = null, model = codexModelOf(null), effort = null } = {}) {
  const outPath = path.join(os.tmpdir(), `ppanam-outside-${crypto.randomBytes(4).toString('hex')}.txt`);
  // 인자는 bus.codexArgs 하나 — 샌드박스 읽기 전용 · resume 은 -c 로 · 자리별 모델 · 추론 강도(결정 69). check 가 같은 함수를 돌려본다.
  const args = codexArgs({ model, effort, resume, outPath });

  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`응답 없음 (${Math.round(TIMEOUT / 1000)}초 초과)`));
    }, TIMEOUT);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      let answer = '';
      try { answer = fs.readFileSync(outPath, 'utf8').trim(); } catch { /* stdout 으로 */ }
      try { fs.unlinkSync(outPath); } catch { /* 없으면 그만 */ }
      if (code !== 0) {
        const why = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        return finish(reject, new Error(`codex exit ${code}${why ? ' — ' + why : ''}`));
      }
      // 세션 id 는 stderr 머리말에 나온다. 다음 턴을 이어붙이려면 이게 필요하다.
      // 머리말에 색 코드가 섞인다 — `\e[1msession id:\e[0m 01a0…` — 그대로 찾으면 못 읽고, 새 세션마다 id 가 null 이라
      // 다음 턴이 또 새 세션이 된다 ("레오 님이 들어왔습니다" 가 턴마다 찍힘 — 09-13 15:34~16:41 에 17번, teams/dev/log.jsonl). 색 코드를 벗기고 찾는다.
      const plain = stderr.replace(/\x1b\[[0-9;]*m/g, '');
      const sid = /session id:\s*([0-9a-f-]{8,})/i.exec(plain)?.[1] ?? resume ?? null;
      if (DEBUG) console.error(`[debug] codex stderr (${stderr.length}자) · 세션 id ${sid ?? '(못 읽음)'}:\n${stderr.slice(0, 1200)}`);
      finish(resolve, { answer: answer || stdout.trim(), sessionId: sid });
    });

    child.stdin.on('error', () => { /* 자식이 먼저 죽은 경우 */ });
    child.stdin.end(input);
  });
}

/* ── gemini — 파일로 주고받기 ──
 * 임시 외부 감사(대표 결정 09-14 — codex 계정 한도 엿새). Antigravity 앱은 명령줄이 없어 outside.mjs 가 직접 못 부른다. ChatGPT 그림 뽑을 때 쓰던 길 그대로:
 *   state/gemini/ask/<id>.json     { id, team, actor, model, prompt, resume, ts }   ← 여기서 쓴다
 *   state/gemini/answer/<id>.json  { id, answer, sessionId, ts }                    ← 하네스가 창을 몰아 쓴다
 * runCodex 와 같은 모양 { answer, sessionId } 를 돌려준다. 느리다(30초~1분) — 판정 같은 큰 것에만 건다.
 */
export const GEMINI_DIR = path.join(ROOT, 'state', 'gemini');
const GEMINI_POLL_MS = 2000;
function runGemini(input, { resume = null, model = geminiModelOf(null), team = null } = {}) {
  const id = `gem_${crypto.randomBytes(4).toString('hex')}`;
  const askDir = path.join(GEMINI_DIR, 'ask'), ansDir = path.join(GEMINI_DIR, 'answer');
  const askPath = path.join(askDir, `${id}.json`), ansPath = path.join(ansDir, `${id}.json`);
  fs.mkdirSync(askDir, { recursive: true }); fs.mkdirSync(ansDir, { recursive: true });
  // 임시 파일에 쓴 뒤 rename — 하네스가 반쪽 JSON 을 읽지 않게.
  const tmp = `${askPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id, team, actor: ACTOR, model, prompt: input, resume, ts: new Date().toISOString() }, null, 1) + '\n');
  fs.renameSync(tmp, askPath);
  if (DEBUG) console.error(`[debug] gemini 물음 ${askPath} (${input.length}자)`);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const cleanup = () => { try { fs.rmSync(askPath, { force: true }); } catch { /* 없으면 그만 */ } try { fs.rmSync(ansPath, { force: true }); } catch { /* 없으면 그만 */ } };
    const poll = () => {
      let raw = null;
      try { raw = fs.readFileSync(ansPath, 'utf8'); } catch { /* 아직 */ }
      if (raw != null) {
        let a;
        try { a = JSON.parse(raw); } catch { return setTimeout(poll, GEMINI_POLL_MS); }   // 쓰는 중일 수 있다 — 한 번 더
        cleanup();
        if (a.error) return reject(new Error(`gemini — ${String(a.error).slice(0, 200)}`));
        return resolve({ answer: String(a.answer ?? '').trim(), sessionId: a.sessionId ?? resume ?? null });
      }
      if (Date.now() - started > TIMEOUT) { cleanup(); return reject(new Error(`gemini 답 없음 (${Math.round(TIMEOUT / 1000)}초 초과) — 하네스 세션이 도는 중인가`)); }
      setTimeout(poll, GEMINI_POLL_MS);
    };
    setTimeout(poll, GEMINI_POLL_MS);
  });
}

/* ── 참여자로서 말하기 ── */

const DEFAULT_PERSONA =`너는 이 팀의 **외부감사**이다. 다른 회사 모델이고, 그래서 여기 있다.
클로드끼리 합의한 지점이야말로 네가 봐야 하는 곳이다.

본다: 인용된 수치·날짜·링크가 실재하는가. 코드라면 경계 조건과 멱등성.
그리고 상대가 당연하게 깔고 있어서 스스로는 못 보는 가정.

합의를 만들려 하지 마라. 이견이 없으면 없다고 하고, 있으면 근거와 함께 말해라.
파일은 읽되 고치지 마라. 한국어로 답한다.`;

/**
 * 턴마다 다시 준다 — 클로드 자리가 시스템 프롬프트로 매 턴 받는 것과 같은 조립(인격 + 확정 조항 + 일지 + 라운드 브리프).
 * 첫 턴에만 주면 세션이 라운드를 넘기며 압축될 때 인격이 먼저 사라진다 (M1 인격 이음, 2026-09-13). 인격 파일이 없는 방은 공용 인격.
 */
function personaOf(team) {
  const full = assemblePrompt(team, ACTOR);
  return seatPersonaOf(team, ACTOR) ? full : [DEFAULT_PERSONA, full].filter(Boolean).join('\n\n---\n\n');
}

/**
 * 이 방에서 오간 말. 외부감사도 대화를 따라와야 참여자다.
 *
 * 작전실은 이번 라운드만 본다(라운드마다 컨텍스트를 비운다는 규칙).
 * 총괄실은 라운드가 없어서 readContext 가 늘 비어 있으므로 최근 대화를 쓴다 —
 * 이걸 안 하면 제리가 대표 원문을 못 보고 대조하는 척만 하게 된다.
 */
function contextOf(team, { since = null, fromRound = null } = {}) {
  const cast = readCast(team).agents ?? {};
  // 넘어온 차례(--from-round)는 닫힌 라운드의 못 들은 말부터 — 지난 라운드 커서가 이번 라운드에 없어 마지막 10줄로 떨어지면
  // 무엇에 답하는지 모른다 (결정 25).
  const { round } = readState(team);
  let events = isOffice(team) ? readTail(team, { limit: 40 }).events
    : fromRound && round ? readLog(team).filter((e) => e.round >= fromRound && e.round <= round) : readContext(team);

  // 이어지는 턴에는 지난번 이후에 새로 오간 말만 넘긴다.
  // 이게 없으면 첫 턴 이후로 방에서 무슨 말이 오갔는지 모른 채 답하게 된다.
  if (since) {
    const i = events.findIndex((e) => e.id === since);
    events = i >= 0 ? events.slice(i + 1) : events.slice(-10);
  }

  const lines = [];
  for (const e of events) {
    if (e.type === 'tool' || e.meta?.alive) continue;   // 도구 줄·생존 알림(결정 31 ②)은 화면용
    // 시스템 살림살이는 감사 재료가 아니다(대표 지적 09-14 — 마크 첫 호출 17,126자 중 67% 가 방 대화록, 밤 시계 깨우기까지 들어감).
    // note(승인·요청 블록·차례 안내)와 밤 시계 깨우기(out/watchdogs/nightwatch.mjs 의 문장)는 뺀다. 사람 말·판정 카드·라운드 경계만 남는다.
    if (e.type === 'note') continue;
    if (e.actor === 'system' && e.type === 'message' && /밤 시계가 깨웁니다/.test(e.text ?? '')) continue;
    const who = cast[e.actor]?.name ?? e.actor;
    const tag = e.type === 'verdict' ? ` [${e.meta?.verdict ?? ''}]` : '';
    lines.push(`${who}${tag}: ${e.text.replace(/\s+/g, ' ').slice(0, e.actor === 'system' ? 300 : 600)}`);
  }
  return lines.slice(-40).join('\n');
}

/** 이 방에서 지금까지 남은 마지막 이벤트. 다음 턴에 "그 뒤로 새로 온 말"의 기준이 된다. */
function lastEventId(team) {
  const { events } = readTail(team, { limit: 1 });
  return events[0]?.id ?? null;
}

/**
 * 판정을 첫 줄에서 읽는다.
 * 페르소나가 "판정할 때는 첫 줄에 PASS 또는 REVISE 만" 이라고 시킨다.
 */
function splitVerdict(text) {
  const [first, ...rest] = text.split('\n');
  const v = first.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (VERDICTS.has(v)) return { verdict: v, body: rest.join('\n').trim() || text };
  return { verdict: null, body: text };
}

/** 판정 차례. 첫 줄 PASS/REVISE 규약 — 클로드 자리와 같다. */
const VERDICT_TURN = (target) => `⟦판정 요청⟧ ${target}\n판정 대상: ${target}. 산출물 파일을 열어 확인해라. 첫 줄에 PASS 또는 REVISE 한 단어만, 그다음 줄부터 근거(경로·줄 번호). 같은 지적을 다시 내지 마라 — 새 근거가 없으면 PASS.`;
/** 일지 차례. 답은 대화록이 아니라 journal/outside.md 에 간다. 지시문은 클로드 자리와 같은 것(bus.mjs journalPrompt) — 첫 문장 "나는 …". */
const JOURNAL_TURN = journalPrompt;

/** 사회자가 주는 차례의 종류별 지시문. 판정이 아니다. server/conductor.mjs 의 INSTRUCTION 과 같다. */
const TURN = {
  called: '방에서 너에게 한 말이다. 상대 이름으로 시작해 네 말투로 한두 문장 — 사람에게 말하듯, 보고서·목록 말고. 판정이 아니다 — 첫 줄에 PASS·REVISE·FAIL 을 쓰지 마라. 모르면 모른다고, 돌려봐야 알면 돌려보겠다고 해라. 남길 말이 없으면 (패스) 한 마디만.',
  lull: '방이 잠시 조용하다. 아무도 너에게 말한 건 아니다. 오간 말에 보탤 것이 있거나 누군가에게 한마디 걸고 싶으면 네 말투로 한두 문장 — 없으면 (패스) 한 마디만. 첫 줄에 PASS·REVISE·FAIL 을 쓰지 마라.',
  third: '두 사람 사이에서 같은 얘기가 세 번 오갔다. 너는 제3자다. 정리하거나 다른 각도를 하나만, 네 말투로 한두 문장. 없으면 (패스).',
  lunch: '점심시간이다. 일 얘기는 잠시 두고 한마디 툭 — 한 문장. 없으면 (패스).',
  carried: '지난 라운드가 닫히면서 못 받은 차례다 — 위 말 끝에 누가 너에게 한 말이 있다. 새 라운드가 열렸으니 그 말에 지금 답해라. 상대 이름으로 시작해 네 말투로 한두 문장. 판정이 아니다 — 첫 줄에 PASS·REVISE·FAIL 을 쓰지 마라. 남길 말이 없으면 (패스) 한 마디만.',
};

/**
 * 대화의 통로. 외부감사가 대화를 안 하는 이유는 성격이 아니라 통로였다 — --ask 는 한 번 돌고 첫 줄에
 * PASS/REVISE 를 강제하니 무슨 말을 해도 판정이 된다. 사회자(server/conductor.mjs)가 이름이 불리거나 방이
 * 조용할 때 --turn <종류> 로 깨우면, 그는 판정 없이 사람에게 답한다. 대표 지적 (2026-09-02).
 * 그의 답은 그가 직접 대화록에 남기고, 다른 자리들은 각자 다음 차례에 듣는다 — 들려주기는 사회자의 일이다.
 */
async function ask(team, question, { talk = false, lull = false, turn = null, text = null, dry = false, fromRound = null } = {}) {
  let KIND = engineKindOf(team);   // 'gpt' → codex CLI · 'gemini' → 파일. 기본이 못 돌면 아래서 폴백으로 바뀐다(결정 116 ②)
  // 계정 한도 쿨다운(R25) — codex 계정 것이라 gpt 자리에만. 폴백(자리의 fallback, 기본은 나머지 다른 회사 엔진)이 있으면 그걸로 이 호출을 돈다 —
  // 오늘 codex 하나가 끊겨 다섯 팀이 다 섰는데 인계받을 사람이 어디에도 안 적혀 있었다. 폴백이 'none' 이면 대표께 올리고 조용히 1 로 나간다(방마다 한 번 알림).
  const cd = dry || KIND !== 'gpt' ? null : outsideCooldown();
  if (cd) {
    const fb = fallbackOf(seatOf(team));
    const when = new Date(cd.until).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (fb && fb !== KIND) {
      if (!cd.noted.includes(`${team}:fb`)) {
        emit(team, { actor: ACTOR, type: 'note', text: `외부 감사 계정(codex)이 사용 한도에 걸려 ${when} 까지 못 부릅니다 — 이 자리에 적힌 폴백 ${engineName(fb)} 로 대신 돕니다(결정 116 ②). 판정문에는 답한 엔진이 적힙니다.` });
        setOutsideCooldown({ ...cd, noted: [...cd.noted, `${team}:fb`] });
      }
      KIND = fb;
    } else {
      if (!cd.noted.includes(team)) {
        emit(team, { actor: ACTOR, type: 'note', text: `외부 감사 계정이 사용 한도에 걸려 ${when} 까지 부르지 못합니다 — 대신할 엔진이 적혀 있지 않아 대표께 올립니다(결정 116 ②). 그때까지 이 자리는 조용히 건너뜁니다. 크레딧은 대표님 몫(결정 85 ④).` });
        setOutsideCooldown({ ...cd, noted: [...cd.noted, team] });
      }
      console.error(`외부 감사 쿨다운 — ${cd.until} 까지`);
      return 1;
    }
  }
  const ENGINE = engineLabel(team, KIND);   // 이 호출이 쓰는 엔진 — meta.engine 에 그대로 남는다 (자리별 모델, 결정 69 · 답한 것을 적는다, 결정 78)
  if (!dry && KIND === 'gpt' && !await hasCodex()) {
    emit(team, {
      actor: ACTOR, type: 'note',
      text: '외부 모델이 연결되어 있지 않습니다. 교차검증 없이 진행합니다.',
    });
    console.error('외부감사 설정 안 됨 — node bus/outside.mjs --setup');
    return 1;
  }

  // 승인 대조(apr_…)를 시키는 쪽을 먼저 본다. --team 은 다른 방의 외부감사를 빌려 묻는 데 쓰라고 열어둔 것인데
  // (룸메이트 렌즈), 개발팀 세션이 --team hq --ask "승인 요청 apr_x 대조" 로 제리에게 자기 요청의 대조를 기록하게 할 수
  // 있었다 (Fable 재점검, 2026-09-12). 서버가 띄운 세션은 PPANAM_TEAM 을 갖는다 — 총괄실 세션이 아니면 대조는 없다.
  // 환경이 없는 셸도 막는다. "대표의 터미널" 이라고 열어 뒀지만 그 셸이 대표인지 확인할 길이 없다 (대표 결정, 2026-09-13).
  // 대화(talk)는 승인을 건드리지 않는다 — 대조는 --ask 로만 시킨다. 부르기 전에 막아 codex 를 헛돌리지 않는다.
  const apr = talk ? null : /apr_[0-9a-f]{8}/.exec(question)?.[0];
  const caller = process.env.PPANAM_TEAM ?? null;
  if (apr && caller !== 'hq') {
    emit(team, { actor: 'system', type: 'note', text: `${apr} 대조 요청을 거부했습니다 — 총괄실 세션이 아니면(${caller ?? '환경 없는 셸'}) 대조를 시킬 수 없습니다.` });
    console.error(`거부: ${apr} 대조는 총괄실 세션(PPANAM_TEAM=hq)만 시킬 수 있습니다.`);
    return 1;
  }

  const slot = slotOf(team);
  // 이어붙일 세션은 **같은 엔진 것**만 — 대표가 codex → gemini 로 바꾼 자리에 codex 세션 id 가 남아 있으면 그걸 gemini resume 으로 넘기고 인격까지 빼 버린다.
  const prior = slot?.engine === KIND ? (slot?.id ?? null) : null;
  const name = readCast(team).agents?.outside?.name ?? '외부감사';
  // 지금 라운드를 잡아둔다. 생각하는 5분 사이 라운드가 바뀌면 답은 이 번호로 남고 판정으로 세지 않는다.
  const round = readState(team).round;
  // HEAD 도 지금 잡아둔다 — 카드에 찍히는 sha 는 그가 **본** 커밋이어야 한다(결정 63). 답이 돌아온 뒤의 HEAD 를 찍으면
  // 감사 도중 들어온 커밋이 안 본 채로 PASS 로 찍혀 푸시 문이 열린다 (레오 REVISE, R22).
  const sha = headSha();

  // 인격은 턴마다. 대화는 첫 턴에 지금까지 전부, 이어지는 턴에는 지난번 이후 새로 온 말만 —
  // 자기 세션이 앞의 대화는 이미 기억하고 있으니, 못 들은 부분만 채워주면 된다. 인격은 다르다: 세션이 라운드를
  // 넘기며 길어지면 압축되고, 첫 턴에 한 번 준 인격이 제일 먼저 밀려난다. 그래서 클로드 자리처럼 매 턴 앞에 둔다.
  const ctx = contextOf(team, { since: prior ? slot.lastSeen : null, fromRound });
  // 이 턴이 들은 마지막 말. 커서를 여기 둔다 — 자기 발언 id 로 두면 생각하는 동안(최대 5분)
  // 도착한 말이 since 밖으로 떨어져 영영 못 듣는다 (Fable 감사, 2026-09-02).
  const seenId = lastEventId(team);
  // 인격은 codex 는 턴마다(세션이 압축되며 인격이 먼저 밀려난다 — M1 인격 이음), gemini 는 **대화마다 한 번** — 이어가는 호출(resume)이면
  // 인격·확정조항·일지를 빼고 새 말만 보낸다(대표 지적 09-14 — 매번 똑같은 2,900자). 하네스 창의 대화가 곧 세션이라 앞을 기억한다.
  const persona = KIND === 'gemini' && prior ? null : personaOf(team);
  const input = [
    persona,
    persona ? '\n---\n' : null,
    ctx ? `그동안 이 방에서 오간 말:\n\n${ctx}\n\n---\n` : null,
    turn === 'verdict'
      ? VERDICT_TURN(text || question)
      : turn === 'journal'
        ? JOURNAL_TURN(round)
        : turn
          ? TURN[turn] ?? TURN.called
          : lull
        ? TURN.lull
        : talk
          ? `방에서 누가 너에게 한 말이다. 판정이 아니라 대화로 답해라 — 첫 줄에 PASS·REVISE·FAIL 을 쓰지 마라. 상대 이름으로 시작해 네 말투로 한두 문장, 사람에게 말하듯. 모르면 모른다고, 돌려봐야 알면 돌려보겠다고 해라.\n\n${question}`
          : question,
  ].filter(Boolean).join('\n');

  // --dry: codex 를 부르지 않고 이 턴이 받을 입력만 보여준다. 기록도 커서 이동도 없다 — 인격이 매 턴 실리는지 눈으로 확인하는 용도.
  if (dry) {
    console.log(input);
    console.error(`[dry] ${team} · ${prior ? `이어지는 턴 (세션 ${String(prior).slice(0, 8)})` : '첫 턴'} · 입력 ${input.length}자`);
    return 0;
  }

  let res;
  // 도는 동안 표시 — 관제탑이 이 자리를 "일하는 중" 으로 그린다(CLI 호출은 사회자의 outsideBusy 에 안 잡혀 "쉼" 으로 떴다, 09-13 13:48).
  markOutsideRunning(team, ACTOR);
  const clear = () => clearOutsideRunning(team, ACTOR);
  process.once('exit', clear);
  try {
    res = KIND === 'gemini'
      ? await runGemini(input, { resume: prior, model: geminiModelFor(team), team })
      : await runCodex(input, { resume: prior, model: codexModelFor(team), effort: effortFor(team) });
  } catch (e) {
    clear();
    // 계정 한도면 쿨다운을 적어 두고 그 뒤 호출은 위에서 조용히 건너뛴다. 세션은 버리지 않는다 — 한도 때문이지 세션이 썩은 게 아니다. (codex 만 — gemini 는 계정이 다르다)
    const limit = KIND === 'gpt' ? parseUsageLimit(e.message) : null;
    if (limit) {
      setOutsideCooldown({ ...limit, noted: [team] });
      emit(team, { actor: ACTOR, type: 'note', text: `외부 모델을 부르지 못했습니다 — 계정 사용 한도. ${limit.reason.slice(0, 160)}` });
      console.error('실패(한도): ' + limit.until + ' 까지');
      return 1;
    }
    // 이어붙이기가 깨졌으면 세션을 버리고 다음에 새로 연다. (codex 만 — gemini 의 sessionId 는 하네스 창의 대화라 답이 늦은 것뿐이다)
    if (prior && KIND === 'gpt') forget(team);
    emit(team, {
      actor: ACTOR, type: 'note',
      text: `외부 모델을 부르지 못했습니다 — ${String(e.message).split('\n')[0].slice(0, 200)}`,
    });
    console.error('실패: ' + e.message);
    return 1;
  }
  clear();

  if (!prior) emit(team, { round, actor: 'system', type: 'enter', text: `${name} 님이 들어왔습니다` });

  let { verdict, body } = splitVerdict(res.answer || '(빈 답)');
  // 대화에서는 판정이 없다. 습관처럼 첫 줄에 PASS 를 썼어도 떼고 본문만 남긴다.
  if (talk) verdict = null;

  // 일지는 대화록에 남지 않는다. 자기 일지 파일에 붙인다 — 이 프로세스가 곧 그다.
  if (turn === 'journal') {
    if (res.sessionId) remember(team, res.sessionId, seenId, KIND);
    const ok = appendJournal(team, ACTOR, body, { round });
    console.log(`[${ENGINE}] ${team} · 일지 ${ok ? '한 문단' : '(패스)'}`);
    // (패스)·빈 답은 "일지 없음" 이다 — 0 으로 나가면 journalAll(server/session.mjs) 이 성공으로 세어
    // note·재시도가 안 돈다(레오 REVISE, R19). 1 은 codex 호출 실패, 2 는 사용법 오류라 3 을 쓴다.
    return ok ? 0 : 3;
  }

  // 승인 대조였으면 그 판정을 외부감사 이름으로 큐에 남긴다 (시키는 쪽은 위에서 이미 걸렀다 — 총괄실 세션뿐).
  // codex 샌드박스는 파일을 못 쓰므로 그녀 대신 이 프로세스가 쓴다 — 이 프로세스가 곧 그녀다.
  if (apr && verdict && verdict !== 'FAIL') {
    try { decideApproval(apr, { by: ACTOR, decision: verdict, reason: body.split('\n')[0].slice(0, 200), team }); }
    catch (e) { emit(team, { actor: 'system', type: 'note', text: `${name} 의 승인 판정을 못 남겼습니다 — ${e.message}` }); }
  }

  // 대화에서 할 말이 없으면 (패스). 기록하지도 들려주지도 않는다 — 클로드 세션과 같은 약속.
  // 커서만 앞으로 옮겨 다음 차례에 같은 말을 또 듣지 않게 한다.
  if (talk && /^(?:[^\s,，、:·]{1,12}\s*[,，、:·]\s*)?\(?\s*패스\s*\)?[.。]?$/.test(body.trim())) {
    if (res.sessionId) remember(team, res.sessionId, seenId, KIND);
    console.log(`[${ENGINE}] ${team} · (패스)`);
    return 0;
  }

  let rec;
  if (verdict && !apr) {
    try {
      rec = recordVerdict(team, { actor: ACTOR, verdict, text: body, target: 'guide', round, sha });
    } catch (e) {
      // 방이 막혀 있다(FAIL 뒤 대표 판단 대기). 판정으로 세지 않고 말로만 남긴다.
      rec = emit(team, { round, actor: ACTOR, type: 'message', text: `[${verdict} — 판정으로 세지 않음: ${e.message}] ${body}`, meta: { engine: ENGINE } });
    }
  } else {
    // 판정 차례였는데 첫 줄에 판정이 없다 — 말로 남기되 표시한다. 사회자가 한 번 더 묻고, 두 번이면 멈춘다 (레오 감사).
    // --ask 도 판정 경로다(첫 줄 규약). 의견을 물은 것이면 표시가 붙어도 사회자는 기다리는 자리가 아니라 무시한다.
    const missed = !talk && !apr && !verdict;
    rec = emit(team, { round, actor: ACTOR, type: 'message', text: (apr && verdict ? `[${verdict}] ` : '') + body, meta: { engine: ENGINE, ...(apr ? { approval: apr } : {}), ...(missed ? { noVerdict: true } : {}) } });
  }

  // 방금 남긴 것까지가 "이미 본 것"이다. 다음 턴에는 이 뒤로 새로 온 말만 받는다.
  if (res.sessionId) remember(team, res.sessionId, seenId, KIND);

  console.log(`[${ENGINE}] ${team} · ${rec.type}${verdict ? ' ' + rec.meta.verdict : ''}`);
  console.log(body);
  return 0;
}

/* ── 한 번만 묻기 (기록 안 함) ── */

async function viaCodexOnce(prompt) {
  if (!await hasCodex()) return null;
  const { answer } = await runCodex(`${DEFAULT_PERSONA}\n\n---\n\n${prompt}`);
  return answer || null;
}

async function viaOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: API_MODEL,
      messages: [{ role: 'system', content: DEFAULT_PERSONA }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status} ${(await res.text()).slice(0, 180)}`);
  return (await res.json()).choices?.[0]?.message?.content?.trim() ?? null;
}

/* ── 상태 ── */

async function status() {
  const codex = await hasCodex();
  const lines = [];
  if (codex) {
    let v = '';
    try { v = (await run('codex', ['--version'], { timeout: 15_000 })).stdout.trim(); } catch { /* 무시 */ }
    lines.push(`codex CLI 있음${v ? ` (${v})` : ''} · 모델 ${team ? codexModelFor(team) : codexModelOf(null)}${team && effortFor(team) ? ` · 강도 ${effortFor(team)}` : ''}` +
      (process.env.CODEX_API_KEY ? ' · CODEX_API_KEY 설정됨' : ' · 저장된 로그인 사용'));
    const open = Object.keys(readStore());
    lines.push(open.length
      ? `열린 세션: ${open.map((t) => `${t}(${String(slotOf(t)?.id ?? '').slice(0, 8)})`).join(', ')}`
      : '열린 세션 없음');
  }
  const cd = outsideCooldown();
  if (cd) lines.push(`codex 계정 사용 한도 — ${cd.until} 까지 부르지 않음`);
  if (team && engineKindOf(team) === 'gemini') {
    let waiting = 0; try { waiting = fs.readdirSync(path.join(GEMINI_DIR, 'ask')).filter((f) => f.endsWith('.json')).length; } catch { /* 폴더 없음 */ }
    lines.push(`gemini 자리(${team}/${ACTOR}) · 모델 ${geminiModelFor(team)} · 파일로 주고받음(state/gemini/) · 기다리는 물음 ${waiting}`);
  }
  if (process.env.OPENAI_API_KEY) lines.push(`OpenAI API 있음 (모델 ${API_MODEL}) — 한 번 묻기 전용`);
  return { ok: codex || !!process.env.OPENAI_API_KEY || (!!team && engineKindOf(team) === 'gemini'), lines };
}

const SETUP = `외부감사를 연결하는 법.

 1) codex CLI  (권장. 저장소를 직접 읽고, 세션을 유지한다)

      npm install -g @openai/codex
      codex login                     # 또는 export CODEX_API_KEY=...
      codex exec --skip-git-repo-check "안녕"      # 되는지 확인

 2) OpenAI API — export OPENAI_API_KEY=sk-...
    간단하지만 저장소를 못 읽고 세션도 없다. --check 에만 쓰인다.

확인:  node bus/outside.mjs --status
시험:  node bus/outside.mjs --check "2 더하기 2는 5인가?"

붙이지 않으면 감사역이 전부 같은 회사 모델이 되어,
함께 틀리는 지점을 아무도 보지 못한다.`;

/* ── 실행 ── */

const argv = process.argv.slice(2);
let team = process.env.PPANAM_TEAM ?? null;
let question = null, mode = null, turnKind = null, turnText = null, dry = false, fromRound = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') team = argv[++i];
  else if (a === '--dry') dry = true;
  else if (a === '--debug') { /* 위에서 읽었다 */ }
  else if (a === '--ask' || a === '-a') { mode = 'ask'; question = argv[++i]; }
  else if (a === '--talk') { mode = 'talk'; question = argv[++i]; }
  else if (a === '--lull') { mode = 'lull'; question = '(조용한 틈)'; }
  else if (a === '--turn') { mode = 'turn'; turnKind = argv[++i]; question = `(차례: ${turnKind})`; }
  else if (a === '--text') turnText = argv[++i];
  else if (a === '--from-round') fromRound = Number(argv[++i]) || null;   // 넘어온 차례(carried) — 닫힌 라운드의 못 들은 말부터 (결정 25)
  else if (a === '--actor') ACTOR = String(argv[++i] ?? 'outside');        // 어느 자리로 말하나 (결정 69 ① — codex 로 바뀐 자리)
  else if (a === '--check' || a === '-c') { mode = 'check'; question = argv[++i]; }
  else if (a === '--reset') mode = 'reset';
  else if (a === '--status') mode = 'status';
  else if (a === '--setup' || a === '-h' || a === '--help') mode = 'setup';
  else if (!question && !a.startsWith('-')) question = a;
}

// --team 을 줬는데 없는 방이면 멈춘다. 기본 방(hq)으로 조용히 흘리면 오타 하나가 총괄실 외부감사(제리)의 세션 id 를 덮고
// 제리 일지에 남의 문단을 쓴다 — 2026-09-13 17:24 실제로 그랬다(round.mjs check 가 `--team _check` 로 부름, 테라).
if (team && !teamExists(team)) { console.error(`오류: 방 '${team}' 이 없습니다 (teams.json). 기본 방으로 넘기지 않습니다.`); process.exit(2); }
if (!team) team = defaultTeam();
// 자리가 다른 회사 엔진 자리(codex·gemini)여야 한다 — claude 자리(또는 없는 자리)로 띄우면 그 자리 이름으로 남의 말이 남는다. 상태·설정·한 번 묻기는 자리와 무관.
if (!['setup', 'status', 'check'].includes(mode) && !isForeign(readCast(team).agents?.[ACTOR]?.model)) {
  console.error(`오류: '${team}' 의 '${ACTOR}' 자리는 codex 자리가 아닙니다 (cast.json model: ${readCast(team).agents?.[ACTOR]?.model ?? '없음'}).`);
  process.exit(2);
}

if (mode === 'setup') { console.log(SETUP); process.exit(0); }

if (mode === 'status') {
  const s = await status();
  console.log(s.ok ? s.lines.join('\n') : '외부감사 설정 안 됨 — node bus/outside.mjs --setup');
  process.exit(s.ok ? 0 : 1);
}

if (mode === 'reset') {
  console.log(forget(team) ? `[${team}] 외부감사 세션을 버렸습니다.` : `[${team}] 열린 세션이 없습니다.`);
  process.exit(0);
}

if (!question) {
  console.error('사용법: outside.mjs --team <팀> --ask "물어볼 것"        판정 (첫 줄 PASS/REVISE)');
  console.error('        outside.mjs --team <팀> --talk "방에서 한 말"     대화 (판정 없음)');
  console.error('        outside.mjs --team <팀> --turn <called|lull|lunch|third|carried> [--from-round N]   사회자가 주는 차례 (판정 없음)');
  console.error('        outside.mjs --team <팀> --turn verdict --text "<대상>"       판정 차례 (첫 줄 PASS/REVISE)');
  console.error('        outside.mjs --team <팀> --turn journal                    일지 한 문단 (대화록에 안 남음)');
  console.error('        … --actor <자리>                                        외부감사가 아닌 codex 자리로 (결정 69 ① — 기본 outside)');
  console.error('        … --dry                                              codex 를 안 부르고 이 턴이 받을 입력만 출력 (기록 없음)');
  console.error('        outside.mjs --check "한 번만 물어볼 것"');
  console.error('        outside.mjs --setup');
  process.exit(2);
}

if (mode === 'check') {
  const errors = [];
  for (const [name, fn] of [['codex', viaCodexOnce], ['openai', viaOpenAI]]) {
    try {
      const r = await fn(question);
      if (r) {
        console.log(`[${name === 'codex' ? `codex · ${codexModelOf(null)}` : `openai · ${API_MODEL}`}] ${r}`);
        process.exit(0);
      }
    } catch (e) { errors.push(`${name}: ${String(e.message).split('\n')[0].slice(0, 200)}`); }
  }
  console.log('외부감사 설정 안 됨 — 교차검증 없이 진행한다는 사실을 작전실에 남기세요.');
  if (errors.length) console.log('\n시도한 것:\n  ' + errors.join('\n  '));
  console.log('\n' + SETUP);
  process.exit(1);
}

const chat = mode === 'talk' || mode === 'lull' || (mode === 'turn' && turnKind !== 'verdict' && turnKind !== 'journal');
process.exit(await ask(team, question, { talk: chat, lull: mode === 'lull', turn: mode === 'turn' ? turnKind : null, text: turnText, dry, fromRound }));
