#!/usr/bin/env node
// N3 1단계 — 로밍 자리(나리·세라) 답이 집 방에도 남던 것, 원본을 부른 방 하나로
// (나리 설계 teams/dev/out/n3-roam-record-design.md, 대표 13:2x "설계미스인거지. 개선안 찾아봐")
//
// callHomeElsewhere(server/conductor.mjs)가 집 세션에 물으면, 답을 부른 방(turn.extra)에 이미
// emit 으로 남긴다. 그런데 훅의 Stop 처리가 독립적으로 또 집 방(hq·sera) 대화록에 같은 말을 남겨서
// 원본이 두 벌이었다 — meta.roam 표시·화면 접기(솔라 610fea7·테라 e64a40d)로 가렸을 뿐 대화록
// 자체엔 그대로였다.
//
// turn.kind==='called' && turn.extra 는 callHomeElsewhere 만 쓰는 조합이다(로밍 relay 턴 표시,
// 이미 있음) — 이 경우 훅이 집 방에 안 적는다(bail). sendAndWait 의 텍스트 회수는 훅과 무관하게
// session.mjs drain() 이 stream 을 직접 읽어 처리하므로, 훅이 안 적어도 callHomeElsewhere 는
// 그대로 답을 받아 부른 방에 남긴다. meta.roam 표시는 이제 쓸 데가 없어 걷어낸다(옛 기록엔 남아
// 있으니 화면 접기 부품은 테라가 서두르지 않고 정리).
//
// .claude/ 밑은 대표 손이라 대표 터미널에서:  node tools/patch-hook-no-home-copy-0916.mjs
import fs from 'node:fs';

const p = '.claude/hooks/to-bus.mjs';
const src = fs.readFileSync(p, 'utf8');

const from = `    // 로밍 자리(나리·세라)가 다른 방에서 불려 집 세션이 답한 것 — turn.extra 에 부른 방이 실려 있다
    // (server/conductor.mjs callHomeElsewhere). 집 대화록의 이 원본 줄에 어느 방 답인지 찍어 둔다.
    out = { actor, type: 'message', text: trim(text), meta: {
      ...(actor === 'system' ? { hand: 'server' } : {}),
      ...(turn?.kind === 'called' && turn.extra ? { roam: turn.extra } : {}),
    } };
    if (!Object.keys(out.meta).length) out.meta = undefined;
    break;`;

const to = `    // 로밍 자리(나리·세라)가 다른 방에서 불려 집 세션이 답한 것 — callHomeElsewhere(turn.extra 에
    // 부른 방이 실려 있다)가 이미 그 방에 정본을 남겼다. 집 대화록에 또 적으면 원본이 두 벌이 된다
    // (대표 13:2x "설계 미스" — N3 1단계). sendAndWait 의 텍스트 회수는 훅과 무관하니 여기서 안
    // 적어도 callHomeElsewhere 는 그대로 답을 받는다.
    if (turn?.kind === 'called' && turn.extra) bail('로밍 답 — callHomeElsewhere 가 부른 방에 이미 남김');
    out = { actor, type: 'message', text: trim(text), meta: actor === 'system' ? { hand: 'server' } : undefined };
    break;`;

if (src.includes("로밍 답 — callHomeElsewhere 가 부른 방에 이미 남김")) { console.log('이미 고쳐져 있음 — 아무것도 안 함'); process.exit(0); }
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`멈춤 — 이 블록이 ${n}번 있음(1번이어야)`); process.exit(1); }

fs.writeFileSync(p + '.bak-no-home-copy-0916', src);
fs.writeFileSync(p, src.replace(from, to));
console.log(`고침 — ${p}. 원본은 ${p}.bak-no-home-copy-0916`);
