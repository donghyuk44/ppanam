#!/usr/bin/env node
// 작전실에 한 마디 남긴다.
//
//   node bus/say.mjs --as guide "헤드라인 3안 뽑았습니다."
//   node bus/say.mjs --team dev --as review --verdict REVISE "테스트가 없습니다."
//   node bus/say.mjs --as guide --tool Read "teams/marketing/report.md"
//   echo "긴 내용" | node bus/say.mjs --as outside --stdin

import { emit, readCast, recordVerdict, EVENT_TYPES, VERDICTS, defaultTeam, teamExists, listTeams } from './bus.mjs';

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
  --as      guide | review | outside | boss | system
  --type    ${[...EVENT_TYPES].join(' | ')}
  --verdict ${[...VERDICTS].join(' | ')}   (type 을 verdict 로 만듦)
  --target  판정 대상 (기본 guide)
  --tool    도구 이름 (type 을 tool 로 만듦)
  --stdin   본문을 표준입력에서 읽음`);
    process.exit(0);
  } else rest.push(a);
}

const team = o.team ?? process.env.PPANAM_TEAM ?? defaultTeam();
if (!teamExists(team)) {
  console.error(`오류: '${team}' 팀이 없습니다. 있는 팀: ${listTeams().map((t) => t.id).join(', ')}`);
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const text = (o.stdin ? (await readStdin()).trimEnd() : (o.text ?? rest.join(' '))).trim();

if (!o.actor) { console.error('오류: --as <화자> 가 필요합니다. 예) --as guide'); process.exit(1); }
if (!text) { console.error('오류: 할 말이 비어 있습니다.'); process.exit(1); }

const cast = readCast(team);
if (cast.agents && !cast.agents[o.actor]) {
  console.error(`경고: '${o.actor}' 는 ${team} 팀 명단에 없는 화자입니다. 기본 아바타로 표시됩니다.`);
}

let rec;
try {
  rec = o.type === 'verdict'
    ? recordVerdict(team, { actor: o.actor, verdict: o.verdict, text, target: o.target })
    : emit(team, { actor: o.actor, type: o.type, text, ...(o.tool ? { meta: { tool: o.tool } } : {}) });
} catch (e) {
  console.error('오류: ' + e.message);
  process.exit(1);
}

const label = rec.meta?.verdict ? `${rec.type}:${rec.meta.verdict}` : rec.type;
const head = rec.text.length > 48 ? rec.text.slice(0, 48) + '…' : rec.text;
console.log(`[${team}] R${rec.round} ${rec.actor} (${label}) ${head}`);
