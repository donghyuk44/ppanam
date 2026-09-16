#!/usr/bin/env node
// 훅 판정 기록의 대상 한 줄 고치기 (작은 B apr_132205cc, 나리 PASS · 세라 조건 — 서로 감사 결정 125 의 한 짝).
// 지금 줄(186행): bus.recordVerdict(team, { actor, verdict, text, target: 'guide' }) — 솔라(ops) 것을 판정해도 테라 판정으로 적힌다.
// 고친 줄: target: turn.targetSeat ?? 'guide' — 사회자·outside.mjs 가 판정 요청마다 '대상:' 을 싣고 bus.writeTurn 이 targetSeat 로 저장한다(솔라, 버스).
//   ?? 'guide' 는 옛 차례(대상 없는 것)만 위한 것 — 세라 조건대로 round.mjs check 에 '대상 없는 판정 요청 0건' 이 서서 조용히 병이 이어지지 않게 한다.
// .claude/ 밑은 대표·관리 창 손:  node tools/patch-hook-target-0916.mjs   (그 줄이 정확히 한 번일 때만, 원본 .bak-target-0916, 재시작 없음)
import fs from 'node:fs';

const p = process.argv[2] || '.claude/hooks/to-bus.mjs';   // 시험용 사본 경로를 줄 수 있다
const src = fs.readFileSync(p, 'utf8');

const from = "          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: 'guide' }); }";
const to = "          try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: turn.targetSeat ?? 'guide' }); }   // 대상은 차례(writeTurn targetSeat)에서 — 작은 B apr_132205cc, 없으면 옛 차례라 guide";

if (src.includes('turn.targetSeat')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 그 줄이 ${n}번 있음(1번이어야). 훅이 바뀌었으면 이 스크립트를 다시 맞춘다.`); process.exit(1); }

fs.writeFileSync(p + '.bak-target-0916', src);
const out = src.replace(from, to);
fs.writeFileSync(p, out);
const line = out.split('\n').findIndex((l) => l.includes('turn.targetSeat')) + 1;
console.log(`고침 — ${p} ${line}행. 원본은 ${p}.bak-target-0916. 버스 쪽(writeTurn targetSeat · 판정 요청의 '대상:')은 솔라 커밋 뒤에 값이 들어온다.`);
