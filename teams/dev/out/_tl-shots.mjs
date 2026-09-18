// 타임라인 사진 셋 — 사진은 같은 이름에 덮어쓰지 않는다(결정 171·178): 판 이름을 꼭 준다. 쓰는 법: node teams/dev/out/_tl-shots.mjs <판 이름> [inject]
//   'inject' 를 주면 서버 재시작 전에도 goal·destination·after 를 가짜로 넣어(_tl-inject.txt) 맨 위 목표 한 장까지 찍는다 — 이름에 'goal-' 이 붙는다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ver = process.argv[2];
if (!ver || ver === 'inject') { console.error('판 이름을 주세요 — 예: node teams/dev/out/_tl-shots.mjs b [inject]'); process.exit(1); }
const inject = process.argv[3] === 'inject';
const prep = inject ? fs.readFileSync('teams/dev/out/_tl-inject.txt', 'utf8').trim() : '';
const tag = inject ? 'goal-' : '';
for (const [w, h] of [[412, 1500], [750, 1300], [1280, 1300]]) {
  const out = `teams/dev/out/shots/r37-timeline-${tag}${w}-${ver}.png`;
  if (fs.existsSync(out)) { console.error('이미 있는 이름 — 다른 판 이름으로:', out); process.exit(1); }
  const args = ['tools/screen-shot.mjs', out, 'dev/dashboard', String(w), String(h), '', '9612', ...(prep ? [prep] : [])];
  const r = spawnSync('node', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
