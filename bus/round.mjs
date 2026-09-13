#!/usr/bin/env node
// 라운드 제어.
//
//   node bus/round.mjs start --topic "가드" -m 1      # 주제는 게이트 이름
//   node bus/round.mjs status                        # 전체 팀 한눈에
//   node bus/round.mjs end -v PASS --summary "1안 확정"
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
  addressees, callsBoss, readLog, approvalPreview, approvalArtifacts, outFile, ROOT, collectJournals, appendJournal,
} from './bus.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const o = { team: null, milestone: null, verdict: null, limit: 20, topic: null, summary: null };
const words = [];

for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') o.team = argv[++i];
  else if (a === '--milestone' || a === '-m') o.milestone = Number(argv[++i]);
  else if (a === '--verdict' || a === '-v') o.verdict = String(argv[++i]).toUpperCase();
  else if (a === '--limit' || a === '-n') o.limit = Number(argv[++i]);
  else if (a === '--topic') o.topic = argv[++i];
  else if (a === '--summary') o.summary = argv[++i];
  else words.push(a);
}

const team = o.team ?? process.env.PPANAM_TEAM ?? defaultTeam();
if (cmd !== 'status' && cmd !== 'check' && !teamExists(team)) {
  console.error(`오류: '${team}' 팀이 없습니다.`);
  process.exit(1);
}
// 플래그가 우선이고, 없으면 남은 단어가 주제(start)·요약(end)이다.
const phrase = words.join(' ').trim() || null;
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
    const r = await viaServer({ team, action: 'end', verdict: o.verdict, summary });
    if (r) {
      if (r.deferred) {
        console.log(`[${team}] 실무 턴이 끝나면 라운드 ${r.round} 이 닫힙니다. 세션 컨텍스트도 그때 비워집니다.`);
      } else if (r.accepted) {
        console.log(`[${team}] 서버가 라운드 ${r.round} 을 닫는 중 — 자리마다 일지 한 문단을 받은 뒤 닫히고 세션 컨텍스트를 비웁니다. 끝나면 방에 note 가 남습니다.`);
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
    } catch (e) {
      console.error('오류: ' + e.message);
      process.exit(1);
    }
    break;
  }
  case 'verdict': {
    // 판정은 사회자가 돌린다 — 내부감사 → 외부감사 순서로 차례를 주고, 첫 줄 PASS/REVISE 를 카드로 남긴다.
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
      recordVerdict(T, { actor: 'outside', verdict: 'REVISE', text: '하나' });
      endRound(T, { summary: '닫고' });
      const s = startRound(T, { milestone: 2 });
      out.push(['반박 횟수를 다음 라운드가 물려받음', s.attempt === 1 ? '✓ 1/3' : `✗ ${s.attempt}`]);
      recordVerdict(T, { actor: 'outside', verdict: 'FAIL', text: '명백' });
      out.push(['FAIL(blocked) 뒤 닫기', refuses(() => endRound(T, {}), '대표가 이 방에 말해')]);
      resumeRound(T, { text: '풀어라' });
      out.push(['대표 재개 → 반박 0 · 닫힘', readState(T).attempt === 0 && (endRound(T, {}), true) ? '✓' : '✗']);
      const guarded = protectedBranch();
      out.push([`원격 기본 브랜치(${guarded ?? '모름'}) 푸시 요청`, guarded ? refuses(() => pushAction(guarded, '0'.repeat(40)), '원격 기본 브랜치') : '✗ origin/HEAD 없음 — git remote set-head origin -a']);
      out.push(['다른 브랜치 푸시 요청', pushAction('feature/x', '0'.repeat(40)).type === 'push' ? '✓ 허용' : '✗']);
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
      endRound(T, { summary: '일지 시험' });
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
      console.log(JSON.stringify(s, null, 2));
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
