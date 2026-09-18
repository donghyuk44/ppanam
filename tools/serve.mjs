#!/usr/bin/env node
// 얇은 감독 (N1 둘째 조각, 나리 13:2x·13:5x) — 진짜 서버(server/index.mjs)를 자식으로 띄우고 stdio 를
// 그대로 흘린다. 재시작 카드(75)를 만나면 1초 뒤 다시 띄운다(포트가 놓일 시간, 09-18 EADDRINUSE 실측).
// 그 밖의 오류 종료도 다시 띄운다(세라
// 태클 — 75 만 살리면 서버가 죽었을 때 감독도 같이 끝나 "멈추면 안 켜진다"가 그대로다) — 신호
// (SIGTERM·SIGINT)로 끝난 것만 빼고, 그건 관리 창이 일부러 내린 것이다. 5분 안에 세 번 넘게 죽으면
// 포기하고 총괄실에 한 줄 남긴다 — 안 그러면 죽고 뜨고를 초 단위로 반복하며 방을 도배한다.
//
// 관리 창(preview_start)은 이 파일 하나만 켠다 — 그 뒤 재시작은 승인된 카드로 서버가 스스로.
// pkill 로 감독을 죽이면 자식(서버)도 같이 죽는다(SIGTERM 을 그대로 넘긴다).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from '../bus/bus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESTART_EXIT_CODE = 75;   // server/executor.mjs 와 같은 값 — 둘 다 남이 못 바꾸는 상수라 그냥 맞춰 둔다.
const CRASH_WINDOW_MS = 5 * 60_000;
const CRASH_MAX = 3;               // 이 창 안에 이보다 많이(네 번째부터) 죽으면 멈춘다
const BACKOFF_MS = [1000, 2000, 5000];   // 첫째·둘째·그 뒤론 5초
// 재시작 카드(75) 뒤 바로 띄우면 포트가 아직 안 놓였다(executor.mjs 가 server.close() 없이 exit 만 해서
// OS 가 4321 을 거두는 사이 새 자식이 EADDRINUSE 로 또 죽는다) — 그 죽음이 crashes 에 또 쌓여 카드를
// 여러 번 통과시키면 3진 아웃까지 갔다(09-18 14:57, 나리 실측 ①). 1초 여유를 준다.
const RESTART_DELAY_MS = 1000;

let downedBySignal = false;   // 관리 창이 신호로 내렸다 — 다시 안 띄운다
let crashes = [];             // 최근 오류 종료 시각들(75 가 아닌 종료) — 5분 창

function launch() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], { cwd: ROOT, stdio: 'inherit', env: process.env });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.removeAllListeners(sig);
    process.on(sig, () => { downedBySignal = true; try { child.kill(sig); } catch { /* 이미 죽음 */ } });
  }
  child.on('exit', (code, signal) => {
    if (downedBySignal) { process.exit(0); return; }
    if (code === RESTART_EXIT_CODE) { console.log(`[serve] 재시작 카드 — ${RESTART_DELAY_MS}ms 뒤 다시 띄웁니다(포트 놓일 시간).`); setTimeout(launch, RESTART_DELAY_MS); return; }

    // 그 밖의 모든 종료(오류·죽음·뜻밖의 코드 0) — 다시 띄우되 5분에 세 번 넘으면 포기한다.
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < CRASH_WINDOW_MS);
    crashes.push(now);
    if (crashes.length > CRASH_MAX) {
      console.error(`[serve] ${Math.round(CRASH_WINDOW_MS / 60_000)}분 안에 ${crashes.length}번 죽었습니다 — 멈춥니다.`);
      try { emit('hq', { actor: 'system', type: 'note', text: `서버가 ${Math.round(CRASH_WINDOW_MS / 60_000)}분 안에 ${crashes.length}번 죽어 멈췄습니다 — 관리 창.` }); }
      catch { /* 방도 못 쓰면 그냥 멈춘다 */ }
      process.exit(1);
      return;
    }
    const wait = BACKOFF_MS[Math.min(crashes.length - 1, BACKOFF_MS.length - 1)];
    console.error(`[serve] 오류 종료(code ${code}${signal ? ' · ' + signal : ''}) — ${wait}ms 뒤 다시 띄웁니다 (${crashes.length}/${CRASH_MAX + 1}).`);
    setTimeout(launch, wait);
  });
}

launch();
