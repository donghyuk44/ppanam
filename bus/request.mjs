#!/usr/bin/env node
// 요청 블록 안에서 말하기 (대표 결정 49·51). 계약은 docs/event-schema.md 6-1절.
//
//   node bus/request.mjs --say <id> "…"          두 작업자의 1:1, 톰의 중간 점검 — 같은 줄
//   node bus/request.mjs --done <id> "out/…"     받는 작업자: 됐다 (무엇을 어디에 냈는지)
//   node bus/request.mjs --ack <id>              요청한 작업자: 받았다
//   node bus/request.mjs --confirm <id> ["…"]    톰: 확인 — 이 줄이 있어야 닫힌다
//   node bus/request.mjs --stop <id> "<이유>"     톰: 어긋나서 끊음
//   node bus/request.mjs --goal <id> "…"         톰: 목표 한 줄
//   node bus/request.mjs --list [--team <팀>] [--all] · --show <id>
//
// 누가 쓰는지는 인자가 아니라 환경(PPANAM_TEAM)이 정한다 — 승인과 같은 규칙. 블록을 여는 건 approve.mjs --to 다.
// 줄은 파일에만 쌓인다. 상대의 귀에 넣는 건 서버(notifier)의 일이라 이 명령은 서버가 꺼져 있어도 된다.

import { listRequests, readRequest, appendRequest, whoAmI, LINE_KINDS } from './requests.mjs';
import { readCast } from './bus.mjs';

const argv = process.argv.slice(2);
const o = { mode: null, id: null, team: null, all: false };
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') o.team = argv[++i];
  else if (a === '--all') o.all = true;
  else if (a === '--list' || a === '-l') o.mode = 'list';
  else if (a === '--show' || a === '-s') { o.mode = 'show'; o.id = argv[++i]; }
  else if (['--say', '--done', '--ack', '--confirm', '--stop', '--goal'].includes(a)) { o.mode = a.slice(2); o.id = argv[++i]; }
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else words.push(a);
}

function usage() {
  console.log(`요청 블록 — 팀이 팀에게 직접 (결정 49·51).

  --say <id> "…"          두 작업자의 1:1, 톰의 중간 점검
  --done <id> "…"         받는 작업자: 됐다 — 무엇을 어디에 냈는지 (out/… 는 링크가 된다)
  --ack <id>              요청한 작업자: 받았다
  --confirm <id> ["…"]    톰: 확인 — 이 줄이 있어야 닫힌다
  --stop <id> "<이유>"     톰: 어긋나서 끊음
  --goal <id> "…"         톰: 목표 한 줄
  --list [--team <팀>] [--all]   열린 것 (--all 이면 닫힌 것도)
  --show <id>

블록을 여는 건 approve.mjs --request B --to <팀> 이다. 누가 쓰는지는 환경(PPANAM_TEAM)이 정한다.`);
}

const nameOf = (who) => who ? (readCast(who.team).agents?.[who.actor]?.name ?? `${who.team}/${who.actor}`) : '서버';
const STATUS = { open: '열림', done: '됐다', acked: '받았다', closed: '닫힘' };
const fmt = (r) => `${r.id}  ${STATUS[r.status] ?? r.status}${r.status === 'closed' ? '(' + r.closedBy + ')' : ''}  ${r.from.team}→${r.to.team}  ${nameOf(r.from)}→${nameOf(r.to)}  ${r.what}${r.mode === 'milestone' ? `  [마일스톤 ${r.until?.milestone ?? '?'} 끝까지]` : ''}`;

if (!o.mode) { usage(); process.exit(0); }

if (o.mode === 'list') {
  const rows = listRequests({ team: o.team }).filter((r) => o.all || r.status !== 'closed');
  if (!rows.length) { console.log(o.all ? '요청 블록이 없습니다.' : '열린 요청 블록이 없습니다.'); process.exit(0); }
  for (const r of rows) console.log(fmt(r));
  process.exit(0);
}

if (o.mode === 'show') {
  const r = readRequest(o.id);
  if (!r) { console.error(`없음: ${o.id}`); process.exit(1); }
  console.log(fmt(r));
  if (r.why) console.log(`왜: ${r.why}`);
  if (r.due) console.log(`기한: ${r.due}`);
  if (r.goal) console.log(`목표(톰): ${r.goal}`);
  for (const l of r.thread) console.log(`  ${l.ts.slice(11, 16)} ${l.kind.padEnd(7)} ${nameOf(l.by).padEnd(4)} ${l.text}`);
  process.exit(0);
}

// 줄 쓰기
if (!LINE_KINDS[o.mode]) { usage(); process.exit(1); }
const who = whoAmI();
if (!who) { console.error('오류: 방이 지정되지 않은 셸에서는 쓸 수 없습니다. 세션 안에서 부르세요.'); process.exit(1); }
try {
  const r = appendRequest(o.id, o.mode, { who, text: words.join(' ') });
  console.log(fmt(r));
  if (r.status === 'closed') console.log('닫혔습니다. 대화는 파일로 남고(state/requests/), 두 방에 완료 note 가 갔습니다.');
  else if (o.mode === 'done') console.log('요청한 쪽이 --ack 으로 받으면, 톰이 --confirm 으로 닫습니다.');
  else if (o.mode === 'ack') console.log('톰의 --confirm 을 기다립니다.');
  else console.log('상대와 톰의 귀에는 서버가 넣습니다.');
} catch (e) {
  console.error('오류: ' + e.message);
  process.exit(1);
}
