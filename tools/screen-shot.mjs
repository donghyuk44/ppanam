// 작전실 화면 한 장 — 폰 412 폭으로 어느 탭이든. 정리 규칙은 lineup-shot 과 같다(모든 종료 경로에서 크롬·프로필 정리, 그림 없으면 exit 3, 옛 그림은 먼저 지움).
//
//   node tools/screen-shot.mjs <out.png> <hash> [W] [H] [towerTab] [port]
//   node tools/screen-shot.mjs teams/dev/out/shots/r25-room-412.png dev/room 412 915
//   node tools/screen-shot.mjs teams/dev/out/shots/r25-tower-people-412.png dev/tower 412 915 people
//   node tools/screen-shot.mjs teams/dev/out/shots/r25-analysis-412.png dev/analysis 412 915
//
// hash 는 주소의 # 뒤(<팀>/<화면>: room · tower · analysis · world). towerTab 은 관제탑 서브탭(all · teams · people · asks) — 그림 안 선택 상태로 확인(레오).
// GPU 없이 3D 를 그리는 깃발 셋(마을 탭용). exit: 0 저장 · 1 오류 · 2 타임아웃 · 3 그림 없음 · 130/143 신호
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const [,, OUT, HASH = 'dev/room', W = '412', H = '915', TAB = '', PORT = '9612'] = process.argv;
if (!OUT) { console.error('사용법: node tools/screen-shot.mjs <out.png> <hash> [W] [H] [towerTab] [port]'); process.exit(1); }
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER = process.env.PPANAM_URL || 'http://localhost:4321';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ppanam-screen-'));
try { fs.rmSync(OUT, { force: true }); } catch {}

let ch = null, done = false;
function cleanup(code, why) { if (done) return; done = true; if (why) console.log(why);
  try { ch?.kill('SIGKILL'); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(code); }
process.on('SIGINT', () => cleanup(130, 'SIGINT')); process.on('SIGTERM', () => cleanup(143, 'SIGTERM'));
process.on('uncaughtException', (e) => cleanup(1, 'ERROR ' + (e?.message ?? e))); process.on('unhandledRejection', (e) => cleanup(1, 'ERROR ' + (e?.message ?? e)));
const to = setTimeout(() => cleanup(2, 'TIMEOUT'), 90_000);

ch = spawn(CH, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tg = null; for (let i = 0; i < 40; i++) { try { tg = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()); if (tg?.length) break; } catch {} await sleep(500); }
if (!tg?.length) cleanup(1, 'ERROR 크롬이 안 떴다');
const ws = new WebSocket(tg.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(W), height: Number(H), deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${SERVER}/#${HASH}` });
await sleep(4000);
if (TAB) { await ev(`(()=>{const b=document.querySelector('#towerTabs button[data-tab="${TAB}"]'); if(b){b.click();return 'clicked'} return 'no tab'})()`); await sleep(1500); }
const view = await ev(`document.getElementById('app')?.dataset.view ?? null`);
const tab = await ev(`document.querySelector('#towerTabs button[aria-current="true"]')?.dataset.tab ?? null`);
const vw = await ev('innerWidth');
console.log('screen', `view ${view} · tab ${tab} · vw ${vw}`);
const sh = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Number(W), height: Number(H), scale: 1 } });
clearTimeout(to);
if (!sh.result?.data) cleanup(3, 'NO_IMAGE ' + JSON.stringify(sh.error ?? sh).slice(0, 200));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(sh.result.data, 'base64'));
console.log('SAVED', OUT, `${W}x${H}`);
cleanup(0);
