// 승인 실행자 — 통과한 B 를 실제 행동으로 옮기는 유일한 자리.
//
// 승인 체인은 "누가 무엇을 허락하나"까지만 정한다. 통과가 나도 원격 푸시는
// 아무 claude 세션도 못 한다 — git push 는 허용 목록에 일부러 없다. 실무가
// 스스로 밀 수 있으면 톰·제리를 우회하는 길이 생기기 때문이다.
//
// 그래서 미는 것은 서버다. 서버는 claude 세션이 아니라 신뢰된 node 프로세스라
// 허용 목록에 매이지 않는다. 통과가 확정된 뒤에만, 서버가 대신 민다.
// 이것이 "대표가 없어도 팀이 달린다"의 마지막 한 칸이다.
//
// 미는 조건은 둘 다 참일 때만이다.
//   1. 등급 B 이고 상태가 passed — 총괄실(hq) 자체 카드는 톰·제리 둘 다 PASS, 팀 카드(dev 등)는 톰 혼자
//      (대표 09-16 16:4x "제리는 총괄실만", 결정 183·185 — needsOf 가 정하고 여기는 status 만 본다)
//   2. 요청에 action:{type:'push', branch, sha} 가 박혀 있다 (--push 로 요청했을 때)
// 다음 마일스톤 착수·다른 팀에 넘기기 같은 다른 B 는 통과 자체가 곧 진행 신호라
// 서버가 할 일이 없다. 실행자는 오직 푸시만 대신한다.
//
// 자유 텍스트를 정규식으로 훑어 "푸시인가"를 짐작하던 첫 판은 레오가 FAIL 냈다
// (2026-09-02): detail 의 push 도 걸리고 "푸시하지 마라" 같은 부정문도 걸렸다.
// 이제는 요청에 박힌 action 만 믿고, 그때의 SHA 가 지금도 HEAD 인지 대조한 뒤에 민다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { listApprovals, emit, protectedBranch, pushGateError, readLog, listTeams } from '../bus/bus.mjs';
import * as session from './session.mjs';
import * as gemini from './gemini.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(REPO, 'state', 'executor.json');

/** 감독(tools/serve.mjs)이 보는 신호 — 이 코드로 끝나면 재시작, 아니면 그대로 끝. 감독 없이 맨몸으로 뜬 서버는 그냥 죽는다. */
export const RESTART_EXIT_CODE = 75;

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return { done: {} }; }
}
function writeStore(s) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + '\n');
}

/** 이 통과가 실행할 푸시인가. 요청에 박힌 action 만 본다. 텍스트는 안 본다. */
function isPush(r) {
  return r.grade === 'B' && r.status === 'passed' && r.action?.type === 'push';
}

/** 이 통과가 실행할 재시작인가 (N1 둘째 조각 — 나리 13:2x "서버가 스스로 내려갔다 뜨는 길"). */
function isRestart(r) {
  return r.grade === 'B' && r.status === 'passed' && r.action?.type === 'restart';
}

/** 일하는 세션이 하나라도 있으면 안 내린다 — 관리 창이 손으로 재시작할 때 지키던 "busy 세션 없을 때만" 그대로(순수, round.mjs check 가 돌려본다). */
export function anyBusy(sessionRows, geminiRows) {
  return sessionRows.some((x) => x.busy) || geminiRows.some((x) => x.busy);
}

/**
 * 지금 이 순간 실제로 일하는 세션이 있는가 — 여섯 방의 claude 세션 + gemini 상주 풀.
 * hq:system(나리 서버 자리)은 뺀다(톰 지적 09-16 18:4x — 그 자리는 늘 일해서 27분을 못 내렸다).
 * 그 자리는 로밍 답·대리 판정으로 쉬지 않고 도니, "일하는 세션 없을 때" 기준에 넣으면 재시작이 영영 안 온다 —
 * 도는 차례가 끝나는 대로 켜는 게 맞다(그 자리는 죽었다 뜬 뒤 다음 물음에 다시 잡힌다, 다른 자리와 같다).
 */
