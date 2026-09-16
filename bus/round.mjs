#!/usr/bin/env node
// 라운드 제어.
//
//   node bus/round.mjs start --topic "가드" -m 1      # 주제는 게이트 이름
//   node bus/round.mjs start -m 9 --auditor ops      # 이 회차의 안 걸음 감사 자리(결정 125)
//   node bus/round.mjs auditor ops                   # 열린 회차 중에 정하거나 바꾼다
//   node bus/round.mjs wait "사유" --until 2026-09-17T06:30:00+09:00   # 그때까지 침묵 20분 부름을 건너뜀 (O1)
//   node bus/round.mjs wait --clear                  # 기다림을 미리 거둠
//   node bus/round.mjs status                        # 전체 팀 한눈에
//   node bus/round.mjs end -v PASS --summary "1안 확정"
//   node bus/round.mjs end --next --summary "로드맵 교체" [-m 1 --topic "…"]   # 닫고 그 자리에서 다음 라운드를 연다 (결정 25)
//   node bus/round.mjs log --limit 20
//   node bus/round.mjs verdict "무엇을 판정하나" [--target <자리>]   # 서로 감사(결정 125)면 --target 으로 누구를 보는지 직접 적는다
//   node bus/round.mjs check                         # 닫기 가드 자가 시험 (임시 방에서, 기록 안 남음)
//
// 라운드가 끝나도 대화록은 지워지지 않는다. 비워지는 건 AI 컨텍스트뿐이다.
// --topic · --summary 가 없던 때는 그 단어가 주제·요약 본문에 그대로 박혔다 (R11·R12, 2026-09-12).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  startRound, endRound, readState, readTail, readContext, listRounds, recordVerdict, resumeRound, setAuditor, setRoundWait, clearRoundWait,
  listTeams, defaultTeam, teamExists, teamSummary, MAX_ATTEMPTS, emit, paths, readRoadmap, protectedBranch, pushAction,
  addressees, callsBoss, asksBoss, bossParagraph, bossCallOf, bossNotesOf, doneOf, blockedSpansOf, dayStartSeoul, readLog, listApprovals, voidApproval, approvalPreview, approvalArtifacts, outFile, ROOT, collectJournals, appendJournal, peopleOf, readCast, workStateOf, pushGateError,
  castChangeError, updateCastAgent, castChangeText, codexArgs, quiet as quietText, markOutsideRunning, clearOutsideRunning, outsideRunning,
  mergeProgress, normalizeProgress, progressText, writeProgress, readProgress, progressFresh, proxyEligible, proxyForbidden, delegationActive, overdue, setMilestoneStatus,
  roomRules, allowedIn, plansOf, timeboxRounds, stageTable, swapSection, pausedMs, needsOf, requestApproval,
} from './bus.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const o = { team: null, milestone: null, verdict: null, limit: 20, topic: null, summary: null, next: false, auditor: null, target: null, until: null, clear: false };
const words = [];

for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') o.team = argv[++i];
  else if (a === '--milestone' || a === '-m') o.milestone = Number(argv[++i]);
  else if (a === '--verdict' || a === '-v') o.verdict = String(argv[++i]).toUpperCase();
  else if (a === '--limit' || a === '-n') o.limit = Number(argv[++i]);
  else if (a === '--topic') o.topic = argv[++i];
  else if (a === '--summary') o.summary = argv[++i];
  else if (a === '--next') o.next = true;
  else if (a === '--auditor') o.auditor = argv[++i];   // 이 회차의 안 걸음 감사 자리(결정 125) — start · end --next 에
  else if (a === '--target') o.target = argv[++i];   // verdict 의 판정 대상 자리 — 청하는 쪽이 직접 적는다(테라 code-review 지적 ①), 안 주면 글에서 이름 짐작
  else if (a === '--until') o.until = argv[++i];   // wait 가 언제까지인지(O1) — Date.parse 되는 시각
  else if (a === '--clear') o.clear = true;   // wait 를 미리 거둠
  else words.push(a);
}

const team = o.team ?? process.env.PPANAM_TEAM ?? defaultTeam();
if (cmd !== 'status' && cmd !== 'check' && !teamExists(team)) {
  console.error(`오류: '${team}' 팀이 없습니다.`);
  process.exit(1);
}
// 플래그가 우선이고, 없으면 남은 단어가 주제(start)·요약(end)이다.
const phrase = words.join(' ').trim() || null;

/** 판정 대상 문구가 못 쓸 것이면 그 이유, 쓸 수 있으면 null. 빈 문구·`-` 로 시작하는 낱말(플래그를 잘못 친 것)은 거부. */
function verdictTargetError(target) {
  const s = String(target ?? '').trim();
  if (!s) return '판정 대상을 적으세요 — node bus/round.mjs verdict "무엇을 판정하나".';
  const flag = s.split(/\s+/).find((w) => w.startsWith('-'));
  if (flag) return `판정 대상에 플래그 모양 낱말이 있습니다: ${flag} — 문구를 따옴표로 묶어 다시 치세요.`;
  return null;
}
const topic = o.topic ?? phrase;
const summary = o.summary ?? phrase;

/**
 * 서버에 부탁한다. 라운드를 닫는 정본은 서버다 — 실무가 일하는 중이면 턴이 끝난 뒤 닫고, 그 방의
 * 세션 컨텍스트를 비운다. 세션 안에서 직접 닫으면 그 턴의 마무리 보고가 훅에서 버려지고(phase 가
 * 이미 idle), 세션 id 가 남아 다음 라운드가 지난 컨텍스트를 안고 뜬다 (Fable 재점검, 2026-09-12).
 * 서버가 안 떠 있으면(연결 거부) null — 그때만 직접 닫는다. 응답이 늦는 것은 서버가 없는 게 아니다 —
 * 5초 시간 초과를 "서버 없음" 으로 보고 직접 닫았더니 서버가 뒤늦게 일지를 받고 "라운드 없음" 으로 던져
 * 세션 비우기를 건너뛰었다 (R13, 대표 결정 26). 시간 초과면 기다리라고 하고 멈춘다.
 */
