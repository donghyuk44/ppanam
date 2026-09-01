#!/usr/bin/env node
// 총괄 배달 — 대표의 지시를 팀 작전실로 옮긴다.
//
//   node bus/dispatch.mjs --to marketing "9월 캠페인 카피를 맡는다. 예산은 아직 정하지 마라."
//   node bus/dispatch.mjs --to marketing,dev --assign-file plan.md
//   node bus/dispatch.mjs --to marketing --origin "<대표 원문>" "<이 팀 배분>"
//
// **요약만 보내지 않는다.** 대표 원문이 그대로 가고, 배분은 그 위에 얹힌다.
// 나중에 감사역이 "이 지시의 근거가 어디 있냐"고 물었을 때 답할 것이 총괄의
// 요약뿐이면 그건 근거가 아니다.
//
// 원문은 총괄실 대화록에서 자동으로 가져온다(가장 최근 대표 발언).
// 다른 걸 보내려면 --origin 으로 직접 준다.
//
// 봉투는 훅이 받는 즉시 두 개의 이벤트로 갈라진다 — 원문은 대표 말풍선,
// 배분은 총괄 말풍선. 스키마가 갈라놓으므로 섞일 수 없다.

import fs from 'node:fs';
import {
  listTeams, teamExists, isOffice, readTail, readState, defaultTeam,
  RELAY_ORIGIN, RELAY_ASSIGN,
} from './bus.mjs';

const BASE = process.env.PPANAM_SERVER || 'http://localhost:4321';

/* ── 인자 ── */

const argv = process.argv.slice(2);
const o = { to: [], origin: null, from: 'hq', dry: false };
const words = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--to' || a === '-t') o.to.push(...String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  else if (a === '--origin') o.origin = argv[++i];
  else if (a === '--origin-file') o.origin = fs.readFileSync(argv[++i], 'utf8').trim();
  else if (a === '--assign-file') words.push(fs.readFileSync(argv[++i], 'utf8').trim());
  else if (a === '--from') o.from = argv[++i];
  else if (a === '--dry' || a === '-n') o.dry = true;
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else words.push(a);
}

function usage() {
  console.log(`총괄 배달 — 대표 원문은 그대로, 배분은 그 위에.

  node bus/dispatch.mjs --to <팀[,팀…]> "<이 팀이 맡을 부분>"

  --to           보낼 팀. 쉼표로 여럿
  --origin       대표 원문을 직접 준다 (없으면 총괄실 최근 대표 발언을 쓴다)
  --origin-file  원문을 파일에서
  --assign-file  배분을 파일에서
  --dry          보내지 않고 무엇이 갈지만 보여준다

  팀 목록: ${listTeams().filter((t) => !isOffice(t.id)).map((t) => t.id).join(', ')}`);
}

const assign = words.join('\n').trim();

if (!o.to.length) { console.error('오류: --to 로 보낼 팀을 지정하세요.\n'); usage(); process.exit(2); }

const bad = o.to.filter((t) => !teamExists(t));
if (bad.length) { console.error(`오류: 없는 팀 — ${bad.join(', ')}`); process.exit(1); }

const toOffice = o.to.filter((t) => isOffice(t));
if (toOffice.length) { console.error(`오류: 총괄실로는 배달하지 않습니다 — ${toOffice.join(', ')}`); process.exit(1); }

/* ── 원문 ── */

/** 총괄실에서 대표가 마지막으로 한 말. 이게 팀에 그대로 간다. */
function lastBossSay(room) {
  const { events } = readTail(room, { limit: 60 });
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    // 총괄이 옮겨온 것은 원문이 아니다. 대표가 이 방에서 직접 한 말만 고른다.
    if (e.actor === 'boss' && e.type === 'message' && !e.meta?.via) return e.text;
  }
  return null;
}

const origin = o.origin ?? lastBossSay(o.from);

if (!origin) {
  console.error(`오류: ${o.from} 에서 대표 발언을 찾지 못했습니다. --origin 으로 직접 주세요.`);
  process.exit(1);
}

const envelope = `${RELAY_ORIGIN}\n${origin}\n\n${RELAY_ASSIGN}\n${assign || '(배분 없음 — 원문 그대로 전달합니다.)'}`;

/* ── 보낸다 ── */

if (o.dry) {
  console.log(`받는 팀: ${o.to.join(', ')}\n`);
  console.log(envelope);
  process.exit(0);
}

let failed = 0;

for (const team of o.to) {
  // 라운드가 닫혀 있으면 훅이 기록하지 않는다. 조용히 사라지느니 여기서 말한다.
  if (readState(team).phase !== 'running') {
    console.error(`[${team}] 라운드가 닫혀 있습니다. 열고 다시 보내세요.`);
    failed++;
    continue;
  }
  try {
    const r = await fetch(`${BASE}/api/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team, text: envelope }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error(`[${team}] 실패 — ${data.error ?? r.status}`); failed++; continue; }
    console.log(`[${team}] 보냈습니다${data.queued ? ` (앞에 ${data.queued}건 대기)` : ''}`);
  } catch (e) {
    console.error(`[${team}] 서버에 닿지 못했습니다 — ${e.message}`);
    console.error(`  ${BASE} 에서 npm start 가 돌고 있어야 합니다.`);
    failed++;
  }
}

process.exit(failed ? 1 : 0);
