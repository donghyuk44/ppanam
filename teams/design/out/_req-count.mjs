import fs from 'fs';
const dir = 'state/requests';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
const counts = {};
for (const f of files) {
  const lines = fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length-1]);
  const st = last.status || last.state || 'unknown';
  counts[st] = (counts[st]||0)+1;
}
console.log('total files:', files.length);
console.log(counts);
