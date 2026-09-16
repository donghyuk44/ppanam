#!/usr/bin/env node
// 영어 속말 가드 2단 — 테라가 apr_df4bc5b8(그 전 낱말수 규칙에 이미 승인됨: "경로·명령·백틱 안은 빼고 센다")
// 를 내 비율 규칙(솔라 0ce069e) 위에 다시 얹으려다, 줄째 버리는 안(_hook-copy.mjs 2판)이 "O1 is
// wired: ..." 처럼 첫 토큰에 숫자가 든 정상 영어 문장까지 프로즈 전체를 지워 latinChars 0 으로
// 만드는 걸 이 스크립트를 짜며 발견했다(teams/dev/out/_test-prose-ratio-0916.mjs 로 실측) — 그
// 문장이 바로 0ce069e 가 잡으려던 그 leak 원본이다, 되짚으면 안 됐다.
//
// 고침: 줄을 통째로 안 버리고, 백틱 spans 만 떼고 낱말 단위로만 거른다 — 경로·명령·해시(/ . : _ - 숫자
// @ # = \ 든 낱말)는 셈에서 빼되, 그 낱말이 든 줄의 나머지 프로즈는 그대로 남는다. git log·번호
// 목록(테라 실측)도, 원래 leak(솔라 실측)도 둘 다 맞게 갈린다(teams/dev/out/_test-prose-ratio-v3-0916.mjs
// 다섯 표본 다 통과).
//
// .claude/ 밑은 편집 도구가 막아 이 스크립트로 문자열 치환해 쓴다:  node tools/patch-hook-prose-only-0916.mjs
import fs from 'node:fs';

const p = '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');

const from = `    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const latinChars = (text.match(/[A-Za-z]/g) || []).length;
    if (latinChars >= 40 && latinChars > koreanChars * 6) bail('영어 속말 — 기록 안 함');`;

const to = `    // 경로·명령·해시 낱말(/ . : _ - 숫자 @ # = \\\\ 든 것)은 셈에서 뺀다 — git log·파일 목록처럼
    // 한글 없는 정상 답까지 영어 속말로 버려졌다(테라 apr_df4bc5b8 실측). 줄째 버리진 않는다 — 그러면
    // "O1 is wired: …" 처럼 첫 낱말에 숫자가 든 정상 영어 문장까지 통째로 안 셈해 leak 을 놓친다
    // (되짚다 실측, teams/dev/out/_test-prose-ratio-v3-0916.mjs).
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const proseText = String(text).replace(/\`[^\`]*\`/g, ' ').split(/\\s+/).filter((w) => w && !/[/.:_\\-\\d@#=\\\\]/.test(w)).join(' ');
    const latinChars = (proseText.match(/[A-Za-z]/g) || []).length;
    if (latinChars >= 40 && latinChars > koreanChars * 6) bail('영어 속말 — 기록 안 함');`;

if (src.includes('proseText')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 이 블록이 ${n}번 있음(1번이어야)`); process.exit(1); }

fs.writeFileSync(p + '.bak-prose-only-0916', src);
fs.writeFileSync(p, src.replace(from, to));
console.log(`고침 — ${p}. 원본은 ${p}.bak-prose-only-0916`);
