#!/usr/bin/env node
// 옛 문장 찾기 — teams/*/out 의 md 에서 낱말이 든 줄을 파일별로 뽑는다(결정이 뒤집힐 때 돌린다).
// 쓰기: node tools/stale-sweep.mjs 피그마 [다른낱말…]
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const words = process.argv.slice(2); if (!words.length) { console.log('낱말을 하나 이상 주세요'); process.exit(1); }
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(path.join(d, e.name))) : (e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
const files = fs.readdirSync(path.join(ROOT, 'teams')).flatMap((t) => { const p = path.join(ROOT, 'teams', t, 'out'); return fs.existsSync(p) ? walk(p) : []; });
let n = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => words.some((w) => l.includes(w)));
  if (!hits.length) continue;
  const rec = lines[0].startsWith('> 기록 문서') ? ' (기록 문서)' : '';
  console.log(`\n${path.relative(ROOT, f)}${rec}`);
  for (const [i, l] of hits) { n++; console.log(`  ${i}: ${l.trim().slice(0, 140)}`); }
}
console.log(`\n${n}줄`);
