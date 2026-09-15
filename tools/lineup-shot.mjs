// 인형 한 줄 · 세라 한 장 찍기 — /world/lineup.html 을 헤드리스 크롬으로. out/watchdogs/village-shot.mjs 의 정리 규칙 그대로(모든 종료 경로에서 크롬·프로필 정리, 그림 없으면 exit 3).
//
//   node tools/lineup-shot.mjs <out.png> [query] [W] [H] [port]
//   node tools/lineup-shot.mjs teams/dev/out/shots/r25-dolls-lineup-1920.png "" 1920 520
//   node tools/lineup-shot.mjs teams/dev/out/shots/r25-sera-200.png "only=hq-secretary&size=200&transparent=1&front=1" 200 200
//
// GPU 없이 3D 를 그리는 깃발 셋(테라, R24). 투명 요청(query 에 transparent=1)이면 페이지 배경도 투명으로 덮어 PNG 알파가 산다.
// exit: 0 저장 · 1 오류 · 2 타임아웃 · 3 그림 없음/인형 못 그림 · 130/143 신호
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const [,, OUT, QUERY = '', W = '1920', H = '520', PORT = '9611'] = process.argv;
if (!OUT) { console.error('사용법: node tools/lineup-shot.mjs <out.png> [query] [W] [H] [port]'); process.exit(1); }
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER = process.env.PPANAM_URL || 'http://localhost:4321';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ppanam-lineup-'));
const TRANSPARENT = /(^|&)transparent=1/.test(QUERY);
try { fs.rmSync(OUT, { force: true }); } catch {}   // 옛 그림은 먼저 지운다 — 실패했는데 파일이 남아 성공으로 읽히지 않게(레오 R25)

let ch = null, done = false;
function cleanup(code, why) { if (done) return; done = true; if (why) console.log(why);
  try { ch?.kill('SIGKILL'); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(code); }
process.on('SIGINT', () => cleanup(130, 'SIGINT')); process.on('SIGTERM', () => cleanup(143, 'SIGTERM'));
process.on('uncaughtException', (e) => cleanup(1, 'ERROR ' + (e?.message ?? e))); process.on('unhandledRejection', (e) => cleanup(1, 'ERROR ' + (e?.message ?? e)));
const to = setTimeout(() => cleanup(2, 'TIMEOUT'), 120_000);

ch = spawn(CH, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tg = null; for (let i = 0; i < 40; i++) { try { tg = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()); if (tg?.length) break; } catch {} await sleep(500); }
if (!tg?.length) cleanup(1, 'ERROR 크롬이 안 떴다');
const ws = new WebSocket(tg.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(W), height: Number(H), deviceScaleFactor: 1, mobile: false });
if (TRANSPARENT) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
await send('Page.navigate', { url: `${SERVER}/world/lineup.html${QUERY ? '?' + QUERY : ''}` });
// 다 그려질 때까지 — window.__lineup.ready. 60초 안에 안 오면 실패.
let st = null;
for (let i = 0; i < 120; i++) { st = await ev('window.__lineup ? JSON.stringify(window.__lineup) : null'); if (st && JSON.parse(st).ready) break; await sleep(500); }
const info = st ? JSON.parse(st) : null;
console.log('lineup', info ? `loaded ${info.loaded} · placed ${info.placed ?? '?'} · misplaced ${info.misplaced ?? 0} · offscreen ${info.offscreen ?? 0} · failed ${info.failed} · colormaps ${info.colormaps} · ${info.names.join('·')}` : '(상태 없음)');
// 머리 그림(head=1)이면 어깨선~머리 꼭대기가 몇 px 인지 — spec.md 1절 "얼굴 120px 이상" 을 찍는 쪽이 바로 센다(헨리 req_0f26d834)
if (info?.head) console.log('head', `facePx ${info.head.facePx}/${H} · 어깨선 ${info.head.bottom} · 꼭대기 ${info.head.top} · 폭 ${info.head.spanX}`);
if (!info?.ready) cleanup(3, 'NO_RENDER — lineup.js 가 ready 를 못 냈다 (three CDN? /out/design 색표?)');
if (info.loaded === 0) cleanup(3, 'NO_DOLLS — 인형을 하나도 못 불렀다');
// 화면에 선 수가 부른 수와 다르면 그림이 틀린 것이다 — exit 0 에 파일만 있는 조용한 실패를 막는다(하네스 R25: 열여섯이 한 자리에 겹침)
if ((info.placed ?? 0) !== info.loaded) cleanup(3, `NOT_PLACED — 불러온 ${info.loaded} 중 화면에 제자리에 선 것 ${info.placed ?? 0} (겹침 ${info.misplaced ?? 0} · 화면 밖 ${info.offscreen ?? 0})`);
await sleep(500);
const sh = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Number(W), height: Number(H), scale: 1 }, ...(TRANSPARENT ? { fromSurface: true } : {}) });
clearTimeout(to);
if (!sh.result?.data) cleanup(3, 'NO_IMAGE ' + JSON.stringify(sh.error ?? sh).slice(0, 200));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(sh.result.data, 'base64'));
console.log('SAVED', OUT, `${W}x${H}${TRANSPARENT ? ' 투명' : ''}`);
cleanup(0);
