// node run-limited.mjs <초> <명령> [인자…]  — stdin 을 넘기고, 시간 지나면 죽인다.
import { spawn } from 'node:child_process';
const [secs, cmd, ...args] = process.argv.slice(2);
const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '', err = '';
p.stdout.on('data', (d) => (out += d));
p.stderr.on('data', (d) => (err += d));
process.stdin.pipe(p.stdin);
const t = setTimeout(() => { p.kill('SIGKILL'); console.log('[시간 초과 ' + secs + '초]'); print(); process.exit(2); }, Number(secs) * 1000);
const print = () => { if (out.trim()) console.log('--- 답 ---\n' + out.trim().slice(0, 1500)); if (err.trim()) console.log('--- stderr ---\n' + err.trim().slice(0, 600)); };
p.on('close', (c) => { clearTimeout(t); console.log('종료코드 ' + c); print(); process.exit(0); });
