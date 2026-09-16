// 오늘(2026-09-16) 방 기록에서 우리끼리 말이 몇 줄에 나왔나 — 낱말표(결정 198) 고를 때 근거용. 읽기만 한다.
import fs from 'node:fs';
const files = fs.readdirSync('teams').map(t => `teams/${t}/log.jsonl`).filter(f => fs.existsSync(f));
const lines = [];
for (const f of files) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
  if (!l) continue;
  // 사람 말만(type message·verdict) — tool 줄(명령어 기록)·note(서버 안내)는 뺀다
  try { const o = JSON.parse(l); const ts = String(o.ts || o.time || ''); if (ts.startsWith('2026-09-16') && o.text && (o.type === 'message' || o.type === 'verdict')) lines.push(o.text); } catch {}
}
console.log('lines', lines.length);
const words = ['블록','ack','confirm','회차','단계','evt_','apr_','req_','카드','손','판정','흐름','대리','장부','총괄실','세션','리셋','커밋','스테이지','훅','서브에이전트','감사','잣대','대조','실측','정본','원문','표본','자리','실무','등급','컷리스트','마일스톤','통과 조건','완료 조건','상황판','인수인계','책장','들려주기','패스','차례','순찰','판독','실물','접두어','결재','승인','반려','통과','PASS','REVISE','--small','옮겨 적','올렸','닫았','열었','굳힘','꽂기','붙임','뜻 줄','틱','큐','버스','하네스','이벤트','푸시','kill','대기','막힘','진행 중','--as','bus/','node ','sha','SHA','시각','0절','프로세스','자식','sessions.json','cast.json','work.json','보드','작업판','따라가기','한 장','묶음','대표 차례','대표님 할 일','서버 자리','관리 창','노랑','파랑','에이전트','모델','codex','gemini','opus','sonnet','fable','판 ','판(','뜻','A3','B 카드','C 카드','--done','--ack','--say','apr','req','evt'];
const cnt = words.map(w => [lines.filter(l => l.includes(w)).length, w]).sort((a, b) => b[0] - a[0]);
for (const [n, w] of cnt) console.log(`${n}\t${w}`);
// 예문 — `node … sample 낱말 낱말` 로 부르면 그 낱말이 든 짧은 줄(120자 아래) 둘씩
if (process.argv[2] === 'sample') for (const w of process.argv.slice(3)) {
  const hits = lines.filter(l => l.includes(w) && l.length < 120);
  console.log(`\n## ${w} (${hits.length} short)`);
  for (const h of hits.slice(0, 2)) console.log('  ' + h.replace(/\n/g, ' '));
}
