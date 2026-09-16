#!/usr/bin/env node
// 작전실에 한 마디 남긴다.
//
//   node bus/say.mjs --as guide "헤드라인 3안 뽑았습니다."
//   node bus/say.mjs --team dev --as review --verdict REVISE "테스트가 없습니다."
//   node bus/say.mjs --as guide --tool Read "teams/marketing/report.md"
//   echo "긴 내용" | node bus/say.mjs --as review --stdin
//
// 누가 말하는지는 --as 가 아니라 환경이 정한다 (docs/event-schema.md 6절).
//   - 서버가 띄운 세션에는 PPANAM_TEAM 이 있다. 그 방에만 말할 수 있고, --as 는 guide · review · ops · system 뿐이다.
//     실무가 --as outside --verdict PASS 로 자기 판정을 외부감사 이름으로 남길 수 있었다 (Fable 재점검, 2026-09-12).
//     outside 는 bus/outside.mjs 가, boss 는 화면이, chief 는 총괄실 세션의 훅이 각자 남긴다 — 여기서는 못 쓴다.
//   - 판정(--verdict)은 감사 자리만 낸다 — review(있으면) · 이 회차의 감사 자리(round.json auditor, 결정 125 — round.mjs auditor ops).
//     만든 사람은 판정하지 않는다 — 닫을 때 자기가 고친 파일을 본 카드인지 본다(bus.selfPassError).
//   - PPANAM_ACTOR 가 있으면(서버가 자리별 세션을 띄울 때 넣는다) --as 는 그 값이어야 한다.
//     ※ 아직 서버가 PPANAM_ACTOR 를 넣지 않는다(자리별 상주 세션은 B1 에서). 그때까지 같은 세션 안의 실무와
//     내부감사 서브에이전트를 구분할 환경 변수가 없어 실무가 --as review --verdict 를 낼 수 있다 (레오 감사,
//     2026-09-12). 외부감사·대표·총괄 사칭은 이미 막혔고, 이 구멍은 B1 이 닫는다.
//   - 환경이 없는 셸은 대표의 터미널이다. 방을 --team 으로 고르되, 위의 화자 제한은 같다.

import { emit, readCast, recordVerdict, verdictSeatError, EVENT_TYPES, VERDICTS, defaultTeam, teamExists, listTeams } from './bus.mjs';

const argv = process.argv.slice(2);
const o = { team: null, type: 'message', actor: null, text: null, verdict: null, target: 'guide', tool: null, stdin: false };
const rest = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') o.team = argv[++i];
  else if (a === '--as' || a === '--actor') o.actor = argv[++i];
  else if (a === '--type') o.type = argv[++i];
  else if (a === '--verdict') { o.verdict = argv[++i]; o.type = 'verdict'; }
  else if (a === '--target') o.target = argv[++i];
  else if (a === '--tool') { o.tool = argv[++i]; o.type = 'tool'; }
  else if (a === '--text') o.text = argv[++i];
  else if (a === '--stdin') o.stdin = true;
  else if (a === '-h' || a === '--help') {
    console.log(`사용법: say.mjs --as <화자> [옵션] "할 말"

  --team    ${listTeams().map((t) => t.id).join(' | ')}   (기본 ${defaultTeam()})
  --as      guide | review | ops | system   (outside 는 outside.mjs, boss 는 화면, chief 는 총괄실 훅)
  --type    ${[...EVENT_TYPES].join(' | ')}
  --verdict ${[...VERDICTS].join(' | ')}   (type 을 verdict 로 만듦)
  --target  판정 대상 (기본 guide)
  --tool    도구 이름 (type 을 tool 로 만듦)
  --stdin   본문을 표준입력에서 읽음`);
    process.exit(0);
  } else rest.push(a);
}

const envTeam = process.env.PPANAM_TEAM ?? null;
const envActor = process.env.PPANAM_ACTOR ?? null;
const team = o.team ?? envTeam ?? defaultTeam();
if (!teamExists(team)) {
  console.error(`오류: '${team}' 팀이 없습니다. 있는 팀: ${listTeams().map((t) => t.id).join(', ')}`);
  process.exit(1);
}
if (envTeam && team !== envTeam) {
  console.error(`오류: 너는 '${envTeam}' 방 사람이다. '${team}' 방에는 말할 수 없다.`);
  process.exit(1);
}
if (!o.actor && envActor) o.actor = envActor;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const text = (o.stdin ? (await readStdin()).trimEnd() : (o.text ?? rest.join(' '))).trim();

if (!o.actor) { console.error('오류: --as <화자> 가 필요합니다. 예) --as guide'); process.exit(1); }
const SAYABLE = new Set(['guide', 'review', 'ops', 'system']);
if (!SAYABLE.has(o.actor)) {
  console.error(`오류: '${o.actor}' 는 여기서 말할 수 없다. outside 는 bus/outside.mjs 가, boss 는 화면이, chief 는 총괄실 세션이 남긴다.`);
  process.exit(1);
}
if (envActor && o.actor !== envActor) {
  console.error(`오류: 너는 '${envActor}' 다. '${o.actor}' 로 말할 수 없다.`);
  process.exit(1);
}
// 판정은 감사 자리만 낸다 — review(있으면) · 이 회차의 감사 자리(round.json auditor, 결정 125). 만든 사람은 판정하지 않는다(닫을 때 파일 단위로 본다).
if (o.type === 'verdict') {
  const seat = verdictSeatError(team, o.actor);
  if (seat) { console.error('오류: ' + seat + ' 외부감사 판정은 bus/outside.mjs 로.'); process.exit(1); }
}
if (!text) { console.error('오류: 할 말이 비어 있습니다.'); process.exit(1); }

const cast = readCast(team);
if (cast.agents && !cast.agents[o.actor]) {
  console.error(`경고: '${o.actor}' 는 ${team} 팀 명단에 없는 화자입니다. 기본 아바타로 표시됩니다.`);
}

let rec;
try {
  // hand:'cli' — 이 자리 세션이 스스로 낸 말이 아니라 명령줄로 대신 친 말이다(C16, 대표 말풍선 색 구분 —
  // 서버 세션 자리는 노랑, 이 길로 온 것은 파랑). 훅(.claude/hooks/to-bus.mjs)이 남기는 말은 hand:'session'.
  rec = o.type === 'verdict'
    ? recordVerdict(team, { actor: o.actor, verdict: o.verdict, text, target: o.target })
    : emit(team, { actor: o.actor, type: o.type, text, meta: { ...(o.tool ? { tool: o.tool } : {}), hand: 'cli' } });
} catch (e) {
  console.error('오류: ' + e.message);
  process.exit(1);
}
// 방의 규칙이 버렸다(결정 132 — 비서실엔 대표·세라의 말만). 오류가 아니라 안 남은 것이다 — 그렇다고 말한다.
if (!rec) { console.error(`[${team}] 이 방엔 ${o.actor} 의 ${o.type} 이 남지 않습니다 — 방 규칙(state/teams.json speakers·only)`); process.exit(2); }

const label = rec.meta?.verdict ? `${rec.type}:${rec.meta.verdict}` : rec.type;
const head = rec.text.length > 48 ? rec.text.slice(0, 48) + '…' : rec.text;
console.log(`[${team}] R${rec.round} ${rec.actor} (${label}) ${head}`);
