// 디스크 시계 — 20분마다 임시 찌꺼기를 치운다. 화면 찍을 때마다 크롬 프로필이 50MB 씩 쌓여 낮에 디스크가 꽉 찼다.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
const run = promisify(execFile);
const LOG = process.env.DW_LOG;
const say = (s) => { try { fs.appendFileSync(LOG, `${new Date().toLocaleTimeString("sv-SE",{timeZone:"Asia/Seoul"})} ${s}\n`); } catch {} };
async function free() {
  const { stdout } = await run('df', ['-m', '/System/Volumes/Data']);
  return Number(stdout.trim().split('\n')[1].split(/\s+/)[3]);
}
async function tick() {
  try {
    const before = await free();
    await run('bash', ['-c', `for d in /private/tmp/claude-501/cdp-profile-*; do [ -d "$d" ] || continue; [ -z "$(find "$d" -maxdepth 0 -mmin -25 2>/dev/null)" ] && rm -rf "$d"; done; find /private/tmp/claude-501/bash-edit-diff -type f -mmin +60 -delete 2>/dev/null; true`]);
    const after = await free();
    const gain = after - before;
    say(`빈 자리 ${Math.round(after/1024*10)/10}G${gain > 50 ? ` (+${Math.round(gain/1024*10)/10}G 치움)` : ''}${after < 3000 ? '  ⚠ 3G 아래' : ''}`);
  } catch (e) { say('터짐 ' + String(e.message).slice(0,60)); }
}
say('디스크 시계 시작 — 20분마다');
await tick();
setInterval(() => { tick().catch(()=>{}); }, 20*60*1000);
