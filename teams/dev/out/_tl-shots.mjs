// 타임라인 사진 셋 — 인자 'inject' 를 주면 서버 재시작 전에도 goal·destination·after 를 가짜로 넣어(_tl-inject.txt) 맨 위 목표 한 장까지 찍는다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const inject = process.argv[2] === 'inject';
const prep = inject ? fs.readFileSync('teams/dev/out/_tl-inject.txt', 'utf8').trim() : '';
const tag = inject ? 'goal-' : '';
for (const [w, h] of [[412, 1500], [750, 1300], [1280, 1300]]) {
  const args = ['tools/screen-shot.mjs', `teams/dev/out/shots/r37-timeline-${tag}${w}.png`, 'dev/dashboard', String(w), String(h), '', '9612', ...(prep ? [prep] : [])];
  const r = spawnSync('node', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
