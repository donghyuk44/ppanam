// 8단계 실패 수습 시험 — 지금 떠 있는 자리 프로세스 목록 (node --test tools/m8-ps.mjs 로 돈다 — 셸 허용 목록이 그 모양뿐이다).
// 서버(server/index.mjs) → 자식: claude 세션(자리마다 하나 — --resume <id> 를 state/sessions.json 으로 풀어 자리 이름), node bus/outside.mjs(차례마다), agy(상주 gemini).
// ps 의 command 에는 claude 세션의 시스템 프롬프트가 통째로 실리므로(bus/outside.mjs 같은 글자가 그 안에도 있다) 앞 120자로만 가른다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let ids = {}; try { ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'sessions.json'), 'utf8')); } catch { /* 없음 */ }
const seatOfId = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));

const rows = execFileSync('ps', ['-eww', '-o', 'pid,ppid,etime,command'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').slice(1)
  .map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], etime: m[3], cmd: m[4], head: m[4].slice(0, 160) }; }).filter(Boolean);
const server = rows.find((r) => /^node server\/index\.mjs/.test(r.head));
console.log('server', server ? `pid ${server.pid} (${server.etime})` : '없음');
const kids = rows.filter((r) => server && r.ppid === server.pid);
for (const r of kids) {
  let kind;
  if (/^node .*bus\/outside\.mjs/.test(r.head)) kind = `outside.mjs --team ${(/--team (\S+)/.exec(r.head) || [])[1] ?? '?'} --actor ${(/--actor (\S+)/.exec(r.head) || [])[1] ?? '?'} --turn ${(/--turn (\S+)/.exec(r.head) || [])[1] ?? '?'}`;
  else if (/^agy /.test(r.head)) kind = `agy(상주) ${(/--model (\S+)/.exec(r.head) || [])[1] ?? ''}`;
  else if (/^claude /.test(r.head)) { const id = (/--resume ([0-9a-f-]{36})/.exec(r.head) || [])[1]; kind = `claude 세션 ${id ? (seatOfId[id] ?? `(id ${id.slice(0, 8)} — 자리 모름)`) : '(새 세션 · --resume 없음)'} ${(/--model (\S+)/.exec(r.head) || [])[1] ?? ''}`; }
  else kind = r.head.slice(0, 80);
  console.log(`  pid ${r.pid} ${r.etime} — ${kind}`);
}
// 자식의 자식 — codex(outside.mjs 가 띄움)·agy -p·claude mcp serve(agy 상주의 것)
for (const r of rows) {
  if (!kids.some((k) => k.pid === r.ppid)) continue;
  if (/^\/bin\/bash|^bash|^sh /.test(r.head)) continue;
  console.log(`    pid ${r.pid} ppid ${r.ppid} ${r.etime} — ${r.head.slice(0, 100)}`);
}
