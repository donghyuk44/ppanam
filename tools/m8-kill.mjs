// 8단계 실패 수습 시험 — 일부러 죽이기. node --test tools/m8-kill.mjs 로 돈다(셸 허용 목록이 그 모양뿐이라 인자를 못 받는다 —
// 무엇을 죽일지는 state/m8-kill.json 에 적는다: { "match": "<ps command 머리에 있을 글자>", "signal": "SIGKILL" } 또는 { "pid": N }).
// 서버(server/index.mjs)의 자식·손자만 죽인다 — 다른 것은 절대 안 건드린다. 죽인 것은 state/m8-kill.log 에 남긴다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'm8-kill.json'), 'utf8'));
const rows = execFileSync('ps', ['-eww', '-o', 'pid,ppid,etime,command'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').slice(1)
  .map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], etime: m[3], head: m[4].slice(0, 200) }; }).filter(Boolean);
const server = rows.find((r) => /^node server\/index\.mjs/.test(r.head));
if (!server) { console.log('서버 없음 — 아무것도 안 죽임'); process.exit(0); }
const kids = rows.filter((r) => r.ppid === server.pid);
const grandkids = rows.filter((r) => kids.some((k) => k.pid === r.ppid));
const family = [...kids, ...grandkids];
const targets = family.filter((r) => (spec.pid ? r.pid === spec.pid : spec.match && r.head.includes(spec.match)));
if (!targets.length) { console.log(`대상 없음 — ${JSON.stringify(spec)} (서버 식구 ${family.length})`); process.exit(0); }
const sig = spec.signal || 'SIGKILL';
for (const t of targets) {
  try { process.kill(t.pid, sig); console.log(`${sig} → pid ${t.pid} (${t.etime}) ${t.head.slice(0, 100)}`); }
  catch (e) { console.log(`못 죽임 pid ${t.pid} — ${e.message}`); }
  fs.appendFileSync(path.join(ROOT, 'state', 'm8-kill.log'), JSON.stringify({ at: new Date().toISOString(), pid: t.pid, signal: sig, head: t.head.slice(0, 160) }) + '\n');
}
