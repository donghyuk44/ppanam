#!/usr/bin/env node
// 시연용 라운드. 서버를 띄워두고 실행하면 채팅창에 실시간으로 흐른다.
//
//   npm start                      (다른 터미널)
//   npm run demo                   마케팅팀 한 판
//   node bus/demo.mjs --team dev   개발팀에서
//   BEAT=300 npm run demo          빠르게

import { startRound, endRound, emit, recordVerdict, defaultTeam, teamExists } from './bus.mjs';

const argv = process.argv.slice(2);
let team = process.env.PPANAM_TEAM ?? defaultTeam();
for (let i = 0; i < argv.length; i++) if (argv[i] === '--team' || argv[i] === '-t') team = argv[++i];
if (!teamExists(team)) { console.error(`'${team}' 팀이 없습니다.`); process.exit(1); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const beat = Number(process.env.BEAT ?? 1400);

const script = [
  () => startRound(team, { topic: '9월 캠페인 헤드라인 3안', milestone: 3 }),
  () => emit(team, { type: 'enter', actor: 'system', text: '길잡이, 되짚기, 바깥눈 님이 들어왔습니다' }),
  () => emit(team, { type: 'message', actor: 'guide', text: '헤드라인 3안 뽑았습니다. 작년 9월 리포트와 이번 분기 검색량을 근거로 썼고, 셋 다 같은 약속 하나만 말하도록 맞췄습니다.' }),
  () => emit(team, { type: 'tool', actor: 'guide', text: 'teams/marketing/out/2025-09-report.md', meta: { tool: 'Read' } }),
  () => emit(team, { type: 'message', actor: 'review', text: '2안이 약속을 두 개 하고 있습니다. "빠르게"와 "저렴하게" 중 어느 쪽이 이번 캠페인의 약속입니까?' }),
  () => emit(team, { type: 'tool', actor: 'outside', text: '경쟁사 9월 랜딩 3건', meta: { tool: 'WebFetch' } }),
  () => emit(team, { type: 'message', actor: 'outside', text: '둘 다 놓친 게 있습니다. 3안의 "업계 최초"는 근거 문서에 없는 표현입니다. 출처를 못 대면 표시광고 심사에서 걸립니다.' }),
  () => recordVerdict(team, { actor: 'review', verdict: 'REVISE', target: 'guide', text: '근거 없는 수치 1건, 중복 약속 1건.\n서브카피의 "30% 절감"은 리포트 12쪽 기준 27%입니다.' }),
  () => emit(team, { type: 'message', actor: 'boss', text: '3안 빼고 1안으로 가자' }),
  () => emit(team, { type: 'message', actor: 'guide', text: '1안으로 확정하고 2안의 중복 약속은 잘라냈습니다. 수치도 27%로 고쳤습니다.' }),
  () => recordVerdict(team, { actor: 'review', verdict: 'PASS', target: 'guide', text: '통과. 마일스톤의 산출물 조건을 채웠습니다.' }),
  () => endRound(team, { verdict: 'PASS', summary: '라운드 종료 · 헤드라인 1안 확정' }),
];

console.log(`[${team}] 시연 시작 (박자 ${beat}ms)\n`);
for (const step of script) {
  const r = step();
  const t = r?.text ?? '';
  console.log(`  ${(r?.actor ?? 'system').padEnd(8)} ${t.split('\n')[0].slice(0, 54)}`);
  await wait(beat);
}
console.log(`\n끝. 대화록은 그대로 남아 있고, 다음 라운드부터 AI 컨텍스트만 새로 시작합니다.`);
