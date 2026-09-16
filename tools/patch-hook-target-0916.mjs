#!/usr/bin/env node
// 훅 판정 기록의 대상 한 줄 고치기 (작은 B apr_132205cc, 나리 PASS · 세라 조건 — 서로 감사 결정 125 의 한 짝).
// 지금 줄(186행): bus.recordVerdict(team, { actor, verdict, text, target: 'guide' }) — 솔라(ops) 것을 판정해도 테라 판정으로 적힌다.
// 고친 줄: 차례에 저장된 요청 첫 줄(124행 writeTurn 의 extra = ⟦판정 요청⟧ 뒷글)에서 '대상: <자리>' 를 읽는다 — bus.verdictInstruction 이 그 첫 줄에
//   ' · 대상: ops' 처럼 자리 id 를 싣는 것이 솔라 몫(버스; writeTurn 서명은 안 바뀐다). 없으면 'guide' — 옛 차례만 위한 것이고, 세라 조건대로
//   round.mjs check 에 '대상 없는 판정 요청 0건' 이 서서 조용히 병이 이어지지 않게 한다. 124행은 그대로(첫 줄 200자를 이미 저장한다).
// .claude/ 밑은 대표·관리 창 손:  node tools/patch-hook-target-0916.mjs   (그 줄이 정확히 한 번일 때만, 원본 .bak-target-0916, 재시작 없음)
import fs from 'node:fs';

const p = process.argv[2] || '.claude/hooks/to-bus.mjs';   // 시험용 사본 경로를 줄 수 있다
const src = fs.readFileSync(p, 'utf8');

const from = "          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: 'guide' }); }";
const to = [
  "          // 대상은 요청 첫 줄의 '대상: <자리>'(bus.verdictInstruction — 작은 B apr_132205cc, 서로 감사 결정 125). 없으면 옛 차례라 guide — check 가 '대상 없는 요청 0건' 을 잰다",
  "          const targetSeat = /대상:\\s*(guide|ops|review|chief|secretary|system)\\b/.exec(turn.extra ?? '')?.[1] ?? 'guide';",
  "          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: targetSeat }); }",
].join('\n');

if (src.includes('const targetSeat')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 그 줄이 ${n}번 있음(1번이어야). 훅이 바뀌었으면 이 스크립트를 다시 맞춘다.`); process.exit(1); }

fs.writeFileSync(p + '.bak-target-0916', src);
const out = src.replace(from, to);
fs.writeFileSync(p, out);
const line = out.split('\n').findIndex((l) => l.includes('const targetSeat')) + 1;
console.log(`고침 — ${p} ${line}행. 원본은 ${p}.bak-target-0916. 값은 버스(bus.verdictInstruction 첫 줄의 '대상: <자리>', 솔라) 커밋 뒤에 들어온다 — 그 전엔 guide 그대로.`);