function liveAnyBusy() {
  const sessionRows = listTeams().flatMap((t) => Object.entries(session.statusAll(t.id))
    .filter(([actor]) => !(t.id === 'hq' && actor === 'system')).map(([, s]) => s));
  return anyBusy(sessionRows, gemini.status());
}

/** 몇 번 터지면 포기하나. 실패를 done 에 안 남기면 250ms 마다 영원히 다시 시도해 총괄실을 도배한다. */
const MAX_TRIES = 3;

/**
 * action 이 실행해도 되는 모양인가. 큐 파일은 사람도 세션도 쓸 수 있으므로 실행 직전에 다시 본다.
 * 틀리면 이유를 돌려주고, 실행자는 그 요청을 done 에 남기고 지나간다.
 */
function invalidAction(a) {
  if (!a || typeof a !== 'object') return 'action 없음';
  if (typeof a.sha !== 'string' || !/^[0-9a-f]{40}$/.test(a.sha)) return 'sha 가 40자 hex 가 아님';
  if (typeof a.branch !== 'string' || !a.branch || a.branch === 'HEAD') return '브랜치 없음';
  // 이름 규칙은 git 이 안다. 정규식으로 흉내내면 'foo.' 'foo@{bar' 'foo//bar' '/foo' 가 샌다 (레오 감사, 2026-09-12).
  try { execFileSync('git', ['check-ref-format', '--branch', a.branch], { cwd: REPO, stdio: 'ignore' }); }
  catch { return '브랜치 이름이 git 규칙에 맞지 않음'; }
  // 원격 기본 브랜치는 C 등급(메인 병합)이다 — B 요청에 박혀 있어도 안 민다. 어느 브랜치인지 모르면 안전한 쪽으로 — 안 민다.
  const guarded = protectedBranch();
  if (!guarded) return '원격 기본 브랜치를 알 수 없어(refs/remotes/origin/HEAD 없음) 실행자가 밀지 않음 — git remote set-head origin -a';
  if (a.branch === guarded) return `'${a.branch}' 는 원격 기본 브랜치(C 등급, 메인 병합)라 실행자가 밀지 않음`;
  if (a.remote != null && (typeof a.remote !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(a.remote))) return '원격 이름이 이상함';
  return null;
}

