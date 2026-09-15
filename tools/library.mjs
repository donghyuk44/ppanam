#!/usr/bin/env node
// 서고와 사서 (대표 결정 09-14 · 경영 M1). 문서를 다 읽지 않는다 — 목차로 좁히고, 색인으로 절을 고르고, 그 줄만 읽는다.
//
//   node tools/library.mjs build [--full] [--dry]   바뀐 것만 다시 읽어 목차·색인을 갱신한다. 다시 읽은 장수를 센다
//   node tools/library.mjs toc                      목차 한 장 (10KB 한도) — 늘 들고 있어도 되는 것
//   node tools/library.mjs show <경로>…              그 문서의 색인: 절 · 줄 범위 · 크기 · 낱말. 본문은 안 연다
//   node tools/library.mjs find <낱말>…              목차·색인만 뒤져 후보 절을 낸다. 본문 0바이트
//   node tools/library.mjs check                    통과 조건을 잰다 — 가) 본문 0 나) 다시 읽음 0/전체 다) 목차 ≤10KB
//
// 어디에: teams/finance/out/library/ — toc.md(목차) · manifest.json(장부) · index/<경로>.json(문서마다 색인)
// 바뀜은 크기+수정시각으로 잡는다 — teams/*/out/ 은 .gitignore 라 sha 가 없다. 둘이 그대로면 다시 읽지 않는다.
// toc·show·find 는 먼저 build 를 조용히 돈다(stat 만, 바뀐 장만 읽음) — 갱신을 사람이 기억하지 않아도 되게.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, listTeams } from '../bus/bus.mjs';

export const LIB_DIR = path.join(ROOT, 'teams', 'finance', 'out', 'library');
export const TOC_PATH = path.join(LIB_DIR, 'toc.md');
export const MANIFEST_PATH = path.join(LIB_DIR, 'manifest.json');
export const INDEX_DIR = path.join(LIB_DIR, 'index');
export const TOC_LIMIT = 10_000;            // 다) 목차가 이보다 크면 목차가 또 낭비다
const EXTS = new Set(['.md', '.txt', '.json']);
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);   // 그림은 읽지 않는다 — 이름·크기만 목차에 올린다 (헨리 확인, 물음 1: 판정에 그림이 빠졌다)
const SKIP_DIRS = new Set(['node_modules', '.git', 'ref']);
const SKIP_FILES = new Set(['cast.json', 'round.json', 'progress.json', 'log.jsonl', 'rounds.jsonl', 'round.json.bak']);
const COLLAPSE_AT = 4;                     // 같은 폴더에 같은 확장자(.md 빼고)가 이만큼 이상이면 목차 한 줄로 접는다
const BUNDLE_AT = 8;                       // README.md 가 있고 옆에 같은 틀 md 가 이만큼 이상이면 README 한 줄 + "*.md N장" 한 줄로 접는다

/* ── 서고: 무엇이 문서인가 ── */

const teamName = (() => {
  const m = Object.fromEntries(listTeams().map((t) => [t.id, t.name]));
  return (rel) => {
    if (rel.startsWith('teams/')) return m[rel.split('/')[1]] ?? rel.split('/')[1];
    return '공용';
  };
})();

// 바뀜의 지문: 크기 · mtime(ns) · ctime(ns). mtime 은 cp -p·rsync -t·touch 가 옛 값으로 되돌릴 수 있지만 ctime 은 커널만 쓰고
// 어떤 쓰기든 올린다. 셋이 다 같은데 본문만 다르려면 같은 나노초에 두 번 써야 한다 — 그건 안 생긴다. 그래도 의심되면 build --full.
function stamp(abs) {
  const st = fs.statSync(abs, { bigint: true });
  return { size: Number(st.size), mtime: String(st.mtimeNs), ctime: String(st.ctimeNs) };
}
const same = (a, b) => a && b && a.size === b.size && a.mtime === b.mtime && a.ctime === b.ctime;

