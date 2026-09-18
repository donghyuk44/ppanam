// 같은 작업 트리에서 남의 미커밋 덩이를 쓸어 담지 않게 — 한 파일의 diff 에서 <찾는 말> 이 든 덩이만 index 에 올린다(R30 사고 뒤).
// node teams/dev/out/_stage-hunk.mjs <파일> <덩이 안 글자>
import { execFileSync } from 'node:child_process';
const [file, needle] = process.argv.slice(2);
const diff = execFileSync('git', ['diff', '-U0', '--', file], { encoding: 'utf8' });
const lines = diff.split('\n');
const headEnd = lines.findIndex((l) => l.startsWith('@@'));
const head = lines.slice(0, headEnd);
const hunks = []; let cur = null;
for (const l of lines.slice(headEnd)) { if (l.startsWith('@@')) { cur = [l]; hunks.push(cur); } else if (cur) cur.push(l); }
const keep = hunks.filter((h) => h.join('\n').includes(needle));
if (!keep.length) { console.error('덩이 없음:', needle); process.exit(2); }
const patch = [...head, ...keep.flat()].join('\n') + '\n';
execFileSync('git', ['apply', '--cached', '--unidiff-zero', '-'], { input: patch });
console.log(`올림 ${keep.length}/${hunks.length} 덩이 — ${file}`);