async function viaServer(body, api = '/api/round') {
  const base = process.env.PPANAM_SERVER || 'http://localhost:4321';
  let r;
  try {
    r = await fetch(`${base}${api}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const code = e?.cause?.code ?? e?.code ?? e?.name;
    // ECONNREFUSED 만 "서버 없음" 이다. ECONNRESET 은 붙었다가 끊긴 것 — 서버가 요청을 받고 닫는 중일 수 있어
    // 직접 닫으면 두 번 닫힌다 (레오 감사, 2026-09-13).
    if (code === 'ECONNREFUSED') return null;
    console.error(`오류: 서버가 ${code === 'TimeoutError' ? '15초 안에 답하지 않았습니다' : '응답하지 않습니다 (' + code + ')'}. 직접 닫지 않습니다 — 서버가 살아 있으면 지금 닫는 중일 수 있습니다. 방의 note 를 보세요.`);
    process.exit(1);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('오류: ' + (data.error ?? r.status)); process.exit(1); }
  return data;
}

switch (cmd) {
  case 'start': {
    try {
      const s = startRound(team, { topic, milestone: o.milestone, auditor: o.auditor });
      console.log(`[${team}] 라운드 ${s.round} 시작 · 마일스톤 ${s.milestone}${s.topic ? ' — ' + s.topic : ''}${s.auditor ? ` · 감사 ${s.auditor}` : ''}${s.attempt ? ` · 반박 ${s.attempt}/${MAX_ATTEMPTS} 물려받음` : ''}`);
    } catch (e) {
      console.error('오류: ' + e.message);
      process.exit(1);
    }
    break;
  }
  case 'auditor': {
    // 열린 회차의 감사 자리를 정한다(결정 125) — node bus/round.mjs auditor ops. 방에 note 가 남는다.
    try {
      const n = setAuditor(team, phrase ?? o.auditor);
      console.log(`[${team}] R${n.round} ${n.text}`);
    } catch (e) {
      console.error('오류: ' + e.message);
      process.exit(1);
    }
    break;
  }
  case 'wait': {
    // 열린 회차가 무엇을 언제까지 기다리는지 적는다(O1) — 그때까지 침묵 20분 부름(checkStalls ㉢)을 건너뛴다.
    try {
      const n = o.clear ? clearRoundWait(team) : setRoundWait(team, { why: phrase, until: o.until });
      console.log(`[${team}] R${n.round} ${n.text}`);
    } catch (e) {
      console.error('오류: ' + e.message);
      process.exit(1);
    }
    break;
  }
  case 'end': {
    // 상황판(결정 23)이 이 라운드 동안 갱신되지 않았으면 한 줄 경고 — 거부는 아니다. 닫히면 다음 세션이 이 파일로 자리를 잡는다.
    if (!progressFresh(team)) console.error(`경고: teams/${team}/progress.json 이 이 라운드 동안 갱신되지 않았습니다 — node bus/progress.mjs --team ${team} --doing "…" --next "…" 로 먼저 쓰세요.`);
    // --next: 닫은 그 자리에서 다음 라운드를 연다 (결정 25). 주제는 --topic 만 — 남은 단어는 이 라운드의 요약이다.
    const next = o.next ? { milestone: o.milestone, topic: o.topic, auditor: o.auditor } : null;
    const r = await viaServer({ team, action: 'end', verdict: o.verdict, summary, next });
    if (r) {
      const then = r.next ? ' 닫히면 그 자리에서 다음 라운드가 열립니다(--next).' : '';
      if (r.deferred) {
        console.log(`[${team}] 실무 턴이 끝나면 라운드 ${r.round} 이 닫힙니다. 세션 컨텍스트도 그때 비워집니다.${then}`);
      } else if (r.accepted) {
        console.log(`[${team}] 서버가 라운드 ${r.round} 을 닫는 중 — 자리마다 일지 한 문단을 받은 뒤 닫히고 세션 컨텍스트를 비웁니다. 끝나면 방에 note 가 남습니다.${then}`);
      } else {
        console.log(`[${team}] 라운드 ${r.round} 종료${o.verdict ? ' · ' + o.verdict : ''}`);
        console.log('대화록은 그대로 남습니다. 다음 라운드부터 AI 컨텍스트만 새로 시작합니다.');
      }
      break;
    }
    // 서버가 없다. 직접 닫는다 — 세션 컨텍스트는 다음에 서버가 뜰 때 정리된다.
    try {
      const n = endRound(team, { verdict: o.verdict, summary, next });
      console.log(`[${team}] 라운드 ${n} 종료${o.verdict ? ' · ' + o.verdict : ''} (서버 없이 직접 닫음)`);
      console.log('대화록은 그대로 남습니다. 다음 라운드부터 AI 컨텍스트만 새로 시작합니다.');
      if (next) {
        const s = startRound(team, next);
        console.log(`[${team}] 라운드 ${s.round} 시작 · 마일스톤 ${s.milestone}${s.topic ? ' — ' + s.topic : ''} (--next)`);
      }
    } catch (e) {
      console.error('오류: ' + e.message);
      process.exit(1);
    }
    break;
  }
  case 'verdict': {
    // 판정은 사회자가 돌린다 — 내부감사 → 외부감사 순서로 차례를 주고, 첫 줄 PASS/REVISE 를 카드로 남긴다.
    // 판정 대상은 손으로 쓴 글자가 그대로 계약이 된다 — `--help` 가 대상으로 들어가 레오가 그걸로 REVISE 를 줬다 (R20). 빈 문구·플래그 모양은 거부.
    const bad = verdictTargetError(phrase);
    if (bad) { console.error(`오류: ${bad}`); process.exit(2); }
    // --target — 누가 평가받는지 직접 적는다(테라 code-review 지적 ①). 안 주면 서버가 문구에서 이름을 짐작한다 —
    // "테라 화면 + 솔라 서버" 처럼 둘을 한 번에 청할 땐 짐작이 하나로 뭉개지니, 서로 감사(결정 125)에선 꼭 쓴다.
    if (o.target) {
      const cast = readCast(team).agents ?? {};
      if (o.target === 'boss' || o.target === 'system' || !cast[o.target]) {
        console.error(`오류: --target ${o.target} 은 이 방의 자리가 아닙니다 (${Object.keys(cast).filter((k) => k !== 'boss' && k !== 'system').join(' · ')}).`);
        process.exit(2);
      }
    }
    // requester(청한 자리) — --target 이 없으면 서버가 이걸 기본 대상으로 쓴다(나리 15:3x, 헨리가
    // 청했는데 글 속 다른 이름을 잡아 엉뚱하게 찍히던 것). 세션 환경의 PPANAM_ACTOR — 셸에서 맨 명령으로
    // 치면 없어 예전처럼 이름 찾기로 떨어진다.
    const r = await viaServer({ team, target: phrase, targetSeat: o.target, requester: process.env.PPANAM_ACTOR ?? null }, '/api/verdict');
    if (!r) { console.error('오류: 판정 흐름은 서버가 돌립니다. 서버(npm start)가 떠 있어야 합니다.'); process.exit(1); }
    console.log(`[${team}] 판정 시작 — ${r.flow.target}. 결과는 판정 카드로 방에 남고 너에게 들립니다. 기다리는 동안 (패스).`);
    break;
  }
  case 'rounds': {
    const rs = listRounds(team);
    if (!rs.length) { console.log(`[${team}] 끝난 라운드가 없습니다.`); break; }
    for (const r of rs) {
      console.log(`R${String(r.round).padStart(3, '0')}  M${r.milestone ?? '-'}  ${(r.verdict ?? '—').padEnd(6)} ${String(r.eventCount ?? 0).padStart(3)}건  ${r.topic ?? ''}`);
    }
    break;
  }
  case 'log': {
    const { events, total, more } = readTail(team, { limit: o.limit });
    for (const e of events) {
      const t = new Date(e.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      console.log(`${t}  R${e.round}  ${e.actor.padEnd(8)} ${e.type.padEnd(11)} ${e.text.slice(0, 60)}`);
    }
    console.log(`\n대화록 총 ${total}건${more ? ' (더 있음)' : ''}`);
    break;
  }
  case 'context': {
    const events = readContext(team);
    console.log(`[${team}] 현재 라운드 컨텍스트 ${events.length}건 — AI 가 읽는 범위입니다.`);
    for (const e of events) console.log(`  ${e.actor.padEnd(8)} ${e.type.padEnd(11)} ${e.text.slice(0, 56)}`);
    break;
  }
  case 'nightly': {
    // 자정 마감 미리보기 (M7) — 파일·note·톰 호출 없이 그 날의 장 여섯을 찍는다. 쓰는 건 서버 틱(server/nightly.mjs runNightly)뿐.
    //   node bus/round.mjs nightly [--day 2026-09-15]
    const { buildNightly, yesterdayKey } = await import('../server/nightly.mjs');
    const di = argv.indexOf('--day');
    const day = di >= 0 ? argv[di + 1] : yesterdayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) { console.error(`날짜가 아닙니다: ${day}`); process.exit(2); }
    const out = buildNightly(day);
    for (const t of out.teams) { console.log(`===== ${t.file} =====`); console.log(t.md); }
    console.log(`===== teams/hq/out/nightly/${day}.md =====`);
    console.log(out.hq.md);
    console.error(`[미리보기] ${day} · 팀 ${out.teams.length} · 문제 ${out.hq.problems.length}건 · 파일 안 씀`);
    break;
  }
  case 'check': {
    // 닫기 가드 자가 시험. 실제 방을 건드리지 않으려고 임시 방 `_check` 에서 돌리고 지운다.
    // 대표가 정한 통과 시험 넷 (2026-09-13): 카드 없이 PASS → 거부 · REVISE 뒤 PASS → 거부 · 정식 흐름 → 성공 + 로드맵 pass ·
    // 원격 기본 브랜치의 푸시 요청 → 거부. 덧붙여 blocked 는 못 닫음 · 반박 횟수 상속 · 닫힌 방의 판정은 stale.
    const T = '_check';
    const dir = paths(T).dir;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // 승인 큐도 임시 방 안에 — 자가 시험의 요청·무효 줄이 state/approvals.jsonl 에 안 쌓인다(bus.approvalsPath, 나리 점검-0916 3-4). 방을 지울 때 같이 사라진다.
    const realQueueSize = () => { try { return fs.statSync(path.join(ROOT, 'state', 'approvals.jsonl')).size; } catch { return 0; } };
    const realQ0 = realQueueSize();
    process.env.PPANAM_APPROVALS_PATH = path.join(dir, 'approvals.jsonl');
    fs.writeFileSync(paths(T).roadmap, JSON.stringify({ milestones: [{ n: 1, title: '시험', status: 'now' }, { n: 2, title: '둘', status: 'wait' }] }));
    const refuses = (fn, want) => { try { fn(); return '✗ 통과됨 (거부돼야 함)'; } catch (e) { return e.message.includes(want) ? '✓ 거부' : `✗ 다른 이유로 거부: ${e.message}`; } };
    // PASS 카드는 떨어뜨릴 이유 셋과 반박이 있어야 PASS 로 남는다(점검-0916 3-9 ⑦, bus.passShapeError) — 아래 PASS 들은 이 모양으로 낸다.
    const shaped = (t) => `${t}\n떨어뜨릴 이유 1: 산출물이 빈가 — 반박: 열어 보니 내용 있음\n떨어뜨릴 이유 2: 조건과 다른가 — 반박: 조건 그대로\n떨어뜨릴 이유 3: 폰에서 깨지나 — 반박: 412 확인`;
    // 산출물 하나(8단계 조건 5) — 파일을 쓰고 훅이 남기는 모양의 도구 줄(절대 경로)을 남긴다. PASS 로 닫는 자리마다 이게 있어야 한다.
    const artifact = (name = '물건.md', body = '내용 한 줄\n') => {
      const abs = path.join(dir, 'out', name);
      fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body);
      emit(T, { actor: 'ops', type: 'tool', text: abs, meta: { tool: 'Write' } });   // guide 가 아니다 — 아래 생존 알림 시험이 guide 의 마지막 도구 줄을 본다
      return abs;
    };
    const out = [];
    try {
      startRound(T, { topic: '가드', milestone: 1 });
      out.push(['카드 없이 end -v PASS', refuses(() => endRound(T, { verdict: 'PASS' }), '판정 카드가 있어야')]);
      recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '근거 없음' });
      out.push(['REVISE 뒤 end -v PASS', refuses(() => endRound(T, { verdict: 'PASS' }), '마지막 판정이 REVISE')]);
      // 정형문 PASS 는 서버가 REVISE 로 되돌린다(점검 3-9 ⑦) — 카드는 REVISE·meta.shape·said:PASS, 반박으로 안 세고(counted 없음) 횟수도 그대로, 방에 note 한 줄.
      {
        const a0 = readState(T).attempt || 0;
        const boiler = recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: '빠진 것 0건 · 더해진 것 0건 · 잘못 간 것 0건 · 뒤집힌 것 0건. 통과입니다.' });
        const noted = readLog(T).some((e) => e.type === 'note' && e.meta?.verdictShape && e.text.includes('REVISE 로 되돌립니다'));
        const bWant = boiler.meta.verdict === 'REVISE' && /정형문/.test(boiler.meta.shape ?? '') && boiler.meta.said === 'PASS' && boiler.meta.counted === undefined && (readState(T).attempt || 0) === a0 && noted
          && refuses(() => endRound(T, { verdict: 'PASS' }), '마지막 판정이 REVISE') === '✓ 거부';
        out.push(['정형문 PASS → REVISE 되돌림(점검 3-9)', bWant ? '✓ REVISE 카드 · shape · said PASS · 반박 안 셈 · note · 그걸로 못 닫음' : '✗ ' + JSON.stringify({ meta: boiler.meta, a0, a1: readState(T).attempt, noted })]);
      }
      recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('됐다') });
      out.push(['PASS 카드만, 완료 note 없이', refuses(() => endRound(T, { verdict: 'PASS' }), '완료 note 가 없습니다')]);
      emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass' } });
      // 부분 성공은 통과가 아니다(8단계) — 카드·note 는 다 맞는데 물건이 없다 → 거부, 0바이트 → 거부, 판정 대상 글의 경로가 없는 파일 → 거부, 채우면 닫힌다.
      {
        const { artifactPathsIn, artifactsOf } = await import('./bus.mjs');
        const pp = artifactPathsIn('산출물 out/m8-failures.md · teams/hq/out/화면이-답하는-질문.md(맨 밑) · 그림 out/shots/r28-412.png. out/ 폴더와 out/kit/co… 는 안 셈 · HEAD 9b89715');
        const ppWant = pp.join('|') === 'out/m8-failures.md|teams/hq/out/화면이-답하는-질문.md|out/shots/r28-412.png';
        const none = refuses(() => endRound(T, { verdict: 'PASS' }), '산출물이 없습니다');
        const empty = artifact('빈것.md', '');
        const zero = refuses(() => endRound(T, { verdict: 'PASS' }), '0바이트');
        fs.writeFileSync(empty, '이제 채움\n');
        emit(T, { actor: 'system', type: 'note', text: '판정 시작 — out/없는것.md', meta: { verdictFlow: 'start', steps: ['outside'], target: 'out/없는것.md 를 봐라' } });
        const missing = refuses(() => endRound(T, { verdict: 'PASS' }), '없는것.md(없음)');
        fs.writeFileSync(path.join(dir, 'out', '없는것.md'), '있다\n');
        // 작업 사본(`_` 로 시작)은 산출물이 아니다 — 썼다 지워도 '없음' 으로 안 센다(R29: 지운 _build-roadmap-proposal.mjs 가 닫기를 막았다). 판정 대상 글에 적으면 그건 물건
        fs.rmSync(artifact('_사본.mjs', 'x\n'));
        const seen = artifactsOf(T, readLog(T).filter((e) => e.round === readState(T).round)).paths;
        const seenWant = seen.length === 2 && seen.every((a) => a.bytes > 0) && ['out/빈것.md', 'out/없는것.md'].every((p) => seen.some((a) => a.path === p)) && !seen.some((a) => a.path.includes('_사본'));
        out.push(['부분 성공은 통과 아님(8단계)', ppWant && none === '✓ 거부' && zero === '✓ 거부' && missing === '✓ 거부' && seenWant ? '✓ 경로 뽑기 셋(확장자 없는 것 제외) · 물건 없음 거부 · 0바이트 거부 · 판정 대상의 없는 경로 거부 · 채우면 둘 다 크기 있음 · _작업 사본은 안 셈' : '✗ ' + JSON.stringify({ pp, none, zero, missing, seen })]);
      }
      let ok = false; try { endRound(T, { verdict: 'PASS' }); ok = true; } catch (e) { out.push(['정식 흐름', `✗ ${e.message}`]); }
      if (ok) {
        const row = listRounds(T).find((x) => x.round === 1);
        const ms = readLog(T).find((e) => e.type === 'milestone' && e.round === 1);
        const artWant = row?.artifacts?.length === 2 && ms?.meta?.artifacts?.length === 2 && row.artifacts.every((a) => a.bytes > 0);
        // 긴급 수정(나리 위임, 09-16 — 마케팅·디자인이 B 승인을 기다리며 방째 죽었다): PASS 로 마일스톤이 닫히면
        // 서버가 다음 마일스톤 회차를 바로 연다 — 더는 idle 로 안 남는다. milestones[1](n:2)도 이제 now.
        const st = readState(T);
        out.push(['정식 흐름 → 닫힘 + 로드맵 pass + 다음 회차 바로 엶', readRoadmap(T).milestones[0].status === 'pass' && readRoadmap(T).milestones[1].status === 'now'
          && st.phase === 'running' && st.milestone === 2 && st.round === 2 && artWant ? '✓ + 행·milestone 이벤트에 artifacts 둘 · 안 죽고 R2 로 바로 이어짐' : '✗ ' + JSON.stringify({ ms0: readRoadmap(T).milestones[0].status, ms1: readRoadmap(T).milestones[1].status, st, row: row?.artifacts, ms: ms?.meta?.artifacts })]);
      }
      // 닫힌 고리(대표 실측 09-14) — PASS 로 닫히며 다음 마일스톤이 있으면 서버가 "다음 마일스톤 착수" B 요청을 올린다(autoOpen).
      // 이제 서버가 그 마일스톤을 이미 바로 열었지만(위), 이 기록은 감사 흔적으로 그대로 남는다 — 나중에 결정돼도
      // notifier.applyAction 이 "이미 now·이미 열림" 을 보고 조용히 넘어간다. 진짜 큐에 안 남게 바로 무효 처리.
      {
        const auto = listApprovals({ team: T, status: 'pending' }).filter((r) => r.action?.type === 'milestone');
        const a0 = auto[0];
        const aWant = auto.length === 1 && a0.grade === 'B' && a0.action.n === 2 && a0.action.autoOpen === true && a0.what.includes('착수') && a0.by === 'guide'
          && readLog(T).some((e) => e.type === 'note' && e.meta?.approval === a0.id);
        out.push(['PASS 닫힘 → 다음 착수 B 자동 요청(기록만, 이미 열림)', aWant ? `✓ ${a0.id} · 마일스톤 2 · autoOpen · 방에 note` : '✗ ' + JSON.stringify(auto.map((r) => [r.id, r.action]))]);
        for (const r of auto) voidApproval(r.id, '자가 시험');
      }
      // "닫힌 방의 판정 → stale" 을 보려면 진짜 idle 이 있어야 한다 — 이제 PASS 닫힘이 바로 다음 회차를 열어서,
      // 마일스톤 2 를 잠깐 pass 로 둬(자동 이어열기 ㉠도 stillOpen=false 로 안 걸리게) 닫고, 시험 뒤 다시 now 로 돌려 이어간다.
      setMilestoneStatus(T, 2, 'pass');
      endRound(T, { summary: '스테일 시험용 닫음' });
      out.push(['닫힌 방의 판정 → stale', recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '늦음' }).meta.stale ? '✓' : '✗']);
      setMilestoneStatus(T, 2, 'now');
      startRound(T, { milestone: 2 });
      // 결정 84 — 받아들여 고친 지적은 반박이 아니다. 첫 REVISE 는 안 세고, 같은 sha 로 다시 받으면(안 고침) 센다.
      const shaA = 'a'.repeat(40), shaB = 'b'.repeat(40), shaC = 'c'.repeat(40);
      const d1 = recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '하나 — 첫 지적', sha: shaA });
      const d2 = recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '둘 — 고친 뒤 다른 지적', sha: shaB });
      const d3 = recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '셋 — 안 고치고 다시', sha: shaB });
      const d4 = recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '셋 — 안 고치고 다시', sha: shaC });
      const dWant = d1.meta.counted === false && d1.meta.attempt === 0 && d2.meta.counted === false && d2.meta.attempt === 0
        && d3.meta.counted === true && d3.meta.attempt === 1 && d4.meta.counted === true && d4.meta.attempt === 2 && readState(T).phase === 'running';
      out.push(['받아들인 지적은 반박 아님(결정 84)', dWant ? '✓ 첫 REVISE 0 · 고친 뒤 다른 지적 0 · 같은 sha 다시 1 · 같은 지적 되풀이 2' : '✗ ' + JSON.stringify([d1.meta, d2.meta, d3.meta, d4.meta])]);
      // 마일스톤 2 가 now 라 ㉠(같은 단계 자동 이어열기)가 이 닫기 뒤 바로 다음 회차를 연다 — 이제 손으로 다시 안 연다.
      endRound(T, { summary: '닫고' });
      const s = readState(T);
      out.push(['반박 횟수를 다음 라운드가 물려받음', s.phase === 'running' && s.attempt === 2 ? '✓ 2/3, ㉠ 로 바로 이어짐' : `✗ ${JSON.stringify(s)}`]);
      recordVerdict(T, { actor: 'outside', verdict: 'FAIL', text: '명백' });
      out.push(['FAIL(blocked) 뒤 닫기', refuses(() => endRound(T, {}), '대표가 이 방에 말해')]);
      resumeRound(T, { text: '풀어라' });
      out.push(['대표 재개 → 반박 0 · 닫힘', readState(T).attempt === 0 && (endRound(T, {}), true) ? '✓' : '✗']);
      const guarded = protectedBranch();
      out.push([`원격 기본 브랜치(${guarded ?? '모름'}) 푸시 요청`, guarded ? refuses(() => pushAction(guarded, '0'.repeat(40)), '원격 기본 브랜치') : '✗ origin/HEAD 없음 — git remote set-head origin -a']);
      out.push(['다른 브랜치 푸시 요청', pushAction('feature/x', '0'.repeat(40)).type === 'push' ? '✓ 허용' : '✗']);
      // 푸시 문 (결정 63) — 이 라운드의 마지막 외부감사 카드가 PASS 이고 그 sha 가 미는 SHA 여야 한다. 순수 pushGateError + 실제 카드의 sha 도장.
      {
        const A = 'a'.repeat(40), B = 'b'.repeat(40);
        const V = (verdict, sha, extra = {}) => ({ type: 'verdict', actor: 'outside', meta: { verdict, sha, ...extra } });
        const g = [
          pushGateError([], A),                                                   // 카드 없음 → 거부
          pushGateError([V('REVISE', A)], A),                                     // 마지막이 REVISE → 거부
          pushGateError([V('PASS', A), V('REVISE', A)], A),                       // PASS 뒤 REVISE → 거부
          pushGateError([V('PASS', null)], A),                                    // 문 전의 카드(sha 없음) → 거부
          pushGateError([V('PASS', B)], A),                                       // 다른 커밋을 본 PASS → 거부
          pushGateError([V('PASS', A), V('REVISE', B, { stale: true })], A),      // stale 은 안 센다 → 허용
          pushGateError([V('REVISE', A), V('PASS', A)], A),                       // REVISE 뒤 PASS → 허용
          pushGateError([{ type: 'verdict', actor: 'review', meta: { verdict: 'PASS', sha: A } }], A),   // 내부감사만 → 거부
        ];
        const gWant = g.slice(0, 5).every(Boolean) && g[5] === null && g[6] === null && !!g[7];
        out.push(['푸시 문(결정 63)', gWant ? '✓ 카드 없음·REVISE·sha 없음·다른 sha·내부감사만 거부, stale 무시' : '✗ ' + JSON.stringify(g)]);
        // 실제 카드에 HEAD sha 가 박히고, 그 카드로 문이 열린다. 마일스톤 2 가 now 라 앞의 닫기(301행)가 ㉠ 로 이미 이어 열었다.
        const card = recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('봤다') });
        const live = card.meta.sha && /^[0-9a-f]{40}$/.test(card.meta.sha) && pushGateError(readLog(T).filter((e) => e.round === readState(T).round), card.meta.sha) === null
          && pushGateError(readLog(T).filter((e) => e.round === readState(T).round), B)?.includes('다시 감사');
        out.push(['판정 카드에 HEAD sha', live ? `✓ ${card.meta.sha.slice(0, 8)} · 그 sha 로 열림, 다른 sha 거부` : '✗ ' + JSON.stringify(card.meta)]);
        // 감사가 본 sha 를 부르는 쪽이 넘기면 그것이 찍힌다 — 감사 도중 커밋이 들어와도 안 본 HEAD 가 PASS 로 찍히지 않는다 (레오 REVISE, R22).
        const seenCard = recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('시작 때 본 것'), sha: B });
        const ctxNow = readLog(T).filter((e) => e.round === readState(T).round);
        out.push(['카드 sha 는 감사 시작 때 것', seenCard.meta.sha === B && pushGateError(ctxNow, B) === null && pushGateError(ctxNow, card.meta.sha)?.includes('다시 감사') ? '✓ 넘긴 sha 로 찍힘 · 지금 HEAD 는 거부' : '✗ ' + JSON.stringify(seenCard.meta)]);
        endRound(T, { summary: '문 시험 닫음' });
      }
      // 위 구간이 마일스톤 2 를 now 로 남겨서(긴급 수정 시험) ㉠ 이 방금 또 바로 이어 열었다 — 뒤따르는 시험들은
      // 옛 가정(마일스톤 2 는 손으로 열 때만 now) 그대로라, 여기서 원래대로 되돌린다: wait 로 두고 그 회차를 닫는다.
      setMilestoneStatus(T, 2, 'wait');
      if (readState(T).phase !== 'idle') endRound(T, { summary: '긴급 수정 시험 정리' });
      // 호명 (결정 22 · 19-2). 문단 첫머리의 이름 전부, 부른 순서대로. "대표님" 은 대표 호명.
      const cast = { guide: { name: '하영' }, review: { name: '안젤' }, outside: { name: '다니엘' }, boss: { name: '함동혁(댄)' } };
      const multi = addressees('대표님, 정리했습니다.\n\n안젤, 근거 봐줘.\n\n다니엘, 숫자 대조 부탁.', cast);
      out.push(['여러 명 호명 순서', multi.join(',') === 'review,outside' ? '✓ 안젤→다니엘' : `✗ ${multi.join(',')}`]);
      out.push(['대표 호명("대표님,")', callsBoss('대표님, 결정 부탁드립니다.', cast) && !callsBoss('안젤, 대표님께 여쭤봐.', cast) ? '✓' : '✗']);
      // 도구 줄 접기 (결정 30) — 화면과 같은 코드(server/public/toollabel.js)로 문자열을 실제로 만든다.
      const { toolLabel } = await import('../server/public/toollabel.js');
      const items = [{ tool: 'Read', text: '/a/b/app.js' }, { tool: 'Edit', text: '/a/b/app.js' }, { tool: 'Write', text: '/a/b/style.css' }];
      const live = toolLabel(items, true), done = toolLabel(items, false);
      out.push(['도구 줄 접기(진행 중)', live === '파일 1개 읽고 2개 고치는 중 (app.js, style.css)' ? '✓ ' + live : '✗ ' + live]);
      out.push(['도구 줄 접기(끝남)', done === '파일 1개 읽고 2개 고침 (app.js, style.css)' ? '✓ ' + done : '✗ ' + done]);
      // 관제탑 카드의 마지막 줄 (독립검수 #10) — 발언 뒤에 도구 줄·note 가 와도 lastText 는 발언, 도구 줄은 lastTool 로 따로.
      const { toolPhrase, ga } = await import('../server/public/toollabel.js');
      // 주격 조사 — "헨리이 불렀습니다" 가 떴다 (레오 R15 B 감사). 받침 유무로 이/가.
      const gaAll = ['헨리', '톰', '테라', '하영', 'Leo'].map(ga).join(' ');
      out.push(['이/가 조사', gaAll === '헨리가 톰이 테라가 하영이 Leo가' ? '✓ ' + gaAll : '✗ ' + gaAll]);
      emit(T, { actor: 'guide', type: 'message', text: '마지막 말' });
      emit(T, { actor: 'guide', type: 'tool', text: '/a/b/app.js', meta: { tool: 'Edit' } });
      emit(T, { actor: 'system', type: 'note', text: '안내 한 줄' });
      const ts = teamSummary(T);
      out.push(['카드 마지막 줄은 발언', ts.lastText === '마지막 말' && ts.lastActor === 'guide' ? '✓' : `✗ ${ts.lastText}`]);
      const phrase = ts.lastTool ? `${ts.lastTool.actor} · ${toolPhrase(ts.lastTool, true)}` : '(없음)';
      out.push(['도구 줄은 따로', phrase === 'guide · app.js 고치는 중' ? '✓ ' + phrase : '✗ ' + phrase]);
      // 사람별 집계 (결정 40 · M2) — 대화록만으로 나오는 값. 어제 발언은 오늘 수에 안 들고, 마지막 발언 뒤 도구 줄이 "하는 일",
      // (패스) 는 발언이 아니고, 판정 수는 감사 자리만 숫자, 대표 호출은 대표가 답하면 사라진다. 시각을 손에 쥐려고 가짜 대화록으로 잰다.
      const pcast = { ...cast, ops: { name: '솔라' } };
      const d0 = new Date(); d0.setHours(10, 0, 0, 0);
      const at = (min) => new Date(d0.getTime() + min * 60_000).toISOString();
      const plog = [
        { id: 'e0', ts: new Date(d0.getTime() - 24 * 3600_000).toISOString(), actor: 'guide', type: 'message', text: '어제 말.' },
        { id: 'e1', ts: at(0), actor: 'system', type: 'round_start', text: '시작' },
        { id: 'e2', ts: at(1), actor: 'guide', type: 'message', text: '대표님, 손 하나 빌려도 될까요? 둘째 문장.' },
        { id: 'e3', ts: at(2), actor: 'guide', type: 'tool', text: '/a/b/app.js', meta: { tool: 'Edit' } },
        { id: 'e4', ts: at(3), actor: 'outside', type: 'verdict', text: '됐다', meta: { verdict: 'PASS' } },
        { id: 'e5', ts: at(4), actor: 'outside', type: 'message', text: '(패스)' },
        { id: 'e6', ts: at(5), actor: 'ops', type: 'message', text: '첫 문장. 둘째 문장.' },
      ];
      const pe = peopleOf(plog, pcast, { now: d0.getTime() + 10 * 60_000 });
      const pWant = pe.guide.todaySay === 1 && pe.guide.todayVerdict === null && pe.guide.doing?.tool === 'Edit' && pe.guide.lastSaidAt === at(1)
        && pe.guide.bossCall?.text === '대표님, 손 하나 빌려도 될까요? 둘째 문장.' && pe.outside.todayVerdict === 1 && pe.outside.todaySay === 0
        && pe.outside.lastSaidAt === at(3) && pe.ops.doing?.text === '첫 문장.' && pe.ops.todaySay === 1 && pe.boss.todaySay === 0 && !('system' in pe);
      out.push(['사람별 집계', pWant ? '✓ 오늘 수 · 도구 줄 doing · (패스) 제외 · 판정 수 감사만 · 대표 호출 인용' : '✗ ' + JSON.stringify(pe)]);
      const pe2 = peopleOf([...plog, { id: 'e7', ts: at(6), actor: 'boss', type: 'message', text: '알겠다.' }], pcast, { now: d0.getTime() + 10 * 60_000 });
      out.push(['대표가 답하면 호출 사라짐', pe2.guide.bossCall === null && pe2.boss.lastText === '알겠다.' && pe2.boss.todaySay === 1 ? '✓' : '✗ ' + JSON.stringify(pe2.boss)]);
      // 보고와 결정 요청 (결정 52) — "대표님," 으로 시작해도 물음이 없으면 보고라 종(bossCall)이 안 울리고 오늘 보고 줄(bossNotes, ask:false)에만.
      // 하영·헨리 보고가 승인 요청으로 읽힌 09-13 17:28 건. 종 배지 · 개인 카드 · 오늘 보고 줄이 같은 표(ASK_RE)를 쓴다.
      const rlog = [plog[1], { id: 'r1', ts: at(1), actor: 'guide', type: 'message', text: '대표님, 용어 목록 정리했습니다. out/opsroom-content.md 에 있습니다.' }];
      const rp = peopleOf(rlog, pcast, { now: d0.getTime() + 10 * 60_000 });
      const rn = bossNotesOf(rlog, pcast, { now: d0.getTime() + 10 * 60_000 });
      const an = bossNotesOf(plog, pcast, { now: d0.getTime() + 10 * 60_000 });
      const pick = asksBoss('대표님, A 와 B 중 골라 주세요.', pcast), noCall = asksBoss('안젤, 이거 맞아?', pcast);
      const rWant = rp.guide.bossCall === null && rn.length === 1 && rn[0].ask === false && an.length === 1 && an[0].ask === true && pick && !noCall;
      out.push(['보고는 종 없이 보고 줄로(결정 52)', rWant ? '✓ 보고 → bossCall 없음·ask:false · 물음 → bossCall·ask:true · "골라" 는 결정 · 대표 안 부르면 아님' : '✗ ' + JSON.stringify({ call: rp.guide.bossCall, rn, an, pick, noCall })]);
      // 물음은 대표를 부른 그 문단 안에서만 (레오 REVISE R23 + 나리 결정 ① 09-15) — 다른 사람 문단의 물음표는 대표 것이 아니고, 이름 없는 다음 문단도 안 센다.
      // 전엔 앞 상대에게 이어진다고 봤는데 톰 "…(셋째 문단) 그때 정해 주시면 됩니다" 와 세라가 캐스트 밖 나리에게 한 "나리, 검토 부탁해요" 가 대표 차례로 서서 대표 종에 넷이 남았다.
      const mixed = asksBoss('대표님, 진행 상황 보고드립니다.\n\n솔라, 이 수치가 맞습니까?', pcast);
      const cont = asksBoss('대표님, 정리했습니다.\n\n둘 중 어느 쪽으로 갈까요?', pcast);
      const back = asksBoss('솔라, 이거 맞아?\n\n대표님, 위 결과 보고드립니다.', pcast);
      const tom = asksBoss('대표님, 유니티 비교가 나왔습니다 — 그림 둘과 한 줄입니다.\n\n- 유니티: 조각이라 마을 전체는 아닙니다.\n\n제 판단 하나 보태면, 대표님이 정하시기 전에 한 장 다시 찍게 하겠습니다. 그때 한마디로 정해 주시면 됩니다.', pcast);
      const sera = asksBoss('대표님, 우선순위 표를 만들어 두었습니다.\n\n나리, 검토 부탁해요 — 2판으로 두고 A-1 부터 가 주세요.', pcast);
      const mid = asksBoss('솔라, 이건 대표님이 정하실 것 같은데 어떻게 할까?', pcast);
      const same = asksBoss('대표님, 둘 중 어느 쪽으로 갈까요?\n\n솔라, 됐어.', pcast);
      out.push(['물음은 대표를 부른 그 문단 안에서만(나리 ①)', !mixed && !cont && !back && !tom && !sera && !mid && same ? '✓ 솔라 문단의 물음표는 보고 · 이름 없는 다음 문단은 안 셈(톰 셋째 문단·세라→나리) · 글 가운데 "대표님" 0 · 부른 문단의 물음만' : '✗ ' + JSON.stringify({ mixed, cont, back, tom, sera, mid, same })]);
      // 물은 사람이 그 뒤 다시 말하면 그 물음은 지나간 것(나리 ①) — bossCallOf · peopleOf · blockedSpansOf 셋이 같은 선. (패스) 는 말한 것이 아니다.
      const agLog = [plog[1], { id: 'g1', ts: at(1), actor: 'guide', type: 'message', text: '대표님, A 와 B 중 골라 주세요.' }, { id: 'g2', ts: at(2), actor: 'guide', type: 'message', text: '안젤, 그동안 B 로 가 둘게.' }];
      const agPass = [agLog[0], agLog[1], { id: 'g3', ts: at(2), actor: 'guide', type: 'message', text: '(패스)' }];
      const agOther = [agLog[0], agLog[1], { id: 'g4', ts: at(2), actor: 'ops', type: 'message', text: '테라, 나도 B.' }];
      const agNew = [...agLog, { id: 'g5', ts: at(3), actor: 'guide', type: 'message', text: '대표님, 색은요?' }];
      const agGot = [bossCallOf(agLog, pcast)?.id ?? null, bossCallOf(agPass, pcast)?.id ?? null, bossCallOf(agOther, pcast)?.id ?? null, bossCallOf(agNew, pcast)?.id ?? null,
        peopleOf(agLog, pcast, { now: d0.getTime() + 10 * 60_000 }).guide.bossCall?.id ?? null, peopleOf(agPass, pcast, { now: d0.getTime() + 10 * 60_000 }).guide.bossCall?.id ?? null,
        blockedSpansOf(agNew, pcast, { team: 'dev', since: at(0), until: at(10), now: Date.parse(at(10)) }).map((s) => `${s.ref}:${s.to == null ? 'open' : 'closed'}`).join(',')];
      // 상황판 boss 칸이 비면 그 팀 대표 차례는 없다(나리 ③) — 실무가 답 끝났다고 칸을 비웠는데 방 발언이 살아남았다. 칸이 있거나 상황판이 없으면 대화록대로.
      const bdLog = [plog[1], agLog[1]];
      const bdGot = [bossCallOf(bdLog, pcast, { progress: { boss: [] } })?.id ?? null, bossCallOf(bdLog, pcast, { progress: { boss: ['색 하나'] } })?.id ?? null, bossCallOf(bdLog, pcast, { progress: null })?.id ?? null,
        peopleOf(bdLog, pcast, { now: d0.getTime() + 10 * 60_000, progress: { boss: [] } }).guide.bossCall?.id ?? null, peopleOf(bdLog, pcast, { now: d0.getTime() + 10 * 60_000, progress: { boss: ['색 하나'] } }).guide.bossCall?.id ?? null];
      out.push(['상황판 boss 칸 비면 대표 차례 없음(나리 ③)', bdGot.map(String).join('|') === 'null|g1|g1|null|g1' ? '✓ 빈 칸 → 없음 · 칸 있음·상황판 없음 → 대화록대로 · 사람 카드 같음' : '✗ ' + JSON.stringify(bdGot)]);
      out.push(['물은 사람이 다시 말하면 지움(나리 ①)', agGot.map(String).join('|') === 'null|g1|g1|g5|null|g1|g1:closed,g5:open' ? '✓ 다음 말이 있으면 없음 · (패스)·남의 말은 그대로 · 새 물음이면 그것 · 사람 카드 같음 · 보고서 물음 구간도 그 말에서 닫힘' : '✗ ' + JSON.stringify(agGot)]);
      // 대표에게 해 달라는 부탁도 종이다 (결정 66) — 헨리 "zip 받아 풀어 주시면" 이 보고로 빠지면 대표가 못 본다. 단순 보고(올렸습니다·됐습니다)는 그대로.
      const favors = ['대표님, 손 하나 더 빌립니다 — 세 zip 을 받아 ref/kenney/ 에 풀어 주시면 클레멘타인이 목록을 적습니다.', '대표님, 확인 부탁드립니다.',
        '대표님, allow 한 줄 허용해 주세요.', '대표님, 이 명령 실행 한 번만요.', '대표님, 서버 다시 띄워 주세요.'].map((t) => asksBoss(t, pcast));
      const plain = ['대표님, 시안 올렸습니다 — out/screens/seoul.png.', '대표님, 커밋했고 check 46건 됐습니다.', '대표님, 보고드립니다.\n\n클레멘타인, 부품 목록 적어 줘.'].map((t) => asksBoss(t, pcast));
      out.push(['부탁도 종(결정 66)', favors.every(Boolean) && !plain.some(Boolean) ? '✓ 주시면·부탁·허용·실행·주세요 5건 결정 · 올렸습니다·됐습니다·남의 문단 부탁 3건 보고' : '✗ ' + JSON.stringify({ favors, plain })]);
      // ◂ 대표님이 부르셨어요 → 받았나(헨리 사람 카드 2판, 9단계 ①) — 이 라운드에서 대표가 이름을 부른 마지막 말. 그 뒤 그 사람이 말했으면 replied, 옮겨온 말(via)·지난 라운드는 아님.
      const bkLog = [plog[1], { id: 'b1', ts: at(1), actor: 'boss', type: 'message', text: '하영, 이거 왜 안 없어지냐' }, { id: 'b2', ts: at(2), actor: 'boss', type: 'message', text: '솔라, 서버 봐 줘', meta: { via: 'hq' } }];
      const bkReply = [...bkLog, { id: 'b3', ts: at(3), actor: 'guide', type: 'message', text: '대표님, 종 고쳤습니다.' }];
      const bkOld = [{ id: 'b0', ts: at(-5), actor: 'boss', type: 'message', text: '하영, 어제 것' }, plog[1]];
      const bk = peopleOf(bkLog, pcast, { now: d0.getTime() + 10 * 60_000 }), bkR = peopleOf(bkReply, pcast, { now: d0.getTime() + 10 * 60_000 }), bkO = peopleOf(bkOld, pcast, { now: d0.getTime() + 10 * 60_000 });
      const bkOk = bk.guide.bossAsk?.id === 'b1' && bk.guide.bossAsk.replied === null && bk.guide.bossAsk.text === '하영, 이거 왜 안 없어지냐' && bk.ops.bossAsk === null
        && bkR.guide.bossAsk?.id === 'b1' && bkR.guide.bossAsk.replied === at(3) && bkO.guide.bossAsk === null;
      out.push(['대표가 부른 사람 → 받았나(bossAsk)', bkOk ? '✓ 부른 말 · 답하면 replied · 옮겨온 말 아님 · 지난 라운드 아님' : '✗ ' + JSON.stringify({ bk: bk.guide.bossAsk, ops: bk.ops.bossAsk, bkR: bkR.guide.bossAsk, bkO: bkO.guide.bossAsk })]);
      // 종이 보고에 울렸다는 실측(out/m6-screen-findings.md 맨 위) — 그 세 말 중 원문을 찾은 둘은 "시스템," 으로 시작하고 대표 문단이 없다. 지금 표로는 부름도 물음도 아니어야 한다.
      const sysTom = '시스템, 됐다 — `state/teams.json` 은 경영·경영 작전실, `teams/finance/cast.json` 은 유진(유)·노라(노)·빅터(빅) 로 결정 4 원문대로. 남은 건 0건이고 상황판에도 "경영" 으로 뜬다.';
      const sysHenry = '시스템, 세라는 `characters.json` 열여섯째로 넣었습니다 — 나이를 말하는 부착물은 없어요. 시안은 올렸으니 dolls-lineup 2차와 함께 뽑아 주세요. 클레멘타인, 세라 옷색은 개발 몫이라 톰한테 한 줄 남겨야겠다.';
      const sysCast = { ...pcast, system: { name: '시스템' }, boss: { name: '함동혁(댄)' } };
      const sysGot = [callsBoss(sysTom, sysCast), asksBoss(sysTom, sysCast), callsBoss(sysHenry, sysCast), asksBoss(sysHenry, sysCast)];
      out.push(['"시스템," 보고는 종이 아님(findings 맨 위)', sysGot.every((x) => x === false) ? '✓ 톰·헨리 둘 다 부름 아님·물음 아님 — "뽑아 주세요" 는 시스템에게' : '✗ ' + JSON.stringify(sysGot)]);
      // 총괄이 옮겨온 대표 말(meta.via) 은 대표 카드에 안 잡힌다 — 결정 원문이 "하는 일" 로 떴다 (시스템 R21).
      const pe3 = peopleOf([...plog, { id: 'e8', ts: at(7), actor: 'boss', type: 'message', text: '47. 공동 프로젝트 (대표 원문)', meta: { via: 'chief' } }], pcast, { now: d0.getTime() + 10 * 60_000 });
      out.push(['옮겨온 대표 말은 대표 카드 밖', pe3.boss.lastText === null && pe3.boss.todaySay === 0 && pe3.guide.bossCall === null ? '✓ 카드 비고 · 호출은 답한 것으로' : '✗ ' + JSON.stringify(pe3.boss)]);
      // 한 것 한 목록 (결정 92 "누가 뭘 했나", M6 준비 — 계약 3절 "한 것 — 한 목록"). 일곱 종류가 한 목록에 ts 내림차순, 창 밖·늦은 판정·결정 청한 말·대표 말은 뺀다.
      const dlog = [
        ...plog,
        { id: 'd1', ts: at(6), actor: 'guide', type: 'message', text: '대표님, 그림 올렸습니다 out/shots/a.png.' },
        { id: 'd2', ts: at(7), actor: 'outside', type: 'verdict', text: '늦게 온 판정', meta: { verdict: 'REVISE', stale: true } },
        { id: 'd3', ts: at(8), actor: 'system', type: 'note', text: '요청 블록 req_x 닫힘 — 톰 확인', meta: { request: 'req_x', status: 'closed' } },
        { id: 'd4', ts: at(9), actor: 'system', type: 'note', text: '대리 결정 — 톰·제리: 가자', meta: { proxy: ['chief', 'outside'], approval: 'apr_p' } },
        { id: 'd5', ts: at(10), actor: 'system', type: 'milestone', text: '마일스톤 1 통과', meta: { index: 1 } },
        { id: 'd6', ts: at(11), actor: 'system', type: 'round_end', text: '주제', meta: { verdict: 'PASS' } },
        { id: 'd7', ts: at(12), actor: 'boss', type: 'message', text: '대표님이 대표에게, 됐습니다.' },
        { id: 'd8', ts: at(13), actor: 'system', type: 'note', text: '요청 블록 req_y 열림', meta: { request: 'req_y', status: 'open' } },
      ];
      const dApr = [{ id: 'apr_p', grade: 'B', team: 'dev', what: '푸시', decisions: [{ by: 'chief', decision: 'PASS', ts: at(9.2) }, { by: 'outside', decision: 'PASS', ts: at(9.5) }, { by: 'boss', decision: 'PASS', ts: new Date(d0.getTime() - 24 * 3600_000).toISOString() }] }];
      const dn = doneOf(dlog, pcast, { team: 'dev', approvals: dApr, now: d0.getTime() + 20 * 60_000 });
      const dKinds = dn.map((x) => `${x.kind}:${x.by ?? '-'}`).join(',');
      const doneWant = dKinds === 'round:-,milestone:-,decision:outside,decision:chief,proxy:chief,request:-,report:guide,verdict:outside'
        && dn[0].text === '회차를 닫았어요 — 주제' && dn[2].ref === 'apr_p' && dn[2].text === '결재 승인 — 푸시' && dn[7].text === '승인 — 판정을 냈어요' && dn.every((x) => x.team === 'dev');
      out.push(['한 것 한 목록(결정 92)', doneWant ?'✓ 8건 · ts 내림차순 · 늦은 판정·결정 청한 말·대표 말·열린 요청·어제 판정 제외 · 일곱 종류 · 글은 사람 말(회차를 닫았어요 · 결재 승인 · 승인 — 판정)' : '✗ ' + dKinds + ' ' + JSON.stringify(dn.map((x) => x.text))]);
      // 결정 140(R32) — 한 것의 글은 전부 자(bosswords.js bossOk)에 맞는다. 경로·번호·해시는 ref 로만. 나리 자(tools/boss-words-check.mjs)가 '누가뭘했나' 39줄을 세던 것.
      const { bossOk: bossOk140 } = await import('../server/public/bosswords.js');
      const dnBad = dn.filter((x) => !bossOk140(x.text)).map((x) => x.text);
      out.push(['한 것 — 글은 사람 말(결정 140)', !dnBad.length ? '✓ 여덟 줄 다 자에 맞음 · 60자 안 · 경로·번호는 ref' : '✗ ' + JSON.stringify(dnBad)]);
      // 대리 결정 보고 요약 — meta.boss 를 먼저 쓴다(테라 code-review 지적 #5, decideApproval --boss).
      // 없으면 plain() 이 글 안 첫 " — " 앞만 남겨 "대리 결정" 다섯 글자로 잘려 요약이 빈 것처럼 보였다.
      // hasBoss(세라 조건, O4 아침 한 장) — 진짜 --boss 없이 fallback 문장으로 채운 건 자를 통과해도
      // 검사기(tools/boss-words-check.mjs)가 따로 ✗ 로 잡을 수 있게 표시만 남긴다.
      const dnBoss = doneOf([
        { id: 'pb1', ts: at(9), actor: 'system', type: 'note', text: '대리 결정 — 승인 통과 [C] apr_9f8e7d6c 요청 — 로드맵 3단계 착수', meta: { proxy: ['chief', 'outside'], approval: 'apr_p', boss: '로드맵 다음 단계로 넘어갑니다' } },
        { id: 'pb2', ts: at(9.5), actor: 'system', type: 'note', text: '대리 결정 — 승인 통과 [C] apr_없음 요청', meta: { proxy: ['chief', 'outside'], approval: 'apr_없음' } },
      ], pcast, { team: 'dev', approvals: [], now: d0.getTime() + 20 * 60_000 });
      out.push(['대리 결정 보고 요약 — meta.boss 우선(테라 지적 #5)', dnBoss[1]?.text === '로드맵 다음 단계로 넘어갑니다' && dnBoss[1]?.hasBoss === true && dnBoss[0]?.hasBoss === false
        ? '✓ boss 있으면 그대로 씀 · plain() 의 " — " 자르기를 안 탐 · 없으면 hasBoss:false(세라 조건)' : '✗ ' + JSON.stringify(dnBoss)]);
      // 뒤늦은 사람 말(attachBossLine, 나리 요청 09-16 14:5x) — decide 가 끝난 옛 카드는 --boss 를 그때
      // 못 실었다. boss-line 한 줄로 결정에 채우고, doneOf 는 meta.boss 가 없어도 approvals[] 교차 참조로
      // 그 값을 찾는다(그 옛 로그 note 자체는 못 고치니까).
      {
        const { attachBossLine, decideApproval } = await import('./bus.mjs');
        const blCard = requestApproval(T, { grade: 'B', what: '뒤늦은 사람 말 시험', small: true });
        decideApproval(blCard.id, { by: 'chief', decision: 'PASS', team: 'hq', reason: 'apr_xyz 요청 처리', proxy: ['chief'], delegation: null });
        const blBefore = attachBossLine(blCard.id, '작은 재시작 하나를 대신 통과시켰어요');
        const blStored = blBefore.decisions.find((d) => d.by === 'chief')?.boss === '작은 재시작 하나를 대신 통과시켰어요';
        const noBoss = refuses(() => attachBossLine('apr_없는카드', '아무거나'), '그런 요청이 없습니다');
        const dnBackfilled = doneOf([
          { id: 'pb2', ts: at(9), actor: 'system', type: 'note', text: '대리 결정 — 승인 통과 [B] 뒤늦은 사람 말 시험 — apr_xyz 요청 처리', meta: { proxy: ['chief'], approval: blCard.id } },
        ], pcast, { team: 'dev', approvals: [blBefore], now: d0.getTime() + 20 * 60_000 });
        const blWant = blStored && noBoss === '✓ 거부' && dnBackfilled[0]?.text === '작은 재시작 하나를 대신 통과시켰어요';
        out.push(['뒤늦은 사람 말(attachBossLine)', blWant
          ? '✓ boss-line 이 결정에 채워짐 · 없는 카드는 거부 · doneOf 가 approvals[] 교차 참조로 옛 카드도 채움'
          : '✗ ' + JSON.stringify({ blStored, noBoss, dnBackfilled })]);
      }
      // 창 — since·until 로 자르면 "어젯밤" 보고서(결정 80)가 된다. 어제 말(e0)과 어제 판정(boss) 만.
      const dy = doneOf([...dlog, { id: 'd9', ts: new Date(d0.getTime() - 20 * 3600_000).toISOString(), actor: 'ops', type: 'message', text: '대표님, 어젯밤에 서버 살렸습니다.' }], pcast,
        { team: 'dev', approvals: dApr, since: d0.getTime() - 30 * 3600_000, until: d0.getTime() - 3600_000 });
      out.push(['한 것 — 창 자르기', dy.length === 2 && dy[0].kind === 'report' && dy[0].by === 'ops' && dy[1].kind === 'decision' && dy[1].by === 'boss' ? '✓ 어젯밤 창에 보고 1·대표 판정 1' : '✗ ' + JSON.stringify(dy.map((x) => [x.kind, x.by]))]);
      // 기본 창의 "오늘" 은 서울 0시 — 서버 TZ 와 무관(결정 101, 레오). 지금이 09-14 01:00 KST(= 09-13T16:00Z)면 00:30 KST 는 오늘, 23:30 KST(어제) 는 아니다.
      const kNow = Date.parse('2026-09-13T16:00:00Z');
      const kn = doneOf([
        { id: 'k1', ts: '2026-09-13T14:30:00Z', actor: 'guide', type: 'message', text: '대표님, 어제 밤 보고입니다.' },
        { id: 'k2', ts: '2026-09-13T15:30:00Z', actor: 'guide', type: 'message', text: '대표님, 오늘 새벽 보고입니다.' },
      ], pcast, { team: 'dev', now: kNow });
      out.push(['한 것 — 오늘은 서울 0시(결정 101)', kn.length === 1 && kn[0].id === 'report:k2' && dayStartSeoul(kNow) === Date.parse('2026-09-13T15:00:00Z') ? '✓ 00:30 KST 는 오늘 · 23:30 KST 는 어제 · 0시 = 15:00Z' : '✗ ' + JSON.stringify(kn.map((x) => x.id))]);
      // 만든 것도 한 것(나리 09-15 — 승인·판정만 세니 감사 셋만 일한 사람으로 섰다): 커밋(Bash 도구 줄의 git commit, -m 뒤 글자 — 안의 다른 따옴표는 글자) · 산출물(Write/Edit 가 out/ 을 가리킴, 같은 파일은 마지막 한 번) · Read 와 out/ 밖은 안 셈
      const mk = doneOf([
        { id: 'm1', ts: at(1), actor: 'guide', type: 'tool', text: 'cd /x && git add a && git commit -q -m "관제탑 ② \'더 보기\' 는 오늘 안에서만 — 어제는 보고서" && git log', meta: { tool: 'Bash' } },
        { id: 'm2', ts: at(2), actor: 'ops', type: 'tool', text: '/x/teams/dev/out/shots/a.png', meta: { tool: 'Read' } },
        { id: 'm3', ts: at(3), actor: 'ops', type: 'tool', text: '/x/teams/dev/out/m7.md', meta: { tool: 'Write' } },
        { id: 'm4', ts: at(4), actor: 'ops', type: 'tool', text: '/x/teams/dev/out/m7.md', meta: { tool: 'Edit' } },
        { id: 'm5', ts: at(5), actor: 'guide', type: 'tool', text: '/x/server/index.mjs', meta: { tool: 'Edit' } },
        { id: 'm6', ts: at(6), actor: 'guide', type: 'tool', text: 'git status', meta: { tool: 'Bash' } },
      ], pcast, { team: 'dev', now: d0.getTime() + 20 * 60_000 });
      // 글은 사람 말(결정 140, R32): 산출물은 "글 한 장 — 이름"(경로는 ref) · 커밋은 " — "·"(" 앞 머리만("고쳐 올렸어요 — …", 전문은 ref)
      const mkOk = mk.length === 2 && mk[0].id === 'file:ops:teams/dev/out/m7.md' && mk[0].ts === at(4) && mk[0].text === '글 한 장 — m7' && mk[0].ref === 'teams/dev/out/m7.md' && mk[0].by === 'ops'
        && mk[1].kind === 'commit' && mk[1].by === 'guide' && mk[1].text === "고쳐 올렸어요 — 관제탑 ② '더 보기' 는 오늘 안에서만" && mk[1].ref === "관제탑 ② '더 보기' 는 오늘 안에서만 — 어제는 보고서";
      out.push(['한 것 — 커밋·산출물(나리 09-15)', mkOk ? '✓ 커밋 -m 머리 글자(안의 따옴표 글자, 전문은 ref) · 산출물 이름만(경로는 ref) · 같은 파일 마지막 한 번 · Read·out 밖·git status 안 셈' : '✗ ' + JSON.stringify(mk)]);
      // 멈춰 있던 구간(blockedSpansOf — 보고서 띠의 빨간 띠, 헨리 report 1판): FAIL(blocked note → resumed note) · 답 없는 물음(asksBoss → 대표 말/대리 답) · 창과 겹치는 것만 · 안 풀린 건 to null · 라운드가 바뀌면 지난 물음은 닫힘
      const bsLog = [
        { id: 's1', ts: at(1), actor: 'system', type: 'note', text: 'FAIL — 대표 판단', meta: { blocked: true } },
        { id: 's2', ts: at(3), actor: 'system', type: 'note', text: '대표 판단으로 재개', meta: { resumed: true } },
        { id: 's3', ts: at(4), actor: 'guide', type: 'message', text: '솔라, 됐어.\n\n대표님, 유니티로 갈까요?' },
        { id: 's4', ts: at(6), actor: 'boss', type: 'message', text: '유니티' },
        { id: 's5', ts: at(7), actor: 'ops', type: 'message', text: '대표님, 색을 골라 주세요.' },
        { id: 's6', ts: at(8), actor: 'system', type: 'round_start', text: '라운드 2 시작' },
        { id: 's7', ts: at(9), actor: 'guide', type: 'message', text: '대표님, 이건 어느 쪽으로 할까요?' },
      ];
      const bsAt = (iso) => String(Math.round(((Date.parse(iso) - Date.parse(at(0))) / 60000) * 10) / 10);   // at(n) 의 n 으로 되돌림
      const bs = blockedSpansOf(bsLog, pcast, { team: 'dev', since: at(0), until: at(10), now: Date.parse(at(10)) });
      const bsKinds = bs.map((s) => `${s.kind}:${bsAt(s.from)}:${s.to == null ? 'open' : bsAt(s.to)}`).join(',');
      const bsWin = blockedSpansOf(bsLog, pcast, { team: 'dev', since: at(2), until: at(5), now: Date.parse(at(10)) }).map((s) => s.kind + ':' + (s.to == null ? 'open' : 'closed')).join(',');
      // 멈춘 구간(pauses)은 잘라낸다 — FAIL 1→3 에 멈춤 2→3 이 겹치면 1→2 만, 물음 4→6 이 멈춤 4→6 에 통째로 들면 사라짐, 열린 물음 9→ 에 멈춤 9.5→ 이면 9→9.5 만
      const bsPz = blockedSpansOf(bsLog, pcast, { team: 'dev', since: at(0), until: at(10), now: Date.parse(at(10)), pauses: [{ from: at(2), to: at(3) }, { from: at(4), to: at(6) }, { from: at(9.5), to: at(11) }] });
      const bsPzKinds = bsPz.map((s) => `${s.kind}:${bsAt(s.from)}:${s.to == null ? 'open' : bsAt(s.to)}`).join(',');
      const bsOk = bsKinds === 'fail:1:3,ask:4:6,ask:7:8,ask:9:open' && bs[1].text === '대표님, 유니티로 갈까요?' && bs[1].by === 'guide' && bs[0].by === null && bsWin === 'fail:closed,ask:closed'
        && bsPzKinds === 'fail:1:2,ask:7:8,ask:9:9.5';
      out.push(['멈춰 있던 구간(blockedSpansOf)', bsOk ? '✓ FAIL 구간 · 물음→대표 답 · 라운드 바뀌면 닫힘 · 창과 겹치는 것만 · 멈춘 구간은 잘라냄 · 인용은 대표 문단' : '✗ ' + JSON.stringify({ bsKinds, bsWin, bsPzKinds })]);
      // 말투 표본은 물음이 아니다(솔라, 나리 09-15 R27 보고서 "막힌 것 2" — 레오 표본 다섯 줄이 evt_54daf02c54·evt_6c39d2149f 로 종·막힘에 섰다).
      // 표본 글자만으로는 못 가려서(둘째 판은 "기계 같음 검사" 글자도 없다) — note meta.sampleIds 로 표시(sampleIdsOf, bossCallOf·peopleOf·bossNotesOf 도 같은 선).
      const sampleLog = [
        { id: 'sp1', ts: at(1), actor: 'guide', type: 'message', text: '대표님, 표본입니다 — 정해 주세요.' },
        { id: 'sp2', ts: at(2), actor: 'system', type: 'note', text: '정정 — sp1 은 말투 표본', meta: { sampleIds: ['sp1'] } },
      ];
      const spanSample = blockedSpansOf(sampleLog, pcast, { team: 'dev', since: at(0), until: at(10), now: Date.parse(at(10)) });
      out.push(['말투 표본은 물음이 아니다(나리 09-15)', spanSample.length === 0 ? '✓ note meta.sampleIds 로 표시된 발언은 asksBoss 라도 구간을 안 연다' : '✗ ' + JSON.stringify(spanSample)]);
      // 대표에게 한 그 문단(bossParagraph) — "헨리, 셌어…" 넷째 문단이 "대표님, 한 줄요 — …?" 였는데 첫 줄이 대표 차례로 섰다(나리 09-15)
      const bp = bossParagraph('헨리, 셌어. 낱말 사전 밖 말 0.\n\n걸리는 거 하나 — 메모야?\n\n대표님, 한 줄요 — 유진 색이 겹쳐요. 계속 쓸까요?\n\n클레멘타인 끝.', pcast);
      const bp2 = bossParagraph('솔라, 됐어.\n\n대표님, 올렸습니다.', pcast);
      const bp3 = bossParagraph('솔라, 이거 왜 이래?', pcast);
      const bpPeople = peopleOf([{ id: 'b1', ts: at(1), actor: 'guide', type: 'message', text: '헨리, 셌어.\n\n대표님, 한 줄요 — 계속 쓸까요?' }], pcast, { now: d0.getTime() + 10 * 60_000 });
      const bpOk = bp === '대표님, 한 줄요 — 유진 색이 겹쳐요. 계속 쓸까요?' && bp2 === '대표님, 올렸습니다.' && bp3 === '솔라, 이거 왜 이래?' && bpPeople.guide.bossCall?.text === '대표님, 한 줄요 — 계속 쓸까요?';
      out.push(['대표에게 한 그 문단(bossParagraph)', bpOk ? '✓ 물은 문단 · 부르기만 한 문단 · 없으면 원문 · 사람 카드 bossCall 인용도 그 문단' : '✗ ' + JSON.stringify({ bp, bp2, bp3, call: bpPeople.guide?.bossCall })]);
      // 일 상태 (결정 58 ①) — 마을 시계가 아니라 busy·bossCall·phase·alive·신호 5분으로. 일요일 저녁에 열넷이 "잠" 이던 버그.
      const wnow = d0.getTime() + 10 * 60_000;
      const ws = (p, phase) => workStateOf({ busy: false, alive: null, lastSignal: null, bossCall: null, ...p }, phase, wnow);
      const wsGot = [
        ws({ busy: true }, 'running'),                                             // working
        ws({ bossCall: { id: 'x' }, lastSignal: at(9) }, 'running'),               // bossCall — 신호 1분 전이라도 부름이 이긴다
        ws({ alive: true, lastSignal: at(9) }, 'blocked'),                         // blocked — 팀이 막히면 신호보다 앞
        ws({ alive: false, lastSignal: at(6) }, 'running'),                        // working — 턴 끝났지만 4분 전 신호
        ws({ alive: true, lastSignal: at(0) }, 'running'),                         // waiting — 세션 떠 있고 차례 기다림
        ws({ alive: false, lastSignal: at(0) }, 'running'),                        // resting — 라운드 도는데 세션 없고 10분 조용
        ws({ alive: false }, 'idle'),                                              // waiting — 라운드가 없다
        ws({ alive: null, lastSignal: at(0) }, 'running'),                         // resting — codex, 10분 넘게 말 없음
        ws({ alive: null, lastSignal: at(7) }, 'running'),                         // working — codex, 3분 전 발언
      ];
      const wsWant = ['working', 'bossCall', 'blocked', 'working', 'waiting', 'resting', 'waiting', 'resting', 'working'];
      out.push(['일 상태(결정 58)', wsGot.join() === wsWant.join() ? '✓ 마을 시계 없이 ' + wsWant.length + '경우' : '✗ ' + wsGot.join()]);
      // 요청 블록 접기 (결정 49·51, 6-1절) — 순수 함수 foldRequest·lineError. 세 자리 밖 거부, done→ack→confirm 순서, milestone 모드는 ack 으로 안 닫힘.
      {
        const { foldRequest, lineError } = await import('./requests.mjs');
        const F = { team: 'design', actor: 'guide' }, T = { team: 'dev', actor: 'guide' }, C = { team: 'hq', actor: 'chief' }, X = { team: 'marketing', actor: 'guide' };
        const open = { kind: 'open', id: 'req_abcd1234', ts: at(0), approval: 'apr_00000000', from: F, to: T, what: '카드에 버튼', why: '대표가 누를 수 있게', mode: 'once' };
        const r0 = foldRequest([open]);
        const e = [
          lineError(r0, 'say', X),            // 바깥 → 거부
          lineError(r0, 'done', F),           // 요청한 쪽이 됐다 → 거부
          lineError(r0, 'ack', F),            // done 전에 받았다 → 거부
          lineError(r0, 'confirm', C),        // acked 전에 확인 → 거부
          lineError(r0, 'goal', T),           // 톰 아닌데 목표 → 거부
          lineError(r0, 'open', C),           // 서버 줄 → 거부
          lineError(r0, 'say', F), lineError(r0, 'say', T), lineError(r0, 'say', C), lineError(r0, 'done', T), lineError(r0, 'goal', C),   // 허용
        ];
        const eWant = e.slice(0, 6).every(Boolean) && e.slice(6).every((x) => x === null);
        const r1 = foldRequest([open, { kind: 'goal', ts: at(1), by: C, text: '버튼이 실제로 눌리게' }, { kind: 'say', ts: at(2), by: T, text: '됩니다' },
          { kind: 'done', ts: at(3), by: T, text: 'out/x.md' }, { kind: 'ack', ts: at(4), by: F, text: '' }]);
        const r2 = foldRequest([...[open, { kind: 'done', ts: at(3), by: T, text: 'out/x.md' }, { kind: 'ack', ts: at(4), by: F, text: '' }], { kind: 'confirm', ts: at(5), by: C, text: '' }, { kind: 'say', ts: at(6), by: T, text: '닫힌 뒤' }]);
        const r3 = foldRequest([{ ...open, mode: 'milestone', until: { team: 'design', milestone: 2 } }, { kind: 'done', ts: at(3), by: T, text: 'a' }, { kind: 'ack', ts: at(4), by: F, text: '' }]);
        const r4 = foldRequest([{ ...open, mode: 'milestone', until: { team: 'design', milestone: 2 } }, { kind: 'close', ts: at(9), by: null, text: '라운드 3' }]);
        const fWant = r1.status === 'acked' && r1.goal === '버튼이 실제로 눌리게' && r1.thread.length === 4 && lineError(r1, 'confirm', C) === null
          && r2.status === 'closed' && r2.closedBy === 'confirm' && r2.thread.length === 4 && lineError(r2, 'say', T)?.includes('닫힌')
          && r3.status === 'acked' && lineError(r3, 'confirm', C) === null && r4.status === 'closed' && r4.closedBy === 'close' && foldRequest([]) === null;
        out.push(['요청 블록 접기', fWant ? '✓ open→done→acked→closed · milestone 은 ack 으로 안 닫힘 · close 줄로 닫힘' : '✗ ' + JSON.stringify({ r1: r1.status, r2: r2.status, r3: r3.status, r4: r4.status })]);
        out.push(['요청 블록 자리 검사', eWant ? '✓ 바깥·역할·순서·서버 줄 거부 6, 허용 5' : '✗ ' + JSON.stringify(e)]);
        // 총괄실이 받는(to: hq/chief) · 보내는(from: hq/chief) 부탁 — 톰은 chief 이면서 그쪽 자리다(9단계 ④, 나리). 전엔 chief 하나로 읽어 자기 앞 부탁에 '됐다'·자기가 낸 부탁에 '받았다' 를 못 썼다
        const toHq = foldRequest([{ ...open, id: 'req_00000001', from: F, to: C }]), fromHq = foldRequest([{ ...open, id: 'req_00000002', from: C, to: T }, { kind: 'done', ts: at(3), by: T, text: 'a' }]);
        const toHqDone = foldRequest([{ ...open, id: 'req_00000001', from: F, to: C }, { kind: 'done', ts: at(3), by: C, text: 'a' }, { kind: 'ack', ts: at(4), by: F, text: '' }]);
        const hqOk = lineError(toHq, 'done', C) === null && lineError(toHq, 'goal', C) === null && lineError(toHq, 'ack', C) !== null && lineError(fromHq, 'ack', C) === null && lineError(fromHq, 'done', C) !== null
          && lineError(toHqDone, 'confirm', C) === null && toHqDone.status === 'acked';
        // 분석 셋(헨리 분석 1판 · 하영 글 틀 3절, 9단계 ③) — stuckOf 돌려보낸 결재(카드 하나에 REVISE 둘이어도 하나, 튀는 팀 하나) · slowedOf 지난→이번(멈춤 뺌, 시험 회차 뺌) · repeatsOf 같은 카드·같은 단계
        {
          const { stuckOf, slowedOf, repeatsOf, cardBase } = await import('./bus.mjs');
          const ap = [
            { id: 'a1', team: 'design', what: '계획표 2~4단계 재편', ts: at(1), status: 'passed', decisions: [{ by: 'chief', decision: 'REVISE' }] },
            { id: 'a2', team: 'design', what: '계획표 2~4단계 재편 (2차, 톰 REVISE 반영)', ts: at(2), status: 'passed', decisions: [{ by: 'outside', decision: 'REVISE' }, { by: 'chief', decision: 'REVISE' }] },
            { id: 'a3', team: 'design', what: '계획표 2~4단계 재편 (3차, 제리 REVISE 반영)', ts: at(3), status: 'passed', decisions: [{ by: 'chief', decision: 'PASS' }, { by: 'outside', decision: 'PASS' }] },
            { id: 'a4', team: 'dev', what: '로드맵 교체', ts: at(4), status: 'void', decisions: [] },
            { id: 'a5', team: 'dev', what: '로드맵 교체 (apr_a4 고침)', ts: at(5), status: 'passed', decisions: [{ by: 'boss', decision: 'PASS' }] },
            { id: 'a6', team: 'dev', what: '푸시', ts: at(6), status: 'pending', decisions: [] },
          ];
          const st = stuckOf(ap, ['hq', 'marketing', 'dev', 'design', 'finance']);
          const d = st.find((x) => x.team === 'design'), v = st.find((x) => x.team === 'dev');
          const stOk = st.length === 5 && d.total === 3 && d.count === 2 && d.worst === true && d.ids.map((x) => x.id).join(',') === 'a1,a2' && v.total === 2 && v.count === 0 && v.worst === false && st.filter((x) => x.worst).length === 1
            && cardBase('계획표 2~4단계 재편 (2차, 톰 REVISE 반영)') === '계획표 2~4단계 재편' && cardBase('로드맵 교체 (apr_a4 고침)') === '로드맵 교체' && cardBase('푸시') === '푸시';
          const rb = { dev: [
            { round: 24, milestone: 6, verdict: 'PASS', startedAt: '2026-09-13T14:46:11Z', endedAt: '2026-09-13T16:50:55Z' },
            { round: 25, milestone: 6, verdict: 'PASS', startedAt: '2026-09-13T16:51:33Z', endedAt: '2026-09-15T12:32:01Z' },
            { round: 26, milestone: 7, verdict: null, startedAt: '2026-09-15T12:33:06Z', endedAt: '2026-09-15T12:33:06.500Z' } ],   // 0.5초 시험 회차 — 뺀다
          design: [{ round: 11, milestone: 1, verdict: null, startedAt: '2026-09-12T10:00:00Z', endedAt: '2026-09-12T11:00:00Z' }, { round: 12, milestone: 1, verdict: 'PASS', startedAt: '2026-09-12T11:00:00Z', endedAt: '2026-09-12T11:30:00Z' }],
          finance: [{ round: 1, milestone: 1, verdict: null, startedAt: '2026-09-01T06:31:46Z', endedAt: '2026-09-13T03:49:52Z' }] };
          const pz2 = [{ from: '2026-09-14T04:35:00Z', to: '2026-09-15T12:13:00Z' }];   // 31시간 38분
          const sl = slowedOf(rb, pz2);
          const sdev = sl.find((x) => x.team === 'dev'), sdes = sl.find((x) => x.team === 'design');
          const slOk = sl.length === 2 && sdev.dir === 'bad' && sdev.prevRound === 24 && sdev.curRound === 25 && Math.round(sdev.prev / 60_000) === 125 && Math.round(sdev.cur / 60_000) === 722 && Math.round(sdev.pausedMs / 60_000) === 1898
            && sdes.dir === 'good' && sl[0] === sdev && !sl.find((x) => x.team === 'finance');
          const rp2 = repeatsOf(ap, rb);
          const card = rp2.find((x) => x.kind === 'card'), rnd = rp2.find((x) => x.kind === 'round' && x.team === 'design'), rdev = rp2.find((x) => x.kind === 'round' && x.team === 'dev');
          const rpOk = rp2.length === 3 && card.team === 'design' && card.what === '계획표 2~4단계 재편' && card.nth === 3 && card.passed === true && card.ids.join(',') === 'a1,a2,a3'
            && rnd.what === '1단계' && rnd.nth === 2 && rnd.at.join(',') === '11,12' && rnd.passed === true && rdev.what === '6단계' && rdev.at.join(',') === '24,25' && rp2[0] === card
            && !rp2.find((x) => x.what === '로드맵 교체') && repeatsOf([], {}).length === 0 && slowedOf({}, []).length === 0;
          out.push(['분석 셋(stuckOf·slowedOf·repeatsOf)', stOk && slOk && rpOk ? '✓ 돌려보낸 결재 3건 중 2·튀는 팀 하나·무효 뺌 · 지난 2시간 5분→이번 12시간 2분(멈춤 31시간 38분 뺌)·시험 회차 뺌·회차 하나면 없음 · 같은 카드 세 번째에 통과·같은 단계 두 회차' : '✗ ' + JSON.stringify({ stOk, st, slOk, sl, rpOk, rp2 })]);
        }
        out.push(['총괄실 부탁은 톰이 닫는다(9단계 ④)', hqOk ? '✓ 받는 부탁 done·goal·confirm 톰 · 보내는 부탁 ack 톰 · 남의 자리 줄은 그대로 거부' : '✗ ' + JSON.stringify({ d: lineError(toHq, 'done', C), a: lineError(fromHq, 'ack', C), c: lineError(toHqDone, 'confirm', C), st: toHqDone.status })]);
      }
      // 판정 대상 문구 (솔라 R21) — 빈 문구·플래그 모양은 서버로 가기 전에 거부. `--help` 가 대상이 됐던 R20 사고.
      const vt = [verdictTargetError(null), verdictTargetError('--help'), verdictTargetError('M2 people 집계 -v'), verdictTargetError('M2 people 집계')];
      out.push(['판정 대상 가드', vt[0] && vt[1]?.includes('--help') && vt[2]?.includes('-v') && vt[3] === null ? '✓ 빈 문구·--help·-v 거부, 보통 문구 허용' : '✗ ' + JSON.stringify(vt)]);
      // 닫으면서 이어 열기 (결정 25) — end --next 는 endRound 뒤 그 자리에서 startRound. 마일스톤을 안 주면 로드맵 now — PASS 로 닫아
      // now 가 없어졌으면 startRound 가 거부한다(다음 착수는 B). 번호를 주면 그 마일스톤으로 이어진다. note 글은 session.closedText 하나.
      {
        if (readState(T).phase !== 'idle') endRound(T, { summary: '이어 열기 전 닫음' });
        const before = readState(T).round;
        const noNow = refuses(() => startRound(T, { milestone: null, topic: null }), 'B 승인');
        const s = startRound(T, { milestone: 2, topic: '이어 열기' });
        const { closedText } = await import('../server/session.mjs');
        const okText = closedText({ round: before, journaled: 2, next: { round: s.round, milestone: 2, topic: '이어 열기' } });
        const badText = closedText({ round: before, journaled: 2, nextError: '로드맵에 now 인 마일스톤이 없습니다.' });
        const nWant = noNow.startsWith('✓') && s.round === before + 1 && s.milestone === 2 && readState(T).phase === 'running'
          && okText.includes(`라운드 ${s.round} 을 이어 엽니다 · 마일스톤 2 — 이어 열기`) && badText.includes('다음 라운드를 열지 못했습니다');
        out.push(['닫으면서 이어 열기(--next)', nWant ? `✓ now 없으면 B 거부 · 번호 주면 R${before}→R${s.round} · note 글 둘` : '✗ ' + JSON.stringify({ noNow, s, okText, badText })]);
        // codex 세션 칸(외부감사 `방`, codex 로 바뀐 자리 `방:자리` — 결정 69 ①)은 마일스톤이 실제로 pass 로
        // 닫힐 때만 비운다 — 클로드 자리(session.mjs reset)와 같은 규칙(나리 판단 09-16, t2-tension.md 해결:
        // "라운드마다 비운다"는 읽는 범위지 세션을 죽이라는 뜻이 아니었다). 그냥 닫히면(verdict 없음) 그대로
        // 두고, PASS 로 마일스톤이 끝나면 비운다 — `방` 만 지우면 codex 실무의 세션이 이어진다(레오 REVISE R23).
        const osPath = path.join(ROOT, 'state', 'outside-sessions.json');
        const osBefore = fs.existsSync(osPath) ? fs.readFileSync(osPath, 'utf8') : null;
        const seedOs = () => {
          const cur = fs.existsSync(osPath) ? JSON.parse(fs.readFileSync(osPath, 'utf8')) : {};
          const seeded = { ...cur, [T]: { id: 'x1', lastSeen: null }, [`${T}:guide`]: { id: 'x2', lastSeen: null }, [`${T}x`]: { id: 'x3', lastSeen: null } };
          fs.mkdirSync(path.dirname(osPath), { recursive: true }); fs.writeFileSync(osPath, JSON.stringify(seeded, null, 2) + '\n');
        };
        // ① 그냥 닫기 — 마일스톤 2 는 아직 now, PASS 가 아니다. 아무것도 안 비운다(같은 단계 안이라 세션이 이어진다).
        seedOs();
        endRound(T, { summary: '이어 열기 시험 닫음' });
        const osNoPass = JSON.parse(fs.readFileSync(osPath, 'utf8'));
        const notSwept = (T in osNoPass) && (`${T}:guide` in osNoPass) && (`${T}x` in osNoPass);
        // ② 마일스톤 2 를 실제로 PASS 로 닫는다 — 이번엔 비운다. ①은 로드맵의 마일스톤 2 가 'now' 가 아니라서
        // (여기 시험 로드맵은 milestone 1 만 now 로 시작한다) 자동 이어열기가 안 걸렸다 — 그래서 새로 연다.
        if (readState(T).phase === 'idle') startRound(T, { milestone: 2, topic: 'PASS 시험' });
        seedOs();
        recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('이어 열기 마일스톤 봤다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass' } });
        artifact('이어열기물건.md', '내용\n');
        endRound(T, { verdict: 'PASS', summary: '마일스톤 2 닫음' });
        const osPass = JSON.parse(fs.readFileSync(osPath, 'utf8'));
        const swept = !(T in osPass) && !(`${T}:guide` in osPass) && (`${T}x` in osPass);
        delete osPass[`${T}x`];
        if (osBefore == null) fs.rmSync(osPath, { force: true }); else fs.writeFileSync(osPath, JSON.stringify(osPass, null, 2) + '\n');
        out.push(['codex 칸 비움 — 마일스톤 pass 때만(T2)', notSwept && swept
          ? '✓ 그냥 닫기는 안 비움(같은 단계 이어짐) · 마일스톤 PASS 로 닫히면 방·방:guide 비움, 다른 방(방x)은 그대로'
          : '✗ ' + JSON.stringify({ notSwept, osNoPass: Object.keys(osNoPass).filter((k) => k.startsWith(T)), osPass: Object.keys(osPass).filter((k) => k.startsWith(T)) })]);
      }
      // 같은 단계면 회차 자동 이어열기(나리 실측 09-16 — 세 방이 45~95분씩 서서 손으로 다섯 번 열었다) — endRound 뒤에도
      // 그 마일스톤이 로드맵에서 여전히 now 면 승인 없이 바로 startRound. 이미 pass 면(사람이 번호로 재개한 것) 자동으로 안 잇는다.
      // --next 로 부른 쪽이 바로 이을 참이면(endRound({ next })) 여기서 먼저 안 열어 그쪽 startRound 와 안 겹친다.
      {
        // 정리 먼저 — 앞 구간(T2 시험)이 PASS 로 닫으며 "다음 계획표 대기" 회차를 남겼을 수 있다(긴급 수정). wait 로
        // 두고 닫아야(now 면 ㉠ 이 또 바로 이어 열어 아래 startRound 와 겹친다) 안전하게 idle 로 돌아간다.
        setMilestoneStatus(T, 2, 'wait');
        if (readState(T).phase !== 'idle') endRound(T, { summary: '자동 이어열기 전 정리' });
        setMilestoneStatus(T, 2, 'now');
        const before2 = startRound(T, { milestone: 2, topic: '자동' }).round;
        endRound(T, { summary: '중간에 세워 둠' });   // verdict 없음 — milestone 은 그대로 now
        const after2 = readState(T);
        const autoOk = after2.phase === 'running' && after2.round === before2 + 1 && after2.milestone === 2;
        setMilestoneStatus(T, 2, 'pass');   // 다음 시험 전에 닫는다 — pass 로 둬야 이 닫기 자체가 또 자동으로 안 이음
        endRound(T, { summary: '자동 이어열기 확인 뒤 닫음' });

        startRound(T, { milestone: 2, topic: '수동 재개' });
        endRound(T, { summary: '수동 재개 닫음' });   // 이미 pass — 자동으로 안 이음
        const noAutoOk = readState(T).phase === 'idle';

        setMilestoneStatus(T, 2, 'now');
        startRound(T, { milestone: 2, topic: '넥스트' });
        let nextErr = null;
        try { endRound(T, { summary: '넥스트 닫음', next: { milestone: 2, topic: null, auditor: null } }); } catch (e) { nextErr = e.message; }
        const withNextOk = nextErr === null && readState(T).phase === 'idle';
        if (readState(T).phase !== 'idle') endRound(T, { summary: '뒷정리' });
        setMilestoneStatus(T, 2, 'wait');   // 원래대로 — 안 그러면 뒤따르는 시험들이 이 자동 이어열기에 걸린다

        out.push(['같은 단계면 회차 자동 이어열기', autoOk && noAutoOk && withNextOk
          ? `✓ now 면 승인 없이 이어 R${before2}→R${before2 + 1} · 이미 pass 면 사람 몫 그대로 · next 부르면 안 겹침`
          : '✗ ' + JSON.stringify({ autoOk, noAutoOk, withNextOk, after2 })]);
      }
      // 멈춤 감시 ㉢ — owner 만 부르면 그 회차에 몫이 걸린 다른 자리가 조용해도 못 잡는다(독립검수 실측, 노라 71분 안 걸림).
      // workSeatsOf(team, work) 는 순수 — work.json 에서 "진행" 인 그 팀 자리를 뽑는다(중복 제거).
      {
        const { workSeatsOf } = await import('../server/conductor.mjs');
        const work = { items: [
          { id: 'w1', team: T, seat: 'ops', status: '진행' },
          { id: 'w2', team: T, seat: 'ops', status: '진행' },   // 같은 자리 둘 — 중복 제거
          { id: 'w3', team: T, seat: 'review', status: '대기' },   // 대기는 안 걸림
          { id: 'w4', team: `${T}x`, seat: 'guide', status: '진행' },   // 다른 팀은 안 걸림
        ] };
        const seats = workSeatsOf(T, work);
        out.push(['work.json "진행" 자리 뽑기(㉢, 독립검수)', seats.join(',') === 'ops' ? '✓ 진행만 · 중복 제거 · 다른 팀 제외' : '✗ ' + JSON.stringify(seats)]);
      }
      // 완료 조건(D1, 대표 승인 09:5x 151) — doneCheckOf(team, seat, work) 순수: doneCheck 파일이 있고 0바이트
      // 아니면 통과, doneCheck 가 아예 없으면(아무도 안 적음) 그것도 통과(예전처럼 감사 통과만으로 충분).
      {
        const { doneCheckOf } = await import('../server/conductor.mjs');
        const work2 = { items: [
          { id: 'w1', team: T, seat: 'guide', status: '진행', doneCheck: 'CLAUDE.md' },      // 있고 안 빔 → 통과
          { id: 'w2', team: T, seat: 'ops', status: '진행', doneCheck: '없는파일-xyz.md' },   // 없음 → 대기
          { id: 'w3', team: T, seat: 'review', status: '진행' },                              // doneCheck 없음 → 통과
          { id: 'w4', team: T, seat: 'chief', status: '진행', doneCheck: '../../../../etc/passwd' },   // 저장소 밖(2판 #10)
        ] };
        const dc1 = doneCheckOf(T, 'guide', work2), dc2 = doneCheckOf(T, 'ops', work2), dc3 = doneCheckOf(T, 'review', work2), dc4 = doneCheckOf(T, '없는자리', work2);
        const dc5 = doneCheckOf(T, 'chief', work2);   // ..로 저장소 밖을 가리키면 통과가 아니라 이유 있는 거부
        out.push(['완료 조건(D1) — doneCheckOf', dc1.ok === true && dc2.ok === false && dc3.ok === true && dc4.ok === true && dc4.item === null
          && dc5.ok === false && dc5.reason?.startsWith('저장소 밖')
          ? '✓ 파일 있으면 통과 · 없으면 대기 · doneCheck 없으면 통과 · 걸린 항목 없어도 통과(item null) · ..로 저장소 밖은 이유 있는 거부(2판 #10)'
          : '✗ ' + JSON.stringify({ dc1, dc2, dc3, dc4, dc5 })]);
      }
      // D2 — 규칙은 검사기가 막는다(참고-비교-0916 #2 "글로 된 규칙은 안 지켜진다"). d2GuardError 는
      // 순수: 이 회차 도구 줄에서 Agent 둘 이상이면 거부, server/public/app.js 를 Edit·Write 로 고쳤으면
      // 거부(server/src/app.js 는 통과 — 빌드 산출물이 아니라 소스).
      {
        const { d2GuardError } = await import('./bus.mjs');
        const g1 = d2GuardError([{ type: 'tool', meta: { tool: 'Agent' } }]);
        const g2 = d2GuardError([{ type: 'tool', meta: { tool: 'Agent' } }, { type: 'tool', meta: { tool: 'Agent' } }]);
        const g3 = d2GuardError([{ type: 'tool', meta: { tool: 'Edit' }, text: `${ROOT}/server/public/app.js` }]);
        const g4 = d2GuardError([{ type: 'tool', meta: { tool: 'Edit' }, text: `${ROOT}/server/src/app.js` }]);
        const gWant = g1 === null && g2?.includes('서브에이전트') && g3?.includes('server/public/app.js') && g4 === null;
        out.push(['D2 — 규칙은 검사기가 막는다(d2GuardError)', gWant
          ? '✓ Agent 하나는 통과 · 둘 이상 거부 · public/app.js 직접 수정 거부 · src/app.js 는 통과'
          : '✗ ' + JSON.stringify({ g1, g2, g3, g4 })]);
        // 실물 — requestApproval 이 이 회차에 위반이 있으면 카드를 아예 안 연다. T 는 이 check 내내 쓰는
        // 공유 로그라 위반 사건을 거기 남기면 뒤 시험들이 걸린다 — 별도 임시 팀에서 한 번만.
        const T2 = '_check_d2';
        fs.rmSync(paths(T2).dir, { recursive: true, force: true }); fs.mkdirSync(paths(T2).dir, { recursive: true });
        fs.writeFileSync(paths(T2).roadmap, JSON.stringify({ milestones: [{ n: 1, title: '시험', status: 'now' }] }));
        let blocked;
        try {
          startRound(T2, { milestone: 1, topic: 'D2 시험' });
          emit(T2, { actor: 'ops', type: 'tool', text: `${ROOT}/server/public/app.js`, meta: { tool: 'Edit' } });
          blocked = refuses(() => requestApproval(T2, { grade: 'B', what: 'D2 위반 있는 회차의 요청' }), '카드를 못 엽니다');
        } finally {
          fs.rmSync(paths(T2).dir, { recursive: true, force: true });
        }
        out.push(['D2 — requestApproval 이 위반 회차에서 거부', blocked === '✓ 거부' ? '✓ 카드를 못 엽니다' : '✗ ' + blocked]);
      }
      // work.json 통과 겹쳐 쓰기(2판 코드 점검 #12, "그럴 법함") — writeWorkIfUnchanged 는 CAS: 쓰기 직전
      // 파일이 읽었을 때(before)와 다르면(다른 프로세스가 먼저 썼으면) 버리고 false, 남의 변경을 안 덮는다.
      // advanceWorkOnPass 는 그러면 새로 읽어 다시 시도한다 — 두 방 PASS 훅이 겹쳐도 서로 안 지운다.
      {
        const { writeWorkIfUnchanged, advanceWorkOnPass } = await import('./bus.mjs');
        const workFile = path.join(paths(T).dir, 'work.json');
        const seed = { items: [{ id: 'x1', team: T, seat: 'guide', status: '진행' }, { id: 'x2', team: T, seat: 'ops', status: '진행' }] };
        fs.writeFileSync(workFile, JSON.stringify(seed, null, 2) + '\n');
        const before = fs.readFileSync(workFile, 'utf8');
        fs.writeFileSync(workFile, JSON.stringify(seed, null, 2) + '\n// 다른 프로세스가 먼저 씀\n');   // 경합 흉내
        const cas1 = writeWorkIfUnchanged({ items: [{ id: 'x1', team: T, seat: 'guide', status: '통과' }] }, before, workFile);
        const survivedRace = fs.readFileSync(workFile, 'utf8').includes('다른 프로세스가 먼저 씀');
        fs.writeFileSync(workFile, JSON.stringify(seed, null, 2) + '\n');   // 되돌리고 정상 진행 확인
        const p1 = advanceWorkOnPass(T, 'guide', { workId: 'x1', file: workFile });
        const p2 = advanceWorkOnPass(T, '없는자리', { workId: 'x9', file: workFile });
        const after = JSON.parse(fs.readFileSync(workFile, 'utf8'));
        fs.rmSync(workFile, { force: true });
        const wfWant = cas1 === false && survivedRace && p1?.status === '통과' && p1.id === 'x1' && p2 === null
          && after.items.find((it) => it.id === 'x1').status === '통과' && after.items.find((it) => it.id === 'x2').status === '진행';
        out.push(['work.json 통과 겹쳐 쓰기(CAS, 2판 #12)', wfWant
          ? '✓ 옛 스냅샷으로 쓰면 거부(false)·남의 변경 안 덮음 · advanceWorkOnPass 는 정상 진행 · 없는 항목은 null'
          : '✗ ' + JSON.stringify({ cas1, survivedRace, p1, p2, after })]);
      }
      // 라운드 한 줄(roundLineOf, 2판 #11) — briefOf(세션이 뜰 때)와 giveTurn(턴마다)이 같은 함수를 쓴다,
      // T2 뒤로 세션이 한 단계 안 여러 회차를 사는 동안 옛 번호를 붙들지 않게.
      {
        const { roundLineOf } = await import('./bus.mjs');
        const stBefore = fs.readFileSync(paths(T).state, 'utf8');
        const rmBefore2 = fs.readFileSync(paths(T).roadmap, 'utf8');
        fs.writeFileSync(paths(T).roadmap, JSON.stringify({ milestones: [{ n: 5, title: '다섯째', deliverable: '물건 하나', status: 'now' }] }));
        fs.writeFileSync(paths(T).state, JSON.stringify({ round: 9, milestone: 5, topic: '주제 시험', phase: 'running' }));
        const rl1 = roundLineOf(T);
        fs.writeFileSync(paths(T).state, JSON.stringify({ round: 9, milestone: 5, topic: '주제 시험', phase: 'blocked' }));
        const rl2 = roundLineOf(T);
        fs.writeFileSync(paths(T).state, JSON.stringify({ phase: 'idle' }));
        const rl3 = roundLineOf(T);
        fs.writeFileSync(paths(T).state, stBefore);
        fs.writeFileSync(paths(T).roadmap, rmBefore2);
        const rlWant = rl1 === '라운드 9 · 마일스톤 5 "다섯째" — 통과 조건: 물건 하나 · 주제: 주제 시험'
          && rl2 === rl1 + ' · FAIL 로 막혀 있다. 대표 판단 대기' && rl3 === '지금 열린 라운드가 없다.';
        out.push(['라운드 한 줄(roundLineOf, 2판 #11)', rlWant ? '✓ 라운드·마일스톤·주제 · blocked 꼬리 · idle 은 다른 문장' : '✗ ' + JSON.stringify({ rl1, rl2, rl3 })]);
      }
      // 팀 카드 꼬리 N/전체(milestoneStageOf, 나리 실측 — 총괄이 1/5 에 굳어 있었다) — round.json 의
      // state.milestone 이 아니라 로드맵의 pass 수 + 1 로 센다. 총괄실처럼 라운드를 안 타는 방도 맞다.
      {
        const { milestoneStageOf } = await import('./bus.mjs');
        const ms1 = milestoneStageOf({ milestones: [{ n: 1, status: 'pass' }, { n: 2, status: 'pass' }, { n: 3, status: 'wait' }, { n: 4, status: 'wait' }, { n: 5, status: 'wait' }] });
        const ms2 = milestoneStageOf({ milestones: [{ n: 1, status: 'pass' }, { n: 2, status: 'now' }, { n: 3, status: 'wait' }] });
        const ms3 = milestoneStageOf({ milestones: [{ n: 1, status: 'pass' }, { n: 2, status: 'pass' }] });   // 전부 pass — 전체에서 멈춤
        const ms4 = milestoneStageOf({ milestones: [] });
        const msWant = ms1?.n === 3 && ms1.total === 5 && ms2?.n === 2 && ms2.total === 3 && ms3?.n === 2 && ms3.total === 2 && ms4 === null;
        out.push(['팀 카드 꼬리 N/전체(milestoneStageOf)', msWant
          ? '✓ pass 수 + 1(지금 것) · 전부 pass 면 전체에서 멈춤 · 마일스톤 없으면 null'
          : '✗ ' + JSON.stringify({ ms1, ms2, ms3, ms4 })]);
      }
      // 단계 숫자 정본(opus 적대 검수 3절 #3, 09-16) — teamSummary 가 여태 state.milestone 을 그대로 내서, 그
      // 값이 로드맵과 갈라지면(총괄실처럼 라운드를 안 타 안 올라가는 방) 왼쪽 레일·전체 탭·리포트가 카드(이미
      // milestoneStageOf 를 썼다)와 다른 수를 보여 줬다. teamSummary().milestone 도 이제 같은 공식이어야 한다.
      {
        const stBefore3 = fs.readFileSync(paths(T).state, 'utf8');
        const rmBefore3 = fs.readFileSync(paths(T).roadmap, 'utf8');
        fs.writeFileSync(paths(T).roadmap, JSON.stringify({ milestones: [{ n: 1, status: 'pass' }, { n: 2, status: 'pass' }, { n: 3, status: 'pass' }, { n: 4, title: '넷째', status: 'now' }, { n: 5, status: 'wait' }] }));
        fs.writeFileSync(paths(T).state, JSON.stringify({ round: 9, milestone: 1, topic: '굳은 값 시험', phase: 'running' }));   // 옛 버그처럼 1 에 굳음
        const tsStale = teamSummary(T);
        fs.writeFileSync(paths(T).state, stBefore3);
        fs.writeFileSync(paths(T).roadmap, rmBefore3);
        const staleWant = tsStale.milestone === 4 && tsStale.milestonesDone === 3 && tsStale.milestonesTotal === 5;
        out.push(['teamSummary 단계도 정본(milestoneStageOf 따름)', staleWant ? '✓ state.milestone 이 1 에 굳어도 pass 3 + 1 = 4 를 냄 — 카드·레일·리포트 다 같은 수' : '✗ ' + JSON.stringify(tsStale)]);
      }
      // 판정 대상 자리 찾기(테라 code-review 지적, dea1182 — 훅이 target 을 'guide' 로 고정해서 서로 감사(결정 125)로
      // ops 등이 평가받아도 항상 guide 로 찍혔다) — verdictTargetActor(team, flowTargetText) 순수: 자유 글에서
      // 먼저 나오는 이름의 자리를 돌려주고, 아무도 안 나오면 예전처럼 'guide'.
      {
        const { verdictTargetActor } = await import('./bus.mjs');
        // guide·ops 순서로 선언 — vt3 는 글에서 ops(솔라)가 먼저 나오게 해서, "글에서 먼저 나온 이름"과
        // "cast 선언 순서" 가 갈리게 만든다(code-review 지적 — 선언 순서로 도는 버그를 이 시험이 못 잡았었다).
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라' }, ops: { name: '솔라' }, review: { name: '안젤' }, outside: { name: '레오' }, boss: { name: '댄' }, system: { name: '나리' } } }));
        const vt1 = verdictTargetActor(T, '솔라 서버 것 봐줘');
        const vt2 = verdictTargetActor(T, '이번 라운드 산출물');   // 아무 이름도 없음 — 예전 기본값
        const vt3 = verdictTargetActor(T, '솔라 서버랑 테라 화면 둘 다 — 먼저 나온 솔라부터');
        const vt4 = verdictTargetActor(T, '댄·나리 확인 — 실무 아님');   // boss·system 은 자리 후보가 아니다
        // 감사역을 먼저 부르고 그다음 대상을 말하는 게 보통 글(2판 코드 점검 #1) — "레오, 솔라 서버 것 봐줘"
        // 에서 레오(outside)가 먼저 나온다고 outside 가 대상이 되면 안 된다. review(안젤)도 같은 선.
        const vt5 = verdictTargetActor(T, '레오, 솔라 서버 것 봐줘');
        const vt6 = verdictTargetActor(T, '안젤, 이번 라운드 산출물 봐줘');
        // 청한 자리 본인이 기본(나리 15:3x — 헨리가 청했는데 글 속 "클레멘타인" 이름을 잡아 엉뚱하게
        // ops 로 찍혔다) — requester 가 감사가 아니면 이름 찾기 없이 그 자리. 감사가 청했을 때만(남을
        // 대신 청하는 경우) 이름 찾기로 넘어간다.
        const vt7 = verdictTargetActor(T, '솔라가 만든 것 봐줘', 'guide');       // guide(감사 아님)가 청함 — 글 속 이름 안 보고 청한 자리 본인(guide)
        const vt8 = verdictTargetActor(T, '솔라가 만든 것 봐줘', 'outside');     // outside(감사)가 청함 — 남을 대신 청한 것 — 이름 찾기로 ops
        const vt9 = verdictTargetActor(T, '이번 라운드 산출물', 'ops');          // 이름 없고 솔라(ops)가 청함 — 예전 기본값(guide)이 아니라 청한 자리 본인
        out.push(['판정 대상 자리 찾기(target 고정 버그)', vt1 === 'ops' && vt2 === 'guide' && vt3 === 'ops' && vt4 === 'guide' && vt5 === 'ops' && vt6 === 'guide'
          && vt7 === 'guide' && vt8 === 'ops' && vt9 === 'ops'
          ? '✓ 이름 있으면 그 자리 · 없으면 guide · 글 순서로 먼저 나온 이름 · boss·system 은 후보 아님 · 감사역(outside·review) 도 후보 아님(2판 #1) · 청한 자리 본인이 기본, 감사가 청했을 때만 이름 찾기(나리 15:3x)'
          : '✗ ' + JSON.stringify({ vt1, vt2, vt3, vt4, vt5, vt6, vt7, vt8, vt9 })]);
        // 대상 없는 판정 요청 0건(세라 조건, apr_132205cc) — withVerdictTarget 이 target 글 **앞**에
        // '대상: <자리> · ' 를 박고, verdictTargetActor 는 그 표시를 이름 찾기보다 먼저 읽는다 — 왕복해도
        // 같은 자리, 표시 자체가 늘 있다. matched:false 는 아무 이름도 못 찾아 guide 로 기본값이 갔다는 뜻
        // (테라 code-review 지적 ③ — 조용한 기본값을 구분한다).
        const { withVerdictTarget } = await import('./bus.mjs');
        const w1 = withVerdictTarget(T, '솔라 서버 것 봐줘');                 // 이름이 있으면 matched
        const w2 = withVerdictTarget(T, '이번 라운드 산출물');                // 이름이 없으면 guide · matched:false
        const w3 = withVerdictTarget(T, '레오, 솔라 서버 것 봐줘');            // 감사역이 먼저 나와도
        const w4 = withVerdictTarget(T, '테라 화면 + 솔라 서버 봐줘', 'ops');  // 직접 적은 자리가 이름 짐작을 이긴다(지적 ①)
        // 표시를 앞에 두는 이유(지적 ②) — 훅이 첫 줄을 200자로 자른다. 글이 220자여도 앞의 표시는 안 잘린다.
        const w5 = withVerdictTarget(T, '솔라 '.repeat(60) + '서버 것 봐줘');   // 220자 안팎
        const hasMark = (s) => /^대상: [a-z]+ · /.test(s);
        const roundTrip = (w) => verdictTargetActor(T, w.text) === w.seat;
        const survives200 = /^대상: [a-z]+ · /.test(w5.text.slice(0, 200));
        const wWant = w1.seat === 'ops' && w1.matched === true && w2.seat === 'guide' && w2.matched === false && w3.seat === 'ops'
          && w4.seat === 'ops' && w4.matched === true
          && hasMark(w1.text) && hasMark(w2.text) && hasMark(w3.text) && hasMark(w4.text)
          && roundTrip(w1) && roundTrip(w2) && roundTrip(w3) && roundTrip(w4) && survives200;
        out.push(['대상 없는 판정 요청 0건(withVerdictTarget)', wWant
          ? '✓ 글 앞에 대상: <자리> · 를 박음(200자 잘려도 삶) · matched 로 조용한 기본값 구분 · explicitSeat 가 짐작을 이김 · 왕복해도 같은 자리'
          : '✗ ' + JSON.stringify({ w1, w2, w3, w4, survives200 })]);
      }
      // 닫히는 중 쌓인 차례는 다음 라운드로 (결정 25) — 호명·제3자만 넘기고 판정·침묵·점심은 버린다. 순수 함수 pickCarry.
      const { pickCarry, staleCalls, mergeCarry } = await import('../server/conductor.mjs');
      const carried = pickCarry(new Map([['review', { kind: 'called' }], ['outside', { kind: 'verdict' }], ['ops', { kind: 'lull' }], ['guide', { kind: 'third' }], ['chief', { kind: 'lunch' }]]));
      out.push(['닫히는 중 차례 넘기기', carried.map((x) => x.join(':')).join(',') === 'review:called,guide:third' ? '✓ 호명·제3자 넘김 · 판정·침묵·점심 버림' : '✗ ' + JSON.stringify(carried)]);
      // 닫힌 라운드의 호명이 round_end·round_start 와 한 폴링에 오면 새 라운드의 보통 호명이 아니라 넘어온 차례다 (레오 REVISE R23) —
      // 들려주기를 그 말의 라운드부터 잇는다. 새 라운드의 말·대표·자기 자신·참여자 아닌 자리는 안 잡는다.
      const sc = staleCalls([
        { round: 4, type: 'message', actor: 'guide', text: '안젤, 근거 봐줘.' },
        { round: 4, type: 'message', actor: 'guide', text: '대표님, 정했습니다.\n\n다니엘, 숫자 대조.' },
        { round: 5, type: 'message', actor: 'guide', text: '안젤, 새 라운드 말.' },
        { round: 3, type: 'message', actor: 'review', text: '다니엘, 더 이른 라운드.' },
        { round: 4, type: 'message', actor: 'outside', text: '안젤, 같은 사람 두 번째 — 차례는 하나.' },
      ], 5, cast, (a) => a !== 'ops');
      out.push(['닫힌 라운드 호명은 넘어온 차례', sc.map((x) => x.join(':')).join(',') === 'review:4,outside:3' ? '✓ 안젤 R4(두 번 불려도 하나) · 다니엘 R3(가장 이른 것) · 새 라운드·대표 제외' : '✗ ' + JSON.stringify(sc)]);
      // 앞 폴링에서 넘겨 둔 것(carry)과 마지막 묶음의 호명이 같은 사람이면 차례는 하나 (레오 FAIL R23) — 라운드는 가장 이른 것.
      const mc = mergeCarry({ round: 4, items: [['review', 'called'], ['guide', 'third']] }, sc);
      const mc0 = mergeCarry(null, []);
      out.push(['넘겨 둔 것 + 묶음 호명 합치기', mc.map((x) => x.join(':')).join(',') === 'review:4,guide:4,outside:3' && mc0.length === 0 ? '✓ 안젤 하나(carry 와 묶음 둘 다) · 테라 carry 만 · 다니엘 묶음만 · 둘 다 없으면 0' : '✗ ' + JSON.stringify(mc)]);
      // 서버 재시작에 차례가 살아남는다 (결정 104) — 순수 restoreQueue. 같은 라운드면 pending·inflight 그대로(죽은 턴의 커서는 되돌림),
      // 라운드가 바뀌었으면 pickCarry 규칙으로 carry 에(판정·침묵은 버림), 저장이 없으면 빈손.
      {
        const { restoreQueue } = await import('../server/conductor.mjs');
        const saved = { round: 7, pending: [['review', 'called'], ['ops', 'lull']], inflight: [['guide', 'called', 'ev_before']], carry: null, carryFrom: null };
        const same = restoreQueue(saved, 7), later = restoreQueue(saved, 8), none = restoreQueue(null, 8);
        const ok = same.pending.map((x) => x.join(':')).join(',') === 'review:called,ops:lull,guide:called' && same.cursors.map((x) => x.join(':')).join(',') === 'guide:ev_before' && !same.carry
          && later.pending.length === 0 && later.carry?.round === 7 && later.carry.items.map((x) => x.join(':')).join(',') === 'review:called,guide:called' && later.cursors.length === 1
          && none.pending.length === 0 && !none.carry;
        out.push(['서버 재시작 뒤 차례 되살리기(결정 104)', ok ? '✓ 같은 라운드 3건 그대로(나가 있던 턴 포함·커서 되돌림) · 다음 라운드면 호명 2건만 carry · 침묵 버림 · 저장 없으면 0' : '✗ ' + JSON.stringify({ same, later, none })]);
        // 8단계 ① — codex 를 강제로 죽여도 1회 재시도 후 note + 큐. 안쪽(outside.mjs, bus.withRetry): 한 번 실패 → onRetry 한 번 → 됨 · 둘 다 실패 → gaveUp·attempts 2 · 한도(fatal) 는 재시도 없이 바로.
        // 바깥(conductor.retryPlan): 첫 프로세스가 못 냈으면(tries 1) 큐에 3분 뒤 · 큐에서 준 것도 못 냈으면(tries 2) 버림.
        {
          const { withRetry } = await import('./bus.mjs');
          const { retryPlan, OUTSIDE_RETRY_MS, OUTSIDE_MAX_TRIES } = await import('../server/conductor.mjs');
          const retried = [];
          const flaky = await withRetry(async (n) => { if (n === 1) throw new Error('codex SIGKILL 로 죽음'); return `됨 ${n}`; }, { tries: 2, onRetry: (e, n) => retried.push(`${n}:${e.message}`) });
          let dead = null; try { await withRetry(async () => { throw new Error('exit 1'); }, { tries: 2, onRetry: (e, n) => retried.push(`x${n}`) }); } catch (e) { dead = e; }
          let fatal = null; const fatalRetries = []; try { await withRetry(async () => { throw new Error('usage limit'); }, { tries: 2, fatal: (e) => /limit/.test(e.message), onRetry: () => fatalRetries.push(1) }); } catch (e) { fatal = e; }
          const t0 = 1_000_000;
          const p1 = retryPlan(1, t0), p2 = retryPlan(2, t0), p0 = retryPlan(1, t0, { max: 1 });
          const want = flaky === '됨 2' && retried.join(',') === '1:codex SIGKILL 로 죽음,x1' && dead?.gaveUp === true && dead.attempts === 2 && fatal?.message === 'usage limit' && !fatal.gaveUp && fatalRetries.length === 0
            && p1.action === 'queue' && p1.notBefore === t0 + OUTSIDE_RETRY_MS && p2.action === 'drop' && p0.action === 'drop' && OUTSIDE_MAX_TRIES === 2;
          out.push(['codex 죽여도 1회 재시도 후 note+큐(8단계 ①)', want ? `✓ withRetry: 한 번 죽고 두 번째 됨 · 둘 다 죽으면 gaveUp(2) · 한도는 재시도 없이 · retryPlan: 1번째 실패 → ${Math.round(OUTSIDE_RETRY_MS / 60_000)}분 뒤 큐 · 2번째 → 버림` : '✗ ' + JSON.stringify({ flaky, retried, dead: dead && { m: dead.message, g: dead.gaveUp, a: dead.attempts }, fatal: fatal && { m: fatal.message, g: fatal.gaveUp }, fatalRetries, p1, p2, p0 })]);
          // 8단계 ② — 세션이 죽으면 자동 재개(session.deathPlan): 턴 도중 첫 죽음 → 같은 턴 새 세션으로(retry) · 이어붙인 첫 턴이면 id 썩음(rotten) · 이미 한 번 다시 보낸 턴 → 버림(drop) · 턴 밖 → none.
          const { deathPlan } = await import('../server/session.mjs');
          const dp = [
            deathPlan({ inflight: true, retried: false, resumed: false, firstOk: false }),
            deathPlan({ inflight: true, retried: false, resumed: true, firstOk: false }),
            deathPlan({ inflight: true, retried: false, resumed: true, firstOk: true }),
            deathPlan({ inflight: true, retried: true, resumed: false, firstOk: true }),
            deathPlan({ inflight: false, retried: false, resumed: true, firstOk: false }),
          ].map((p) => `${p.action}${p.rotten ? '!' : ''}`);
          out.push(['세션 죽으면 자동 재개(8단계 ②)', dp.join(',') === 'retry,retry!,retry,drop,none' ? '✓ 첫 죽음 retry · 이어붙인 첫 턴은 id 버림 · 이어붙여 잘 돌다 죽으면 id 유지 · 두 번째 죽음 drop · 턴 밖 none' : '✗ ' + dp.join(',')]);
        }
        // 잡담 브레이크(결정 121) — 침묵 차례 발언자 줄이 같은 둘로 3회씩이면 참. 셋이 섞이거나 짧으면 거짓. (호명은 이 줄에 안 들어가니 여기서 못 걸린다.)
        const { chatLoop } = await import('../server/conductor.mjs');
        const cl = [chatLoop(['a', 'b', 'a', 'b', 'a', 'b']), chatLoop(['a', 'a', 'b', 'b', 'a', 'b']), chatLoop(['a', 'b', 'a', 'b', 'a']), chatLoop(['a', 'b', 'c', 'a', 'b', 'a']), chatLoop(['x', 'a', 'b', 'a', 'b', 'a', 'b']), chatLoop([])];
        out.push(['잡담 브레이크(결정 121)', cl.join(',') === 'true,true,false,false,true,false' ? '✓ 둘이 3회씩 참 · 교대 아니어도 참 · 5개 거짓 · 셋 섞이면 거짓 · 앞에 다른 사람 있어도 마지막 6개로 · 빈 줄 거짓' : '✗ ' + cl.join(',')]);
        // 말로 부른 판정(나리 점검-0916 3-7) — "레오, … 판정 …" 은 걸리고, 판정 낱말 없는 호명은 안 걸린다. 10분(AUTO_VERDICT_MS)은 env 로 줄일 수 있다.
        const { asksVerdict, AUTO_VERDICT_MS } = await import('../server/conductor.mjs');
        const av = [asksVerdict('레오, 산출물 out/m9-status.md 판정 부탁해요'), asksVerdict('마크, 판정해 주세요 — 얼굴 열일곱'), asksVerdict('레오, 이거 돌려봤어요?'), asksVerdict(''), asksVerdict(null)];
        out.push(['말로 부른 판정(asksVerdict)', av.join(',') === 'true,true,false,false,false' && AUTO_VERDICT_MS === 10 * 60_000 ? '✓ 판정 낱말이면 참 · 호명만이면 거짓 · 빈 글 거짓 · 기본 10분' : '✗ ' + JSON.stringify({ av, AUTO_VERDICT_MS })]);
        // 작은 B(점검-0916 3-9 감사 무게 나누기) — needsOf: 작은 B 는 톰 혼자, 보통 B 는 총괄실(hq) 카드만 톰+제리
        // — 팀 카드(dev 등)는 톰 혼자, 대신 서는 사람 없음(대표 09-16 16:4x "제리는 총괄실만", 결정 183·185).
        // C 는 대표. 요청은 실행 대상 있는 B·C 에 --small 을 거부(임시 큐라 진짜 큐에 안 남는다).
        // 위임은 인자로(null = 평소 톰) — 실제 state/delegation.json 이 켜져 있어도 check 는 흔들리지 않는다. 위임 중(to:system)엔 결정 자리가 나리.
        const nd = [needsOf({ grade: 'B', small: true, team: 'hq' }, null), needsOf({ grade: 'B', team: 'hq' }, null), needsOf({ grade: 'C', small: true }, null), needsOf({ grade: 'A' }, null)].map((x) => x.join('+'));
        const ndDg = [needsOf({ grade: 'B', small: true, team: 'hq' }, { to: 'system' }), needsOf({ grade: 'B', team: 'hq' }, { to: 'system' }), needsOf({ grade: 'C' }, { to: 'system' })].map((x) => x.join('+')).join(' / ');
        // 팀 카드(hq 아님)는 보통 B 도 결정 자리 하나 — 제리 줄 없음.
        const ndTeam = [needsOf({ grade: 'B', team: 'dev' }, null), needsOf({ grade: 'B', team: 'design' }, { to: 'system' })].map((x) => x.join('+'));
        const smallC = refuses(() => requestApproval(T, { grade: 'C', what: '작은 C', small: true }), '작은 B');
        const smallPush = refuses(() => requestApproval(T, { grade: 'B', what: '작은 푸시', small: true, action: { type: 'push' } }), '큰 것');
        let smallOk = null; try { smallOk = requestApproval(T, { grade: 'B', what: '재시작 — 시험', small: true }); } catch (e) { smallOk = { err: e.message }; }
        // --to 도 --restart 도 --small 됨(점검-0916 3-9 가 재시작을 원래 "작은 B" 예로 들었다, 톰 배분이
        // --to 를 더했다·나리 지적 apr_642fbd69) — 결과가 되돌리기 쉽거나 그 방 확인 정도라 가벼운 것들.
        // 다른 실행 대상(푸시 등)은 그대로 거부.
        let smallToOk = null; try { smallToOk = requestApproval(T, { grade: 'B', what: '작은 요청 블록 시험', small: true, action: { type: 'request', to: { team: 'design', actor: 'guide' }, why: '', due: null, mode: 'once' } }); } catch (e) { smallToOk = { err: e.message }; }
        let smallRestartOk = null; try { smallRestartOk = requestApproval(T, { grade: 'B', what: '작은 재시작 시험', small: true, action: { type: 'restart' } }); } catch (e) { smallRestartOk = { err: e.message }; }
        const smallWant = nd.join(' / ') === 'chief / chief+outside / boss / ' && ndDg === 'system / system+outside / boss' && ndTeam.join(' / ') === 'chief / system'
          && smallC === '✓ 거부' && smallPush === '✓ 거부' && smallOk?.small === true && needsOf(smallOk, null).join() === 'chief'
          && smallToOk?.small === true && smallToOk?.action?.type === 'request'
          && smallRestartOk?.small === true && smallRestartOk?.action?.type === 'restart';
        // 결정 자리 실측(임시 큐) — 위임 중 톰의 판정은 거부('나리가 정합니다'), 방 없는 나리 거부, 총괄실 나리 통과 → 작은 B 는 그걸로 닫힘. 위임 없이 나리는 거부('톰이 정합니다').
        const { decideApproval, listApprovals: listQ } = await import('./bus.mjs');
        const dgOnB = { to: 'system', until: '2099-01-01T00:00:00Z' };
        const dTom = smallOk?.id ? refuses(() => decideApproval(smallOk.id, { by: 'chief', decision: 'PASS', team: 'hq', delegation: dgOnB }), '나리가 정합니다') : '✗ 카드 없음';
        const dNariNoRoom = smallOk?.id ? refuses(() => decideApproval(smallOk.id, { by: 'system', decision: 'PASS', team: null, delegation: dgOnB }), '총괄실에서만') : '✗';
        const dNariNoDg = smallOk?.id ? refuses(() => decideApproval(smallOk.id, { by: 'system', decision: 'PASS', team: 'hq', delegation: null }), '톰이 정합니다') : '✗';
        let dNari = null; try { dNari = smallOk?.id ? decideApproval(smallOk.id, { by: 'system', decision: 'PASS', reason: '됐다', team: 'hq', delegation: dgOnB, boss: '작은 재시작 하나 통과시켰어요' }) : null; } catch (e) { dNari = { err: e.message }; }
        const closedBySystem = smallOk?.id ? listQ().find((x) => x.id === smallOk.id)?.status === 'passed' : false;
        // --boss 한 줄이 결정 레코드에 그대로 남나(테라 code-review 지적 #5) — approve.mjs --boss 로 심는 값.
        const bossStored = smallOk?.id ? listQ().find((x) => x.id === smallOk.id)?.decisions?.find((d) => d.by === 'system')?.boss === '작은 재시작 하나 통과시켰어요' : false;
        // 옛 카드(톰 PASS 하나로 닫힘 — 팀 카드라 제리 줄이 없다, 16:4x)가 위임 뒤에도 통과로 남나 — 결정
        // 칸은 하나(sameSlot). 톰 통과 뒤 나리가 또 찍으면 거부(이미 끝남).
        let old = null; try { old = requestApproval(T, { grade: 'B', what: '옛 카드 — 톰이 통과시킨 것', action: null }); decideApproval(old.id, { by: 'chief', decision: 'PASS', team: 'hq', delegation: null }); } catch (e) { old = { err: e.message }; }
        const oldStill = old?.id ? listQ().find((x) => x.id === old.id)?.status === 'passed' : false;
        const dupSlot = old?.id ? refuses(() => decideApproval(old.id, { by: 'system', decision: 'PASS', team: 'hq', delegation: dgOnB }), '이미 끝난') : '✗';
        const dcWant = dTom === '✓ 거부' && dNariNoRoom === '✓ 거부' && dNariNoDg === '✓ 거부' && dNari?.status === 'passed' && closedBySystem && bossStored && oldStill && dupSlot === '✓ 거부';
        out.push(['결정 자리 — 위임 중 나리(대표 09-16)', dcWant ? '✓ 위임 중 톰 거부 · 방 없는 나리 거부 · 위임 없이 나리 거부 · 총괄실 나리 통과로 작은 B 닫힘 · --boss 한 줄 저장(지적 #5) · 톰이 닫은 옛 카드는 그대로 통과 · 끝난 카드 재판정 거부' : '✗ ' + JSON.stringify({ dTom, dNariNoRoom, dNariNoDg, dNari: dNari?.status ?? dNari, closedBySystem, bossStored, oldStill, dupSlot })]);
        if (smallOk?.id && !closedBySystem) voidApproval(smallOk.id, '자가 시험');
        // 위임 자리 40분 마감(D4, 결정 154) — delegateOverdueCards 순수: 위임 없으면 빈 배열, 위임
        // 중이면 leftOf 에 위임 대상이 남은 pending 카드 중 wait 를 넘은 것만(오늘 아침 카드 다섯이
        // 30분 넘게 선 것이 계기). delegation 을 인자로 넣어(decideApproval 과 같은 꼴) 진짜
        // state/delegation.json 을 안 건드리고 시험한다.
        {
          const { delegateOverdueCards } = await import('./bus.mjs');
          const dgObj = { to: 'system', until: '2099-01-01T00:00:00Z', decision: 999 };
          const fresh = requestApproval(T, { grade: 'B', what: '위임 시험 카드' });
          const noDg = delegateOverdueCards(Date.now(), { wait: 0, delegation: null });               // 위임 없으면 wait 0 이어도 빈 배열
          const overNow = delegateOverdueCards(Date.now(), { wait: 0, delegation: dgObj }).some((r) => r.id === fresh.id);        // wait 0 — 바로 넘김
          const notYet = delegateOverdueCards(Date.now(), { wait: 3600_000, delegation: dgObj }).some((r) => r.id === fresh.id);  // wait 1시간 — 아직
          decideApproval(fresh.id, { by: 'system', decision: 'PASS', team: 'hq', delegation: dgObj });
          const doneOne = delegateOverdueCards(Date.now(), { wait: 0, delegation: dgObj }).some((r) => r.id === fresh.id);        // 나리가 정했으니 그 뒤론 안 걸림(outside 만 남음)
          const d4Want = noDg.length === 0 && overNow === true && notYet === false && doneOne === false;
          out.push(['위임 자리 40분 마감(D4, 결정 154)', d4Want
            ? '✓ 위임 없으면 빈 배열 · wait 넘으면 잡음 · 아직이면 안 잡음 · 위임 자리가 이미 정했으면 안 잡음'
            : '✗ ' + JSON.stringify({ noDg, overNow, notYet, doneOne })]);
        }
        // requestApproval 이 only:['message'] 방(비서실 꼴)에서도 안 죽는가(점검-코드리뷰-0916 #5) — emit 이 type:'note'
        // 를 버려(null) rec.note = ev.id 가 TypeError 로 승인 자체가 기록 안 됐다. 임시 팀을 teams.json 에 등록해 실물로 시험.
        {
          const { TEAMS_PATH } = await import('./bus.mjs');
          const teamsBefore = fs.readFileSync(TEAMS_PATH, 'utf8');   // 원본 바이트 그대로 되돌린다 — JSON.stringify 로 다시 쓰면 들여쓰기가 깨진다
          const cfg = JSON.parse(teamsBefore);
          const T2 = '_check_sera';
          cfg.teams.push({ id: T2, name: '시험 비서실', room: '시험', kind: 'office', owner: 'secretary', speakers: ['boss', 'secretary'], only: ['message'] });
          fs.writeFileSync(TEAMS_PATH, JSON.stringify(cfg));
          let onlyMsg = null;
          try {
            fs.rmSync(paths(T2).dir, { recursive: true, force: true }); fs.mkdirSync(paths(T2).dir, { recursive: true });
            onlyMsg = requestApproval(T2, { by: 'secretary', grade: 'B', what: '시험 — 비서실 꼴', small: true });
          } catch (e) { onlyMsg = { err: e.message }; }
          finally {
            fs.writeFileSync(TEAMS_PATH, teamsBefore);
            fs.rmSync(paths(T2).dir, { recursive: true, force: true });
          }
          const onlyMsgWant = onlyMsg?.id && onlyMsg.note && !onlyMsg.err;
          out.push(['requestApproval — only:[message] 방에서도 안 죽음(#5)', onlyMsgWant
            ? '✓ note 대신 message 로 남기고 승인은 그대로 appendApproval — TypeError 없음'
            : '✗ ' + JSON.stringify(onlyMsg)]);
        }
        // PASS 모양(점검 3-9 ⑦) — 정형문·이유 셋 없음·반박 없음은 되돌리고, 모양이 맞으면 null. 지시문(bus.verdictInstruction)에 그 모양이 적혀 있다.
        const { passShapeError, verdictInstruction } = await import('./bus.mjs');
        const ps = [
          passShapeError('빠진 것 0건 · 더해진 것 0건 · 잘못 간 것 0건 · 뒤집힌 것 0건. 통과입니다.'),
          passShapeError('봤습니다. 좋아요.'),
          passShapeError('떨어뜨릴 이유 1: a — 반박: b\n떨어뜨릴 이유 2: c\n떨어뜨릴 이유 3: e — 반박: f'),
          passShapeError(shaped('됐다')),
          // 반박이 다음 줄에 오거나(2판 #4) "반론"이라 써도 — 통과인데 REVISE 로 되돌려지던 것
          passShapeError('떨어뜨릴 이유 1: a\n반박: b\n떨어뜨릴 이유 2: c — 반론: d\n떨어뜨릴 이유 3: e\n반박이다: f'),
        ];
        const vi = verdictInstruction('out/x.md', '테라');
        const psWant = /정형문/.test(ps[0]) && /0개/.test(ps[1]) && /반박이 2개/.test(ps[2]) && ps[3] === null && ps[4] === null
          && vi.startsWith('⟦판정 요청⟧ out/x.md') && vi.includes('만든 사람: 테라') && vi.includes('떨어뜨릴 이유 1:') && vi.includes('못 열었다 — 판정 아님');
        out.push(['PASS 모양(점검 3-9 — 떨어뜨릴 이유 셋)', psWant ? '✓ 정형문 되돌림 · 이유 0개 · 반박 2개 되돌림 · 셋+반박이면 통과 · 다음 줄·반론도 반박으로 셈(2판 #4) · 지시문에 모양·만든 사람·못 열면 판정 아님' : '✗ ' + JSON.stringify({ ps, vi: vi.slice(0, 120) })]);
        // out/ 산출물 커밋(나리 09-16) — 100KB 넘는 그림만 .gitignore 표시 블록에(tools/out-ignore.mjs). dev/out/shots 는 안 세고, 그림 아닌 큰 파일은 안 뺀다. 블록은 갈아 끼우고 없으면 끝에.
        const { largeImages, spliceBlock } = await import('../tools/out-ignore.mjs');
        const fakeWalk = function* () { yield ['teams/design/out/a.png', 200_000]; yield ['teams/design/out/b.png', 1_000]; yield ['teams/dev/out/shots/x.png', 900_000]; yield ['teams/dev/out/big.md', 900_000]; yield ['teams/dev/out/c.JPG', 150_000]; };
        const li = largeImages('/x', 100 * 1024, fakeWalk);
        const s1 = spliceBlock('a\nb\n', ['p1']), s2 = spliceBlock(s1, ['p2', 'p3']);
        const liWant = li.join(',') === 'teams/design/out/a.png,teams/dev/out/c.JPG' && s1.includes('\np1\n') && !s2.includes('p1') && s2.includes('p2\np3') && s2.split('>>>').length === 2 && s2.startsWith('a\nb\n');
        out.push(['out/ 큰 그림만 빼기(out-ignore)', liWant ? '✓ 100KB 넘는 그림만 · shots 안 셈 · md 안 뺌 · 대문자 확장자 · 블록 갈아 끼움' : '✗ ' + JSON.stringify({ li, s1, s2 })]);
        out.push(['작은 B · 결정 자리(점검 3-9 · 대표 09-16)', smallWant ? '✓ 작은 B = 톰 혼자 · 보통 B = hq 만 톰+제리, 팀 카드는 톰 혼자(제리 총괄실만, 16:4x) · 위임 중엔 나리 / 나리+제리 · C·푸시 등엔 --small 거부 · --to·--restart 는 --small 됨(톰 배분·나리 지적) · 레코드 small:true' : '✗ ' + JSON.stringify({ nd, ndDg, ndTeam, smallC, smallPush, smallOk, smallToOk, smallRestartOk })]);
      }
      // 자리의 엔진·모델·추론 강도 (결정 69) — 순수 castChangeError 가 거르고, updateCastAgent 가 임시 방 cast.json 에 쓴다. 엔진 바꾸기는 아직 거부(같은 값은 통과).
      {
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        const ag = readCast(T).agents;
        const errs = [
          castChangeError('guide', ag.guide, { llm: 'opus', effort: 'high' }),          // 통과
          castChangeError('guide', ag.guide, { model: 'claude', effort: 'low' }),       // 같은 엔진은 통과
          castChangeError('guide', ag.guide, { model: 'gpt' }),                         // 실무를 codex 로 — 통과 (결정 69 ①)
          castChangeError('outside', ag.outside, { model: 'claude' }),                  // 외부감사를 claude 로 — 거부 (CLAUDE.md)
          castChangeError('guide', ag.guide, { llm: 'gpt-5' }),                         // 목록 밖
          castChangeError('guide', ag.guide, { effort: 'max' }),                        // 목록 밖
          castChangeError('boss', ag.boss, { effort: 'high' }),                         // 사람
          castChangeError('nobody', null, { effort: 'high' }),                          // 없는 자리
          castChangeError('guide', ag.guide, {}),                                       // 빈 패치
          castChangeError('outside', ag.outside, { codexModel: 'gpt-5.1', effort: 'xhigh' }),   // 통과
        ];
        const eWant = errs[0] === null && errs[1] === null && errs[2] === null && errs[3]?.includes('다른 회사 모델') && errs[4]?.includes('claude 모델') && errs[5]?.includes('추론 강도')
          && errs[6]?.includes('사람') && errs[7]?.includes('없습니다') && errs[8]?.includes('바꿀 값') && errs[9] === null;
        const up = updateCastAgent(T, 'guide', { llm: 'opus', effort: 'high', model: 'claude' });
        const again = readCast(T).agents.guide;
        const uWant = up.to.llm === 'opus' && up.to.effort === 'high' && up.to.model === undefined && up.from.llm === null && again.llm === 'opus' && again.effort === 'high' && again.model === 'claude';
        // 실무를 codex 로 바꾸면 cast.json 의 model 이 gpt — 사회자가 outside.mjs --actor guide 로 띄우고, outside.mjs 는 claude 자리로는 뜨지 않는다(아래 exit 2).
        const sw = updateCastAgent(T, 'guide', { model: 'gpt' });
        const swWant = sw.to.model === 'gpt' && sw.from.model === 'claude' && readCast(T).agents.guide.model === 'gpt' && castChangeText('테라', sw.to) === '대표가 테라를 codex 로 바꿨습니다 — 다음 턴부터.';
        updateCastAgent(T, 'guide', { model: 'claude' });
        // gemini — 임시 외부 감사(대표 결정 09-14). 외부감사를 gemini 로는 되고 claude 로는 안 되고, geminiModel 은 목록 안, note 는 'gemini'. isForeign 이 셋 다 가른다.
        const { isForeign, engineName, GEMINI_MODELS, geminiFallbackOf } = await import('./bus.mjs');
        const gErrs = [castChangeError('outside', ag.outside, { model: 'gemini' }), castChangeError('outside', ag.outside, { geminiModel: GEMINI_MODELS[1] }), castChangeError('outside', ag.outside, { geminiModel: 'gemini-9' })];
        const gsw = updateCastAgent(T, 'outside', { model: 'gemini', geminiModel: GEMINI_MODELS[0] });
        // geminiFallback(503 갈아탈 모델, 나리 15:5x) — 목록 안만 통과, 없으면 null(갈아탈 데 없음). 목록은
        // 나리가 agy models 로 실측한 넷(15:53) — 그 밖(예: gemini-9)만 거부.
        const gfErrs = [castChangeError('outside', ag.outside, { geminiFallback: GEMINI_MODELS[1] }), castChangeError('outside', ag.outside, { geminiFallback: 'gemini-9' })];
        const gfWant = gfErrs[0] === null && gfErrs[1]?.includes('gemini 대체 모델') && geminiFallbackOf({ geminiFallback: GEMINI_MODELS[1] }) === GEMINI_MODELS[1] && geminiFallbackOf({}) === null;
        // 503 사다리(나리 15:5x) — flash 는 한 단씩(3.6→3.7→3.8, 3.8 은 끝이라 null) · pro 는 flash 가 아니니 null · 아닌 모델도 null.
        const { geminiFlashUpgradeOf, isGeminiOverload } = await import('./bus.mjs');
        const upWant = geminiFlashUpgradeOf('gemini-3.6-flash') === 'gemini-3.7-flash' && geminiFlashUpgradeOf('gemini-3.7-flash') === 'gemini-3.8-flash'
          && geminiFlashUpgradeOf('gemini-3.8-flash') === null && geminiFlashUpgradeOf('gemini-3.1-pro') === null && geminiFlashUpgradeOf('gemini-9') === null
          && isGeminiOverload(new Error('상주 gemini 503 — UNAVAILABLE')) && isGeminiOverload(new Error('503')) && !isGeminiOverload(new Error('시간 초과'));
        const gWant = gErrs[0] === null && gErrs[1] === null && gErrs[2]?.includes('gemini 모델') && readCast(T).agents.outside.model === 'gemini'
          && castChangeText('레오', gsw.to) === `대표가 레오를 gemini·${GEMINI_MODELS[0]} 로 바꿨습니다 — 다음 턴부터.`
          && isForeign('gpt') && isForeign('gemini') && !isForeign('claude') && !isForeign(null) && engineName('gemini') === 'gemini' && engineName('gpt') === 'codex'
          && gfWant && upWant;
        updateCastAgent(T, 'outside', { model: 'gpt' });
        // 폴백(결정 116 ②) — 자리에 없으면 나머지 다른 회사 엔진, 'none' 은 대표께 올림(null), 클로드 자리는 없음, 목록 밖은 거부.
        const { fallbackOf } = await import('./bus.mjs');
        const fWant = fallbackOf({ model: 'gpt' }) === 'gemini' && fallbackOf({ model: 'gemini' }) === 'gpt' && fallbackOf({ model: 'gpt', fallback: 'none' }) === null
          && fallbackOf({ model: 'claude' }) === null && fallbackOf({ model: 'gpt', fallback: 'gemini' }) === 'gemini'
          && castChangeError('outside', ag.outside, { fallback: 'claude' })?.includes('폴백') && castChangeError('outside', ag.outside, { fallback: 'none' }) === null
          && castChangeText('레오', { fallback: 'gemini' }) === '대표가 레오를 폴백 gemini 로 바꿨습니다 — 다음 턴부터.';
        out.push(['외부 감사 폴백(결정 116 ②)', fWant ? '✓ gpt↔gemini 기본 · none 은 대표께 · 클로드 없음 · claude 폴백 거부 · note' : '✗']);
        // Antigravity CLI(agy) 인자·봉투 — 순수. -p 프롬프트 · json · 모델 · 상한 · 이어붙임은 --conversation · 봉투에서 response·conversation_id · status 가 SUCCESS 아니면 throw.
        const { agyArgs, parseAgy } = await import('./bus.mjs');
        const aa = agyArgs({ prompt: '판정해라', model: 'gemini-3.6-flash', effort: 'high', resume: 'conv_1', timeout: '5m' }).join(' ');
        const ab = agyArgs({ prompt: 'x', model: 'm' }).join(' ');
        const ax = agyArgs({ prompt: 'x', model: 'm', effort: 'xhigh' }).join(' ');
        const pa = parseAgy('{"conversation_id":"conv_9","status":"SUCCESS","response":"PASS\\n됐다","duration_seconds":3}');
        let pErr = null; try { parseAgy('{"status":"ERROR","error":"quota"}'); } catch (e) { pErr = e.message; }
        let pBad = null; try { parseAgy('not json'); } catch (e) { pBad = e.message; }
        const agyWant = aa === '-p 판정해라 --output-format json --model gemini-3.6-flash --print-timeout 5m --effort high --conversation conv_1'
          && ab === '-p x --output-format json --model m --print-timeout 5m --effort medium' && ax.endsWith('--effort high') && !ab.includes('dangerously')
          && pa.answer === 'PASS\n됐다' && pa.sessionId === 'conv_9' && pErr?.includes('ERROR') && pErr?.includes('quota') && pBad?.includes('JSON');
        // agy 권한 합치기(읽기만) — 있던 규칙은 남고 우리 것이 더해지며 중복 없음, write_file(*) 은 deny.
        const { mergePermissions } = await import('../tools/antigravity/agy-permissions.mjs');
        const mp = mergePermissions({ modelProvider: 'gemini', permissions: { allow: ['read_file(*)', 'mcp(x/*)'], deny: ['command(rm -rf)', 'unsandboxed(*)'] } });
        const mpWant = mp.modelProvider === 'gemini' && mp.permissions.allow.filter((x) => x === 'read_file(*)').length === 1 && mp.permissions.allow.includes('mcp(x/*)')
          && mp.permissions.allow.includes('command(cat)') && mp.permissions.deny.includes('write_file(*)') && mp.permissions.deny.includes('command(rm -rf)') && !mp.permissions.allow.some((x) => x.startsWith('write_file'))
          && !mp.permissions.deny.includes('unsandboxed(*)') && ['command(node tools/screen-shot.mjs)', 'command(node tools/library.mjs)', 'command(node --test)', 'command(jq)'].every((x) => mp.permissions.allow.includes(x));   // 나리 실측 09-16 — deny unsandboxed(*) 가 모든 명령을 막았다
        out.push(['agy 권한 합치기(읽기만)', mpWant ? '✓ 있던 것 유지 · 중복 없음 · write_file(*) deny · unsandboxed(*) 는 뺌 · 사진·책장·--test·jq 허용' : '✗ ' + JSON.stringify(mp)]);
        out.push(['Antigravity CLI(agy) 인자·봉투', agyWant ? '✓ -p·json·모델·상한·effort·--conversation · 승인 건너뛰기 없음 · 봉투 response/conversation_id · ERROR·비JSON throw' : '✗ ' + JSON.stringify({ aa, ab, pa, pErr, pBad })]);
        out.push(['gemini 임시 외부 감사(09-14)', gWant ? '✓ outside→gemini 통과 · geminiModel 목록 · note gemini · isForeign 셋 · geminiFallback 목록 안만(15:5x) · flash 사다리 한 단씩·503 감지(15:5x 배선)' : '✗ ' + JSON.stringify({ gErrs, gfErrs, to: gsw.to, upWant })]);
        const txt = castChangeText('테라', up.to), txt2 = castChangeText('안젤', { effort: 'low' });
        const ca = codexArgs({ model: 'gpt-5.1', effort: 'high', resume: 'sid' }), cb = codexArgs({ model: 'gpt-5.1', outPath: '/tmp/o' });
        const cWant = ca.join(' ') === 'exec resume sid --skip-git-repo-check -c model=gpt-5.1 -c sandbox_mode=read-only -c model_reasoning_effort=high -'
          && cb.join(' ') === 'exec --skip-git-repo-check --sandbox read-only -m gpt-5.1 -o /tmp/o -';
        out.push(['자리 엔진·모델·강도(결정 69)', eWant && uWant && swWant && cWant && txt === '대표가 테라를 opus·high 로 바꿨습니다 — 다음 턴부터.' && txt2.startsWith('대표가 안젤을')
          ? '✓ 거르기 10경우(외부감사→claude 만 거부) · cast.json 에 씀(바뀐 값만) · 실무→codex 전환 · note 글 을/를 · codex 인자 resume/새 세션' : '✗ ' + JSON.stringify({ errs, up, sw, txt, ca, cb })]);
      }
      // 나리(system) 는 더 넓은 목록을 고른다(N2, 대표 원문 09-16 "claude 는 fable 까지, gpt 는 astra 까지") — 다른 자리는 그대로.
      {
        const { claudeModelsFor, codexModelsFor } = await import('./bus.mjs');
        const sysFable = castChangeError('system', { model: 'claude' }, { llm: 'fable' });
        const guideFable = castChangeError('guide', { model: 'claude' }, { llm: 'fable' });
        const bossStill = castChangeError('boss', { model: 'claude' }, { llm: 'opus' });
        const n2Want = sysFable === null && claudeModelsFor('system').includes('fable') && !claudeModelsFor('guide').includes('fable')
          && guideFable?.includes('claude 모델은') && bossStill?.includes('사람이라 엔진이 없습니다') && codexModelsFor('system').length >= codexModelsFor('guide').length;
        out.push(['나리(system) 모델 목록이 더 넓음(N2)', n2Want ? '✓ system 은 fable 통과 · 다른 자리는 여전히 거부 · boss 는 여전히 막힘' : '✗ ' + JSON.stringify({ sysFable, guideFable, bossStill })]);
      }
      // codex 자리에 귀로 넣는 말은 방에 note 로 남는다 (레오 FAIL R23 → 대표 "수도꼭지 한 군데만") — session.send 안에서. 대화록에 있어야 codex 가 다음 차례에 읽고,
      // 부른 쪽(알림자·요청 블록·quiet)은 그대로. claude 아닌 사람(boss)은 refused. 임시 방 cast 의 outside 는 gpt — 프로세스는 안 뜬다.
      {
        const { send: sessionSend } = await import('../server/session.mjs');
        startRound(T, { milestone: 2 });
        const before = readLog(T).length;
        const r1 = sessionSend(T, quietText('승인 apr_x 통과 — 톰·제리 PASS'), 'outside');
        const last = readLog(T).at(-1);
        const r2 = sessionSend(T, '아무 말', 'boss');
        const sWant = r1?.noted === last?.id && last?.type === 'note' && last?.meta?.forCodex === 'outside' && last?.text === '레오(codex 자리) 귀에 넣을 말 — 방에 남깁니다: 승인 apr_x 통과 — 톰·제리 PASS'
          && readLog(T).length === before + 1 && r2?.refused;
        out.push(['codex 자리 귀 → 방에 note', sWant ? '✓ note 한 줄(들려주기 표 뗌) · id 돌려줌 · boss 는 refused' : '✗ ' + JSON.stringify({ r1, last: last?.text, r2 })]);
        endRound(T, { summary: '귀 시험 닫음' });
      }
      // 대리 결정 (결정 85) — ④ 돈·바깥은 안 올림(proxyEligible) · 10분 넘은 것만(overdue) · FAIL 을 대리로 풀면 note 에 '대리 결정' · 대리 답 note 는 부름을 답한 것으로.
      {
        const C = (what, extra = {}) => ({ grade: 'C', status: 'pending', what, detail: '', ...extra });
        const el = [
          proxyEligible(C('로드맵 교체')),                                  // 올림
          proxyEligible(C('비용 상한 올리기')),                             // 돈 — 안 올림
          proxyEligible(C('외부 발송 문구 확정')),                          // 바깥 — 안 올림
          proxyEligible(C('본책 병합')),                                    // 병합 — 안 올림
          proxyEligible(C('로드맵', { action: { type: 'send' } })),        // 행동 종류 — 안 올림
          proxyEligible(C('로드맵', { grade: 'B' })),                       // B 는 대리 대상이 아니다(이미 톰·제리)
          proxyEligible(C('로드맵', { status: 'passed' })),                 // 끝난 것
          proxyEligible(C('로드맵 7단계 교체', { detail: '로드맵은 돈·바깥이 아니라 대리 대상 — 비용 상한 아님' })),   // 설명 글(detail)은 안 훑는다 — 올림 (톰 09-15, apr_1bf1b266)
          proxyEligible(C('결제 허용', { detail: '' })),                    // what 에 든 돈 — 안 올림
        ];
        // 위임 스위치(결정 136, 나리 09-15) — delegationActive 순수: until 안이면 { to, until, decision }, 지났거나 없거나 깨졌으면 null. to 기본 system
        const dgNow = Date.parse('2026-09-15T14:00:00Z');
        const dg = [
          delegationActive({ to: 'system', until: '2026-09-16T01:00:00Z', decision: 136 }, dgNow),
          delegationActive({ to: 'system', until: '2026-09-15T13:00:00Z', decision: 136 }, dgNow),   // 지남
          delegationActive({ to: 'system', decision: 136 }, dgNow),                                   // until 없음
          delegationActive(null, dgNow),
          delegationActive({ until: '2026-09-16T01:00:00Z' }, dgNow),
        ];
        const dgOk = dg[0]?.to === 'system' && dg[0]?.decision === 136 && dg[0]?.until === '2026-09-16T01:00:00.000Z' && dg[1] === null && dg[2] === null && dg[3] === null && dg[4]?.to === 'system' && dg[4]?.decision === null;
        const t0 = Date.parse('2026-09-13T10:00:00Z');
        const od = overdue([{ key: 'a', since: new Date(t0 - 11 * 60_000).toISOString() }, { key: 'b', since: new Date(t0 - 9 * 60_000).toISOString() }, { key: 'c', since: null }], { now: t0 }).map((x) => x.key);
        startRound(T, { milestone: 2 });
        recordVerdict(T, { actor: 'outside', verdict: 'FAIL', text: '명백' });
        const un = resumeRound(T, { text: '톰: 근거 봤다 · 제리: 원문과 같다', proxy: ['chief', 'outside'] });
        const unNote = readLog(T).at(-1);
        endRound(T, {});
        const pcast2 = { guide: { name: '테라' }, boss: { name: '댄' } };
        const q0 = new Date(); q0.setHours(11, 0, 0, 0);
        const qat = (m) => new Date(q0.getTime() + m * 60_000).toISOString();
        const qlog = [{ id: 'q1', ts: qat(0), actor: 'system', type: 'round_start', text: '시작' }, { id: 'q2', ts: qat(1), actor: 'guide', type: 'message', text: '대표님, A 와 B 중 골라 주세요.' }];
        const before = peopleOf(qlog, pcast2, { now: q0.getTime() + 20 * 60_000 }).guide.bossCall;
        const after = peopleOf([...qlog, { id: 'q3', ts: qat(12), actor: 'system', type: 'note', text: '대리 결정 — 톰·제리: A', meta: { proxyAnswer: 'q2' } }], pcast2, { now: q0.getTime() + 20 * 60_000 }).guide.bossCall;
        // 물음도 같은 선 — "유료 결제를 허용해 주세요" 는 대리 답 후보가 아니다 (레오 REVISE R23).
        // 자리 이름 "외부 감사" 와 "서버가 돈다" 는 금지어가 아니다 — 헨리 도면 승인(외부 감사 후보 목록)이 밤새 대리에서 빠졌다(하네스 R24).
        const fb = [proxyForbidden('대표님, 유료 결제를 허용해 주세요.'), proxyForbidden('대표님, A 와 B 중 골라 주세요.'), proxyForbidden('대표님, 외부에 보내도 될까요?'),
          proxyForbidden('괄호 후보(비서실 · 팀장/감사/외부 감사/운영 담당) 중 고르실 것'), proxyForbidden('외부감사가 실제로 돌려본다'), proxyForbidden('서버가 돈다, 세션은 산다'),
          // .claude 밑도 대표만(결정 136 원문 셋째 — 제리 REVISE apr_4fb49ab6). 경로 글자가 있을 때만 — "클로드" 나 "훅" 낱말만으론 안 걸린다
          proxyForbidden('대표님, .claude/hooks/to-bus.mjs 한 줄 허용해 주세요.'), proxyForbidden('클로드 세션 훅이 잘 돈다')];
        const xWant = el.join(',') === 'true,false,false,false,false,false,false,true,false' && dgOk && od.join(',') === 'a' && un?.phase === 'running' && unNote?.text?.startsWith('대리 결정(톰·제리)으로 재개')
          && unNote?.meta?.proxy?.length === 2 && before?.id === 'q2' && after === null && fb.join(',') === 'true,false,true,false,false,false,true,false';
        out.push(['대리 결정(결정 85)', xWant ? '✓ 돈·바깥·병합·B·끝난 것 안 올림 · 설명 글은 안 훑음 · 위임 스위치(until 안·지남·없음) · 물음도 같은 선(유료 결제·외부 발송·.claude 제외) · "외부 감사"·"돈다"·"클로드" 는 안 걸림 · 10분 넘은 것만 · FAIL 대리 풀기 note · 대리 답이면 부름 사라짐' : '✗ ' + JSON.stringify({ el, od, un: un?.phase, note: unNote?.text, before, after, fb })]);
      }
      // 상황판 (결정 23) — 옛 모양(issues·left)을 계약 모양으로, 준 항목만 통째로 바뀜, --clear 로 비움, 프롬프트 네 줄, 이 라운드 동안 갱신됐나.
      {
        const old = normalizeProgress({ at: '2026-09-13T01:00:00Z', doing: ['a'], issues: ['막힘 1'], left: ['다음 1'], done: ['한 것'] });
        const m1 = mergeProgress(old, { doing: ['b', ' c '], boss: ['골라 주세요'] }, { by: '테라', round: 9, now: new Date('2026-09-13T02:00:00Z') });
        const m2 = mergeProgress(m1, {}, { clear: ['blocked'], now: new Date('2026-09-13T02:01:00Z') });
        const txt = progressText(m1);
        startRound(T, { milestone: 2 });
        const staleBefore = progressFresh(T);   // 파일 없음 → false
        const w = writeProgress(T, { doing: ['시험'] }, { by: '테라' });
        const freshNow = progressFresh(T) && readProgress(T).round === readState(T).round && w.round === readState(T).round;
        endRound(T, { summary: '상황판 시험 닫음' });
        const pWant = old.blocked[0] === '막힘 1' && old.next[0] === '다음 1'
          && m1.doing.join(',') === 'b,c' && m1.blocked[0] === '막힘 1' && m1.boss[0] === '골라 주세요' && m1.next[0] === '다음 1' && m1.done[0] === '한 것' && m1.by === '테라' && m1.round === 9 && m1.at === '2026-09-13T02:00:00.000Z'
          && m2.blocked.length === 0 && m2.doing.join(',') === 'b,c' && m2.by === '테라'
          && txt === '하는 것: b · c\n막힌 것: 막힘 1\n대표 차례: 골라 주세요\n다음: 다음 1'
          && staleBefore === false && freshNow;
        out.push(['상황판 progress(결정 23)', pWant ? '✓ 옛 모양 읽기 · 준 항목만 바뀜 · clear · 네 줄 글 · 라운드 안 갱신 판별' : '✗ ' + JSON.stringify({ old, m1, m2, txt, staleBefore, freshNow })]);
      }
      // 누가 봤나 · 중단(결정 118) — ① auditorsOf 순수 · rounds.jsonl 행에 auditors/outsideAudited ② endRefusal 이 카드 actor 를 본다: review 만 PASS 면 거부, outside 를 중단(suspended)으로 적으면 닫히되 outsideAudited:false·why 가 박힌다.
      {
        const { auditorsOf } = await import('./bus.mjs');
        const av = auditorsOf([
          { type: 'verdict', actor: 'review', ts: 't1', meta: { verdict: 'REVISE', sha: 'a' } },
          { type: 'verdict', actor: 'review', ts: 't2', meta: { verdict: 'PASS', sha: 'b', engine: 'claude' } },
          { type: 'verdict', actor: 'outside', ts: 't3', meta: { verdict: 'PASS', sha: 'b', engine: 'gemini · x', stale: true } },
          { type: 'message', actor: 'outside', ts: 't4', text: '말' },
        ]);
        const avWant = av.auditors.length === 1 && av.auditors[0].actor === 'review' && av.auditors[0].verdict === 'PASS' && av.auditors[0].sha === 'b' && av.outsideAudited === false
          && auditorsOf([{ type: 'verdict', actor: 'outside', ts: 't', meta: { verdict: 'PASS', sha: 'c', engine: 'codex · gpt-5.1' } }]).outsideAudited === true;
        // 앞의 정식 흐름(라운드 1, 레오 PASS) 행에 박혔나
        const r1 = listRounds(T).find((x) => x.round === 1);
        const rowWant = r1?.outsideAudited === true && r1.auditors?.some((a) => a.actor === 'outside' && a.verdict === 'PASS') && !('outsideWhy' in r1);
        // review 만 PASS → 거부. 중단 적으면 통과, 행에 outsideAudited:false · why 'suspended'
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, review: { name: '검수', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        startRound(T, { milestone: 2, topic: '중단 시험' });
        artifact();
        recordVerdict(T, { actor: 'review', verdict: 'PASS', text: shaped('내부 됐다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['review'], skipped: [], reason: null } });
        const refused = refuses(() => endRound(T, { verdict: 'PASS' }), '외부감사');
        const sus = updateCastAgent(T, 'outside', { suspended: '2026-09-20' });
        const susText = castChangeText('레오', sus.to);
        const bad = castChangeError('guide', readCast(T).agents.guide, { suspended: '2026-09-20' }), badDate = castChangeError('outside', readCast(T).agents.outside, { suspended: '내일' });
        // 닫히는 회차 번호를 먼저 잡는다 — 마일스톤이 다 끝난 PASS 닫힘은 이제 바로 "다음 계획표 대기" 회차를 여니
        // (긴급 수정), endRound 뒤의 readState(T).round 는 그 새 회차 번호지 방금 닫힌 회차가 아니다.
        const roundToClose = readState(T).round;
        let closed = null; try { endRound(T, { verdict: 'PASS' }); closed = listRounds(T).find((x) => x.round === roundToClose); } catch (e) { closed = { err: e.message }; }
        const unsus = updateCastAgent(T, 'outside', { suspended: 'none' });
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        setMilestoneStatus(T, 2, 'wait');
        if (readState(T).phase !== 'idle') endRound(T, { summary: '정리' });   // 위 PASS 닫힘이 연 대기 회차를 치운다
        for (const r of listApprovals({ team: T, status: 'pending' })) voidApproval(r.id, '자가 시험');
        const sWant = refused === '✓ 거부' && susText === '대표가 레오를 중단(2026-09-20 복귀 예정) 로 바꿨습니다 — 다음 턴부터.' && bad?.includes('outside') && badDate?.includes('YYYY')
          && closed?.outsideAudited === false && closed?.outsideWhy === 'suspended' && closed?.auditors?.[0]?.actor === 'review' && closed.verdict === 'PASS'
          && unsus.to.suspended === null && readCast(T).agents.outside?.suspended === undefined;
        out.push(['누가 봤나 · 중단(결정 118)', avWant && rowWant && sWant ? '✓ auditorsOf(stale 제외·자리당 마지막) · R1 행 outsideAudited:true · review 만 PASS 거부 · 중단이면 닫히고 false·suspended · 해제 null' : '✗ ' + JSON.stringify({ avWant, rowWant, refused, susText, bad, badDate, closed })]);
      }
      // 만든 사람이 판정하지 않는다(대표 지시 R25) — 마지막 판정 카드의 자리가 이 라운드에 Edit·Write 를 남겼으면 거부, 다른(안 고친) 자리가 새 PASS 를 내면 스스로 풀린다.
      {
        const { buildersOf } = await import('./bus.mjs');
        const bWant = buildersOf([
          { type: 'tool', actor: 'review', meta: { tool: 'Edit' } },
          { type: 'tool', actor: 'guide', meta: { tool: 'Read' } },
        ]).size === 1;
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, review: { name: '검수', model: 'claude' }, outside: { name: '레오', model: 'claude' }, boss: { name: '댄', model: null } } }));
        startRound(T, { milestone: 2, topic: '자기 판정 시험' });
        artifact();
        emit(T, { actor: 'review', type: 'tool', text: '고침', meta: { tool: 'Edit' } });
        recordVerdict(T, { actor: 'review', verdict: 'PASS', text: shaped('내가 고치고 내가 됐다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['review'], skipped: [], reason: null } });
        const selfRefused = refuses(() => endRound(T, { verdict: 'PASS' }), '만든 사람');
        // 회복 — 안 고친 다른 자리(outside)가 새로 PASS 를 내면 그게 마지막 판정이 되어 중단 없이도 닫힌다
        recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('내가 봤다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['review', 'outside'], skipped: [], reason: null } });
        let closed2 = null; try { endRound(T, { verdict: 'PASS' }); closed2 = true; } catch (e) { closed2 = e.message; }
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        setMilestoneStatus(T, 2, 'wait');
        if (readState(T).phase !== 'idle') endRound(T, { summary: '정리' });   // 위 PASS 닫힘이 연 대기 회차를 치운다
        for (const r of listApprovals({ team: T, status: 'pending' })) voidApproval(r.id, '자가 시험');
        const want = bWant && selfRefused === '✓ 거부' && closed2 === true;
        out.push(['만든 사람이 판정하지 않는다(R25)', want ? '✓ buildersOf(Edit·Write) · review 가 고치고 PASS → 거부 · 안 고친 outside 가 새 PASS → 회복' : '✗ ' + JSON.stringify({ bWant, selfRefused, closed2 })]);
      }
      // 감사 자리(결정 125) — review 없는 방(개발)에서 ops 를 회차 감사로 정하면 카드를 낼 수 있고, 안 정하면 못 낸다. 자기가 고친 파일은 못 본다(파일 단위):
      // 테라 X · 솔라 Y 를 고치고 솔라 PASS(마지막) → 솔라 것을 본 카드가 없어 거부 → 레오 PASS → 닫힘. 같은 파일을 둘이 고치면 거부. 닫히면 auditor 비움.
      {
        const { editsOf, selfPassError, verdictSeats, auditorError } = await import('./bus.mjs');
        const ed = editsOf([
          { type: 'tool', actor: 'guide', text: `${ROOT}/bus/a.mjs`, meta: { tool: 'Edit' } },
          { type: 'tool', actor: 'ops', text: `${ROOT}/.claude/worktrees/w1/server/b.mjs`, meta: { tool: 'Write' } },
          { type: 'tool', actor: 'ops', text: `${ROOT}/bus/a.mjs`, meta: { tool: 'Read' } },
        ]);
        const edWant = ed.get('guide')?.has('bus/a.mjs') && ed.get('ops')?.has('server/b.mjs') && ed.get('ops').size === 1;
        const seatsWant = [...verdictSeats({ guide: {}, ops: {}, outside: {} }, { auditor: 'ops' })].join(',') === 'outside,ops'
          && [...verdictSeats({ guide: {}, review: {}, outside: {} }, { auditor: null })].join(',') === 'outside,review';
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, ops: { name: '솔라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        const badSeat = auditorError(T, 'outside'), badName = auditorError(T, 'review');
        startRound(T, { milestone: 2, topic: '서로 감사 시험' });
        const noSeat = refuses(() => recordVerdict(T, { actor: 'ops', verdict: 'PASS', text: '안 정했는데' }), '감사 자리가 아닙니다');
        const set = setAuditor(T, 'ops');
        const stAud = readState(T).auditor === 'ops' && set.meta?.auditor === 'ops';
        artifact();   // ops 가 out/물건.md 를 씀
        emit(T, { actor: 'guide', type: 'tool', text: '/a/b/app.js', meta: { tool: 'Edit' } });   // 아래 생존 알림 시험이 guide 의 마지막 도구 줄(app.js)을 본다
        emit(T, { actor: 'ops', type: 'tool', text: `${ROOT}/server/y.mjs`, meta: { tool: 'Edit' } });
        recordVerdict(T, { actor: 'ops', verdict: 'PASS', text: shaped('테라 것 봤다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['ops'], skipped: [], reason: null } });
        const unseen = refuses(() => endRound(T, { verdict: 'PASS' }), '외부감사');   // 레오가 외부라 먼저 그 문에 걸린다
        const selfWhy = selfPassError(readLog(T).filter((e) => e.round === readState(T).round), readCast(T).agents);
        recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('둘 다 봤다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['ops', 'outside'], skipped: [], reason: null } });
        // 마일스톤이 다 끝난 PASS 닫힘은 이제 idle 로 안 남고 "다음 계획표 대기" 회차를 바로 연다(긴급 수정) — auditor 는
        // 여전히 비워지고(writeState 가 매 닫음마다), 방은 running 으로 안 죽고 이어진다.
        let closed3 = null; try { endRound(T, { verdict: 'PASS' }); closed3 = readState(T).auditor === null && readState(T).phase === 'running'; } catch (e) { closed3 = e.message; }
        // 같은 파일을 둘이 고치면 — 순수 함수로
        const shared = selfPassError([
          { type: 'tool', actor: 'guide', text: 'bus/z.mjs', meta: { tool: 'Edit' }, ts: 't1' },
          { type: 'tool', actor: 'ops', text: 'bus/z.mjs', meta: { tool: 'Edit' }, ts: 't2' },
          { type: 'verdict', actor: 'ops', ts: 't3', meta: { verdict: 'PASS' } },
        ], { guide: { name: '테라' }, ops: { name: '솔라' } });
        // 안 고친 자리의 PASS 가 A 의 마지막 고침보다 앞이면 안 본 것
        const early = selfPassError([
          { type: 'verdict', actor: 'outside', ts: 't1', meta: { verdict: 'PASS' } },
          { type: 'tool', actor: 'ops', text: 'server/y.mjs', meta: { tool: 'Edit' }, ts: 't2' },
          { type: 'verdict', actor: 'ops', ts: 't3', meta: { verdict: 'PASS' } },
        ], {});
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        setMilestoneStatus(T, 2, 'wait');
        if (readState(T).phase !== 'idle') endRound(T, { summary: '정리' });   // 위 PASS 닫힘이 연 대기 회차를 치운다
        for (const r of listApprovals({ team: T, status: 'pending' })) voidApproval(r.id, '자가 시험');
        const want = edWant && seatsWant && badSeat?.includes('outside') && badName?.includes('명단') && noSeat === '✓ 거부' && stAud && unseen === '✓ 거부'
          && selfWhy?.includes('만든 사람') && closed3 === true && shared?.includes('같은 파일') && shared.includes('bus/z.mjs') && early?.includes('만든 사람');
        out.push(['감사 자리 · 서로 감사(결정 125)', want ? '✓ editsOf(접두 뗌·Read 안 셈) · verdictSeats · outside/명단 밖 거부 · 안 정하면 카드 거부 · auditor ops → 카드 ✓ · 자기 파일은 남이 봐야(먼저 외부 문) · 레오 PASS → 닫힘·auditor 비움 · 같은 파일 거부 · 고치기 전 PASS 는 안 본 것' : '✗ ' + JSON.stringify({ edWant, seatsWant, badSeat, badName, noSeat, stAud, unseen, selfWhy, closed3, shared, early })]);
      }
      // 회차 기다림(O1, 톰 지적 09-16) — "내일 06:30 첫 실물까지 답만" 처럼 회차가 스스로 적으면 그때까지
      // checkStalls ㉢(침묵 20분)이 안 부른다. roundWaitActive 는 순수, setRoundWait·clearRoundWait 는 상태에 남긴다.
      {
        const { roundWaitActive } = await import('./bus.mjs');
        const now2 = Date.now();
        const rwWant = roundWaitActive({ wait: { why: 'x', until: new Date(now2 + 3600_000).toISOString() } }, now2)?.why === 'x'
          && roundWaitActive({ wait: { why: 'x', until: new Date(now2 - 1000).toISOString() } }, now2) === null
          && roundWaitActive({ wait: null }, now2) === null && roundWaitActive({}, now2) === null;
        out.push(['회차 기다림 — 순수(roundWaitActive)', rwWant ? '✓ until 이 미래면 그대로 · 지났거나 없으면 null' : '✗']);
        if (readState(T).phase !== 'idle') endRound(T, { summary: '기다림 시험 전 정리' });
        const noRound = refuses(() => setRoundWait(T, { why: '사유', until: new Date(now2 + 3600_000).toISOString() }), '진행 중인 라운드가 없습니다');
        startRound(T, { milestone: 2, topic: '기다림 시험' });
        const noWhy = refuses(() => setRoundWait(T, { why: '  ', until: new Date(now2 + 3600_000).toISOString() }), '적으세요');
        const badUntil = refuses(() => setRoundWait(T, { why: '사유', until: '내일쯤' }), '시각이 아닙니다');
        const pastUntil = refuses(() => setRoundWait(T, { why: '사유', until: new Date(now2 - 1000).toISOString() }), '이미 지났습니다');
        const set2 = setRoundWait(T, { why: '내일 06:30 첫 실물까지 답만', until: new Date(now2 + 3600_000).toISOString() });
        const setOk = readState(T).wait?.why === '내일 06:30 첫 실물까지 답만' && set2.meta?.wait?.why === '내일 06:30 첫 실물까지 답만' && roundWaitActive(readState(T), now2) !== null;
        const clear2 = clearRoundWait(T);
        const clearOk = readState(T).wait === null && clear2.meta?.wait === null;
        const noWait = refuses(() => clearRoundWait(T), '걸린 기다림이 없습니다');
        // 회차가 새로 열리거나 닫히면 지난 회차의 기다림을 안 물려받는다(auditor 와 같은 선).
        setRoundWait(T, { why: '또 사유', until: new Date(now2 + 3600_000).toISOString() });
        const clearedByEnd = (() => { endRound(T, { summary: '기다림 정리' }); return readState(T).wait === null; })();
        setMilestoneStatus(T, 2, 'wait');
        if (readState(T).phase !== 'idle') endRound(T, { summary: '기다림 시험 뒷정리' });
        const wWant = noRound === '✓ 거부' && noWhy === '✓ 거부' && badUntil === '✓ 거부' && pastUntil === '✓ 거부' && setOk && clearOk && noWait === '✓ 거부' && clearedByEnd;
        out.push(['회차 기다림(O1) — checkStalls ㉢ 건너뜀', wWant
          ? '✓ 회차 없으면 거부 · 빈 사유·이상한 시각·지난 시각 거부 · 정하면 state.wait+note · 거두면 비움 · 없는데 거두면 거부 · 회차 닫히면 비움'
          : '✗ ' + JSON.stringify({ noRound, noWhy, badUntil, pastUntil, setOk, clearOk, noWait, clearedByEnd })]);
      }
      // 계획표 다 끝난 뒤 연 "다음 계획표 대기" 회차를 또 PASS 로 닫아도 "N 통과"가 두 번 안 뜬다(2판 #9) —
      // setMilestoneStatus 가 이미 pass 인 마일스톤에도 true 를 돌려줘 endRound 가 milestonePassed 를 또
      // 세던 것을, 닫기 전에 이미 pass 인지 먼저 보고 막았다.
      {
        fs.writeFileSync(paths(T).cast, JSON.stringify({ agents: { guide: { name: '테라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '댄', model: null } } }));
        const milestoneEvts = () => readLog(T).filter((e) => e.type === 'milestone' && e.meta?.index === 2).length;
        const count0 = milestoneEvts();   // T 의 대화록은 이 check 실행 내내 쌓인다 — 절대 수가 아니라 이 블록이 늘린 만큼만 본다
        setMilestoneStatus(T, 2, 'now');   // 남은 건 2뿐인 계획표를 흉내
        startRound(T, { milestone: 2, topic: '9번 시험' });
        artifact();
        recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('됐다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['outside'], skipped: [], reason: null } });
        endRound(T, { verdict: 'PASS' });   // 마일스톤 2 pass — 다른 마일스톤이 없어 "다음 계획표 대기" 회차가 열린다
        const count1 = milestoneEvts() - count0;
        // 방금 연 대기 회차를 또 PASS 로 닫는다 — 판정 카드가 있어야 하니 하나 더
        artifact('물건2.md');
        recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: shaped('또 됐다') });
        emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass', steps: ['outside'], skipped: [], reason: null } });
        endRound(T, { verdict: 'PASS' });
        const count2 = milestoneEvts() - count0;
        setMilestoneStatus(T, 2, 'wait');
        if (readState(T).phase !== 'idle') endRound(T, { summary: '정리' });
        for (const r of listApprovals({ team: T, status: 'pending' })) voidApproval(r.id, '자가 시험');
        out.push(['대기 회차 PASS 닫기 — N 통과 두 번 안 뜸(2판 #9)', count1 === 1 && count2 === 1
          ? '✓ 첫 PASS 만 마일스톤 통과로 세고, 대기 회차를 또 PASS 로 닫아도 안 늘어남'
          : `✗ count1=${count1} count2=${count2}`]);
      }
      // codex 가 도는 중 표시 — outside.mjs 가 두고 지우는 파일. 내 pid 로 두면 참, 지우면 null, 죽은 pid 는 무시(SIGKILL 로 못 지운 표시).
      {
        markOutsideRunning(T, 'outside');
        const on = outsideRunning(T, 'outside');
        clearOutsideRunning(T, 'outside');
        const off = outsideRunning(T, 'outside');
        markOutsideRunning(T, 'outside', 2 ** 22 - 7);   // 있을 리 없는 pid
        const dead = outsideRunning(T, 'outside');
        clearOutsideRunning(T, 'outside');
        out.push(['codex 도는 중 표시', on?.pid === process.pid && on.since && off === null && dead === null ? '✓ 내 pid 참 · 지우면 null · 죽은 pid 무시' : '✗ ' + JSON.stringify({ on, off, dead })]);
      }
      // 알림 목록 (결정 68) — 요약·승인에서 종류 순(대표 차례→승인→막힘→보고), 같은 종류는 최근 것부터, 보고는 ask 아닌 것만, C·B 승인(B 는 톰·제리 차례),
      // out/ 그림이 있으면 썸네일, 읽음 집합에 있으면 unread:false. 숫자·빨강은 대표 손이 필요한 것(mine)만 — 보고·B 는 패널에만(나리 결정 ② 09-15).
      {
        const { notificationsOf } = await import('../server/public/notify.js');
        const nTeams = [{ id: 'dev', name: '개발', room: '개발실' }, { id: 'design', name: '디자인', room: '디자인실' }];
        const nSum = {
          dev: { cast: { guide: { name: '테라' } }, bossCall: { id: 'e1', ts: '2026-09-13T10:00:00Z', by: 'guide', forbidden: false }, people: { guide: { bossCall: { id: 'e1', ts: '2026-09-13T10:00:00Z', text: '대표님, A 와 B 중 골라 주세요.' } } },
            bossNotes: [{ id: 'e1', ts: '2026-09-13T10:00:00Z', by: 'guide', text: '대표님, A 와 B 중 골라 주세요.', ask: true }, { id: 'e0', ts: '2026-09-13T09:00:00Z', by: 'guide', text: '대표님, 그림 올렸습니다 out/shots/a.png.', ask: false }] },
          design: { cast: { guide: { name: '헨리' } }, needsBoss: true, needsBossWhy: 'blocked', lastSpokeAt: '2026-09-13T08:00:00Z',
            bossNotes: [{ id: 'e5', ts: '2026-09-13T09:30:00Z', by: 'guide', text: '대표님, 시안 냈습니다.', ask: false }] },
        };
        const nApr = [{ id: 'apr_1', grade: 'C', team: 'design', by: 'guide', what: '로드맵 교체', ts: '2026-09-13T07:00:00Z', proxyable: true }, { id: 'apr_2', grade: 'B', team: 'dev', by: 'guide', what: '푸시', ts: '2026-09-13T07:30:00Z', proxyable: false }];
        const n1 = notificationsOf({ teams: nTeams, summaries: nSum, approvals: nApr });
        const order = n1.items.map((it) => it.id).join(',');
        const n2 = notificationsOf({ teams: nTeams, summaries: nSum, approvals: nApr }, { read: new Set(['boss:e1', 'approval:apr_1', 'blocked:design']) });
        // B 카드는 원문째가 아니라 "톰·제리가 보는 중 N건" 한 줄로 접힘(나리 usability-0916 U3·U4), 대표 몫 C 는 무엇 · 언제까지(10분 안 / 대표님만).
        const nWant = order === 'boss:e1,approval:theirs,approval:apr_1,blocked:design,report:e5,report:e0' && n1.unread === 3 && n1.urgent
          && n1.items[5].thumb === '/out/dev/shots/a.png' && n1.items[4].thumb === null && n1.items[0].name === '테라' && n1.items[3].text.includes('멈춤')
          && n1.items[1].text === '톰·제리가 보는 중 1건' && n1.items[2].text === '로드맵 교체 · 10분 안' && n1.items.map((i) => +i.mine).join('') === '101100'
          && n2.unread === 0 && !n2.urgent && n2.items.filter((i) => i.unread).length === 3;
        out.push(['알림 목록(결정 68 · 나리 ② · U3·U4)', nWant ? '✓ 종류 순 6건 · B 는 "톰·제리가 보는 중 1건" 한 줄 · C 는 무엇 · 10분 안 · ask 제외 · 썸네일 · 숫자는 mine 셋 · 읽음 뒤 0·urgent 꺼짐(안 읽은 보고·접힌 줄 셋은 숫자 밖)' : '✗ ' + JSON.stringify({ order, unread: n1.unread, urgent: n1.urgent, texts: n1.items.map((i) => i.text), mine: n1.items.map((i) => i.mine), n2: [n2.unread, n2.urgent] })]);
        // 위임 중(결정 136)엔 돈·바깥만 대표 손 — 대리 가능한 C·물음·FAIL 은 숫자 밖. until 지나면 평소대로. 돈 C(proxyable:false)·돈 물음(forbidden) 은 위임 중에도 센다.
        const dgOn = { to: 'system', until: '2026-09-16T01:00:00Z', decision: 136 }, dgNow = Date.parse('2026-09-15T14:00:00Z');
        const dApr = [...nApr, { id: 'apr_3', grade: 'C', team: 'dev', by: 'guide', what: '유료 결제 허용', ts: '2026-09-13T08:00:00Z', proxyable: false }];
        const dSum = { ...nSum, design: { ...nSum.design, bossCall: { id: 'e9', ts: '2026-09-13T10:30:00Z', by: 'guide', forbidden: true }, people: { guide: { bossCall: { id: 'e9', ts: '2026-09-13T10:30:00Z', text: '대표님, 크레딧 사도 될까요?' } } } } };
        const d1 = notificationsOf({ teams: nTeams, summaries: dSum, approvals: dApr }, { delegation: dgOn, now: dgNow });
        const d2 = notificationsOf({ teams: nTeams, summaries: dSum, approvals: dApr }, { delegation: dgOn, now: Date.parse('2026-09-16T02:00:00Z') });
        const d3 = notificationsOf({ teams: nTeams, summaries: dSum, approvals: dApr }, { delegation: null, now: dgNow });
        const dMine = d1.items.filter((i) => i.mine).map((i) => i.id).join(',');
        out.push(['위임 중 종은 돈·바깥만(나리 ②)', dMine === 'boss:e9,approval:apr_3' && d1.unread === 2 && d1.urgent && d2.unread === 5 && d3.unread === 5 ? '✓ 위임 중 mine = 돈 물음·돈 C 둘 · until 지나면 다섯 · 위임 없으면 다섯' : '✗ ' + JSON.stringify({ dMine, d1: d1.unread, d2: d2.unread, d3: d3.unread })]);
        // 총괄실에서 부른 말이 그 방에도 남아(crossPost) 같은 알림이 둘로 뜨던 것(하네스 실측 R23 ①) — 같은 사람의 같은 글은 한 줄, 방은 "개발·총괄".
        const xTeams = [...nTeams, { id: 'hq', name: '총괄', room: '총괄실' }];
        const xSum = { ...nSum, hq: { cast: { chief: { name: '톰' } }, bossNotes: [{ id: 'h1', ts: '2026-09-13T09:40:00Z', by: 'chief', text: '대표님, 블록 한 바퀴 돌았습니다.', ask: false }] },
          dev: { ...nSum.dev, cast: { ...nSum.dev.cast, chief: { name: '톰' } }, bossNotes: [...nSum.dev.bossNotes, { id: 'h1x', ts: '2026-09-13T09:40:01Z', by: 'chief', text: '대표님, 블록 한 바퀴 돌았습니다.', ask: false }] } };
        const n3 = notificationsOf({ teams: xTeams, summaries: xSum, approvals: [] });
        const dup = n3.items.filter((it) => it.by === 'chief');
        out.push(['같은 말 두 방 → 알림 하나', dup.length === 1 && dup[0].teamName === '개발·총괄' && n3.items.length === 5 ? '✓ 톰 한 줄 · 개발·총괄' : '✗ ' + JSON.stringify(dup.map((d) => [d.id, d.teamName]))]);
        // 막힌 것 한 목록 (결정 92, M6 준비 — 계약 3절 "막힌 것 — 한 목록"). 여섯 종류가 한 목록에, since 오름차순(오래 기다린 것이 위), waitOn 은 누가 움직여야 풀리나.
        const { blockedOf } = await import('../server/public/notify.js');
        const bNow = new Date('2026-09-13T12:00:00Z').getTime();
        const bSum = { ...nSum, dev: { ...nSum.dev, progress: { at: '2026-09-13T11:00:00Z', blocked: ['디스크 꽉 참'] } } };
        const bReq = [
          { id: 'req_o', status: 'open', from: { team: 'dev', actor: 'guide' }, to: { team: 'design', actor: 'guide' }, what: '첫 화면 넘김', updatedAt: '2026-09-13T06:00:00Z' },
          { id: 'req_d', status: 'done', from: { team: 'dev', actor: 'guide' }, to: { team: 'design', actor: 'guide' }, what: '됐다 뒤', updatedAt: '2026-09-13T06:30:00Z' },
          { id: 'req_a', status: 'acked', from: { team: 'dev', actor: 'guide' }, to: { team: 'design', actor: 'guide' }, what: '받았다 뒤', updatedAt: '2026-09-13T06:40:00Z' },
          { id: 'req_c', status: 'closed', from: { team: 'dev', actor: 'guide' }, to: { team: 'design', actor: 'guide' }, what: '닫힘', updatedAt: '2026-09-13T05:00:00Z' },
        ];
        const b1 = blockedOf({ teams: nTeams, summaries: bSum, approvals: nApr, requests: bReq }, { now: bNow });
        const bOrder = b1.map((it) => it.id).join(',');
        const bWait = b1.map((it) => typeof it.waitOn === 'string' ? it.waitOn : `${it.waitOn.team}/${it.waitOn.actor}`).join(',');
        const bWant = bOrder === 'request:req_o,request:req_d,request:req_a,approval:apr_1,approval:apr_2,blocked:design,boss:e1,board:dev:0'
          && bWait === 'design/guide,dev/guide,chief,boss,chief,boss,boss,dev/guide'
          && b1[0].wait === 6 * 3600_000 && b1[0].text.startsWith('헨리 차례') && b1[6].text.includes('골라 주세요') && b1.every((it) => it.teamName !== undefined);
        out.push(['막힌 것 한 목록(결정 92)', bWant ? '✓ 8건 · since 오름차순 · 닫힌 요청 제외 · waitOn 여섯 가지' : '✗ ' + JSON.stringify({ bOrder, bWait, wait0: b1[0]?.wait, t0: b1[0]?.text })]);
        // 밑바닥 넷 — 잰 값이 없으면 항목 없음 · ok 신선하면 없음 · ok:false 는 down · 시각이 timeout 넘으면 ok 여도 unknown(마지막 성공값 잔존, 레오) · 시각 없으면 unknown.
        const fresh = new Date(bNow - 60_000).toISOString(), old = new Date(bNow - 30 * 60_000).toISOString();
        const b2 = blockedOf({ teams: [], infra: {
          server: { ok: true, at: fresh, timeout: 5 * 60_000 },
          codex: { ok: false, at: fresh, timeout: 5 * 60_000, detail: 'codex 없음' },
          sessions: { ok: true, at: old, timeout: 5 * 60_000 },
          disk: { ok: true, timeout: 5 * 60_000 },
        } }, { now: bNow });
        const bInfra = b2.map((it) => `${it.id}=${it.state}`).join(',');
        const b3 = blockedOf({ teams: [], infra: { server: { ok: true, at: fresh, timeout: 5 * 60_000 } } }, { now: bNow });
        // 헛막힘 셋(나리 실측 R25): 상황판 "(없음)" 줄 · 총괄실(office)에서 대표 부른 것 · 서버가 거른 자리표시(normalizeProgress)
        const bFake = blockedOf({ teams: [{ id: 'hq', name: '총괄', room: '총괄실', kind: 'office' }, { id: 'mk', name: '마케팅', room: '마케팅실' }], summaries: {
          hq: { cast: { chief: { name: '톰' } }, bossCall: { id: 'h1', ts: '2026-09-13T11:00:00Z', by: 'chief' }, people: { chief: { bossCall: { id: 'h1', ts: '2026-09-13T11:00:00Z', text: '대표님, 나리 얘기입니다.' } } } },
          mk: { cast: { guide: { name: '하영' } }, progress: { at: '2026-09-13T11:00:00Z', blocked: ['(없음)', '없음', '—', '없음 — 사람 손 기다림뿐', '(없음 — 사용량으로 전원 멈춤)', '진짜 막힘 하나'] } },
        } }, { now: bNow });
        const fakeOk = bFake.length === 1 && bFake[0].kind === 'board' && bFake[0].text === '진짜 막힘 하나'
          && normalizeProgress({ blocked: ['(없음)', ' ', '막힘'], boss: ['없어요.'] }).blocked.join(',') === '막힘' && normalizeProgress({ boss: ['없어요.'] }).boss.length === 0;
        out.push(['헛막힘 거르기(자리표시·office 부름)', fakeOk ? '✓ (없음)·없음·— 안 셈 · 총괄실 대표 부름 안 셈 · normalizeProgress 도 거름' : '✗ ' + JSON.stringify({ bFake, np: normalizeProgress({ blocked: ['(없음)', '막힘'] }) })]);
        // 경계(레오): 딱 timeout 은 신선 · 1ms 넘으면 unknown · 못 읽는 시각 unknown · 미래 시각은 허용 시차(1분) 안이면 신선, 넘으면 unknown(시계 틀린 기계가 영원히 살아 있지 않게)
        const edge = (at, ok = true) => blockedOf({ teams: [], infra: { server: { ok, at, timeout: 5 * 60_000 } } }, { now: bNow })[0]?.state ?? 'none';
        const bEdge = [edge(new Date(bNow - 5 * 60_000).toISOString()), edge(new Date(bNow - 5 * 60_000 - 1).toISOString()), edge('어제쯤'), edge(new Date(bNow + 30_000).toISOString()), edge(new Date(bNow + 61_000).toISOString()), edge(new Date(bNow + 61_000).toISOString(), false)].join(',');
        out.push(['밑바닥 넷(레오 세 경우 + 경계)', bInfra === 'infra:sessions=unknown,infra:codex=down,infra:disk=unknown' && b3.length === 0 && b2[1].text.includes('codex 없음') && b2[0].text.includes('30분째')
          && bEdge === 'none,unknown,unknown,none,unknown,unknown'
          ? '✓ 신선 ok 없음 · down · 잔존 ok 는 unknown · 시각 없음 unknown · 안 잰 것 없음 · 딱 timeout 신선 · +1ms unknown · 미래 1분 넘으면 unknown' : '✗ ' + JSON.stringify({ bInfra, b3: b3.length, bEdge, t: b2.map((i) => i.text) })]);
        // 재는 쪽(server/infra.mjs) — df 파싱은 순수, probeAll 은 넷 다 { ok, at, timeout, detail } 을 돌려주고 하나가 죽어도(안 듣는 포트) 나머지는 잰다. 잰 값은 blockedOf 에 그대로 들어간다.
        const { parseDf, probeAll, INFRA_KEYS, INFRA_TIMEOUT_MS } = await import('../server/infra.mjs');
        const dfMac = 'Filesystem    1024-blocks      Used Available Capacity iused ifree %iused  Mounted on\n/dev/disk3s5    971350180 850000000   5872640    99% 1234  5678   18%   /System/Volumes/Data\n';
        const dfSp = 'Filesystem 1024-blocks Used Available Capacity Mounted on\nmy disk name 100 50 2048 50% /\n';
        const pr = await probeAll({ port: 1, sessionHealth: () => ({ alive: 2, zombie: 0 }) });   // 포트 1 — 아무도 안 듣는다
        const prOk = INFRA_KEYS.every((k) => pr[k] && typeof pr[k].ok === 'boolean' && pr[k].at && pr[k].timeout === INFRA_TIMEOUT_MS && typeof pr[k].detail === 'string')
          && pr.server.ok === false && pr.sessions.ok === true && pr.sessions.detail === '살아 있음 2 · 좀비 0' && typeof pr.disk.ok === 'boolean';
        const prBlocked = blockedOf({ teams: [], infra: pr }, { now: Date.parse(pr.server.at) + 1000 }).map((i) => i.id);
        out.push(['밑바닥 재기(server/infra.mjs)', parseDf(dfMac) === 5872640 * 1024 && parseDf(dfSp) === 2048 * 1024 && parseDf('') === null && prOk && prBlocked.includes('infra:server')
          ? `✓ df 파싱(맥·공백 이름·빈 것) · 넷 다 at·timeout·detail · 안 듣는 포트는 down · 세션 좋음 · blockedOf 에 그대로(${prBlocked.join(',') || '없음'})` : '✗ ' + JSON.stringify({ df: [parseDf(dfMac), parseDf(dfSp)], pr, prBlocked })]);
      }
      // 생존 알림 문장 (결정 31 ②) — 신호가 최근이면 "아직 작업 중 (N분째, 마지막: …)", 신호도 끊겼으면 그렇게.
      const { aliveNoteText } = await import('../server/session.mjs');
      const now = Date.now();
      const log = readLog(T);
      const fresh = aliveNoteText({ name: '테라', actor: 'guide', turnStartedAt: now - 7 * 60_000, lastSignal: now - 20_000 }, log, now);
      out.push(['생존 알림(신호 있음)', fresh === '테라 아직 작업 중 (7분째, 마지막: app.js 고치는 중)' ? '✓ ' + fresh : '✗ ' + fresh]);
      const dead = aliveNoteText({ name: '테라', actor: 'guide', turnStartedAt: now - 9 * 60_000, lastSignal: now - 6 * 60_000 }, log, now);
      out.push(['생존 알림(신호 없음)', dead.startsWith('테라 6분째 신호 없음') ? '✓ ' + dead : '✗ ' + dead]);
      // 승인 카드가 펼치는 "바뀌는 것" (결정 20-2) — 큐에 안 쓰고 레코드 모양만 넘겨 푼다.
      fs.mkdirSync(paths(T).out, { recursive: true });
      fs.writeFileSync(path.join(paths(T).out, 'rm.json'), JSON.stringify({ destination: '목적지', milestones: [{ n: 1, title: '하나', status: 'now' }], cutList: ['둘'] }));
      const pv = approvalPreview({ team: T, action: { type: 'roadmap', file: 'rm.json' } });
      out.push(['로드맵 카드 미리보기', pv.destination === '목적지' && pv.milestones.length === 1 && pv.cutList[0] === '둘' ? '✓ 목적지·마일스톤 1·컷 1' : '✗ ' + JSON.stringify(pv)]);
      out.push(['로드맵 파일 없음 → error', approvalPreview({ team: T, action: { type: 'roadmap', file: 'none.json' } }).error ? '✓' : '✗']);
      const gitq = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
      const pp = approvalPreview({ team: T, action: { type: 'push', remote: 'origin', branch: gitq(['rev-parse', '--abbrev-ref', 'HEAD']), sha: gitq(['rev-parse', 'HEAD']) } });
      out.push(['푸시 카드 미리보기', !pp.error && Array.isArray(pp.files) && Array.isArray(pp.commits) ? `✓ 기준 ${pp.base} · 커밋 ${pp.count}(제목 ${pp.commits.length}) · 파일 ${pp.files.length}` : '✗ ' + JSON.stringify(pp)]);
      // 산출물 보기 (결정 36) — 글에서 out/… 경로 찾기는 화면과 같은 코드(server/public/outlink.js).
      const { findOutPaths, linkOutPaths } = await import('../server/public/outlink.js');
      const sample = '실물: teams/design/out/kit/concept.png (1920×1080). 내 것은 out/oss-research.md, out/kit/concept.md. '
        + '링크 /out/design/kit/concept.png 와 layout/x.md 와 폴더 out/kit/ 는 아니다. out/설계.md을 열어. 같은 것 out/kit/concept.md.';
      const found = findOutPaths(sample, 'dev');
      const want = 'design:kit/concept.png:image dev:oss-research.md:md dev:kit/concept.md:md dev:설계.md:md';
      const got = found.map((f) => `${f.team}:${f.rel}:${f.kind}`).join(' ');
      out.push(['산출물 경로 찾기', got === want ? `✓ ${found.length}개, 문장 부호·폴더·링크 제외` : `✗ ${got}`]);
      out.push(['산출물 경로 url', found[0].url === '/out/design/kit/concept.png' && found[3].url === '/out/dev/%EC%84%A4%EA%B3%84.md' ? '✓ 팀·인코딩' : `✗ ${found[0].url} ${found[3].url}`]);
      const linked = linkOutPaths('봐 out/a.png.', 'dev', (f) => `[${f.url}|${f.raw}]`);
      out.push(['산출물 경로 링크 치환', linked === '봐 [/out/dev/a.png|out/a.png].' ? '✓ ' + linked : '✗ ' + linked]);
      out.push(['팀 모르면 out/… 은 건너뜀', findOutPaths('out/a.png teams/design/out/b.md', null).map((f) => f.rel).join() === 'b.md' ? '✓' : '✗']);
      // /out/<팀>/<경로> 가 여는 파일 — out/ 밖·숨김·없는 팀은 null.
      const devOut = paths('dev').out;
      const guards = [
        outFile('dev', 'kit/concept.png') === path.join(devOut, 'kit', 'concept.png'),
        outFile('dev', '../cast.json') === null, outFile('dev', 'a/../../cast.json') === null,
        outFile('dev', '.hidden') === null, outFile('dev', 'kit/.env') === null,
        outFile('nope', 'a.md') === null, outFile('../dev', 'a.md') === null, outFile('dev', '') === null,
      ];
      out.push(['/out/ 경로 가드', guards.every(Boolean) ? '✓ out/ 안만, .. · 숨김 · 없는 팀 거부' : `✗ ${guards.map((g) => (g ? 1 : 0)).join('')}`]);
      // 승인 카드의 산출물 — --out 파일 + detail 의 경로, 있으면 크기, 없으면 missing. 실제 팀(design)의 실물로 잰다.
      const arts = approvalArtifacts({ team: 'design', what: '1단계 방향', detail: '그림 teams/design/out/kit/concept.png 와 out/없는파일.md', files: ['kit/concept.md'] });
      const artsGot = arts.map((f) => `${f.rel}:${f.missing ? 'missing' : f.size > 0 ? 'ok' : 'empty'}`).join(' ');
      out.push(['승인 카드 산출물', artsGot === 'kit/concept.md:ok kit/concept.png:ok 없는파일.md:missing' ? '✓ ' + artsGot : '✗ ' + artsGot]);
      // 마을 카드의 "어제 한 줄" (결정 13 · M1 인격 이음) — 일지 맨 위 문단의 첫 문장. 경로의 점·소수점은 안 자르고, 머리(## …)는 뗀다.
      const { journalFirstSentence } = await import('../server/session.mjs');
      fs.mkdirSync(path.join(dir, 'journal'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'journal', 'guide.md'), '## 2026-09-13 · 라운드 18 · 테라\n\n나는 테라, bus/outside.mjs 를 2.6초 만에 고치는 막내다. 오늘은 레오한테 걸렸다.\n\n## 2026-09-12 · 라운드 9 · 테라\n\n옛 문단.\n');
      const fs1 = journalFirstSentence(T, 'guide');
      out.push(['일지 첫 문장', fs1 === '나는 테라, bus/outside.mjs 를 2.6초 만에 고치는 막내다.' ? '✓ ' + fs1 : '✗ ' + fs1]);
      out.push(['일지 없는 자리 → null', journalFirstSentence(T, 'ops') === null ? '✓' : '✗']);
      // 일지 재시도 (M1 인격 이음 · 레오 REVISE R19: 이 경로는 라운드 닫힘에서만 돌아 실측이 없었다). 일부러 한 자리를 첫 번에 실패시킨다.
      // note 는 임시 방 대화록에 진짜로 찍힌다 — 아래에서 읽어 센다. (패스) 는 appendJournal 이 false 라 "못 받음" 이다.
      startRound(T, { topic: '일지', milestone: 2 });
      const calls = {};
      const flaky = async (a) => { calls[a] = (calls[a] ?? 0) + 1; return a === 'outside' ? calls[a] >= 2 : true; };   // outside 는 두 번째에만 답한다
      const jn = (t) => emit(T, { actor: 'system', type: 'note', text: t });
      const r1 = await collectJournals(['guide', 'ops', 'outside'], flaky, { note: jn, nameOf: (a) => ({ guide: '테라', ops: '솔라', outside: '레오' })[a], round: 2 });
      const notes1 = readLog(T).filter((e) => e.type === 'note' && e.text.includes('일지')).map((e) => e.text);
      const want1 = r1.got === 3 && r1.missed.join() === 'outside' && r1.still.length === 0 && calls.outside === 2 && notes1.length === 1 && notes1[0] === '일지를 못 받은 자리: 레오 — 한 번 더 묻습니다.';
      out.push(['일지 1회 실패 → note + 재시도 → 받음', want1 ? `✓ 3편 · 레오 2번 물음 · "${notes1[0]}"` : `✗ got=${r1.got} missed=${r1.missed} still=${r1.still} calls=${JSON.stringify(calls)} notes=${JSON.stringify(notes1)}`]);
      const never = async (a) => a !== 'outside';   // outside 는 두 번 다 (패스)
      const r2 = await collectJournals(['guide', 'outside'], never, { note: jn, nameOf: (a) => ({ guide: '테라', outside: '레오' })[a], round: 2 });
      const notes2 = readLog(T).filter((e) => e.type === 'note' && e.text.includes('일지')).map((e) => e.text).slice(1);
      const want2 = r2.got === 1 && r2.still.join() === 'outside' && notes2.length === 2 && notes2[1] === '두 번 물어도 일지를 못 받았습니다: 레오 — 라운드 2 일지 없이 닫습니다.';
      out.push(['일지 2회 실패 → note 둘 · 없이 닫음', want2 ? `✓ 1편 · "${notes2[1]}"` : `✗ got=${r2.got} still=${r2.still} notes=${JSON.stringify(notes2)}`]);
      out.push(['(패스) 는 일지가 아님', appendJournal(T, 'outside', '(패스)', { round: 2 }) === false && !fs.existsSync(path.join(dir, 'journal', 'outside.md')) ? '✓ appendJournal false · 파일 없음 → outside.mjs exit 3' : '✗']);
      // outside.mjs 를 임시 방으로 부르면 **거부**돼야 한다. 전엔 없는 방을 기본 방(hq)으로 조용히 넘겨서, 이 자리에서 가짜 codex 로
      // 일지 exit 코드를 재던 시험이 제리의 세션 id 를 덮고 제리 일지에 문단을 썼다 (2026-09-13 17:24, 테라). exit 코드 자체는 여기서 못 잰다 —
      // 등록된 방에만 돌고 그 방의 세션·일지가 진짜 바뀐다. `(패스)` → exit 3 은 outside.mjs 의 `return ok ? 0 : 3` 한 줄과 위 appendJournal 시험으로 본다.
      const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppanam-fake-codex-'));
      fs.writeFileSync(path.join(fakeDir, 'codex'), '#!/bin/sh\ncat >/dev/null\nprintf \'(패스)\\n\'\n', { mode: 0o755 });
      const storePath = path.join(ROOT, 'state', 'outside-sessions.json');
      const storeBefore = fs.existsSync(storePath) ? fs.readFileSync(storePath, 'utf8') : null;
      const j1 = spawnSync('node', [path.join(ROOT, 'bus', 'outside.mjs'), '--team', T, '--turn', 'journal'], { cwd: ROOT, env: { ...process.env, PATH: `${fakeDir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 20_000 });
      const storeAfter = fs.existsSync(storePath) ? fs.readFileSync(storePath, 'utf8') : null;
      fs.rmSync(fakeDir, { recursive: true, force: true });
      out.push(['outside.mjs 없는 방 → 거부 · 세션 저장소 그대로', j1.status === 2 && storeBefore === storeAfter && !fs.existsSync(path.join(dir, 'journal', 'outside.md')) ? `✓ exit 2 · ${j1.stderr.trim().split('\n')[0]}` : `✗ exit ${j1.status} · 저장소 ${storeBefore === storeAfter ? '그대로' : '바뀜'} · ${(j1.stdout + j1.stderr).trim().slice(0, 200)}`]);
      // 계정 한도 쿨다운(R25) — 오류 문장에서 "try again at" 을 읽고, 못 읽으면 6시간, 한도 아니면 null. 파일은 지나면 없는 것과 같다. 진짜 파일은 시험 뒤 되돌린다.
      {
        const { parseUsageLimit, setOutsideCooldown, outsideCooldown, clearOutsideCooldown } = await import('./bus.mjs');
        const cdPath = path.join(ROOT, 'state', 'outside-cooldown.json');
        const cdBefore = fs.existsSync(cdPath) ? fs.readFileSync(cdPath, 'utf8') : null;
        const real = '\x1b[1m\x1b[31mERROR:\x1b[0m\x1b[0m You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 20th, 2026 3:38 PM. \x1b[2mtokens used\x1b[0m';
        const cNow = Date.parse('2026-09-14T00:00:00+09:00');
        const p1 = parseUsageLimit(real, cNow), p2 = parseUsageLimit('usage limit reached, please wait', cNow), p3 = parseUsageLimit('ENOENT codex', cNow);
        const untilOk = p1 && new Date(p1.until).getTime() > cNow + 5 * 86_400_000 && new Date(p1.until).getTime() < cNow + 7 * 86_400_000;
        setOutsideCooldown({ until: new Date(cNow - 1000).toISOString(), reason: '지남' });
        const gone = outsideCooldown(cNow);
        setOutsideCooldown({ until: new Date(cNow + 3600_000).toISOString(), reason: '한도', noted: ['dev'] });
        const live = outsideCooldown(cNow);
        clearOutsideCooldown();
        const cleared = outsideCooldown(cNow);
        if (cdBefore != null) fs.writeFileSync(cdPath, cdBefore); else clearOutsideCooldown();
        out.push(['codex 한도 쿨다운(R25)', untilOk && !p1.reason.includes('\x1b') && p2 && new Date(p2.until).getTime() === cNow + 6 * 3600_000 && p3 === null && gone === null && live?.noted?.[0] === 'dev' && cleared === null
          ? `✓ 실제 오류에서 ${p1.until.slice(0, 10)} 읽음 · ANSI 뗌 · 시각 없으면 6시간 · 한도 아니면 null · 지난 파일 null · 산 파일 noted · 지움` : '✗ ' + JSON.stringify({ p1, p2, p3, gone, live, cleared })]);
      }
      // 비용 상한(결정 6 · 8단계 ④) — 침묵 방당 시간당 30 · 마을 하루 60. 장부는 파일(state/budget.json)이라 재시작을 넘긴다. 진짜 파일은 시험 뒤 되돌린다.
      {
        const { capTake, takeLull, takeVillage, lullUsed, villageUsed, clearBudget, CAPS, dayStartSeoul } = await import('./bus.mjs');
        const { takeVillageFor } = await import('../server/session.mjs');
        const bPath = path.join(ROOT, 'state', 'budget.json');
        const bBefore = fs.existsSync(bPath) ? fs.readFileSync(bPath, 'utf8') : null;
        try {
          clearBudget();
          // 순수 — 창 밖은 버리고, cap 미만이면 넣는다
          const c1 = capTake([1, 2, 3], 3, { now: 10, since: 2 });       // 창 안 2개 → 넣음 3
          const c2 = capTake([1, 2, 3], 2, { now: 10, since: 2 });       // 창 안 2개 = cap → 거부
          const cWant = c1.ok && c1.used === 3 && c1.list.join(',') === '2,3,10' && !c2.ok && c2.used === 2 && c2.list.join(',') === '2,3';
          // 침묵 — 방당 시간당. 30 쓰면 31번째 거부, 한 시간 지나면 다시. 다른 방은 따로. 파일에 남는다(재시작 넘김 = 새로 읽어도 같은 수).
          const t0 = Date.parse('2026-09-16T03:00:00Z');
          let lastOk = null; for (let i = 0; i < CAPS.lullPerHour; i++) lastOk = takeLull('_check', t0 + i * 1000);
          const over = takeLull('_check', t0 + 60_000), other = takeLull('_check2', t0 + 60_000), later = takeLull('_check', t0 + 3_600_001);
          const lWant = lastOk?.ok === true && lastOk.used === CAPS.lullPerHour && over.ok === false && over.used === CAPS.lullPerHour && other.ok === true && other.used === 1
            && later.ok === true && lullUsed('_check', t0 + 60_000) === CAPS.lullPerHour && JSON.parse(fs.readFileSync(bPath, 'utf8')).lull._check.length === CAPS.lullPerHour;
          // 마을 — 하루(서울 0시). 60 쓰면 61번째 거부, 날이 바뀌면 다시.
          const d0 = dayStartSeoul(t0) + 3_600_000;
          let vLast = null; for (let i = 0; i < CAPS.villagePerDay; i++) vLast = takeVillage('journal', { team: '_check', actor: 'a' }, d0 + i * 1000);
          const vOver = takeVillage('journal', { team: '_check', actor: 'b' }, d0 + 100_000), vNext = takeVillage('plan', { team: '_check' }, d0 + 86_400_000);
          const vWant = vLast?.ok === true && vLast.used === CAPS.villagePerDay && vOver.ok === false && vNext.ok === true && vNext.used === 1 && villageUsed(d0 + 86_400_000) === 1;
          // 걷기 전에 가르기 — 셋 중 둘째에서 막히면 둘째·셋째 건너뜀, 장부는 두 번만 두드림
          let calls = 0;
          const tv = takeVillageFor(['a', 'b', 'c'], () => { calls += 1; return calls === 1 ? { ok: true, used: 60, cap: 60 } : { ok: false, used: 60, cap: 60 }; });
          const tvWant = tv.allowed.join(',') === 'a' && tv.skipped.join(',') === 'b,c' && calls === 2 && tv.cap.used === 60;
          out.push(['비용 상한(결정 6 · 8단계 ④)', cWant && lWant && vWant && tvWant ? `✓ capTake 창·cap · 침묵 ${CAPS.lullPerHour}/시간 방당(31번째 거부·다른 방 따로·한 시간 뒤 다시·파일에 남음) · 마을 ${CAPS.villagePerDay}/하루(61번째 거부·다음 날 다시) · 일지 걷기 전 가르기(막힌 뒤 전부 건너뜀)` : '✗ ' + JSON.stringify({ c1, c2, lastOk, over, other, later, vLast, vOver, vNext, tv, calls })]);
        } finally {
          if (bBefore != null) fs.writeFileSync(bPath, bBefore); else clearBudget();
        }
      }
      // 토큰 장부 델타(T1) — costUsd 는 세션 시작부터의 누적값. sessionId 가 있는 줄은 세션별로, 없는 줄(엔진이 안 줌)도
      // 자리(team:actor)가 곧 프로세스 하나(N1 이전엔 sessionId 없는 엔진뿐)라 같은 식으로 묶어야 부풀지 않는다
      // (나리 실측 09-16: 총괄 chief 가 sessionId 없이 12.9→14.3→14.6 을 그냥 더해 $214 로 부풀었다).
      {
        const { withCostDeltas } = await import('../server/usage.mjs');
        const noSid = [
          { ts: '2026-09-16T01:00:00Z', team: 'hq', actor: 'chief', sessionId: null, costUsd: 12.9 },
          { ts: '2026-09-16T01:10:00Z', team: 'hq', actor: 'chief', sessionId: null, costUsd: 14.3 },
          { ts: '2026-09-16T01:20:00Z', team: 'hq', actor: 'chief', sessionId: null, costUsd: 14.6 },
          { ts: '2026-09-16T01:05:00Z', team: 'hq', actor: 'secretary', sessionId: null, costUsd: 3.0 },   // 딴 자리는 안 섞인다
        ];
        const dNoSid = withCostDeltas(noSid);
        const noSidWant = Math.abs(dNoSid[0].costDelta - 12.9) < 1e-9 && Math.abs(dNoSid[1].costDelta - 1.4) < 1e-9
          && Math.abs(dNoSid[2].costDelta - 0.3) < 1e-9 && Math.abs(dNoSid[3].costDelta - 3.0) < 1e-9;
        const withSid = [
          { ts: '2026-09-16T02:00:00Z', team: 'dev', actor: 'guide', sessionId: 's1', costUsd: 5 },
          { ts: '2026-09-16T02:10:00Z', team: 'dev', actor: 'guide', sessionId: 's1', costUsd: 6 },
        ];
        const dSid = withCostDeltas(withSid);
        const sidWant = dSid[0].costDelta === 5 && dSid[1].costDelta === 1;
        // 프로세스가 바뀌어(--resume) 누적이 작아지면(2판 코드 점검 #8) — 그 줄부터는 옛 최고값과의 차가
        // 아니라 그 줄 자체가 델타(새 프로세스가 0 부터 다시 세니까), 그다음 줄은 다시 정상 증가분.
        // 옛 코드(Math.max(0, cur-prev))라면 둘째 줄이 0, 셋째 줄도 20 을 다시 넘기 전까진 0 이었다.
        const restart = withCostDeltas([
          { ts: '2026-09-16T03:00:00Z', team: 'hq', actor: 'chief', sessionId: null, costUsd: 20 },
          { ts: '2026-09-16T03:10:00Z', team: 'hq', actor: 'chief', sessionId: null, costUsd: 2 },     // 재시작 — 그 자체가 델타
          { ts: '2026-09-16T03:20:00Z', team: 'hq', actor: 'chief', sessionId: null, costUsd: 5 },     // 새 프로세스에서 정상 증가
        ]);
        const restartWant = restart[0].costDelta === 20 && restart[1].costDelta === 2 && restart[2].costDelta === 3;
        out.push(['토큰 장부 델타(T1 — sessionId 없는 줄)', noSidWant && sidWant && restartWant
          ? '✓ sessionId 없어도 team:actor 로 묶어 델타 · sessionId 있으면 세션별 · 딴 자리 안 섞임 · 재시작은 그 줄 자체가 델타(2판 #8), 그 뒤 정상 증가'
          : '✗ ' + JSON.stringify({ dNoSid, dSid, restart })]);
      }
      // 재시작 실행자(N1 둘째 — 나리 13:2x) — anyBusy 는 순수: claude 세션 상태 목록 + gemini 풀 상태 목록 중 하나라도 busy 면 참.
      {
        const { anyBusy } = await import('../server/executor.mjs');
        const none = anyBusy([{ busy: false }, { busy: false }], [{ busy: false }]);
        const claudeBusy = anyBusy([{ busy: false }, { busy: true }], [{ busy: false }]);
        const geminiBusy = anyBusy([{ busy: false }], [{ busy: true }]);
        const empty = anyBusy([], []);
        out.push(['재시작 — 일하는 세션 있으면 대기(anyBusy)', none === false && claudeBusy === true && geminiBusy === true && empty === false
          ? '✓ 다 조용하면 false · claude 세션 하나라도 busy 면 true · gemini 풀 하나라도 busy 면 true · 빈 방은 false'
          : '✗ ' + JSON.stringify({ none, claudeBusy, geminiBusy, empty })]);
      }
      // 늦게 결재된 옛 착수 요청(2판 코드 점검 #3) — 그사이 방이 마일스톤을 이미 pass 까지 마쳤으면
      // applyAction 이 now 로 되돌리지 않는다. setMilestoneStatus(now) 는 조건 없이 다른 now 를 wait 로
      // 내리니, 지나간 단계를 그대로 밀면 지금 도는 단계가 밀려난다.
      {
        const { applyAction } = await import('../server/notifier.mjs');
        const rmBefore = fs.readFileSync(paths(T).roadmap, 'utf8');
        fs.writeFileSync(paths(T).roadmap, JSON.stringify({ milestones: [{ n: 1, status: 'pass' }, { n: 2, status: 'now' }, { n: 3, status: 'wait' }] }));
        let staleText = null, afterStale = null;
        try { staleText = applyAction({ id: 'apr_stale', team: T, grade: 'B', action: { type: 'milestone', n: 1 } }, {}); }
        finally {
          afterStale = JSON.parse(fs.readFileSync(paths(T).roadmap, 'utf8')).milestones;
          fs.writeFileSync(paths(T).roadmap, rmBefore);
        }
        const m1 = afterStale.find((m) => m.n === 1), m2 = afterStale.find((m) => m.n === 2);
        const staleWant = /이미 지나갔습니다/.test(staleText ?? '') && m1.status === 'pass' && m2.status === 'now';
        out.push(['늦게 결재된 옛 착수 — now 로 안 되돌림(2판 #3)', staleWant
          ? '✓ pass 인 마일스톤은 now 로 안 돌아감 · 지금 도는 단계(now) 도 안 밀림 · note 로 왜인지 남김'
          : '✗ ' + JSON.stringify({ staleText, afterStale })]);
      }
      // claude 자리로 codex 를 띄우면 거부 (결정 69 ① — --actor 는 cast.json 이 gpt 인 자리만). 진짜 방(dev)의 guide 는 claude 다. --dry 라 codex 는 안 뜬다.
      const devGuide = readCast('dev').agents?.guide?.model;
      const j2 = spawnSync('node', [path.join(ROOT, 'bus', 'outside.mjs'), '--team', 'dev', '--actor', 'guide', '--turn', 'called', '--dry'], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });
      out.push(['outside.mjs --actor claude 자리 → 거부', devGuide !== 'claude' ? `— dev guide 가 ${devGuide} 라 시험 안 함` : j2.status === 2 && j2.stderr.includes('codex 자리가 아닙니다') ? `✓ exit 2 · ${j2.stderr.trim().split('\n')[0]}` : `✗ exit ${j2.status} · ${(j2.stdout + j2.stderr).trim().slice(0, 200)}`]);
      endRound(T, { summary: '일지 시험' });

      // M5 — 마을 파일 형식(teams/dev/out/village-file-contract.md 2판). city.json 이 부르는 부품·수정 표가 parts.json 에 있고,
      // parts.json 이 가리키는 glb 가 server/public 에 실제로 있는지. 화면을 안 열고도 "없는 부품을 부른다" 를 잡는다.
      {
        const W = path.join(ROOT, 'server/public/world');
        const bad = [];
        try {
          const city = JSON.parse(fs.readFileSync(path.join(W, 'city.json'), 'utf8'));
          const parts = JSON.parse(fs.readFileSync(path.join(W, 'parts.json'), 'utf8'));
          const map = JSON.parse(fs.readFileSync(path.join(W, 'map.json'), 'utf8'));
          const onDisk = (url) => fs.existsSync(path.join(ROOT, 'server/public', decodeURIComponent(url)));
          for (const [name, p] of Object.entries(parts.parts)) {
            if (!parts.kits[p.kit]) bad.push(`parts.${name}: kit '${p.kit}' 없음`);
            else if (!onDisk(parts.kits[p.kit] + p.file)) bad.push(`parts.${name}: 파일 없음 ${p.file}`);
            if (!Array.isArray(p.size) || p.size.length !== 3) bad.push(`parts.${name}: size 는 [w,h,d]`);
            for (const m of p.mods ?? []) if (!parts.mods[m]) bad.push(`parts.${name}: 수정 표 '${m}' 없음`);
          }
          for (const [id, c] of Object.entries(parts.characters)) {
            if (!onDisk(parts.kits.characters + c.model)) bad.push(`characters.${id}: 파일 없음 ${c.model}`);
            if (c.prop?.kind === 'kenney' && !onDisk(parts.kits.characters + c.prop.file)) bad.push(`characters.${id}: 부착물 없음 ${c.prop.file}`);
          }
          const sc = city.scenes.village;
          for (const b of [...sc.buildings, ...sc.props]) if (!parts.parts[b.part]) bad.push(`city ${b.id ?? b.part}: 부품 '${b.part}' 없음`);
          for (const b of sc.buildings) if (b.id?.startsWith('home.') && !map.places[b.id]) bad.push(`city ${b.id}: map.json 에 그 자리 없음`);
          for (const g of sc.ground) if (!parts.colors[g.kind]) bad.push(`city 바닥 '${g.kind}': colors 에 없음`);
          for (const [team, seats] of Object.entries(map.cast)) for (const seat of seats) if (!parts.characters[`${team}-${seat}`]) bad.push(`characters: ${team}-${seat} 없음`);
          if (!parts.characters.boss) bad.push('characters: boss 없음');
        } catch (e) { bad.push(`읽기 실패: ${e.message}`); }
        out.push(['마을 파일 형식(M5) — city ↔ parts ↔ glb', bad.length ? `✗ ${bad.slice(0, 4).join(' · ')}${bad.length > 4 ? ` (+${bad.length - 4})` : ''}` : '✓ 부품·수정 표·인형 열여섯·집 자리 전부 맞음']);
        // 말풍선 쪼개기(대표 원문 R25 "박스를 여러개로") — server/public/world/speech.js 순수 함수. 문장 끝에서 자르고, 짧은 문장은 붙이고, 긴 문장은 띄어쓰기에서, 조각은 PIECES 까지.
        const { splitSpeech, PIECE, PIECES } = await import('../server/public/world/speech.js');
        const sp1 = splitSpeech('됩니다. 아니 잠깐, 안 되네요. 5분만요.');                                          // 짧은 문장 셋 → 한 조각
        const sp2 = splitSpeech('첫 문장입니다.\n둘째 줄은 따로 뜹니다');                                              // 줄바꿈은 항상 자른다
        const sp3 = splitSpeech('가 '.repeat(70).trim());                                                          // 띄어쓰기만 있는 긴 한 문장 → PIECE 안팎에서 강제로
        const sp4 = splitSpeech('이 문장은 조각 하나를 거의 다 채우는 길이로 써 둔 것입니다 하나. '.repeat(PIECES * 2).trim());   // 둘이면 PIECE 를 넘는 문장 열둘 → PIECES 개, 마지막에 …
        const spBoss = splitSpeech('그리고 추가 기능으로 이제 채팅방에서 너네 썸네일에 마우스로 클릭하면 팝업으로 너네의 프로필이 보이는것 (이미지 업로드하고싶은데 업로드가 채팅에 안되네, 이것도 있어야 내가 이미지 공유하는데), 페이스북 카카오톡 프로필 누르면 이제 나오는 정사각형 카드, 인터넷에 검색하면 샘플 많이 나오잖아. 이것도 추가하고 싶어.');
        const spOk = sp1.length === 1 && sp2.length === 2 && sp2[1] === '둘째 줄은 따로 뜹니다'
          && sp3.every((p) => p.length <= PIECE) && sp3.join(' ') === '가 '.repeat(70).trim()
          && sp4.length === PIECES && sp4[PIECES - 1].endsWith(' …')
          && spBoss.every((p) => p.length <= PIECE + 2) && spBoss.length >= 3 && spBoss.length <= PIECES && splitSpeech('') .length === 0;
        // 단계 띠(대시보드, 헨리 시안 1판 · 결정 128) — plansOf 순수. 지난 것 없음, 대표 timebox 는 gated, 막힘은 blocked.
        // 시각 예측(예정 끝·늦음·회차 평균)은 결정 188 뒤로 뺐다 — 옛 계산은 커밋 로그에.
        const pRoad = { milestones: [
          { n: 5, title: '지난', status: 'pass', timebox: '1 라운드' }, { n: 6, title: '지금', status: 'now', timebox: '2 라운드' },
          { n: 7, title: '다음', status: 'wait', timebox: '반 라운드' }, { n: 8, title: '대표 뒤', status: 'wait', timebox: '대표 방향 뒤 정함' }, { n: 9, title: '그 뒤', status: 'wait', timebox: '1 라운드' } ] };
        const p1 = plansOf({ roadmap: pRoad, state: { phase: 'running', round: 25, milestone: 6 } });
        const p2 = plansOf({ roadmap: pRoad, state: { phase: 'blocked', round: 25, milestone: 6 }, progress: { blocked: ['디스크 꽉 참'] } });
        const p3 = plansOf({ roadmap: { milestones: [] }, state: { phase: 'idle' } });
        const s1 = p1.stages;
        const plansOk = s1.length === 4 && s1.map((s) => s.status).join(',') === 'running,planned,gated,planned'
          && s1[2].gate === '대표 방향 뒤 정함' && p2.stages[0].status === 'blocked' && p2.stages[0].blockedWhy === '디스크 꽉 참'
          && p3.stages.length === 0 && timeboxRounds('대표가 방식을 고른 뒤 2 라운드') === null;
        // 문은 열렸으면 문이 아니다(나리 실측 09-15 23:10 — 경영 2단계가 착수됐는데 '대표가 정한 뒤'): status now 면 timebox 에 '대표' 가 있어도 running · timebox 없는 wait 는 planned · '대표' 글자 있는 wait 만 gated
        const p4 = plansOf({ roadmap: { milestones: [{ n: 2, title: '틀', status: 'now', timebox: '대표가 방식을 고른 뒤 2 라운드' }, { n: 3, title: '매뉴얼', status: 'wait' }, { n: 4, title: '문', status: 'wait', timebox: '대표 방향 뒤' }] }, state: { phase: 'running', round: 3, milestone: 1 } });
        const p4Ok = p4.stages.map((s) => s.status).join(',') === 'running,planned,gated' && p4.stages[0].gate === null
          && p4.stages[1].gate === null && p4.stages[2].gate === '대표 방향 뒤';
        const p5 = plansOf({ roadmap: { milestones: [{ n: 2, title: '틀', status: 'now' }] }, state: { phase: 'running', round: 3, milestone: 2 } });
        const p5Ok = p5.stages[0].status === 'running';   // timebox 없는 지금 단계도 문이 아니다
        // '팀별 단계' 절 — 서버가 roadmap 에서 만들어 plan-table.md 의 그 절만 바꿔 끼운다(톰 09-14). 위·아래 절은 그대로.
        // 예정 칸은 결정 188 뒤로 뺐다(지금 단계는 정의상 gate 가 없어 늘 빈 칸이 됐다) · 점선은 gateWhat("대표님이 정한 뒤") · 빈 줄은 계획표 파일 유무로 말 둘(T7)
        const tbl = stageTable([{ id: 'dev', name: '개발', room: '개발 작전실', ...p1 }, { id: 'hq', name: '총괄', room: '총괄실', hasRoadmap: false, ...p3 }, { id: 'finance', name: '경영', room: '경영 방', hasRoadmap: true, ...p3 }]);
        const md = '# 표\n\n## 대표님이 물으신 것\n\n| a |\n| --- |\n| 1 |\n\n## 팀별 단계\n\n| 옛 | 표 |\n| --- | --- |\n| 손 | 글 |\n\n## 대표님 손에 있는 것\n\n| b |\n| --- |\n| 2 |\n';
        const swapped = swapSection(md, '팀별 단계', tbl);
        const swapped2 = swapSection('# 표\n\n## 대표님이 물으신 것\n\n| a |\n', '팀별 단계', tbl);
        const tblOk = tbl.includes('| 개발 작전실 | 6단계 지금 | 하는 중 | 7단계 다음 → 8단계 대표 뒤 — 대표님이 정한 뒤 → 9단계 그 뒤 |')
          && tbl.includes('| 총괄실 |  | 단계 없음 | 계획표 아직 없어요 |') && tbl.includes('| 경영 방 |  | 단계 없음 | 다음 단계 아직 없어요 |')
          && !swapped.includes('| 손 | 글 |') && swapped.includes('| 1 |') && swapped.includes('| 2 |') && swapped.indexOf('## 팀별 단계') < swapped.indexOf('## 대표님 손에') && swapped.includes(tbl)
          && swapped2.endsWith(tbl + '\n') && swapped2.includes('| a |');
        out.push(['팀별 단계 절(stageTable·swapSection)', tblOk ? '✓ roadmap 에서 표 · 가운데 절만 바꿔 끼움 · 위·아래 그대로 · 절 없으면 끝에' : '✗ ' + JSON.stringify({ tbl, swapped, swapped2 })]);
        // 멈춘 구간(state/pauses.json, 톰 09-15 "대표가 멈추라 한 시간은 빼라") — pausedMs 순수 · blockedOf 의 wait(지난 사실이라 결정 188 대상 아님, B 목록)
        const { blockedOf: blockedOf2 } = await import('../server/public/notify.js');
        const pz = [{ from: '2026-09-14T04:00:00Z', to: '2026-09-15T12:00:00Z' }];   // 32시간
        const pmOk = pausedMs('2026-09-14T00:00:00Z', '2026-09-15T13:00:00Z', pz) === 32 * 3600_000 && pausedMs('2026-09-14T05:00:00Z', '2026-09-14T06:00:00Z', pz) === 3600_000
          && pausedMs('2026-09-13T00:00:00Z', '2026-09-14T04:00:00Z', pz) === 0 && pausedMs('x', 1, pz) === 0;
        const pNow2 = Date.parse('2026-09-15T13:00:00Z');   // 멈춤 뒤 한 시간
        const pauseOk = pmOk
          && blockedOf2({ teams: [{ id: 'dev', name: '개발', room: '개발실' }], summaries: { dev: { cast: {}, progress: { at: '2026-09-14T03:00:00Z', blocked: ['진짜'] } } } }, { now: pNow2, pauses: pz })[0].wait === (34 - 32) * 3600_000;
        out.push(['멈춘 시간 빼기(pausedMs)', pauseOk ? '✓ 겹친 만큼만 · 기다림 34h→2h(blockedOf)' : '✗ ' + JSON.stringify({ pmOk })]);
        out.push(['단계 띠(plansOf)', plansOk && p4Ok && p5Ok ? '✓ 지난 것 없음 · 반 라운드 · 대표 timebox 는 gated · 막힘 blocked · 빈 계획표 · 착수된 단계는 문이 아님' : '✗ ' + JSON.stringify({ plansOk, p4Ok, p5Ok, p4: p4.stages, p5: p5.stages })]);
        // 하영 화면 글 틀 1판 5절 T1~T9(req_9cd62767) — 계약·계산 어긋남. 순수한 부분만 여기서. T2(예정 끝 계산)·T3(회차 평균)는 결정 188 뒤로 걷었다.
        const { gateWhatOf, ownersOf, ROUND_MIN_MS, ROUND_MAX_MS } = await import('./bus.mjs');
        const { clockWord, dayWord, timeWord, spanWord } = await import('../server/public/when.js');
        const t3Ok = ROUND_MIN_MS === 60_000 && ROUND_MAX_MS === 7 * 86_400_000;
        // T4·T5 조건이 붙은 timebox 는 셀 수 없어 점선 — 대표면 "대표님이 정한 뒤"(대표님이 여실 단계 카드), 아니면 "{무엇} 뒤"(카드엔 안 옴). 착수된 단계는 그대로 센다
        const t4 = plansOf({ roadmap: { milestones: [{ n: 4, title: '틀', status: 'now', timebox: '2 라운드' }, { n: 5, title: '붙이기', status: 'wait', timebox: '1 라운드 — 테라 붙인 뒤' }, { n: 6, title: '문', status: 'wait', timebox: '대표 방향 뒤 정함' }] }, state: { phase: 'running', round: 3, milestone: 4 } });
        const t4now = plansOf({ roadmap: { milestones: [{ n: 5, title: '붙이기', status: 'now', timebox: '1 라운드 — 테라 붙인 뒤' }] }, state: { phase: 'running', round: 4, milestone: 5 } });
        const t4Ok = t4.stages.map((s) => s.status).join(',') === 'running,gated,gated' && t4.stages[1].gateWhat === '테라 붙인 뒤' && t4.stages[1].gateBoss === false && t4.stages[1].gate === '1 라운드 — 테라 붙인 뒤'
          && t4.stages[2].gateWhat === '대표님이 정한 뒤' && t4.stages[2].gateBoss === true && t4.stages[0].gateWhat === null
          && t4now.stages[0].status === 'running'
          && gateWhatOf('대표가 방식을 고른 뒤 2 라운드') === '대표님이 정한 뒤' && gateWhatOf('반 라운드 — 디자인 시안 온 뒤') === '디자인 시안 온 뒤' && timeboxRounds('1 라운드 — 테라 붙인 뒤') === null && timeboxRounds('2 라운드') === 2;
        // T6 담당 점 둘 — cast 에서 다른 회사·대표·안내 뺀 둘, 팀장 먼저
        const t6cast = { agents: { guide: { name: '유진', initial: '유', color: '#6f9a4a', model: 'claude' }, review: { name: '노라', initial: '노', color: '#a8541f', model: 'claude' }, outside: { name: '빅터', model: 'codex' }, boss: { name: '댄', model: null }, system: { name: '나리', model: null } } };
        const t6 = ownersOf(t6cast, { owner: 'guide' }), t6b = ownersOf({ agents: { chief: { name: '톰', initial: '톰', color: '#1f5f4f', model: 'claude' }, outside: { name: '제리', model: 'gemini' }, secretary: { name: '세라', initial: '세', color: '#2f6f8f', model: 'claude' } } }, { owner: 'chief' });
        const t6Ok = t6.map((o) => o.initial).join('') === '유노' && t6[0].color === '#6f9a4a' && t6b.map((o) => o.name).join('·') === '톰·세라' && ownersOf(null).length === 0;
        // T8 막힌 이유 기본 글 · T9 때 글자(새벽 0~5 · 아침 6~9 · 낮 10~16 · 저녁 17~19 · 밤 20~23) · 날(오늘·내일·모레·N일·N월 N일) · 길이 — when.js 는 타임라인 말고도 쓰여 그대로 시험
        const t8 = plansOf({ roadmap: { milestones: [{ n: 6, title: '지금', status: 'now', timebox: '1 라운드' }] }, state: { phase: 'blocked', round: 25, milestone: 6 } });
        const tn = Date.parse('2026-09-15T13:35:00Z');   // 우리 시각 09-15 밤 22:35
        const t9Ok = clockWord('2026-09-15T23:41:00Z') === '아침 8:41' && clockWord('2026-09-15T16:05:00Z') === '새벽 1:05' && clockWord('2026-09-15T03:13:00Z') === '낮 12:13' && clockWord('2026-09-15T09:00:00Z') === '저녁 18:00' && clockWord('2026-09-15T11:00:00Z') === '밤 20:00' && clockWord('x') === ''
          && dayWord(tn, tn) === '오늘' && dayWord('2026-09-15T16:05:00Z', tn) === '내일' && dayWord('2026-09-17T00:00:00Z', tn) === '모레' && dayWord('2026-09-20T03:00:00Z', tn) === '20일' && dayWord('2026-10-02T16:00:00Z', tn) === '10월 3일'
          && timeWord('2026-09-15T16:05:00Z', tn) === '내일 새벽 1:05' && timeWord('2026-09-15T13:20:48Z', tn) === '밤 22:20' && spanWord(82 * 60_000 + 29_000) === '1시간 22분' && spanWord(40 * 60_000) === '40분' && spanWord(0) === '0분' && spanWord(50 * 3600_000) === '2일 2시간';
        const framesOk = t3Ok && t4Ok && t6Ok && t8.stages[0].blockedWhy === '검토에서 멈춤 — 대표님 판단 기다림' && t9Ok;
        out.push(['화면 글 틀 T1~T9(plansOf·when.js)', framesOk ? '✓ 회차 길이 범위 상수 · "… 뒤" 는 점선(대표만 카드) · 담당 둘 · 막힘 기본 글 · 때 글자(다른 화면이 아직 씀)' : '✗ ' + JSON.stringify({ t3Ok, t4Ok, t4: t4.stages, t6Ok, t6, t6b, t8: t8.stages[0].blockedWhy, t9Ok })]);
        // 비서실 규칙(결정 132, 계약 0절) — roomRules·allowedIn 순수. 실제 teams.json 의 sera 가 그 규칙을 갖는지도 본다.
        const sr = roomRules('sera'), hr = roomRules('hq'), dr = roomRules('dev');
        const rulesOk = sr.owner === 'secretary' && hr.owner === 'chief' && dr.owner === 'guide' && !hr.speakers && !dr.only
          && allowedIn(sr, { actor: 'boss', type: 'message' }) && allowedIn(sr, { actor: 'secretary', type: 'message' })
          && allowedIn(sr, { actor: 'system', type: 'message' })   // 나리 — 대표 초대(09-14). 말은 남고
          && !allowedIn(sr, { actor: 'secretary', type: 'tool' }) && !allowedIn(sr, { actor: 'system', type: 'note' }) && !allowedIn(sr, { actor: 'chief', type: 'message' })
          && allowedIn(hr, { actor: 'system', type: 'note' }) && allowedIn(dr, { actor: 'guide', type: 'tool' });
        // 상주 gemini 스트림 파서(결정 122) — 실측 줄(나리 R25): 알맹이가 사건 이름 밑에 한 겹(result.result.response). 첫 실측이 그래서 빈 답이었다. 평평한 모양도 같이.
        const { parseLines } = await import('../server/gemini.mjs');
        const nested = await parseLines([
          '{"event":"init","init":{"conversation_id":"dd6f16b7-0000"}}',
          '{"event":"step_update","step_update":{"state":"RUNNING","text_delta":"4입니다."}}',
          '{"event":"step_update","step_update":{"state":"DONE","text_delta":"\\n"}}',
          '{"event":"result","result":{"conversation_id":"dd6f16b7-0000","status":"SUCCESS","response":"4입니다.\\n","duration_seconds":2.09,"num_turns":1}}',
        ]);
        const flat = await parseLines(['{"event":"init","conversation_id":"c-flat"}', '{"event":"step_update","text_delta":"5"}', '{"event":"result","status":"SUCCESS","response":"5"}']);
        const noResp = await parseLines(['{"event":"step_update","step_update":{"text_delta":"여섯"}}', '{"event":"result","result":{"status":"SUCCESS"}}']);
        const gmErr = await parseLines(['{"event":"result","result":{"status":"ERROR","error":"quota"}}']).then(() => null, (e) => e.message);
        const gmOk = nested.answer === '4입니다.' && nested.sessionId === 'dd6f16b7-0000' && nested.firstMs != null
          && flat.answer === '5' && flat.sessionId === 'c-flat' && noResp.answer === '여섯' && /ERROR.*quota/.test(gmErr ?? '');
        out.push(['상주 gemini 파서(server/gemini.mjs)', gmOk ? '✓ 한 겹 안 result.response · 평평한 모양 · response 없으면 조각 합 · 첫 낱말 시각 · ERROR 는 거부' : '✗ ' + JSON.stringify({ nested, flat, noResp, gmErr })]);
        out.push(['비서실 규칙(결정 132)', rulesOk ? '✓ 주인 세라 · 대표·세라·나리 message 만 · 도구·안내·톰 버림 · 총괄실·작전실은 열린 방' : '✗ ' + JSON.stringify({ sr, hr, dr })]);
        // 세라 재료(결정 98) — briefOf('sera', 'secretary') 가 안 죽고 다섯 팀·승인·요청 세 절을 담는지. 지금 있는 값 그대로(고정 값 안 만듦).
        {
          const { briefOf } = await import('../server/session.mjs');
          let brief = null, err = null;
          try { brief = briefOf('sera', 'secretary'); } catch (e) { err = e.message; }
          const braceOk = !err && typeof brief === 'string'
            && brief.includes('## 다섯 팀 상황') && brief.includes('### 대기 승인') && brief.includes('### 열린 요청 블록')
            && !briefOf('hq', 'chief').includes('## 다섯 팀 상황');   // 총괄실은 안 붙는다 — 세라 방만
          out.push(['세라 재료(결정 98)', braceOk ? '✓ briefOf(sera) 에 다섯 팀·대기 승인·열린 요청 셋 다 · 총괄실엔 안 붙음' : '✗ ' + JSON.stringify({ err, head: brief?.slice(0, 200) })]);
          // 기억 3층(M7) — 세션이 죽었다 살아나도 어제를 잇는 길은 프롬프트 조립 하나(assemblePrompt = 인격 + 확정 조항 + 일지 + 브리프(상황판)).
          // 새 프로세스가 뜰 때마다(spawnFor) 이걸 붙이니, 일지 맨 위 문단의 첫 문장과 상황판 절이 실제로 들어 있는지 지금 있는 개발 실무 값으로 본다.
          const { assemblePrompt, journalOf, journalFirstSentence } = await import('../server/session.mjs');
          let ap = null, apErr = null; try { ap = assemblePrompt('dev', 'guide'); } catch (e) { apErr = e.message; }
          const jf = journalFirstSentence('dev', 'guide'), jt = journalOf('dev', 'guide', 1);
          const memOk = !apErr && typeof ap === 'string' && ap.includes('## 네 일지') && !!jf && ap.includes(jf) && ap.includes('## 상황판 (teams/dev/progress.json')
            && ap.indexOf('## 네 일지') < ap.indexOf('## 상황판') && (jt?.total ?? 0) >= 1;
          out.push(['기억 3층 조립(assemblePrompt)', memOk ? `✓ 새 세션마다 인격 → 확정 조항 → 일지(맨 위 문단 첫 문장 포함, 전체 ${jt?.total}) → 상황판 순으로 붙음 · ${ap.length}자` : '✗ ' + JSON.stringify({ apErr, jf, hasJ: ap?.includes('## 네 일지'), hasP: ap?.includes('## 상황판') })]);
        }
        out.push(['말풍선 쪼개기(speech.js)', spOk ? `✓ 짧은 셋 → 1 · 줄바꿈 2 · 긴 한 문장 ${sp3.length}조각(≤${PIECE}) · 넘치면 ${PIECES}+… · 대표 사진 문장 ${spBoss.length}조각` : '✗ ' + JSON.stringify({ sp1, sp2, sp3: sp3.map((p) => p.length), sp4: sp4.length, spBoss })]);
        // 자정 마감(M7 · 결정 45 ③) — bus/nightly.mjs 순수 셋. 창은 우리 시각 그날(09-15 = UTC 09-14 15:00 ~ 09-15 15:00). 문제는 대표 손이 필요한 것만.
        {
          const { nightlyOf, nightlyHqOf, proxyLinesOf, dayStartOf, dayKeySeoul } = await import('./nightly.mjs');
          const nCast = { guide: { name: '테라', model: 'claude' }, outside: { name: '레오', model: 'gpt' }, boss: { name: '함동혁(댄)' } };
          const nNow = Date.parse('2026-09-15T15:00:00Z');   // 09-16 00:00 KST — 자정
          const nRounds = [{ round: 25, milestone: 6, topic: '화면', verdict: 'PASS', startedAt: '2026-09-14T01:51:00Z', endedAt: '2026-09-15T12:32:00Z' }, { round: 20, milestone: 4, topic: '옛것', verdict: 'PASS', startedAt: '2026-09-13T01:00:00Z', endedAt: '2026-09-13T05:00:00Z' }];
          const nLog = [
            { id: 'e1', ts: '2026-09-15T12:24:00Z', type: 'verdict', actor: 'outside', text: '테라, 봤습니다.', meta: { verdict: 'PASS', target: 'guide', engine: 'gemini' } },
            { id: 'e2', ts: '2026-09-14T12:00:00Z', type: 'verdict', actor: 'outside', text: '어제 것', meta: { verdict: 'REVISE', target: 'guide' } },   // 창 밖
            { id: 'e3', ts: '2026-09-15T13:00:00Z', type: 'verdict', actor: 'outside', text: '늦게 온 것', meta: { verdict: 'PASS', stale: true } },   // stale — 안 셈
            { id: 'e4', ts: '2026-09-15T12:33:00Z', type: 'round_start', actor: 'system', text: '라운드 26 시작' },
            { id: 'e5', ts: '2026-09-15T13:10:00Z', type: 'message', actor: 'guide', text: '솔라, 됐어.\n\n대표님, 유니티로 갈까요 Three 로 갈까요?' },
          ];
          const nApr = [
            { id: 'apr_c1', grade: 'C', what: '방향', team: 'dev', status: 'pending', ts: '2026-09-15T10:00:00Z', decisions: [] },
            // team: 'hq' 로 둔다(대표 09-16 16:4x·결정 183·185 뒤로 팀 카드는 결정 자리 하나면 닫힌다 — 제리는
            // 총괄실 카드만) — 톰 PASS 뒤에도 "제리 차례"로 남는 사례(사람 칸 사라짐)를 보려면 hq 카드가 맞다.
            { id: 'apr_b1', grade: 'B', what: '푸시', team: 'hq', status: 'pending', ts: '2026-09-15T11:00:00Z', decisions: [{ by: 'chief', decision: 'PASS', ts: '2026-09-15T11:05:00Z' }] },
            { id: 'apr_b0', grade: 'B', what: '지난 것', team: 'dev', status: 'passed', ts: '2026-09-13T11:00:00Z', decidedAt: '2026-09-13T12:00:00Z', decisions: [{ by: 'chief', decision: 'PASS', ts: '2026-09-13T11:30:00Z' }, { by: 'outside', decision: 'PASS', ts: '2026-09-13T12:00:00Z' }] },
          ];
          const q = nightlyOf({ team: 'dev', name: '개발', day: '2026-09-15', log: [nLog[0], nLog[3]], rounds: nRounds, approvals: [], progress: { next: ['내일 첫 일'], blocked: [] }, state: { round: 25, phase: 'idle' }, cast: nCast, now: nNow });
          const quietOk = q.problems.length === 0 && q.counts.rounds === 1 && q.counts.verdicts === 1 && q.counts.approvals === 0 && q.counts.blocked === 0
            && q.md.includes('문제 없음') && q.md.includes('- 25 · 화면 (6단계) · PASS · 09-14 10:51 ~ 21:32') && q.md.includes('레오 PASS (gemini) → 테라 — 테라, 봤습니다.') && q.md.includes('- 내일 첫 일') && !q.md.includes('옛것');
          const b = nightlyOf({ team: 'dev', name: '개발', day: '2026-09-15', log: nLog, rounds: nRounds, approvals: nApr, progress: { blocked: ['디스크 꽉 참'], next: [] }, state: { round: 26, milestone: 7, topic: '기억', phase: 'blocked', attempt: 3, startedAt: '2026-09-15T12:33:00Z' }, cast: nCast, now: nNow, delegation: null });   // 위임 없음으로 고정 — 실제 파일에 흔들리지 않게
          // 위임 중(to:system)엔 같은 카드가 "제리 차례" 그대로다 — 톰이 답한 결정 칸을 나리 몫으로 다시 안 센다(같은 칸).
          const bDg = nightlyOf({ team: 'dev', name: '개발', day: '2026-09-15', log: nLog, rounds: nRounds, approvals: nApr, progress: { blocked: [], next: [] }, state: { round: 26, milestone: 7, topic: '기억', phase: 'blocked', attempt: 3, startedAt: '2026-09-15T12:33:00Z' }, cast: nCast, now: nNow, delegation: { to: 'system', until: '2099-01-01T00:00:00Z' } });
          const kinds = b.problems.map((p) => p.kind);
          const blockOk = kinds.join(',') === 'blocked,approval,bossCall' && b.counts.blocked === 5 && b.counts.rounds === 2 && b.counts.verdicts === 1 && b.counts.approvals === 2
            && b.md.includes('문제 3건') && b.md.includes('- 26 · 기억 (7단계) · 아직 열림 · 21:33 ~ (FAIL 로 막힘)') && b.md.includes('FAIL 로 막힘 — 라운드 26') && b.md.includes('승인 [C] apr_c1 방향 — 대표 차례')
            && b.md.includes('테라이 22:10 에 대표를 불렀는데 답이 없음 — "대표님, 유니티로 갈까요 Three 로 갈까요?"') && b.md.includes('apr_b1 [B] 푸시 — 대기 (제리 차례) (톰 PASS)') && b.md.includes('상황판 — 디스크 꽉 참') && !b.md.includes('apr_b0') && !b.md.includes('늦게 온 것')
            && bDg.md.includes('apr_b1 [B] 푸시 — 대기 (제리 차례) (톰 PASS)');
          const a = nightlyOf({ team: 'dev', name: '개발', day: '2026-09-15', log: [...nLog, { id: 'e6', ts: '2026-09-15T13:20:00Z', type: 'message', actor: 'boss', text: '유니티' }], rounds: nRounds, approvals: [], state: { round: 26, phase: 'running', attempt: 0, startedAt: '2026-09-15T12:33:00Z' }, cast: nCast, now: nNow });
          const answeredOk = a.problems.length === 0 && a.md.includes('아직 열림') && !a.md.includes('FAIL');
          const t = nightlyOf({ team: 'dev', name: '개발', day: '2026-09-15', log: [], rounds: [], approvals: [], state: { round: 26, phase: 'running', attempt: 3, startedAt: '2026-09-15T12:33:00Z' }, cast: nCast, now: nNow });
          const attemptsOk = t.problems.length === 1 && t.problems[0].kind === 'attempts';
          const hq = nightlyHqOf({ day: '2026-09-15', teams: [{ team: 'dev', name: '개발', file: 'teams/dev/out/nightly/2026-09-15.md', counts: b.counts, problems: b.problems }, { team: 'design', name: '디자인', file: 'x.md', counts: q.counts, problems: [] }], proxy: ['- 2026-09-15 04:04 · approval · design · 대리'], journal: '나는 톰이다.', now: nNow });
          const hq0 = nightlyHqOf({ day: '2026-09-15', teams: [{ team: 'design', name: '디자인', file: 'x.md', counts: q.counts, problems: [] }], now: nNow, late: true });
          const hqOk = hq.problems.length === 3 && hq.problems[0].name === '개발' && hq.md.includes('문제 3건 — 대표님 손이 필요합니다.') && hq.md.includes('- 개발 — FAIL 로 막힘 — 라운드 26 대표 판단 대기 (teams/dev/out/nightly/2026-09-15.md)')
            && hq.md.includes('- 2026-09-15 04:04 · approval') && hq.md.includes('- 개발 — 라운드 2 · 판정 1 · 승인 2 · 막힌 것 5 → teams/dev/out/nightly/2026-09-15.md') && hq.md.includes('나는 톰이다.')
            && hq0.problems.length === 0 && hq0.md.includes('문제 없음 — 읽고 넘기셔도 됩니다.') && hq0.md.includes('늦게 썼습니다') && hq0.md.includes('없음 — 톰이 답하지 않았습니다') && hq0.md.includes('## 대표님 대신 정한 것\n\n없음');
          const pl = proxyLinesOf('# 머리\n- 2026-09-15 04:04 · a\n- 2026-09-14 02:47 · b\n- 2026-09-15 01:00 · c\n', '2026-09-15');
          const dayOk = dayStartOf('2026-09-15') === Date.parse('2026-09-14T15:00:00Z') && dayKeySeoul(Date.parse('2026-09-14T15:00:00Z')) === '2026-09-15' && dayKeySeoul(Date.parse('2026-09-14T14:59:59Z')) === '2026-09-14' && pl.length === 2 && pl[1].endsWith('· c');
          const nightOk = quietOk && blockOk && answeredOk && attemptsOk && hqOk && dayOk;
          out.push(['자정 마감(nightlyOf·nightlyHqOf)', nightOk ? '✓ 문제 없음 한 장 · 막힘 넷(FAIL·C·호출·B·상황판) 중 문제 셋 · 창 밖·stale 안 셈 · 자정 넘긴 라운드 "아직 열림" · 대표 답하면 호출 빠짐 · 반박 상한 · 총괄 장(문제 합·대리·일지·늦음) · 우리 시각 날짜' : '✗ ' + JSON.stringify({ quietOk, blockOk, answeredOk, attemptsOk, hqOk, dayOk, kinds, qmd: quietOk ? undefined : q.md, bmd: blockOk ? undefined : b.md, hqmd: hqOk ? undefined : hq.md + hq0.md })]);
        }
      }
    } finally {
      // 진짜 큐는 한 줄도 안 늘었어야 한다 — 임시 방의 approvals.jsonl 이 받았다(위 env). 방과 함께 지운다.
      const tmpQ = process.env.PPANAM_APPROVALS_PATH; let tmpLines = 0; try { tmpLines = fs.readFileSync(tmpQ, 'utf8').split('\n').filter(Boolean).length; } catch {}
      out.push(['check 의 요청은 진짜 큐에 안 남음', realQueueSize() === realQ0 && tmpLines > 0 ? `✓ state/approvals.jsonl ${realQ0}바이트 그대로 · 임시 큐 ${tmpLines}줄은 방과 함께 지움` : '✗ ' + JSON.stringify({ before: realQ0, after: realQueueSize(), tmpLines })]);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const [name, r] of out) console.log(`${r.startsWith('✓') ? '✓' : '✗'}  ${name.padEnd(28)} ${r}`);
    process.exit(out.every(([, r]) => r.startsWith('✓')) ? 0 : 1);
  }
  case 'status':
  default: {
    if (o.team) {
      const s = teamSummary(team);
      // 사람별 집계는 대화록에서 나오는 것만 — 세션 상태·일지 첫 문장은 서버(/api/boot)가 얹는다.
      console.log(JSON.stringify({ ...s, people: peopleOf(readLog(team), readCast(team).agents ?? {}) }, null, 2));
      break;
    }
    console.log('팀        라운드  마일스톤   반박    대화록   상태');
    console.log('─'.repeat(62));
    for (const t of listTeams()) {
      const s = teamSummary(t.id);
      const ms = s.milestonesTotal ? `${s.milestonesDone}/${s.milestonesTotal}` : '—';
      const flag = s.needsBoss ? '대표 호출' : s.phase === 'running' ? '진행 중' : '대기';
      console.log(
        `${t.name.padEnd(9)} ${String(s.round || '—').padStart(4)}   ${ms.padStart(6)}   ${s.attempt}/${MAX_ATTEMPTS}   ${String(s.logCount).padStart(5)}   ${flag}`,
      );
    }
    break;
  }
}