export function walkCorpus() {
  const files = [];
  const visit = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && p !== LIB_DIR) visit(p); continue; }
      if (!e.isFile() || SKIP_FILES.has(e.name)) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (EXTS.has(ext)) files.push({ rel: path.relative(ROOT, p), kind: 'doc', ...stamp(p) });
      else if (IMG_EXTS.has(ext)) files.push({ rel: path.relative(ROOT, p), kind: 'image', ...stamp(p) });
    }
  };
  for (const top of ['CLAUDE.md', 'AGENTS.md', 'docs', 'teams']) {
    const abs = path.join(ROOT, top);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) visit(abs);
    else files.push({ rel: top, kind: 'doc', ...stamp(abs) });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ── 낱말: 절마다 무엇을 말하는지 ── */

const STOP = new Set(('그 이 저 것 수 등 및 때 한 더 안 못 또 좀 잘 왜 곧 뒤 앞 위 중 전 후 내 네 우리 그리고 그래서 하지만 그런데 그러면 이번 지금 여기 거기 없다 있다 한다 된다 같다 대한 위한 통해 대해 하나 하는 있는 없는 되는 같은 이제 아직 다시 먼저 바로 모두 각 그것 이것 것이 것은 것을 수도 사람 정도 경우 자체 위해 때문 아니라 아니다 이렇게 그렇게 어떻게 그대로 바로 따로 서로 스스로 ' +
  'the and for with that this from are was not but http https com www md json mjs true false null').split(/\s+/));
// 이·가 는 안 뗀다 — 컷어웨이·높이 같은 낱말 끝을 잘라 먹는다. 그대로·바로 는 '로' 를 떼기 전에 STOP 에서 걸러진다.
const PARTICLES = ['에서는', '으로는', '에게는', '에서', '으로', '에게', '까지', '부터', '처럼', '보다', '은', '는', '을', '를', '의', '에', '로', '와', '과', '도', '만'];

function tokens(text) {
  const out = [];
  for (let t of String(text).split(/[^\p{L}\p{N}._\-/]+/u)) {
    t = t.replace(/^[._\-/]+|[._\-/]+$/g, '');
    if (!t || STOP.has(t.toLowerCase())) continue;
    for (const p of PARTICLES) { if (t.endsWith(p) && t.length - p.length >= 2 && /[가-힣]$/.test(t)) { t = t.slice(0, -p.length); break; } }
    const low = t.toLowerCase();
    if (low.length < 2 || STOP.has(low)) continue;
    if (/^\d+$/.test(low) && low.length < 4) continue;     // 짧은 숫자는 혼자서는 뜻이 없다 (결정 85 의 85)
    out.push(low);
  }
  return out;
}

function topWords(text, { boost = '', n = 8 } = {}) {
  const score = new Map();
  for (const t of tokens(text)) score.set(t, (score.get(t) ?? 0) + 1);
  for (const t of tokens(boost)) score.set(t, (score.get(t) ?? 0) + 3);
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([t]) => t);
}

/* ── 색인: 문서 한 장을 절로 가른다 ── */

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const firstLine = (lines) => (lines.find((l) => l.trim()) ?? '').trim();

