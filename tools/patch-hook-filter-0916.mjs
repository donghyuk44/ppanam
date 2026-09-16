#!/usr/bin/env node
// (물러남) 훅 영어 속말 거름줄 패치 — 작은 B apr_df4bc5b8 의 뜻은 솔라 a174940(tools/patch-hook-prose-only-0916.mjs)이 훅에 넣었다.
// 1판(줄째 버리기)은 0ce069e 로 겨냥 줄이 사라졌고, 2판(솔라 비율 규칙 위에 문장만 세기)은 "O1 is wired: …" 처럼 첫 낱말에 숫자 든 영어 문장을
// 통째로 놓쳐(솔라 실측) 낱말 단위만 거르는 a174940 으로 대신했다. 이 스크립트는 아무것도 안 바꾼다 — 돌리면 지금 훅이 그 식을 갖고 있는지만 말한다.
// 표본 시험: node --test teams/dev/out/_hook-filter-check.mjs (6/6, 훅의 식과 글자가 같은지도 잰다)
import fs from 'node:fs';

const p = process.argv[2] || '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');
if (src.includes('const proseText')) { console.log('이미 들어가 있음(a174940) — 아무것도 안 함. 확인: node --test teams/dev/out/_hook-filter-check.mjs'); process.exit(0); }
console.error('훅에 proseText 줄이 없다 — node tools/patch-hook-prose-only-0916.mjs (솔라) 를 관리 창에서 돌린다.');
process.exit(1);
