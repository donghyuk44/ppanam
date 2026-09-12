// SpriteCook API 클라이언트 — 디자인팀의 도구. 키는 환경변수 SPRITECOOK_API_KEY 에서만 읽는다(코드·대화록에 적지 않는다).
//
//   node tools/pixel/spritecook.mjs credits
//   node tools/pixel/spritecook.mjs gen  --out out/sprites/boss-idle.png --prompt "..." [--w 64 --h 64] [--style ..] [--theme ..]
//                                        [--ref <asset_id>] [--colors "#aabbcc,#..."] [--variations 1] [--quality high] [--model ..]
//   node tools/pixel/spritecook.mjs anim --asset <asset_id> --prompt "walk cycle, facing south" --frames 4 --out out/sprites/boss-walk-s.png
//
// 문서(2026-09-12 읽음): https://www.spritecook.ai/api-docs — base https://api.spritecook.ai/v1/api,
// Authorization: Bearer sc_live_…, POST /generate-sync · /animate-sync · GET /credits · GET /assets/{id}.
// 응답 모양은 첫 실측 뒤 고정한다 — 아래 saveResponse 가 image/* 본문, JSON 의 url·base64 를 모두 받는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.SPRITECOOK_BASE ?? 'https://api.spritecook.ai/v1/api';
// 키는 환경변수, 없으면 ~/.config/ppanam/spritecook.env (KEY=값 한 줄). 값은 어디에도 출력하지 않는다.
function loadKey() {
  if (process.env.SPRITECOOK_API_KEY) return process.env.SPRITECOOK_API_KEY;
  try {
    const t = fs.readFileSync(path.join(os.homedir(), '.config', 'ppanam', 'spritecook.env'), 'utf8');
    return /SPRITECOOK_API_KEY=([^\s'"]+)/.exec(t)?.[1] ?? null;
  } catch { return null; }
}
const KEY = loadKey();
const ROOT = process.cwd();

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; } }
    else o._.push(a);
  }
  return o;
}

async function call(method, p, body) {
  if (!KEY) throw new Error('SPRITECOOK_API_KEY 가 없습니다. 대표가 환경변수로 넣습니다 — 대화록·코드에 적지 않습니다.');
  const res = await fetch(BASE + p, {
    method, headers: { authorization: `Bearer ${KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${method} ${p} → ${res.status} ${t.slice(0, 300)}`);
  }
  if (ct.startsWith('image/')) return { kind: 'image', ct, bytes: Buffer.from(await res.arrayBuffer()), headers: Object.fromEntries(res.headers) };
  if (ct.includes('json')) return { kind: 'json', data: await res.json() };
  return { kind: 'text', text: await res.text() };
}

/** 응답에서 그림을 꺼내 파일로. 어떤 모양이든 먼저 통째로 기록해 두고(.json), 그림은 옆에 쓴다. */
async function saveResponse(r, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (r.kind === 'image') { fs.writeFileSync(out, r.bytes); return { file: out, assetId: r.headers['x-asset-id'] ?? null }; }
  if (r.kind !== 'json') { fs.writeFileSync(out + '.txt', r.text); throw new Error('그림이 아닌 응답: ' + out + '.txt'); }
  fs.writeFileSync(out + '.json', JSON.stringify(r.data, null, 2));
  const d = r.data;
  const pick = (o) => o && (o.image_url ?? o.url ?? o.image ?? o.png ?? o.webp ?? null);
  const cands = [].concat(d.images ?? d.assets ?? d.variations ?? d.results ?? d.data ?? [], d.asset ?? [], d);
  let n = 0; const saved = [];
  for (const c of cands) {
    const src = typeof c === 'string' ? c : pick(c);
    if (!src) continue;
    const file = n === 0 ? out : out.replace(/\.png$/, `-${n + 1}.png`);
    if (/^data:/.test(src)) fs.writeFileSync(file, Buffer.from(src.split(',')[1], 'base64'));
    else if (/^https?:/.test(src)) { const img = await fetch(src); fs.writeFileSync(file, Buffer.from(await img.arrayBuffer())); }
    else if (/^[A-Za-z0-9+/=]{100,}$/.test(src)) fs.writeFileSync(file, Buffer.from(src, 'base64'));
    else continue;
    saved.push({ file, assetId: (typeof c === 'object' && (c.asset_id ?? c.id)) ?? d.asset_id ?? d.id ?? null });
    n++;
  }
  if (!saved.length) throw new Error('응답에서 그림을 못 찾았습니다 — ' + out + '.json 을 보세요');
  return saved.length === 1 ? saved[0] : saved;
}

const o = args(process.argv.slice(2));
const cmd = o._[0];
try {
  if (cmd === 'credits') {
    const r = await call('GET', '/credits');
    console.log(JSON.stringify(r.kind === 'json' ? r.data : r, null, 2));
  } else if (cmd === 'gen') {
    if (!o.prompt || !o.out) throw new Error('--prompt 와 --out 이 필요합니다');
    const body = {
      prompt: o.prompt, width: Number(o.w ?? 64), height: Number(o.h ?? 64), pixel: true,
      bg_mode: o.bg ?? 'transparent', variations: Number(o.variations ?? 1),
      ...(o.style ? { style: o.style } : {}), ...(o.theme ? { theme: o.theme } : {}),
      ...(o.quality ? { quality: o.quality } : {}), ...(o.model ? { model: o.model } : {}),
      ...(o.ref ? { reference_asset_id: o.ref } : {}),
      ...(o.colors ? { colors: String(o.colors).split(',').map((s) => s.trim()) } : {}),
    };
    const r = await call('POST', '/generate-sync', body);
    const saved = await saveResponse(r, path.resolve(ROOT, o.out));
    console.log(JSON.stringify({ body, saved, credits: r.kind === 'json' ? { used: r.data.credits_used, remaining: r.data.credits_remaining } : null }, null, 2));
  } else if (cmd === 'anim') {
    if (!o.asset || !o.prompt || !o.out) throw new Error('--asset, --prompt, --out 이 필요합니다');
    const body = {
      asset_id: o.asset, prompt: o.prompt, output_frames: Number(o.frames ?? 4),
      output_format: o.format ?? 'spritesheet', removebg: o.removebg ?? 'None',
    };
    const r = await call('POST', '/animate-sync', body);
    const saved = await saveResponse(r, path.resolve(ROOT, o.out));
    console.log(JSON.stringify({ body, saved, credits: r.kind === 'json' ? { used: r.data.credits_used, remaining: r.data.credits_remaining } : null }, null, 2));
  } else if (cmd === 'asset') {
    const r = await call('GET', `/assets/${o._[1]}`);
    console.log(JSON.stringify(r.kind === 'json' ? r.data : r, null, 2));
  } else {
    console.log('사용법: credits | gen --prompt .. --out .. | anim --asset .. --prompt .. --out .. | asset <id>');
    process.exit(2);
  }
} catch (e) { console.error('실패:', e.message); process.exit(1); }