function indexMarkdown(text) {
  const lines = text.split('\n');
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), at: i + 1 });
  });
  const sections = [];
  const pre = lines.slice(0, (heads[0]?.at ?? lines.length + 1) - 1);
  const title = heads.find((h) => h.level === 1)?.title || firstLine(pre) || heads[0]?.title || '';
  const preBody = pre.filter((l) => l.trim());
  if (preBody.length && heads.length) {
    const t = preBody.join('\n');
    sections.push({ level: 0, title: '(머리)', from: 1, to: heads[0].at - 1, bytes: bytes(t), words: topWords(t) });
  }
  // 절은 겹치지 않는다 — 제목 줄부터 다음 제목(급 상관없이) 앞줄까지. "이 줄만 읽어라" 에 쓰는 범위라 평평해야 하고, bytes 는 제목 줄까지 센다.
  const cut = (level, title, from, to) => {
    const body = lines.slice(from - 1, to).join('\n');
    return { level, title, from, to, bytes: bytes(body), words: topWords(body, { boost: title }) };
  };
  heads.forEach((h, i) => {
    const to = heads[i + 1] ? heads[i + 1].at - 1 : lines.length;
    const sec = cut(h.level, h.title, h.at, to);
    // 확정 조항처럼 "N. …" 번호 항목이 제목 없이 길게 이어지는 절(6KB 넘고 항목 5개 이상)은 항목마다 가른다 — 안 그러면 절 하나가 120KB 다.
    const items = sec.bytes > 6000 ? lines.slice(h.at, to).map((l, k) => ({ l, at: h.at + k + 1 })).filter(({ l }) => /^\d+\.\s+\S/.test(l)) : [];
    if (items.length < 5) { sections.push(sec); return; }
    if (items[0].at > h.at + 1) sections.push(cut(h.level, h.title, h.at, items[0].at - 1));
    items.forEach((it, k) => {
      const end = items[k + 1] ? items[k + 1].at - 1 : to;
      sections.push(cut(h.level + 1, it.l.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 80), it.at, end));
    });
  });
  if (!sections.length) sections.push({ level: 0, title: '(전체)', from: 1, to: lines.length, bytes: bytes(text), words: topWords(text) });
  return { title, lines: lines.length, sections, words: topWords(text, { n: 12, boost: title }) };
}

function indexJSON(text, data) {
  const lines = text.split('\n');
  const summary = (v) => Array.isArray(v) ? `배열 ${v.length}` : v && typeof v === 'object' ? `객체 ${Object.keys(v).length}키` : typeof v === 'string' ? JSON.stringify(v.slice(0, 24)) : String(v);
  const sections = [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data);
    let cursor = 0;
    const starts = keys.map((k) => {           // 들여쓰기 0~2칸의 "키": — 예쁘게 찍힌 json 의 맨 위 키만 잡힌다
      const quoted = new RegExp(`^\\s{0,2}"${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`);
      for (let i = cursor; i < lines.length; i++) if (quoted.test(lines[i])) { cursor = i + 1; return i + 1; }
      return null;
    });
    keys.forEach((k, i) => {
      const from = starts[i] ?? 1;
      const nextStart = starts.slice(i + 1).find((s) => s != null);
      const to = nextStart ? nextStart - 1 : lines.length;
      const v = JSON.stringify(data[k]) ?? '';
      sections.push({ level: 1, title: `${k} (${summary(data[k])})`, from, to, bytes: bytes(v), words: topWords(v.slice(0, 4000), { boost: k }) });
    });
  } else {
    sections.push({ level: 0, title: `(${summary(data)})`, from: 1, to: lines.length, bytes: bytes(text), words: topWords(text.slice(0, 4000)) });
  }
  const named = data && typeof data === 'object' && !Array.isArray(data) ? (data.title ?? data.name ?? data.destination ?? null) : null;
  const title = typeof named === 'string' ? named : `${summary(data)}: ${sections.slice(0, 5).map((s) => s.title.split(' ')[0]).join('·')}`;
  return { title, lines: lines.length, sections, words: topWords(text.slice(0, 20000), { n: 12 }) };
}

export function indexFile(rel, text) {
  const ext = path.extname(rel);
  if (ext === '.md') return indexMarkdown(text);
  try { return indexJSON(text, JSON.parse(text)); } catch { /* json 이 아니다 — 글로 본다 */ }
  const lines = text.split('\n');
  return { title: firstLine(lines).slice(0, 80), lines: lines.length, sections: [{ level: 0, title: '(전체)', from: 1, to: lines.length, bytes: bytes(text), words: topWords(text) }], words: topWords(text, { n: 12 }) };
}

/* ── 장부와 갱신 ── */

const readJSON = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const indexPath = (rel) => path.join(INDEX_DIR, `${rel}.json`);

