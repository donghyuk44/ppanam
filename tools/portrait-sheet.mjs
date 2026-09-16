#!/usr/bin/env node
// 초상 후보 한 장 보기 — teams/design/out/portraits/fe/<자리>-<n>.png 를 자리별 한 줄(넷)로 모아 PNG 한 장.
// 쓰기: node tools/portrait-sheet.mjs [out.png]
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const dir = path.join(ROOT, 'teams/design/out/portraits/fe');
const out = process.argv[2] || path.join(ROOT, 'teams/design/out/portraits/fe-sheet.png');
const NAMES = { 'hq-system':'나리 (사장)', 'hq-chief':'톰 (실장)', 'hq-outside':'제리', 'hq-secretary':'세라', 'dev-guide':'테라', 'dev-ops':'솔라', 'dev-outside':'레오', 'design-guide':'헨리', 'design-ops':'클레멘타인', 'design-outside':'마크', 'marketing-guide':'하영', 'marketing-review':'안젤', 'marketing-outside':'다니엘', 'finance-guide':'유진', 'finance-review':'노라', 'finance-outside':'빅터', 'boss':'대표' };
const keys = Object.keys(NAMES).filter((k) => fs.existsSync(path.join(dir, `${k}-1.png`)));
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const rows = keys.map((k) => `<div class="row"><div class="name">${NAMES[k]}<br><small>${k}</small></div>${[1,2,3,4].map((n) => fs.existsSync(path.join(dir, `${k}-${n}.png`)) ? `<div class="cell"><img src="${b64(path.join(dir, `${k}-${n}.png`))}"><span>${n}</span></div>` : '').join('')}</div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f2ee;font:14px -apple-system,system-ui,sans-serif;color:#222}.row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #ddd}.name{width:120px;font-weight:600}.name small{font-weight:400;color:#777}.cell{position:relative}.cell img{width:200px;height:200px;display:block;border-radius:6px}.cell span{position:absolute;left:6px;top:6px;background:#0008;color:#fff;border-radius:10px;padding:1px 8px;font-size:12px}</style><body>${rows}`;
const tmp = path.join(ROOT, 'teams/design/out/portraits/fe-sheet.html');
fs.writeFileSync(tmp, html);
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execSync(`"${CH}" --headless=new --disable-gpu --hide-scrollbars --window-size=980,${keys.length * 214 + 20} --screenshot="${out}" "file://${tmp}" 2>/dev/null`);
fs.unlinkSync(tmp);
console.log('SHEET', out, keys.length, '명');
