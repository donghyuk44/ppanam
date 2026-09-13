#!/usr/bin/env node
// 라운드 제어.
//
//   node bus/round.mjs start --topic "가드" -m 1      # 주제는 게이트 이름
//   node bus/round.mjs status                        # 전체 팀 한눈에
//   node bus/round.mjs end -v PASS --summary "1안 확정"
//   node bus/round.mjs end --next --summary "로드맵 교체" [-m 1 --topic "…"]   # 닫고 그 자리에서 다음 라운드를 연다 (결정 25)
//   node bus/round.mjs log --limit 20
//   node bus/round.mjs check                         # 닫기 가드 자가 시험 (임시 방에서, 기록 안 남음)
//
// 라운드가 끝나도 대화록은 지워지지 않는다. 비워지는 건 AI 컨텍스트뿐이다.
// --topic · --summary 가 없던 때는 그 단어가 주제·요약 본문에 그대로 박혔다 (R11·R12, 2026-09-12).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  startRound, endRound, readState, readTail, readContext, listRounds, recordVerdict, resumeRound,
  listTeams, defaultTeam, teamExists, teamSummary, MAX_ATTEMPTS, emit, paths, readRoadmap, protectedBranch, pushAction,
  addressees, callsBoss, asksBoss, bossNotesOf, readLog, approvalPreview, approvalArtifacts, outFile, ROOT, collectJournals, appendJournal, peopleOf, readCast, workStateOf, pushGateError,
  castChangeError, updateCastAgent, castChangeText, codexArgs, quiet as quietText, markOutsideRunning, clearOutsideRunning, outsideRunning,
  mergeProgress, normalizeProgress, progressText, writeProgress, readProgress, progressFresh, proxyEligible, proxyForbidden, overdue,
} from './bus.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const o = { team: null, milestone: null, verdict: null, limit: 20, topic: null, summary: null, next: false };
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
      const s = startRound(team, { topic, milestone: o.milestone });
      console.log(`[${team}] 라운드 ${s.round} 시작 · 마일스톤 ${s.milestone}${s.topic ? ' — ' + s.topic : ''}${s.attempt ? ` · 반박 ${s.attempt}/${MAX_ATTEMPTS} 물려받음` : ''}`);
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
    const next = o.next ? { milestone: o.milestone, topic: o.topic } : null;
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
      const n = endRound(team, { verdict: o.verdict, summary });
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
    const r = await viaServer({ team, target: phrase }, '/api/verdict');
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
  case 'check': {
    // 닫기 가드 자가 시험. 실제 방을 건드리지 않으려고 임시 방 `_check` 에서 돌리고 지운다.
    // 대표가 정한 통과 시험 넷 (2026-09-13): 카드 없이 PASS → 거부 · REVISE 뒤 PASS → 거부 · 정식 흐름 → 성공 + 로드맵 pass ·
    // 원격 기본 브랜치의 푸시 요청 → 거부. 덧붙여 blocked 는 못 닫음 · 반박 횟수 상속 · 닫힌 방의 판정은 stale.
    const T = '_check';
    const dir = paths(T).dir;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(paths(T).roadmap, JSON.stringify({ milestones: [{ n: 1, title: '시험', status: 'now' }, { n: 2, title: '둘', status: 'wait' }] }));
    const refuses = (fn, want) => { try { fn(); return '✗ 통과됨 (거부돼야 함)'; } catch (e) { return e.message.includes(want) ? '✓ 거부' : `✗ 다른 이유로 거부: ${e.message}`; } };
    const out = [];
    try {
      startRound(T, { topic: '가드', milestone: 1 });
      out.push(['카드 없이 end -v PASS', refuses(() => endRound(T, { verdict: 'PASS' }), '판정 카드가 있어야')]);
      recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '근거 없음' });
      out.push(['REVISE 뒤 end -v PASS', refuses(() => endRound(T, { verdict: 'PASS' }), '마지막 판정이 REVISE')]);
      recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: '됐다' });
      out.push(['PASS 카드만, 완료 note 없이', refuses(() => endRound(T, { verdict: 'PASS' }), '완료 note 가 없습니다')]);
      emit(T, { actor: 'system', type: 'note', text: '판정 완료', meta: { verdictFlow: 'pass' } });
      let ok = false; try { endRound(T, { verdict: 'PASS' }); ok = true; } catch (e) { out.push(['정식 흐름', `✗ ${e.message}`]); }
      if (ok) out.push(['정식 흐름 → 닫힘 + 로드맵 pass', readRoadmap(T).milestones[0].status === 'pass' && readState(T).phase === 'idle' ? '✓' : '✗ 로드맵이 pass 가 아님']);
      out.push(['닫힌 방의 판정 → stale', recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '늦음' }).meta.stale ? '✓' : '✗']);
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
      endRound(T, { summary: '닫고' });
      const s = startRound(T, { milestone: 2 });
      out.push(['반박 횟수를 다음 라운드가 물려받음', s.attempt === 2 ? '✓ 2/3' : `✗ ${s.attempt}`]);
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
        // 실제 카드에 HEAD sha 가 박히고, 그 카드로 문이 열린다.
        startRound(T, { milestone: 2 });
        const card = recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: '봤다' });
        const live = card.meta.sha && /^[0-9a-f]{40}$/.test(card.meta.sha) && pushGateError(readLog(T).filter((e) => e.round === readState(T).round), card.meta.sha) === null
          && pushGateError(readLog(T).filter((e) => e.round === readState(T).round), B)?.includes('다시 감사');
        out.push(['판정 카드에 HEAD sha', live ? `✓ ${card.meta.sha.slice(0, 8)} · 그 sha 로 열림, 다른 sha 거부` : '✗ ' + JSON.stringify(card.meta)]);
        // 감사가 본 sha 를 부르는 쪽이 넘기면 그것이 찍힌다 — 감사 도중 커밋이 들어와도 안 본 HEAD 가 PASS 로 찍히지 않는다 (레오 REVISE, R22).
        const seenCard = recordVerdict(T, { actor: 'outside', verdict: 'PASS', text: '시작 때 본 것', sha: B });
        const ctxNow = readLog(T).filter((e) => e.round === readState(T).round);
        out.push(['카드 sha 는 감사 시작 때 것', seenCard.meta.sha === B && pushGateError(ctxNow, B) === null && pushGateError(ctxNow, card.meta.sha)?.includes('다시 감사') ? '✓ 넘긴 sha 로 찍힘 · 지금 HEAD 는 거부' : '✗ ' + JSON.stringify(seenCard.meta)]);
        endRound(T, { summary: '문 시험 닫음' });
      }
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
      // 물음은 대표에게 한 문단 안에 있어야 한다 (레오 REVISE R23) — 다른 사람 문단의 물음표는 대표 것이 아니고, 이름 없는 문단은 앞 상대에게 이어진다.
      const mixed = asksBoss('대표님, 진행 상황 보고드립니다.\n\n솔라, 이 수치가 맞습니까?', pcast);
      const cont = asksBoss('대표님, 정리했습니다.\n\n둘 중 어느 쪽으로 갈까요?', pcast);
      const back = asksBoss('솔라, 이거 맞아?\n\n대표님, 위 결과 보고드립니다.', pcast);
      out.push(['물음은 대표 문단 안에서만', !mixed && cont && !back ? '✓ 솔라 문단의 물음표는 보고 · 이름 없는 다음 문단은 대표에게 이어짐 · 앞 문단의 물음은 안 섞임' : '✗ ' + JSON.stringify({ mixed, cont, back })]);
      // 대표에게 해 달라는 부탁도 종이다 (결정 66) — 헨리 "zip 받아 풀어 주시면" 이 보고로 빠지면 대표가 못 본다. 단순 보고(올렸습니다·됐습니다)는 그대로.
      const favors = ['대표님, 손 하나 더 빌립니다 — 세 zip 을 받아 ref/kenney/ 에 풀어 주시면 클레멘타인이 목록을 적습니다.', '대표님, 확인 부탁드립니다.',
        '대표님, allow 한 줄 허용해 주세요.', '대표님, 이 명령 실행 한 번만요.', '대표님, 서버 다시 띄워 주세요.'].map((t) => asksBoss(t, pcast));
      const plain = ['대표님, 시안 올렸습니다 — out/screens/seoul.png.', '대표님, 커밋했고 check 46건 됐습니다.', '대표님, 보고드립니다.\n\n클레멘타인, 부품 목록 적어 줘.'].map((t) => asksBoss(t, pcast));
      out.push(['부탁도 종(결정 66)', favors.every(Boolean) && !plain.some(Boolean) ? '✓ 주시면·부탁·허용·실행·주세요 5건 결정 · 올렸습니다·됐습니다·남의 문단 부탁 3건 보고' : '✗ ' + JSON.stringify({ favors, plain })]);
      // 총괄이 옮겨온 대표 말(meta.via) 은 대표 카드에 안 잡힌다 — 결정 원문이 "하는 일" 로 떴다 (시스템 R21).
      const pe3 = peopleOf([...plog, { id: 'e8', ts: at(7), actor: 'boss', type: 'message', text: '47. 공동 프로젝트 (대표 원문)', meta: { via: 'chief' } }], pcast, { now: d0.getTime() + 10 * 60_000 });
      out.push(['옮겨온 대표 말은 대표 카드 밖', pe3.boss.lastText === null && pe3.boss.todaySay === 0 && pe3.guide.bossCall === null ? '✓ 카드 비고 · 호출은 답한 것으로' : '✗ ' + JSON.stringify(pe3.boss)]);
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
        // 라운드가 닫히면 codex 세션 칸을 비운다 — 외부감사(`방`)와 codex 로 바뀐 자리(`방:자리`, 결정 69 ①) 둘 다. `방` 만 지우면 codex 실무의
        // 세션이 다음 라운드로 이어진다(레오 REVISE R23 · 솔라 "고아 세션"). 진짜 저장소에 _check 칸 둘을 심고 닫은 뒤 없어졌는지 본다.
        const osPath = path.join(ROOT, 'state', 'outside-sessions.json');
        const osBefore = fs.existsSync(osPath) ? fs.readFileSync(osPath, 'utf8') : null;
        const seeded = { ...(osBefore ? JSON.parse(osBefore) : {}), [T]: { id: 'x1', lastSeen: null }, [`${T}:guide`]: { id: 'x2', lastSeen: null }, [`${T}x`]: { id: 'x3', lastSeen: null } };
        fs.mkdirSync(path.dirname(osPath), { recursive: true }); fs.writeFileSync(osPath, JSON.stringify(seeded, null, 2) + '\n');
        endRound(T, { summary: '이어 열기 시험 닫음' });
        const osAfter = JSON.parse(fs.readFileSync(osPath, 'utf8'));
        const swept = !(T in osAfter) && !(`${T}:guide` in osAfter) && (`${T}x` in osAfter);
        delete osAfter[`${T}x`];
        if (osBefore == null) fs.rmSync(osPath, { force: true }); else fs.writeFileSync(osPath, JSON.stringify(osAfter, null, 2) + '\n');
        out.push(['닫히면 codex 칸 비움(방·방:자리)', swept ? '✓ 방 · 방:guide 지움 · 다른 방(방x)은 그대로' : '✗ ' + JSON.stringify(Object.keys(osAfter).filter((k) => k.startsWith(T)))]);
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
        const txt = castChangeText('테라', up.to), txt2 = castChangeText('안젤', { effort: 'low' });
        const ca = codexArgs({ model: 'gpt-5.1', effort: 'high', resume: 'sid' }), cb = codexArgs({ model: 'gpt-5.1', outPath: '/tmp/o' });
        const cWant = ca.join(' ') === 'exec resume sid --skip-git-repo-check -c model=gpt-5.1 -c sandbox_mode=read-only -c model_reasoning_effort=high -'
          && cb.join(' ') === 'exec --skip-git-repo-check --sandbox read-only -m gpt-5.1 -o /tmp/o -';
        out.push(['자리 엔진·모델·강도(결정 69)', eWant && uWant && swWant && cWant && txt === '대표가 테라를 opus·high 로 바꿨습니다 — 다음 턴부터.' && txt2.startsWith('대표가 안젤을')
          ? '✓ 거르기 10경우(외부감사→claude 만 거부) · cast.json 에 씀(바뀐 값만) · 실무→codex 전환 · note 글 을/를 · codex 인자 resume/새 세션' : '✗ ' + JSON.stringify({ errs, up, sw, txt, ca, cb })]);
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
        ];
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
          proxyForbidden('괄호 후보(비서실 · 팀장/감사/외부 감사/운영 담당) 중 고르실 것'), proxyForbidden('외부감사가 실제로 돌려본다'), proxyForbidden('서버가 돈다, 세션은 산다')];
        const xWant = el.join(',') === 'true,false,false,false,false,false,false' && od.join(',') === 'a' && un?.phase === 'running' && unNote?.text?.startsWith('대리 결정(톰·제리)으로 재개')
          && unNote?.meta?.proxy?.length === 2 && before?.id === 'q2' && after === null && fb.join(',') === 'true,false,true,false,false,false';
        out.push(['대리 결정(결정 85)', xWant ? '✓ 돈·바깥·병합·B·끝난 것 안 올림 · 물음도 같은 선(유료 결제·외부 발송 제외) · "외부 감사"·"돈다" 는 안 걸림 · 10분 넘은 것만 · FAIL 대리 풀기 note · 대리 답이면 부름 사라짐' : '✗ ' + JSON.stringify({ el, od, un: un?.phase, note: unNote?.text, before, after, fb })]);
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
      // 알림 목록 (결정 68) — 요약·승인에서 종류 순(대표 차례→승인→막힘→보고), 같은 종류는 최근 것부터, 보고는 ask 아닌 것만, C 승인만,
      // out/ 그림이 있으면 썸네일, 읽음 집합에 있으면 unread:false, 급한 것이 안 읽혔을 때만 urgent.
      {
        const { notificationsOf } = await import('../server/public/notify.js');
        const nTeams = [{ id: 'dev', name: '개발', room: '개발실' }, { id: 'design', name: '디자인', room: '디자인실' }];
        const nSum = {
          dev: { cast: { guide: { name: '테라' } }, bossCall: { id: 'e1', ts: '2026-09-13T10:00:00Z', by: 'guide' }, people: { guide: { bossCall: { id: 'e1', ts: '2026-09-13T10:00:00Z', text: '대표님, A 와 B 중 골라 주세요.' } } },
            bossNotes: [{ id: 'e1', ts: '2026-09-13T10:00:00Z', by: 'guide', text: '대표님, A 와 B 중 골라 주세요.', ask: true }, { id: 'e0', ts: '2026-09-13T09:00:00Z', by: 'guide', text: '대표님, 그림 올렸습니다 out/shots/a.png.', ask: false }] },
          design: { cast: { guide: { name: '헨리' } }, needsBoss: true, needsBossWhy: 'blocked', lastSpokeAt: '2026-09-13T08:00:00Z',
            bossNotes: [{ id: 'e5', ts: '2026-09-13T09:30:00Z', by: 'guide', text: '대표님, 시안 냈습니다.', ask: false }] },
        };
        const nApr = [{ id: 'apr_1', grade: 'C', team: 'design', by: 'guide', what: '로드맵 교체', ts: '2026-09-13T07:00:00Z' }, { id: 'apr_2', grade: 'B', team: 'dev', by: 'guide', what: '푸시', ts: '2026-09-13T07:30:00Z' }];
        const n1 = notificationsOf({ teams: nTeams, summaries: nSum, approvals: nApr });
        const order = n1.items.map((it) => it.id).join(',');
        const n2 = notificationsOf({ teams: nTeams, summaries: nSum, approvals: nApr }, { read: new Set(['boss:e1', 'approval:apr_1', 'blocked:design']) });
        const nWant = order === 'boss:e1,approval:apr_1,blocked:design,report:e5,report:e0' && n1.unread === 5 && n1.urgent
          && n1.items[4].thumb === '/out/dev/shots/a.png' && n1.items[3].thumb === null && n1.items[0].name === '테라' && n1.items[2].text.includes('FAIL')
          && n2.unread === 2 && !n2.urgent;
        out.push(['알림 목록(결정 68)', nWant ? '✓ 종류 순 5건 · B 승인·ask 제외 · 썸네일 · 읽음 뒤 unread 2 · urgent 꺼짐' : '✗ ' + JSON.stringify({ order, unread: n1.unread, urgent: n1.urgent, thumb: n1.items.map((i) => i.thumb), n2: [n2.unread, n2.urgent] })]);
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
        out.push(['밑바닥 넷(레오 세 경우)', bInfra === 'infra:sessions=unknown,infra:codex=down,infra:disk=unknown' && b3.length === 0 && b2[1].text.includes('codex 없음') && b2[0].text.includes('30분째')
          ? '✓ 신선 ok 없음 · down · 잔존 ok 는 unknown · 시각 없음 unknown · 안 잰 것 없음' : '✗ ' + JSON.stringify({ bInfra, b3: b3.length, t: b2.map((i) => i.text) })]);
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
      }
    } finally {
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