// 이 프로세스가 문서 본문을 읽은 바이트. build 만 올린다 — show·find 뒤에 그대로면 통과 조건 가)의 증거다.
export let BODY_READ = 0;
function readBody(rel) { const t = fs.readFileSync(path.join(ROOT, rel), 'utf8'); BODY_READ += Buffer.byteLength(t, 'utf8'); return t; }

export function readManifest() { return readJSON(MANIFEST_PATH, { builtAt: null, files: {} }); }

/**
 * 바뀐 것만 다시 읽는다. 돌려주는 값이 곧 통과 조건 나)의 증거다: reread / total.
 * dry 면 무엇을 읽어야 하는지만 세고 아무것도 쓰지 않는다. full 은 장부를 버리고 전부 읽는다.
 */
const INDEX_VERSION = 3;   // 색인 규칙이 바뀌면 올린다 — 장부의 판이 다르면 전부 다시 읽는다 (안 그러면 옛 규칙 색인이 남는다)

export function build({ full = false, dry = false } = {}) {
  const had = readManifest();
  const prev = full || had.version !== INDEX_VERSION ? { files: {} } : had;
  const now = walkCorpus();
  const next = { version: INDEX_VERSION, builtAt: new Date().toISOString(), tocLimit: TOC_LIMIT, files: {} };
  let added = 0, changed = 0, bodyBytes = 0, images = 0;
  const reread = [];
  for (const f of now) {
    const old = prev.files[f.rel];
    if (f.kind === 'image') {              // 그림은 열지 않는다 — 이름·크기·지문만 장부에
      images++;
      next.files[f.rel] = { kind: 'image', size: f.size, mtime: f.mtime, ctime: f.ctime };
      continue;
    }
    if (same(old, f) && (dry || fs.existsSync(indexPath(f.rel)))) { next.files[f.rel] = old; continue; }
    if (old) changed++; else added++;
    reread.push(f.rel);
    if (dry) { next.files[f.rel] = old ?? { size: f.size, mtime: f.mtime, ctime: f.ctime }; continue; }
    const text = readBody(f.rel);
    bodyBytes += f.size;
    const ix = indexFile(f.rel, text);
    fs.mkdirSync(path.dirname(indexPath(f.rel)), { recursive: true });
    fs.writeFileSync(indexPath(f.rel), JSON.stringify({ path: f.rel, size: f.size, mtime: f.mtime, ctime: f.ctime, team: teamName(f.rel), ...ix }, null, 1));
    next.files[f.rel] = { size: f.size, mtime: f.mtime, ctime: f.ctime, lines: ix.lines, title: ix.title, sections: ix.sections.length, words: ix.words };
  }
  const removed = Object.keys(prev.files).filter((rel) => !next.files[rel]);
  if (!dry) {
    for (const rel of removed) { try { fs.rmSync(indexPath(rel)); } catch { /* 이미 없다 */ } }
    fs.mkdirSync(LIB_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(next, null, 1));
    fs.writeFileSync(TOC_PATH, renderToc(next));
  }
  const toc = dry ? (fs.existsSync(TOC_PATH) ? fs.statSync(TOC_PATH).size : null) : fs.statSync(TOC_PATH).size;
  return { total: now.length - images, images, reread: reread.length, rereadList: reread, added, changed, removed: removed.length, bodyBytes, tocBytes: toc, dry };
}

/* ── 목차 ── */

const kb = (b) => (b < 10240 ? `${(b / 1024).toFixed(1)}K` : `${Math.round(b / 1024)}K`);
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
// 제목이 안 들어가면 " — " 뒤 부제부터 버린다 — "아트 디렉션 2판 — 인형 마을로 본 …" 보다 "아트 디렉션 2판" 이 낫다.
const clipTitle = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const head = s.split(/\s[—–-]\s/)[0]; return clip(head.length >= 4 ? head : s, n); };

