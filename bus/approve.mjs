#!/usr/bin/env node
// 승인 — 대표가 없어도 팀이 달리게 하는 게이트.
//
//   node bus/approve.mjs --team dev --request B "원격 푸시" --detail "M1 승인 체인, 커밋 3개"
//   node bus/approve.mjs --decide apr_1a2b3c4d --as chief PASS "마일스톤 조건 채움. 컷리스트 안 넘음"
//   node bus/approve.mjs --decide apr_1a2b3c4d --as outside PASS "원문과 대조. 이견 없음"
//   node bus/approve.mjs --list                  대기 중인 것
//   node bus/approve.mjs --list --all            전부
//   node bus/approve.mjs --show apr_1a2b3c4d
//
// 등급
//   A 자동   실무 혼자. 요청하면 바로 통과로 기록된다.
//   B 총괄   톰(chief)이 결정하고 제리(outside)가 대조한다. 둘 다 PASS 여야 통과.
//   C 대표   대표만. 큐에 남고, 실무는 다음 일감으로 넘어간다.
//
// 요청이 들어오면 판정할 사람의 귀에 넣는다(들려주기). B 는 총괄실, C 는 관제탑 카드.
// 통과·반려가 나면 요청한 방의 귀에 넣는다. 사람이 중간에 옮기지 않는다.

import {
  requestApproval, decideApproval, listApprovals, APPROVAL_GRADES,
  defaultTeam, teamExists, listTeams, readCast, quiet,
} from './bus.mjs';

const BASE = process.env.PPANAM_SERVER || 'http://localhost:4321';

/* ── 인자 ── */

const argv = process.argv.slice(2);
const o = { team: null, mode: null, grade: null, id: null, as: null, decision: null, detail: '', all: false };
const words = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') o.team = argv[++i];
  else if (a === '--request' || a === '-r') { o.mode = 'request'; o.grade = argv[++i]; }
  else if (a === '--decide' || a === '-d') { o.mode = 'decide'; o.id = argv[++i]; }
  else if (a === '--as') o.as = argv[++i];
  else if (a === '--detail') o.detail = argv[++i];
  else if (a === '--list' || a === '-l') o.mode = 'list';
  else if (a === '--all') o.all = true;
  else if (a === '--show' || a === '-s') { o.mode = 'show'; o.id = argv[++i]; }
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else words.push(a);
}

function usage() {
  console.log(`승인 — 등급으로 나뉜 게이트.

  --request <A|B|C> "<무엇>" [--detail "..."]   요청 (--team 으로 방 지정)
  --decide <id> --as <chief|outside|boss> <PASS|REVISE> "<이유>"
  --list [--all]        대기 중인 것 (--all 이면 전부)
  --show <id>

등급
${Object.entries(APPROVAL_GRADES).map(([g, x]) => `  ${g} ${x.label.padEnd(3)} ${x.needs.length ? x.needs.join('+') : '실무 혼자'}  — ${x.desc}`).join('\n')}`);
}

/** 판정할 사람의 귀에 넣는다. 서버가 없으면 큐에는 남았으니 그걸로 족하다. */
async function tell(team, text) {
  try {
    const r = await fetch(`${BASE}/api/say`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team, quiet: true, text }),
    });
    return r.ok;
  } catch { return false; }
}

// 요청자는 그 팀 사람이지만, B·C 의 판정자는 늘 총괄실(톰·제리) 아니면 대표다.
// 요청한 팀의 캐스트로 판정자 이름을 찾으면 "레오:PASS" 처럼 엉뚱한 사람이 찍힌다.
const nameOf = (team, actor) => {
  const own = readCast(team).agents?.[actor]?.name;
  if (actor === 'boss' || actor === 'guide' || actor === 'review' || actor === 'ops') return own ?? actor;
  return readCast('hq').agents?.[actor]?.name ?? own ?? actor;
};

const fmt = (r) => {
  const who = nameOf(r.team, r.by);
  const st = { pending: '대기', passed: '통과', revised: '반려' }[r.status] ?? r.status;
  const dec = r.decisions.map((d) => `${nameOf(r.team, d.by)}:${d.decision}`).join(' ');
  return `${r.id}  [${r.grade}] ${st.padEnd(2)}  ${r.team.padEnd(9)} ${who.padEnd(4)} ${r.what}${dec ? '  (' + dec + ')' : ''}`;
};

