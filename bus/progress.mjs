#!/usr/bin/env node
// 상황판 갱신 (대표 결정 23). 로드맵이 목적지라면 이건 현재 위치다 — 실무가 턴 끝·라운드 닫기마다 쓴다.
//
//   node bus/progress.mjs --team dev --doing "68 패널 그리는 중" --doing "69 서버" --blocked "" --boss "분석 탭 목록 골라 주세요" --next "M5 Three.js"
//   node bus/progress.mjs --team dev --clear blocked           # 막힌 것 없음
//   node bus/progress.mjs --team dev --show
//
// 준 항목만 통째로 바뀌고, 안 준 항목은 그대로. 누가 썼는지는 환경(PPANAM_ACTOR)이 정한다.
// 파일: teams/<팀>/progress.json — 상황판 첫 카드 · 모든 자리 프롬프트 · 관제탑 팀 카드가 읽는다 (docs/event-schema.md 3절 "상황판").

import { readProgress, writeProgress, PROGRESS_KEYS, readCast, defaultTeam, teamExists } from './bus.mjs';

const argv = process.argv.slice(2);
let team = process.env.PPANAM_TEAM ?? null;
const patch = {}; const clear = []; let show = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') team = argv[++i];
  else if (a === '--show') show = true;
  else if (a === '--clear') { const k = argv[++i]; if (!PROGRESS_KEYS.includes(k)) { console.error(`오류: --clear 는 ${PROGRESS_KEYS.join('·')} 중 하나입니다: ${k}`); process.exit(2); } clear.push(k); }
  else if (a.startsWith('--') && PROGRESS_KEYS.includes(a.slice(2))) { const k = a.slice(2); const v = String(argv[++i] ?? '').trim(); if (v) (patch[k] ??= []).push(v); }
  else { console.error(`오류: 모르는 인자 ${a}. 쓰는 법: --team <팀> --doing "…" --blocked "…" --boss "…" --next "…" [--done "…"] [--clear <항목>] [--show]`); process.exit(2); }
}
if (!team) team = defaultTeam();
if (!teamExists(team)) { console.error(`오류: '${team}' 팀이 없습니다.`); process.exit(1); }

const print = (p) => {
  if (!p) { console.log(`[${team}] 상황판이 아직 없습니다.`); return; }
  console.log(`[${team}] 상황판 · ${p.at ?? '—'} · ${p.by ?? '—'} · 라운드 ${p.round ?? '—'}`);
  for (const [k, label] of [['doing', '하는 것'], ['blocked', '막힌 것'], ['boss', '대표 차례'], ['next', '다음'], ['done', '한 것']]) {
    if (!p[k].length) { if (k !== 'done') console.log(`  ${label}: (없음)`); continue; }
    console.log(`  ${label}:`); for (const x of p[k]) console.log(`    - ${x}`);
  }
};

if (show || (!Object.keys(patch).length && !clear.length)) { print(readProgress(team)); process.exit(0); }
const actor = process.env.PPANAM_ACTOR ?? null;
const by = actor ? (readCast(team).agents?.[actor]?.name ?? actor) : '터미널';
print(writeProgress(team, patch, { clear, by }));
