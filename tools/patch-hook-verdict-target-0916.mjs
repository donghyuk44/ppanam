#!/usr/bin/env node
// 훅의 판정 대상(target) 고정 고치기 — 지금은 recordVerdict 에 target: 'guide' 를 항상 박아서,
// 서로 감사(결정 125)로 ops 등 다른 자리가 평가받아도 항상 guide 로 찍힌다(테라 code-review 지적,
// dea1182 근거) — work.json 자동 진행(advanceWorkOnPass)이 엉뚱한 항목을 건드리는 원인이었다.
// bus.verdictTargetActor(team, turn.extra) 가 판정 흐름의 자유 글(예: "솔라 서버 것 봐줘")에서
// 이름이 나온 자리를 찾아 돌려준다(없으면 예전처럼 'guide') — bus/bus.mjs 는 이미 커밋돼 있다.
// .claude/ 밑은 대표 손이라 대표 터미널에서 돌린다:  node tools/patch-hook-verdict-target-0916.mjs
import fs from 'node:fs';

const p = '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');

const from = "try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: 'guide' }); }";
const to = "try { bus.recordVerdict(team, { actor, verdict: v.verdict, text: trim(v.body), target: bus.verdictTargetActor(team, turn.extra) }); }";

if (src.includes('bus.verdictTargetActor(team, turn.extra)')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 이 줄이 ${n}번 있음(1번이어야): ${from}`); process.exit(1); }

fs.writeFileSync(p + '.bak-verdict-target-0916', src);
fs.writeFileSync(p, src.replace(from, to));
console.log(`고침 — ${p}. 원본은 ${p}.bak-verdict-target-0916`);