/* ── 실행 ── */

if (o.mode === 'list') {
  const rows = listApprovals(o.all ? {} : { status: 'pending' });
  if (!rows.length) { console.log(o.all ? '요청이 없습니다.' : '대기 중인 승인이 없습니다.'); process.exit(0); }
  for (const r of rows) console.log(fmt(r));
  process.exit(0);
}

if (o.mode === 'show') {
  const r = listApprovals().find((x) => x.id === o.id);
  if (!r) { console.error(`없음: ${o.id}`); process.exit(1); }
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

if (o.mode === 'request') {
  const team = o.team ?? process.env.PPANAM_TEAM ?? defaultTeam();
  if (!teamExists(team)) { console.error(`없는 팀: ${team} (${listTeams().map((t) => t.id).join(', ')})`); process.exit(1); }
  const by = o.as ?? (process.env.PPANAM_ACTOR || 'guide');
  const what = words.join(' ').trim();
  let r;
  try { r = requestApproval(team, { by, grade: o.grade, what, detail: o.detail }); }
  catch (e) { console.error('오류: ' + e.message); process.exit(1); }

  console.log(fmt(r));

  if (r.status === 'passed') { console.log('등급 A — 바로 진행하세요.'); process.exit(0); }

  if (r.grade === 'B') {
    // 톰이 결정하고 제리가 대조한다. 총괄실 귀에 넣는다.
    const heard = await tell('hq', quiet(
      `승인 요청 ${r.id} [등급 B] — ${team} 팀 ${readCast(team).agents?.[by]?.name ?? by}: ${r.what}` +
      (r.detail ? `\n상세: ${r.detail}` : '') +
      `\n\n판정하세요. 마일스톤 조건을 채웠는지, 컷리스트를 안 넘었는지 보고 결정하고, 제리에게 원문 대조를 시키세요.` +
      `\n  node bus/approve.mjs --decide ${r.id} --as chief PASS|REVISE "이유"` +
      `\n  node bus/outside.mjs --team hq --ask "승인 요청 ${r.id} 대조: ${r.what}"`));
    console.log(heard ? '총괄실에 올렸습니다. 톰과 제리가 판정합니다.' : '(서버가 없어 총괄실에 못 알렸습니다. 큐에는 남았습니다.)');
    console.log('대기 중에는 다음 일감으로 넘어가세요.');
  }
  if (r.grade === 'C') {
    console.log('등급 C — 대표 판단입니다. 관제탑에 올라갑니다. 다음 일감으로 넘어가세요.');
  }
  process.exit(0);
}

if (o.mode === 'decide') {
  const by = o.as ?? process.env.PPANAM_ACTOR;
  const decision = words[0];
  const reason = words.slice(1).join(' ');
  if (!by) { console.error('오류: --as <chief|outside|boss> 가 필요합니다.'); process.exit(1); }
  let r;
  try { r = decideApproval(o.id, { by, decision, reason }); }
  catch (e) { console.error('오류: ' + e.message); process.exit(1); }

  console.log(fmt(r));

  if (r.status !== 'pending') {
    // 요청한 방에 결과를 들려준다. 실무가 기다리던 답이다.
    const cast = readCast(r.team).agents ?? {};
    const msg = r.status === 'passed'
      ? `승인 ${r.id} 통과 — ${r.what}. 진행하세요.`
      : `승인 ${r.id} 반려 — ${r.what}.${reason ? ' 이유: ' + reason : ''} 고쳐서 다시 요청하세요.`;
    const heard = await tell(r.team, quiet(msg));
    console.log(heard ? `${r.team} 팀에 알렸습니다.` : '(서버가 없어 팀에 못 알렸습니다. 큐에는 남았습니다.)');
  } else {
    const left = APPROVAL_GRADES[r.grade].needs.filter((w) => !r.decisions.some((d) => d.by === w));
    console.log(`아직 ${left.map((w) => nameOf(r.team, w)).join('·')} 판정이 남았습니다.`);
  }
  process.exit(0);
}

usage();
process.exit(2);