function tocLines(m, descLen) {
  const groups = new Map();
  for (const [rel, f] of Object.entries(m.files)) {
    const dir = path.dirname(rel) === '.' ? '(뿌리)' : `${path.dirname(rel)}/`;
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push({ rel, name: path.basename(rel), ...f });
  }
  const out = [];
  const sum = (xs) => xs.reduce((a, f) => a + f.size, 0);
  const stem = (f) => f.name.replace(/\.[^.]+$/, '');
  for (const [dir, all] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const files = all.filter((f) => f.kind !== 'image');
    const imgs = all.filter((f) => f.kind === 'image').sort((a, b) => a.name.localeCompare(b.name));
    const head = [files.length ? `${files.length}장` : '', imgs.length ? `그림 ${imgs.length}` : ''].filter(Boolean).join(' · ');
    out.push('', `## ${dir} — ${teamName(all[0].rel)} · ${head} ${kb(sum(all))}`);
    const byExt = new Map();
    for (const f of files) { const e = path.extname(f.name); if (!byExt.has(e)) byExt.set(e, []); byExt.get(e).push(f); }
    for (const [ext, fs_] of [...byExt.entries()].sort((a, b) => (a[0] === '.md' ? -1 : b[0] === '.md' ? 1 : a[0].localeCompare(b[0])))) {
      fs_.sort((a, b) => a.name.localeCompare(b.name));
      if (ext !== '.md' && fs_.length >= COLLAPSE_AT) {
        out.push(`*${ext} ${fs_.length}장 ${kb(sum(fs_))} ${clip(fs_.map(stem).join('·'), descLen)}`);
        continue;
      }
      // README 가 틀을 설명하는 같은 꼴 묶음(20-people·40-persona) — README 한 줄 + 나머지 한 줄. 이름은 접힌 줄에 남아 find 로 잡힌다.
      const readme = ext === '.md' ? fs_.find((f) => f.name === 'README.md') : null;
      const rest = readme ? fs_.filter((f) => f !== readme) : fs_;
      if (readme && rest.length >= BUNDLE_AT) {
        out.push(`${readme.name} ${kb(readme.size)} ${clipTitle(readme.title, descLen)}`);
        out.push(`*.md ${rest.length}장 ${kb(sum(rest))} ${clip(rest.map(stem).join('·'), descLen)}`);
        continue;
      }
      for (const f of fs_) out.push(`${f.name} ${kb(f.size)} ${clipTitle(f.title, descLen)}`);
    }
    // 그림은 이름만 — 판정에 그림이 들어갈 때 어디 있는지는 알아야 한다. 열지는 않는다.
    if (imgs.length) out.push(`그림 ${imgs.length}장 ${kb(sum(imgs))} ${clip(imgs.map(stem).join('·'), descLen)}`);
  }
  return out;
}

