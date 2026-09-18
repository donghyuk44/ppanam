// /api/upload silent 실측(C17) — 1×1 png 와 작은 pdf 를 조용히 올려 파일만 저장되고 말풍선은 안 서는지. 올린 파일은 바로 지운다. node teams/dev/out/_upload-silent-check.mjs [포트]
import fs from 'node:fs';
const port = process.argv[2] ?? 4321;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pdf = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const before = fs.readFileSync('teams/dev/log.jsonl', 'utf8').split('\n').length;
for (const [mime, data] of [['image/png', png], ['application/pdf', pdf]]) {
  const r = await fetch(`http://localhost:${port}/api/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team: 'dev', data, mime, silent: true }) });
  const j = await r.json();
  console.log(mime.padEnd(16), r.status, JSON.stringify(j));
  if (j.name) { const p = `teams/dev/in/${j.name}`; console.log('  파일', fs.existsSync(p) ? `있음 ${fs.statSync(p).size}바이트 → 지움` : '없음'); try { fs.unlinkSync(p); } catch { /* */ } }
}
const after = fs.readFileSync('teams/dev/log.jsonl', 'utf8').split('\n').length;
console.log('대화록 줄 수', before, '→', after, after === before ? '(말풍선 없음 ✓)' : '(말풍선 생김 ✗)');
