// 한글 간판 텍스처 — out/kit/signs.json 의 글을 헤드리스 크롬 캔버스로 그려 out/kit/signs/<id>.png 로.
// 글꼴 파일 없이 맥 시스템 한글로 그린다(tools/lineup-shot.mjs 와 같은 크롬 통로). 그린 뒤 픽셀마다 판·글 두 색 중 가까운 쪽으로
// 붙여 안티앨리어싱 회색을 없앤다 — 파일 안 색은 정확히 둘, 전부 팔레트 안(마크가 센다).
//
//   node tools/kit/sign.mjs [teams/design/out/kit/signs.json] [--only marketing,cafe] [--port 9613]
//
// exit: 0 전부 저장 · 1 오류 · 2 타임아웃 · 3 하나라도 못 그림. 옛 파일은 먼저 지운다(실패가 성공으로 안 읽히게, 레오 R25 규칙).
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { decodePNG, encodePNG } from '../pixel/png.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SPEC = args.find((a) => a.endsWith('.json')) ?? 'teams/design/out/kit/signs.json';
const ONLY = opt('--only', '').split(',').filter(Boolean);
const PORT = opt('--port', '9613');
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const OUT_DIR = path.join(path.dirname(SPEC), 'signs');
const [W, H] = spec.size;
const signs = spec.signs.filter((s) => !ONLY.length || ONLY.includes(s.id));
if (!signs.length) { console.error('그릴 간판이 없다'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const s of signs) { try { fs.rmSync(path.join(OUT_DIR, `${s.id}.png`), { force: true }); } catch {} }

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ppanam-sign-'));
let ch = null, done = false;
function cleanup(code, why) { if (done) return; done = true; if (why) console.log(why);
  try { ch?.kill('SIGKILL'); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(code); }
process.on('SIGINT', () => cleanup(130, 'SIGINT')); process.on('SIGTERM', () => cleanup(143, 'SIGTERM'));
process.on('uncaughtException', (e) => cleanup(1, 'ERROR ' + (e?.message ?? e))); process.on('unhandledRejection', (e) => cleanup(1, 'ERROR ' + (e?.message ?? e)));
const to = setTimeout(() => cleanup(2, 'TIMEOUT'), 60_000);

ch = spawn(CH, ['--headless=new', '--hide-scrollbars', `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tg = null; for (let i = 0; i < 40; i++) { try { tg = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()); if (tg?.length) break; } catch {} await sleep(500); }
if (!tg?.length) cleanup(1, 'ERROR 크롬이 안 떴다');
const ws = new WebSocket(tg.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate 실패'); return r.result?.result?.value; };
await send('Runtime.enable');

// 캔버스 하나에 글 한 줄 — 판 색으로 채우고, 글은 폭의 maxWidthRatio 안에 들어올 때까지 글자 크기를 줄인다. 결과는 PNG data URL.
const drawJS = (s, kind) => `(() => {
  const W = ${W}, H = ${H}, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = ${JSON.stringify(kind.board)}; g.fillRect(0, 0, W, H);
  const f = ${kind.frame || 0}; if (f > 0) { g.fillStyle = ${JSON.stringify(kind.ink)}; g.fillRect(0, 0, W, H); g.fillStyle = ${JSON.stringify(kind.board)}; g.fillRect(f, f, W - 2 * f, H - 2 * f); }
  let px = ${spec.fit.maxFontPx}; const maxW = W * ${spec.fit.maxWidthRatio};
  const font = (n) => ${spec.weight} + ' ' + n + 'px ' + ${JSON.stringify(spec.font)};
  g.font = font(px); while (g.measureText(${JSON.stringify(s.text)}).width > maxW && px > 20) { px -= 2; g.font = font(px); }
  g.fillStyle = ${JSON.stringify(kind.ink)}; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(${JSON.stringify(s.text)}, W / 2, H / 2 + px * 0.04);
  return JSON.stringify({ px, w: Math.round(g.measureText(${JSON.stringify(s.text)}).width), url: c.toDataURL('image/png') });
})()`;

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (d, o, c) => (d[o] - c[0]) ** 2 + (d[o + 1] - c[1]) ** 2 + (d[o + 2] - c[2]) ** 2;
let failed = 0;
for (const s of signs) {
  const kind = spec.kinds[s.kind]; if (!kind) { console.log(`✗ ${s.id} — kind ${s.kind} 가 signs.json kinds 에 없다`); failed++; continue; }
  let r; try { r = JSON.parse(await ev(drawJS(s, kind))); } catch (e) { console.log(`✗ ${s.id} — ${e.message}`); failed++; continue; }
  const png = decodePNG(Buffer.from(r.url.split(',')[1], 'base64'));
  const board = hexToRgb(kind.board), ink = hexToRgb(kind.ink); const d = png.data; let inkPx = 0;
  for (let o = 0; o < d.length; o += 4) { const c = dist(d, o, ink) < dist(d, o, board) ? ink : board; if (c === ink) inkPx++; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
  if (inkPx < 200) { console.log(`✗ ${s.id} — 글 픽셀 ${inkPx} — 글꼴이 안 그려졌다`); failed++; continue; }
  const file = path.join(OUT_DIR, `${s.id}.png`);
  fs.writeFileSync(file, encodePNG(png.width, png.height, d));
  console.log(`✓ ${s.id}  "${s.text}"  ${png.width}×${png.height}  글자 ${r.px}px 폭 ${r.w}  글 픽셀 ${inkPx}  판 ${kind.board} 글 ${kind.ink}  → ${file}`);
}
clearTimeout(to);
cleanup(failed ? 3 : 0, failed ? `${failed} 장 못 그림` : `SAVED ${signs.length} 장 → ${OUT_DIR}`);
