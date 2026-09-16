#!/usr/bin/env node
// 얇은 감독 (N1 둘째 조각, 나리 13:2x) — 진짜 서버(server/index.mjs)를 자식으로 띄우고 stdio 를 그대로
// 흘린다. 서버가 승인된 재시작 카드를 만나면 정해진 종료 코드(server/executor.mjs RESTART_EXIT_CODE,
// 75)로 끝내고, 이 감독이 그걸 보고 다시 띄운다. 그 밖의 종료(오류·SIGTERM)는 감독도 그대로 끝난다.
//
// 관리 창(preview_start)은 이 파일 하나만 켠다 — 그 뒤 재시작은 승인된 카드로 서버가 스스로.
// pkill 로 감독을 죽이면 자식(서버)도 같이 죽는다(SIGTERM 을 그대로 넘긴다).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESTART_EXIT_CODE = 75;   // server/executor.mjs 와 같은 값 — 둘 다 남이 못 바꾸는 상수라 그냥 맞춰 둔다.

function launch() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], { cwd: ROOT, stdio: 'inherit', env: process.env });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.removeAllListeners(sig);
    process.on(sig, () => { try { child.kill(sig); } catch { /* 이미 죽음 */ } });
  }
  child.on('exit', (code, signal) => {
    if (code === RESTART_EXIT_CODE) { console.log('[serve] 재시작 카드 — 다시 띄웁니다.'); launch(); return; }
    process.exit(signal ? 1 : (code ?? 0));
  });
}

launch();