/** 지금의 브랜치·HEAD. 승인된 것과 대조하려고 읽는다. */
function head() {
  const g = (a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  return { branch: g(['rev-parse', '--abbrev-ref', 'HEAD']), sha: g(['rev-parse', 'HEAD']) };
}

function gitPush(sha, branch, remote = 'origin') {
  return new Promise((resolve) => {
    // 승인에 박힌 SHA 를 refspec 으로 직접 민다. 브랜치 이름으로 밀면 아래 HEAD 대조를
    // 통과한 뒤 push 가 실행되기 전에 커밋이 들어올 때 그 틈으로 승인 안 된 것이 나간다.
    // 레오가 격리 실행에서 실제로 재현했다 (2026-09-02) — 대조를 통과시킨 뒤 브랜치를
    // 움직이자 새 SHA 가 밀렸다. refspec 이면 대조와 무관하게 그 커밋만 나간다.
    execFile('git', ['push', remote, `${sha}:refs/heads/${branch}`], { cwd: REPO, timeout: 60_000 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
      resolve({ ok: !err, out: out.slice(0, 500), code: err?.code ?? 0 });
    });
  });
}

let busy = false;

/**
 * 폴링 틱마다 불린다. 통과했는데 아직 안 민 푸시가 있으면 하나 민다.
 * 파일이 작아 매 틱 훑어도 싸다. 한 번에 하나씩만 — busy 로 겹침을 막는다.
 */
export async function runExecutor() {
  if (busy) return;
  const store = readStore();

  // 재시작 — 일하는 세션이 하나라도 있으면 이번 틱은 넘긴다(대기 note 는 한 번만, 도배 방지). 조용해지면 내려갔다 뜬다.
  const restartTarget = listApprovals({ status: 'passed' }).find((r) => isRestart(r) && !store.done[r.id]);
  if (restartTarget) {
    if (liveAnyBusy()) {
      store.waiting = store.waiting ?? {};
      if (!store.waiting[restartTarget.id]) {
        store.waiting[restartTarget.id] = true;
        writeStore(store);
        const meta = { approval: restartTarget.id, grade: 'B', executed: 'waiting' };
        emit(restartTarget.team, { actor: 'system', type: 'note', text: `승인 ${restartTarget.id} — 일하는 세션이 있어 아직 안 내립니다. 조용해지면 내려갔다 뜹니다.`, meta });
        if (restartTarget.team !== 'hq') emit('hq', { actor: 'system', type: 'note', text: `${restartTarget.team} 팀 승인 ${restartTarget.id} — 재시작 대기 중`, meta });
      }
      return;
    }
    store.done[restartTarget.id] = { at: new Date().toISOString(), ok: true, out: 'restart' };
    writeStore(store);
    const meta = { approval: restartTarget.id, grade: 'B', executed: 'restarting' };
    emit(restartTarget.team, { actor: 'system', type: 'note', text: `승인 ${restartTarget.id} — 서버를 다시 켭니다.`, meta });
    if (restartTarget.team !== 'hq') emit('hq', { actor: 'system', type: 'note', text: `${restartTarget.team} 팀 승인 ${restartTarget.id} — 서버 재시작`, meta });
    session.stopAll();
    gemini.stopAll();
    process.exit(RESTART_EXIT_CODE);   // 감독(tools/serve.mjs)이 이 코드를 보고 다시 띄운다
  }

  const target = listApprovals({ status: 'passed' }).find((r) => isPush(r) && !store.done[r.id]);
  if (!target) return;

  busy = true;
  try {
    const want = target.action; // {type,remote,branch,sha}

    const bad = invalidAction(want);
    if (bad) {
      store.done[target.id] = { at: new Date().toISOString(), ok: false, out: `invalid: ${bad}` };
      writeStore(store);
      const meta = { approval: target.id, grade: 'B', executed: 'invalid' };
      emit(target.team, { actor: 'system', type: 'note', text: `승인 ${target.id} — 실행할 수 없는 요청입니다 (${bad}). 밀지 않았습니다. 다시 요청하세요.`, meta });
      if (target.team !== 'hq') emit('hq', { actor: 'system', type: 'note', text: `${target.team} 팀 승인 ${target.id} 실행 불가 — ${bad}`, meta });
      return;
    }

    // 푸시 문 (결정 63) — 요청한 라운드에 그 SHA 를 본 외부감사 PASS 카드가 있어야 한다. 요청 때도 봤지만 큐 파일은 손으로도 쓸 수 있어
    // 실행 직전에 다시 본다. 대화록은 append-only 라 카드는 안 사라진다 — 요청 레코드의 round 로 그 라운드를 찾는다.
    const gate = pushGateError(readLog(target.team).filter((e) => e.round === target.round), want.sha);
    if (gate) {
      store.done[target.id] = { at: new Date().toISOString(), ok: false, out: `unreviewed: ${gate}` };
      writeStore(store);
      const meta = { approval: target.id, grade: 'B', executed: 'unreviewed' };
      emit(target.team, { actor: 'system', type: 'note', text: `승인 ${target.id} — 외부감사 문을 못 열어 밀지 않았습니다 (${gate})`, meta });
      if (target.team !== 'hq') emit('hq', { actor: 'system', type: 'note', text: `${target.team} 팀 승인 ${target.id} 외부감사 없음 — 밀지 않음`, meta });
      return;
    }

    const now = head();

    // 승인 이후 커밋이 바뀌었으면 낡은 승인이다. 톰·제리는 그 SHA 를 통과시킨 것이지
    // 지금 HEAD 를 통과시킨 게 아니다. 밀지 않고 되돌려보낸다.
    if (now.branch !== want.branch || now.sha !== want.sha) {
      store.done[target.id] = { at: new Date().toISOString(), ok: false, out: `stale: approved ${want.branch}@${want.sha.slice(0, 8)}, HEAD ${now.branch}@${now.sha.slice(0, 8)}` };
      writeStore(store);
      const meta = { approval: target.id, grade: 'B', executed: 'stale' };
      emit(target.team, { actor: 'system', type: 'note', text: `승인 ${target.id} — 통과 이후 커밋이 바뀌어 밀지 않았습니다 (승인 ${want.sha.slice(0, 8)} ≠ HEAD ${now.sha.slice(0, 8)}). 다시 요청하세요.`, meta });
      if (target.team !== 'hq') emit('hq', { actor: 'system', type: 'note', text: `${target.team} 팀 승인 ${target.id} 낡음 — 밀지 않음`, meta });
      return;
    }

    const res = await gitPush(want.sha, want.branch, want.remote ?? 'origin');
    store.done[target.id] = { at: new Date().toISOString(), ok: res.ok, out: res.out };
    writeStore(store);

    const head_ = res.ok ? '푸시 완료' : '푸시 실패';
    const tail = ` — ${want.remote ?? 'origin'}/${want.branch} @ ${want.sha.slice(0, 8)}` + (res.out ? ` · ${res.out.split('\n').slice(-2).join(' ')}` : '');
    const meta = { approval: target.id, grade: 'B', executed: res.ok ? 'pushed' : 'push-failed' };

    // 요청한 방과 총괄실 둘 다에 남긴다. 실무는 자기 요청의 결말을 보고,
    // 톰은 자기 판정이 실제 행동이 됐는지 본다.
    emit(target.team, { actor: 'system', type: 'note', text: `승인 ${target.id} — ${head_}${tail}`, meta });
    if (target.team !== 'hq') {
      emit('hq', { actor: 'system', type: 'note', text: `${target.team} 팀 승인 ${target.id} ${head_}${tail}`, meta });
    }
  } catch (e) {
    // 실행 자체가 터졌다(git 이 안 뜨거나 index.lock 등). 몇 번은 다시 해보되, 계속 터지면 done 에 남기고 포기한다.
    // 안 그러면 250ms 마다 영원히 다시 시도하며 총괄실에 같은 note 를 쌓는다 (Fable 재점검, 2026-09-12).
    const s = readStore();
    s.tries = s.tries ?? {};
    const n = (s.tries[target.id] ?? 0) + 1;
    s.tries[target.id] = n;
    const why = String(e.message).split('\n')[0].slice(0, 200);
    if (n >= MAX_TRIES) {
      s.done[target.id] = { at: new Date().toISOString(), ok: false, out: `error x${n}: ${why}` };
      delete s.tries[target.id];
    }
    writeStore(s);
    if (n === 1 || n >= MAX_TRIES) {
      const meta = { approval: target.id, grade: 'B', executed: n >= MAX_TRIES ? 'error' : 'retrying' };
      emit('hq', { actor: 'system', type: 'note', text: `승인 ${target.id} 실행 중 오류 (${n}/${MAX_TRIES}) — ${why}${n >= MAX_TRIES ? '. 포기합니다. 원인을 고치고 다시 요청하세요.' : ''}`, meta });
      if (n >= MAX_TRIES && target.team !== 'hq') emit(target.team, { actor: 'system', type: 'note', text: `승인 ${target.id} — 실행 오류로 밀지 못했습니다 (${why}). 다시 요청하세요.`, meta });
    }
  } finally {
    busy = false;
  }
}
