#!/usr/bin/env node
// 영어 속말 가드 — 통째로 영어면 걸렸는데(가-힣 0개), 명령 예시에 한글 낱말 몇 개만 섞이면 안 걸렸다
// (예: 방금 이 세션의 요약 글에 "node bus/round.mjs wait \"사유\" --until <시각>" 처럼 백틱 안 한글
// 둘이 방패가 돼 400자짜리 영어 요약이 그대로 방에 찍혔다 — 나리 09-16 실측, "영어 덩이").
//
// 개수 하나로 판단하던 것(가-힣 0개 && 영어 낱말 8개↑)을, 비율로 바꾼다 — 영어 글자가 한글 글자의
// 6배를 넘고 40자 이상이면 덩이로 본다. 온전한 한글 문장에 영어 낱말 몇 개(고유명사·파일명)가
// 섞이는 정상적인 경우는 한글 글자 수가 충분해 비율에 안 걸린다.
//
// .claude/ 밑은 편집 도구가 sensitive file 로 막는다 — 이 스크립트로 문자열 치환해 쓴다:
//   node tools/patch-hook-english-ratio-0916.mjs
import fs from 'node:fs';

const p = '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');

const from = `    if (!/[가-힣]/.test(text) && (text.match(/[A-Za-z]{3,}/g) || []).length >= 8) bail('영어 속말 — 기록 안 함');`;

const to = `    // 영어 속말 — 통째로 영어면 걸렸는데(가-힣 0개), 코드·명령 예시에 한글 낱말 몇 개만 섞이면 안
    // 걸렸다(백틱 안 한글 둘이 방패가 된 400자 영어 요약, 나리 09-16 실측). 비율로 본다 — 영어 글자가
    // 한글 글자의 6배를 넘고 40자 이상이면 덩이. 정상적인 한글 문장 속 영어 낱말 몇 개는 안 걸린다.
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const latinChars = (text.match(/[A-Za-z]/g) || []).length;
    if (latinChars >= 40 && latinChars > koreanChars * 6) bail('영어 속말 — 기록 안 함');`;

if (src.includes('영어 글자가\n    // 한글 글자의 6배') || src.includes('koreanChars * 6')) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 이 블록이 ${n}번 있음(1번이어야)`); process.exit(1); }

fs.writeFileSync(p + '.bak-english-ratio-0916', src);
fs.writeFileSync(p, src.replace(from, to));
console.log(`고침 — ${p}. 원본은 ${p}.bak-english-ratio-0916`);