export function renderToc(m = readManifest()) {
  const files = Object.values(m.files);
  const docs = files.filter((f) => f.kind !== 'image');
  const at = m.builtAt ? new Date(m.builtAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '—';
  const head = [
    `# 서고 목차 · ${at} KST · 문서 ${docs.length}장 ${kb(docs.reduce((a, f) => a + f.size, 0))} · 그림 ${files.length - docs.length}장 · node tools/library.mjs`,
    '후보를 고른다 → `show <경로>` 로 절·줄을 본다 → 그 줄만 읽는다. `find <낱말>` 은 목차·색인만 뒤진다. 남에게 전할 땐 절 이름으로(줄은 밀린다). 줄: 파일 크기 제목. `*.json N장`·`*.md N장`·`그림 N장` 은 접은 것.',
  ];
  for (const n of [48, 40, 34, 28, 22, 16]) {
    const text = [...head, ...tocLines(m, n), ''].join('\n');
    if (bytes(text) <= TOC_LIMIT) return text;
  }
  return [...head, `> 경고: 제목을 16자로 줄여도 ${TOC_LIMIT} 바이트를 넘는다 — 서고가 커졌다. 접는 규칙을 손봐야 한다.`, ...tocLines(m, 16), ''].join('\n');
}

/* ── 사서: 찾기 ── */

export function showIndex(rel) {
  const entry = readManifest().files[rel];
  if (entry?.kind === 'image') return `${rel} · 그림 ${kb(entry.size)} — 색인 없음(그림은 안 읽는다). 볼 사람이 직접 연다.`;
  const ix = readJSON(indexPath(rel), null);
  if (!ix) return null;
  // 절 이름이 먼저, 줄은 뒤 — 줄 번호는 그날 밀린다(테라, 09-14). 남에게 전할 때는 절 이름으로, 줄은 지금 읽을 때만.
  const lines = [`${ix.path} · ${ix.team} · ${kb(ix.size)} ${ix.lines}줄 · ${ix.sections.length}절 · ${ix.title}`];
  for (const s of ix.sections) lines.push(`  ${'#'.repeat(s.level) || '·'} ${s.title} — L${s.from}-${s.to} ${kb(s.bytes)} · ${s.words.join(' ')}`);
  return lines.join('\n');
}

export function find(words, { limit = 12 } = {}) {
  const q = [...new Set(words.flatMap((w) => tokens(w).length ? tokens(w) : [w.toLowerCase()]))];
  const m = readManifest();
  const hits = [];
  let opened = 0;
  for (const [rel, f] of Object.entries(m.files)) {
    const hay = `${rel} ${f.title ?? ''} ${(f.words ?? []).join(' ')}`.toLowerCase();
    const docScore = q.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
    if (f.kind === 'image') { if (docScore) hits.push({ rel, score: docScore, s: null, image: true }); continue; }   // 그림은 이름으로만
    const ix = readJSON(indexPath(rel), null);
    if (!ix) continue;
    opened++;
    let anySection = false;
    for (const s of ix.sections) {
      const shay = `${s.title} ${s.words.join(' ')}`.toLowerCase();
      const sec = q.reduce((a, w) => a + (s.title.toLowerCase().includes(w) ? 2 : shay.includes(w) ? 1 : 0), 0);
      if (sec) { anySection = true; hits.push({ rel, score: sec * 2 + docScore, s }); }
    }
    if (docScore && !anySection) hits.push({ rel, score: docScore, s: null });
  }
  hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  return { query: q, hits: hits.slice(0, limit), opened, total: Object.values(m.files).filter((f) => f.kind !== 'image').length };
}

/* ── CLI ── */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  const report = (r) => `다시 읽음 ${r.reread}/${r.total}장 (새 ${r.added} · 바뀜 ${r.changed} · 사라짐 ${r.removed}) · 그림 ${r.images}장(안 읽음) · 본문 ${r.bodyBytes.toLocaleString()}바이트 · 목차 ${r.tocBytes ?? '—'}바이트 (한도 ${TOC_LIMIT.toLocaleString()})${r.dry ? ' · 마른 실행(안 씀)' : ''}`;
  const quietRefresh = () => { const r = build(); return r.reread ? `(갱신: 바뀐 ${r.reread}장 다시 읽음 — ${r.rereadList.slice(0, 5).join(', ')}${r.reread > 5 ? ' …' : ''})\n` : ''; };
  if (cmd === 'build') {
    const r = build({ full: flags.has('--full'), dry: flags.has('--dry') });
    console.log(report(r));
    if (flags.has('--list') && r.rereadList.length) console.log(r.rereadList.join('\n'));
  } else if (cmd === 'toc') {
    process.stdout.write(quietRefresh() + fs.readFileSync(TOC_PATH, 'utf8'));
  } else if (cmd === 'show') {
    if (!args.length) { console.error('쓰는 법: show <경로>…'); process.exit(2); }
    process.stdout.write(quietRefresh());
    for (const rel of args) { const t = showIndex(rel); console.log(t ?? `색인 없음: ${rel} — 서고 밖이거나 경로가 다르다 (toc 에서 찾아라)`); }
    console.log('본문 읽음 0바이트 — 색인만 열었다');
  } else if (cmd === 'find') {
    if (!args.length) { console.error('쓰는 법: find <낱말>… [--limit N]'); process.exit(2); }
    process.stdout.write(quietRefresh());
    const lim = Number((rest.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1]) || 15;
    const r = find(args, { limit: lim });
    console.log(`찾는 말: ${r.query.join(' ')}`);
    for (const h of r.hits) console.log(h.s ? `  ${h.rel} · ${h.s.title} — L${h.s.from}-${h.s.to} ${kb(h.s.bytes)} (${h.score})` : h.image ? `  ${h.rel} (그림 — 이름만 맞음, ${h.score})` : `  ${h.rel} (문서 제목·낱말만 맞음, ${h.score})`);
    if (!r.hits.length) console.log('  (없음 — 다른 말로 찾거나 toc 를 훑어라)');
    console.log(`본문 읽음 0바이트 · 목차 1장 · 색인 ${r.opened}/${r.total}장 열어봄`);
  } else if (cmd === 'check') {
    const built = build();
    const again = build({ dry: true });
    const before = BODY_READ;
    const f = find(['판정']);
    showIndex(Object.keys(readManifest().files)[0] ?? '');
    const bodyDuringLookup = BODY_READ - before;
    const toc = fs.statSync(TOC_PATH).size;
    // 나) 를 자기충족으로 두지 않는다 (노라 지적) — 서고 안에 임시 문서를 하나 넣고 새로 생김 → 같은 크기로 본문만 바뀜 → 사라짐 셋을 실제로 잰다.
    const scratch = 'teams/finance/out/_사서-점검.md';
    const abs = path.join(ROOT, scratch);
    const only = (r) => r.reread === 1 && r.rereadList[0] === scratch;
    let probe;
    try {
      fs.writeFileSync(abs, '# 사서 점검\n\n가\n');
      const a = build({ dry: true }); const aOk = only(a) && a.added === 1;
      build();
      fs.writeFileSync(abs, '# 사서 점검\n\n나\n');          // 바이트 수 같음 — 크기로는 못 잡는다
      const b = build({ dry: true }); const bOk = only(b) && b.changed === 1;
      fs.rmSync(abs);
      const c = build(); const cOk = c.reread === 0 && c.removed === 1;
      probe = { ok: aOk && bOk && cOk, why: `새로 생김 ${a.reread}/${a.total}(${aOk ? '잡음' : '놓침'}) · 같은 크기로 본문만 바뀜 ${b.reread}/${b.total}(${bOk ? '잡음' : '놓침'}) · 사라짐 ${c.removed}(${cOk ? '지움' : '남음'})` };
    } finally { if (fs.existsSync(abs)) { fs.rmSync(abs); build(); } }
    const rows = [
      ['가) 물음 하나에 본문 읽은 바이트 = 0', bodyDuringLookup === 0 && f.opened > 0, `find+show 가 본문 ${bodyDuringLookup}바이트, 색인 ${f.opened}장`],
      ['나) 안 바뀌었을 때 다시 읽은 장수 = 0', again.reread === 0, `${again.reread}/${again.total}장`],
      ['나′) 바뀐 것만 잡나 (임시 문서로 실측)', probe.ok, probe.why],
      [`다) 목차 ≤ ${TOC_LIMIT.toLocaleString()}바이트`, toc <= TOC_LIMIT, `${toc.toLocaleString()}바이트`],
    ];
    console.log(`이번 build: ${report(built)}`);
    let ok = true;
    for (const [name, pass, why] of rows) { ok &&= pass; console.log(`${pass ? '✓' : '✗'} ${name} — ${why}`); }
    process.exit(ok ? 0 : 1);
  } else {
    console.log(`서고와 사서.\n  build [--full] [--dry] [--list]   바뀐 것만 다시 읽어 갱신\n  toc                              목차 (≤${TOC_LIMIT} 바이트)\n  show <경로>…                      문서의 절·줄 범위·낱말\n  find <낱말>…                      목차·색인만 뒤져 후보 절\n  check                            통과 조건 가·나·다`);
    process.exit(cmd ? 2 : 0);
  }
}
