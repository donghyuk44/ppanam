// 결재 카드 ① 자가 시험 — app.js dropDecided 의 거름(note + meta.approval + meta.status ≠ pending)을
// 진짜 대화록의 승인 사건에 대 본다. 요청 note(status 없음)·실행 note(executed)는 남고, 판정 note(passed·revised)만 빠져야 한다.
import fs from 'node:fs';
const id = process.argv[2] ?? 'apr_5c2ee511';
const lines = fs.readFileSync('teams/dev/log.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ev = lines.filter((e) => e.meta && e.meta.approval === id);
const pred = (e) => e.type === 'note' && e.meta?.approval && e.meta?.status && e.meta.status !== 'pending';
for (const e of ev) console.log(pred(e) ? 'DROP' : 'keep', e.meta.status ?? '-', e.meta.executed ?? '-', e.text.slice(0, 44));
