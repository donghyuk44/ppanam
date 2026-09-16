#!/usr/bin/env node
// 로밍 자리(나리·세라)가 다른 방에서 불려 집 세션이 답할 때 — 집 대화록(hq·sera)에 남는 진짜 줄에
// 부른 방을 meta.roam 으로 찍는다. 안 그러면 총괄실 화면에 개발 방 대화가 원본 그대로 섞여 보인다
// (대표 12:59 "왜 테라 솔라한테 한 말이 여기서 보여? 버그?"). conductor.callHomeElsewhere 가 이제
// session.sendAndWait 에 extra: team(부른 방) 을 실어 보낸다(server/conductor.mjs, 이미 커밋됨) —
// 훅은 그 turn.extra 를 읽어 kind:'called' 일 때만 단다. .claude/ 밑은 대표 손이라 대표 터미널에서:
//   node tools/patch-hook-roam-0916.mjs
import fs from 'node:fs';

const p = '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');

const from = `    // 이번 턴이 무엇이었나. 판정 요청이었으면 첫 줄이 판정이다 — 모든 엔진이 같은 규약. 일지였으면 대화록에 안 남는다.
    if (ev === 'Stop') {
      const turn = bus.takeTurn(team, actor, hook.session_id);
      if (turn?.kind === 'journal') bail('일지 — 서버가 받는다');
      if (turn?.kind === 'verdict') {
        const v = bus.splitVerdictLine(text);
        if (v) {
          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: bus.verdictTargetActor(team, turn.extra) }); }
          catch (e) { bus.emit(team, { actor, type: 'message', text: \`[\${v.verdict} — 판정으로 세지 않음: \${e.message}] \${trim(v.body)}\` }); }
          process.exit(0);
        }
        // 판정을 요청받고도 첫 줄에 안 썼다. 말로 남기되 표시해 둔다 — 사회자가 한 번 더 묻는다.
        out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true, ...(actor === 'system' ? { hand: 'server' } : {}) } };
        break;
      }
    }

    // 서브에이전트의 마지막 말은 실무에게 돌려주는 보고다. 그가 그동안 bus/say.mjs 로 방에 이미 말했으면
    // 그 보고는 같은 지적의 재요약이라 두 번 뜬다 (마케팅 R14, 2026-09-01). "(패스) 로 끝내라" 는 인격 문장은
    // 잊힌다 — 훅이 정한다: 들어온 뒤 방에 message/verdict 를 남겼으면 최종 보고는 기록하지 않는다.
    if (ev === 'SubagentStop' && enteredAt) {
      if (bus.readLog(team).some((e) => e.actor === actor && (e.type === 'message' || e.type === 'verdict') && e.ts >= enteredAt)) {
        bail('방에 이미 말함 — 최종 보고는 기록하지 않음');
      }
    }
    out = { actor, type: 'message', text: trim(text), meta: actor === 'system' ? { hand: 'server' } : undefined };
    break;`;

const to = `    // 이번 턴이 무엇이었나. 판정 요청이었으면 첫 줄이 판정이다 — 모든 엔진이 같은 규약. 일지였으면 대화록에 안 남는다.
    let turn = null;
    if (ev === 'Stop') {
      turn = bus.takeTurn(team, actor, hook.session_id);
      if (turn?.kind === 'journal') bail('일지 — 서버가 받는다');
      if (turn?.kind === 'verdict') {
        const v = bus.splitVerdictLine(text);
        if (v) {
          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: bus.verdictTargetActor(team, turn.extra) }); }
          catch (e) { bus.emit(team, { actor, type: 'message', text: \`[\${v.verdict} — 판정으로 세지 않음: \${e.message}] \${trim(v.body)}\` }); }
          process.exit(0);
        }
        // 판정을 요청받고도 첫 줄에 안 썼다. 말로 남기되 표시해 둔다 — 사회자가 한 번 더 묻는다.
        out = { actor, type: 'message', text: trim(text), meta: { noVerdict: true, ...(actor === 'system' ? { hand: 'server' } : {}) } };
        break;
      }
    }

    // 서브에이전트의 마지막 말은 실무에게 돌려주는 보고다. 그가 그동안 bus/say.mjs 로 방에 이미 말했으면
    // 그 보고는 같은 지적의 재요약이라 두 번 뜬다 (마케팅 R14, 2026-09-01). "(패스) 로 끝내라" 는 인격 문장은
    // 잊힌다 — 훅이 정한다: 들어온 뒤 방에 message/verdict 를 남겼으면 최종 보고는 기록하지 않는다.
    if (ev === 'SubagentStop' && enteredAt) {
      if (bus.readLog(team).some((e) => e.actor === actor && (e.type === 'message' || e.type === 'verdict') && e.ts >= enteredAt)) {
        bail('방에 이미 말함 — 최종 보고는 기록하지 않음');
      }
    }
    // 로밍 자리(나리·세라)가 다른 방에서 불려 집 세션이 답한 것 — turn.extra 에 부른 방이 실려 있다
    // (server/conductor.mjs callHomeElsewhere). 집 대화록의 이 원본 줄에 어느 방 답인지 찍어 둔다.
    out = { actor, type: 'message', text: trim(text), meta: {
      ...(actor === 'system' ? { hand: 'server' } : {}),
      ...(turn?.kind === 'called' && turn.extra ? { roam: turn.extra } : {}),
    } };
    if (!Object.keys(out.meta).length) out.meta = undefined;
    break;`;

if (src.includes("turn?.kind === 'called' && turn.extra")) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 이 블록이 ${n}번 있음(1번이어야)`); process.exit(1); }

fs.writeFileSync(p + '.bak-roam-0916', src);
fs.writeFileSync(p, src.replace(from, to));
console.log(`고침 — ${p}. 원본은 ${p}.bak-roam-0916`);
