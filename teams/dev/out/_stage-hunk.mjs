// 같은 작업 트리에서 남의 미커밋 덩이를 쓸어 담지 않게 — 한 파일의 diff(HEAD 대비) 에서 <빼는 말> 이 든 덩이만 빼고 index 에 올린다(R30 사고 뒤).
// node teams/dev/out/_stage-hunk.mjs <파일> --skip <남의 덩이 안 글자> [--skip …]   (index 는 먼저 그 파일만 비운다)
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const file = args[0];
const skips = args.flatMap((a, i) => (a === '--skip' ? [args[i + 1]] : []));
execFileSync('git', ['reset', '-q', '--', file]);
const diff = execFileSync('git', ['diff', '--', file], { encoding: 'utf8' });
if (!diff.trim()) { console.log('바뀐 것 없음 —', file); process.exit(0); }
const lines = diff.split('\n');
const headEnd = lines.findIndex((l) => l.startsWith('@@'));
const head = lines.slice(0, headEnd);
const hunks = []; let cur = null;
for (const l of lines.slice(headEnd)) { if (l.startsWith('@@')) { cur = [l]; hunks.push(cur); } else if (cur) cur.push(l); }
const keep = hunks.filter((h) => !skips.some((s) => h.join('\n').includes(s)));
if (!keep.length) { console.log('올릴 덩이 없음 —', file); process.exit(0); }
const patch = [...head, ...keep.flat()].join('\n') + '\n';
execFileSync('git', ['apply', '--cached', '--recount', '-'], { input: patch });
console.log(`올림 ${keep.length}/${hunks.length} 덩이 — ${file}${skips.length ? ` (뺀 것: ${skips.join(' · ')})` : ''}`);
