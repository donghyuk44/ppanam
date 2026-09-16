#!/usr/bin/env node
// 승인 — 대표가 없어도 팀이 달리게 하는 게이트.
//
//   node bus/approve.mjs --team dev --request B "원격 푸시" --detail "M1 승인 체인, 커밋 3개"
//   node bus/approve.mjs --decide apr_1a2b3c4d --as chief PASS "마일스톤 조건 채움. 컷리스트 안 넘음"
//   node bus/approve.mjs --decide apr_1a2b3c4d --as outside PASS "원문과 대조. 이견 없음"
//   node bus/approve.mjs --list                  대기 중인 것
//   node bus/approve.mjs --list --all            전부
//   node bus/approve.mjs --show apr_1a2b3c4d
//   node bus/approve.mjs --team dev --request B --next "다음 마일스톤 착수"        통과하면 서버가 로드맵 now 를 옮긴다
//   node bus/approve.mjs --team marketing --request C --roadmap out/roadmap.proposed.json "로드맵 교체"
//
// 등급
//   A 자동   실무 혼자. 요청하면 바로 통과로 기록된다.
//   B 총괄   톰(chief, 위임 중엔 나리)이 결정한다. 총괄실(hq) 자체 카드만 제리(outside)가 더 대조한다 —
//            팀 카드(dev·design·marketing·finance)는 톰 혼자, 대신 서는 사람 없음(대표 09-16 16:4x, 결정 183·185).
//   C 대표   대표만. 큐에 남고, 실무는 다음 일감으로 넘어간다.
//
// 알림은 이 파일이 하지 않는다. 서버의 notifier 가 큐를 보고 B 요청을 총괄실에, 결말을 요청한 방에 들려준다 —
// 서버가 꺼져 있을 때 올린 요청도 서버가 뜨면 알려진다. 전에는 요청 순간 한 번 알리고 끝이라 잃어버렸다.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ROOT, requestApproval, decideApproval, voidApproval, attachBossLine, listApprovals, APPROVAL_GRADES, needsOf, leftOf,
  defaultTeam, teamExists, listTeams, readCast, readRoadmap, paths, isOffice, pushAction, roomRules,
} from './bus.mjs';
import { untilOf } from './requests.mjs';

/**
 * 원격 푸시 요청은 지금 이 순간의 상태에 묶인다 — 어느 브랜치의 어느 커밋인가.
 * 톰·제리는 이 SHA 를 통과시키는 것이고, 실행자는 실행 시점에 HEAD 가 아직 그
 * SHA 인지 대조한 뒤에만 민다. 그 사이 커밋이 바뀌면 승인은 낡은 것이 된다.
 * 원격 기본 브랜치는 묶지 못한다 — 어느 브랜치인지는 bus.mjs 의 protectedBranch 가 git 에서 읽는다.
 */
function gitTarget() {
  // 서버(실행자)가 보는 저장소와 같은 곳을 읽는다. cwd 를 안 정하면 워크트리에서 부른 요청이
  // 서버 HEAD 와 영영 어긋나 stale 만 난다 (Fable 재점검, 2026-09-12).
  const g = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    return pushAction(g(['rev-parse', '--abbrev-ref', 'HEAD']), g(['rev-parse', 'HEAD']));
  } catch (e) {
    console.error('오류: ' + e.message);
    process.exit(1);
  }
}

/**
 * 누가 말하는지는 --as 가 아니라 환경이 정한다.
 *
 * 서버가 세션을 띄우며 PPANAM_TEAM 을 넣는다. codex(제리·레오)는 이 파일을 안 부른다 —
 * outside.mjs 가 자기 --team 을 대고 decideApproval 을 직접 부르며, bus 가 그 방을 검사한다.
 * 아무 셸에서나 --as chief 를 쓸 수 있으면 판정 기록이 위조된다 — 실제로 하네스를
 * 고치던 세션의 테스트가 톰의 판정으로 기록됐고, 톰이 그걸 잡아냈다.
 *
 * 세션은 Bash 허용 목록 때문에 `PPANAM_TEAM=hq node ...` 같은 접두를 못 쓴다.
 * 그래서 환경 검사만으로도 충분히 막힌다. 대표는 화면(API)으로만 판정한다.
 */
function whoAmI() {
  const actor = process.env.PPANAM_ACTOR;
  const team = process.env.PPANAM_TEAM;
  if (actor) return { actor, team };
  if (team) return { actor: roomRules(team).owner, team };
  return null;
}
const me = whoAmI();

/* ── 인자 ── */

const argv = process.argv.slice(2);
const o = { team: null, mode: null, grade: null, id: null, as: null, decision: null, detail: '', all: false, push: false, next: false, restart: false, roadmap: null, out: [], to: null, why: '', due: null, untilMilestone: false, small: false, boss: '' };
const words = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--team' || a === '-t') o.team = argv[++i];
  else if (a === '--request' || a === '-r') { o.mode = 'request'; o.grade = argv[++i]; }
  else if (a === '--decide' || a === '-d') { o.mode = 'decide'; o.id = argv[++i]; }
  else if (a === '--as') o.as = argv[++i];
  else if (a === '--detail') o.detail = argv[++i];
  else if (a === '--boss') o.boss = argv[++i];   // --decide 의 사람 말 한 줄(대리 결정 리포트 요약, 테라 code-review 지적 #5) — reason 은 카드 번호·경로가 섞여 자 검사에 걸린다
  else if (a === '--push') o.push = true;
  else if (a === '--next') o.next = true;
  else if (a === '--restart') o.restart = true;
  else if (a === '--roadmap') o.roadmap = argv[++i];
  else if (a === '--to') o.to = argv[++i];
  else if (a === '--why') o.why = argv[++i];
  else if (a === '--due') o.due = argv[++i];
  else if (a === '--until-milestone') o.untilMilestone = true;
  else if (a === '--small') o.small = true;
  else if (a === '--out') o.out.push(...String(argv[++i] ?? '').split(',').map((f) => f.trim()).filter(Boolean));
  else if (a === '--list' || a === '-l') o.mode = 'list';
  else if (a === '--all') o.all = true;
  else if (a === '--show' || a === '-s') { o.mode = 'show'; o.id = argv[++i]; }
  else if (a === '--void') { o.mode = 'void'; o.id = argv[++i]; }
  else if (a === '--boss-line') { o.mode = 'boss-line'; o.id = argv[++i]; }   // decide 가 끝난 옛 카드에 뒤늦게 사람 말 한 줄(나리 요청, 09-16 14:5x)
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else words.push(a);
}

function usage() {
  console.log(`승인 — 등급으로 나뉜 게이트.

  --request <A|B|C> "<무엇>" [--detail "..."] [--push | --next | --restart | --roadmap <파일> | --to <팀>] [--out a.png,b.md]   요청 (--team 으로 방 지정)
      --push     지금의 브랜치·SHA 를 요청에 묶는다. 통과하면 서버가 그 커밋을 origin 에 민다. (B)
      --next     로드맵의 다음 마일스톤을 묶는다. 통과하면 서버가 그것을 now 로 옮긴다. (B)
      --restart  서버 재시작을 묶는다. 통과하면 일하는 세션이 없을 때 서버가 스스로 내려갔다 다시 뜬다(N1, 감독 tools/serve.mjs). 보통 --small 과 같이. (B)
      --roadmap  teams/<팀>/out/ 의 제안 파일을 묶는다. 통과하면 서버가 roadmap.json 으로 옮긴다. (C)
      --to <팀>[:<자리>] [--why "왜"] [--due "기한"] [--until-milestone]
                 다른 팀에 요청 블록을 연다 (B, 결정 49). 통과하면 서버가 state/requests/<id>.jsonl 을 열고 두 방에 알린다.
                 --until-milestone 이면 지금 마일스톤이 닫힐 때까지 여는 공동 프로젝트(결정 47). 그 뒤는 node bus/request.mjs
      --out      카드에 붙일 산출물 — teams/<팀>/out/ 안의 경로, 쉼표로 여럿. 그림은 카드 안에 뜨고 md 는 펼쳐 읽는다.
                 --detail 에 적힌 out/… 경로도 같이 붙는다.
      --small    작은 B — 재시작·문구 한 줄·임시 파일 태그처럼 실행 대상 없는 것, 또는 --to(팀 사이 요청 블록).
                 결정 자리 혼자 보면 닫힌다(제리 대조 생략, 점검-0916 3-9).
                 --push·--next·--roadmap·--restart 와는 같이 못 쓴다 — 그건 큰 것.
  --decide <id> --as <chief|system|outside|boss> <PASS|REVISE> "<이유>" [--boss "사람 말 한 줄"]
                 결정 자리는 평소 톰(chief), 위임 중(state/delegation.json to:system)엔 나리(system) — 대표 09-16. --as system 은 환경 없는 셸(나리)에서만.
                 --boss — 대리 결정처럼 이유에 카드 번호·경로가 섞이는 판정에 사람 말 한 줄. 방 note·리포트 요약이 이걸 먼저 쓴다.
  --list [--all]        대기 중인 것 (--all 이면 전부)
  --show <id>
  --void <id> "<이유>"   잘못 들어온 요청을 무효로 (총괄실만)
  --boss-line <id> "<사람 말>"   decide 가 이미 끝난 카드에 뒤늦게 사람 말 한 줄(--boss 를 그때 못 실었을 때)

등급
${Object.entries(APPROVAL_GRADES).map(([g, x]) => `  ${g} ${x.label.padEnd(3)} ${x.needs.length ? x.needs.join('+') : '실무 혼자'}  — ${x.desc}`).join('\n')}`);
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
  const st = { pending: '대기', passed: '통과', revised: '반려', void: '무효' }[r.status] ?? r.status;
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

if (o.mode === 'void') {
  // 잘못 들어온 요청을 무효로 한다. 지우지 않고 한 줄 더 쓴다. 총괄실만.
  if (!me || me.team !== 'hq') { console.error('오류: 무효 처리는 총괄실에서만 합니다.'); process.exit(1); }
  try { console.log(fmt(voidApproval(o.id, words.join(' ')))); } catch (e) { console.error('오류: ' + e.message); process.exit(1); }
  process.exit(0);
}

if (o.mode === 'boss-line') {
  // decide 가 끝난 카드에 뒤늦게 사람 말 한 줄 — 지우지 않고 boss-line 한 줄 더 쓴다.
  try { console.log(fmt(attachBossLine(o.id, words.join(' ')))); } catch (e) { console.error('오류: ' + e.message); process.exit(1); }
  process.exit(0);
}

if (o.mode === 'request') {
  const team = o.team ?? process.env.PPANAM_TEAM ?? defaultTeam();
  if (!teamExists(team)) { console.error(`없는 팀: ${team} (${listTeams().map((t) => t.id).join(', ')})`); process.exit(1); }
  if (!me) { console.error('오류: 방이 지정되지 않은 셸에서는 요청할 수 없습니다. 세션 안에서 부르세요.'); process.exit(1); }
  if (o.as && o.as !== me.actor) { console.error(`오류: 너는 '${me.actor}' 다. '${o.as}' 로 요청할 수 없다.`); process.exit(1); }
  const by = me.actor;
  const what = words.join(' ').trim();
  // 실행할 행동을 요청에 박는다. 실행자·알림자는 이것만 믿는다 — 자유 텍스트를 훑지 않는다.
  let action = null;
  if ([o.push, o.next, o.restart, !!o.roadmap, !!o.to].filter(Boolean).length > 1) { console.error('오류: --push · --next · --restart · --roadmap · --to 는 하나만.'); process.exit(1); }
  if (o.push) action = gitTarget();
  if (o.restart) {
    if (String(o.grade).toUpperCase() !== 'B') { console.error('오류: --restart 는 B 등급입니다.'); process.exit(1); }
    action = { type: 'restart' };
  }
  if (o.to) {
    // 팀 사이 요청 블록 (결정 49) — 받는 팀[:자리]. 자기 팀에게는 못 연다. 통과하면 알림자가 블록을 연다.
    if (String(o.grade).toUpperCase() !== 'B') { console.error('오류: --to 는 B 등급(팀 사이 요청)입니다.'); process.exit(1); }
    const [toTeam, toActor = 'guide'] = String(o.to).split(':');
    if (!teamExists(toTeam)) { console.error(`없는 팀: ${toTeam} (${listTeams().map((t) => t.id).join(', ')})`); process.exit(1); }
    if (toTeam === team) { console.error('오류: 같은 방에는 요청 블록을 열지 않습니다 — 방에서 말하면 됩니다.'); process.exit(1); }
    if (!readCast(toTeam).agents?.[toActor]) { console.error(`오류: ${toTeam} 방에 '${toActor}' 자리가 없습니다.`); process.exit(1); }
    action = { type: 'request', to: { team: toTeam, actor: toActor }, why: String(o.why ?? '').trim(), due: o.due ?? null, mode: o.untilMilestone ? 'milestone' : 'once' };
    if (o.untilMilestone) { try { action.until = untilOf(team); } catch (e) { console.error('오류: ' + e.message); process.exit(1); } }
  }
  if (o.next) {
    if (String(o.grade).toUpperCase() !== 'B') { console.error('오류: --next 는 B 등급입니다.'); process.exit(1); }
    const ms = readRoadmap(team).milestones ?? [];
    const cur = ms.find((m) => m.status === 'now');
    const next = ms.find((m) => m.status !== 'pass' && m.status !== 'now') ?? null;
    if (!next) { console.error('오류: 착수할 다음 마일스톤이 로드맵에 없습니다.'); process.exit(1); }
    if (cur) { console.error(`오류: 마일스톤 ${cur.n} 이 아직 now 입니다. PASS 로 라운드를 닫아 pass 가 된 뒤에 다음을 요청하세요.`); process.exit(1); }
    action = { type: 'milestone', n: next.n, title: next.title ?? null };
  }
  if (o.roadmap) {
    if (String(o.grade).toUpperCase() !== 'C') { console.error('오류: --roadmap 은 C 등급(로드맵 변경)입니다.'); process.exit(1); }
    const file = path.basename(o.roadmap);
    if (!fs.existsSync(path.join(paths(team).out, file))) { console.error(`오류: teams/${team}/out/${file} 이 없습니다. 제안 파일은 out/ 에 둡니다.`); process.exit(1); }
    action = { type: 'roadmap', file };
  }
  let r;
  try { r = requestApproval(team, { by, grade: o.grade, what, detail: o.detail, action, files: o.out, small: o.small }); }
  catch (e) { console.error('오류: ' + e.message); process.exit(1); }

  console.log(fmt(r));
  if (r.small) { const d = nameOf(r.team, needsOf(r)[0]); console.log(`작은 B — ${d} 혼자 보면 닫힙니다(제리 대조 생략, 점검-0916 3-9). 작은 게 아니라고 보면 ${d}가 돌려보냅니다.`); }
  if (action?.type === 'push') console.log(`푸시 대상: ${action.remote}/${action.branch} @ ${action.sha.slice(0, 8)} — 이 커밋을 통과시키는 것입니다.`);
  if (action?.type === 'restart') console.log('재시작 대상: 서버 — 통과하면 일하는 세션이 없을 때 서버가 스스로 내려갔다 다시 뜹니다.');
  if (action?.type === 'milestone') console.log(`착수 대상: 마일스톤 ${action.n}${action.title ? ' ' + action.title : ''} — 통과하면 서버가 now 로 옮깁니다.`);
  if (action?.type === 'roadmap') console.log(`교체 대상: out/${action.file} — 통과하면 서버가 roadmap.json 으로 옮깁니다.`);
  if (action?.type === 'request') console.log(`요청 대상: ${action.to.team}/${action.to.actor}${action.mode === 'milestone' ? ` · 마일스톤 ${action.until.milestone} 끝까지(공동 프로젝트)` : ''} — 통과하면 서버가 블록을 열고 두 방에 알립니다. 그 뒤는 node bus/request.mjs --say <id> "…".`);
  if (r.files?.length) console.log(`산출물: ${r.files.map((f) => 'out/' + f).join(', ')} — 카드에 링크·미리보기로 붙습니다.`);

  if (r.status === 'passed') { console.log('등급 A — 바로 진행하세요.'); process.exit(0); }

  if (r.grade === 'B') console.log(`큐에 남았습니다. 서버가 총괄실에 알리고, ${needsOf(r).map((w) => nameOf(r.team, w)).join('와 ')}가 판정하면 이 방에 들려줍니다. 대기 중에는 다음 일감으로 넘어가세요.`);
  if (r.grade === 'C') console.log('등급 C — 대표 판단입니다. 관제탑에 올라갑니다. 결과는 서버가 이 방에 들려줍니다. 다음 일감으로 넘어가세요.');
  process.exit(0);
}

if (o.mode === 'decide') {
  // 나리(system)는 서버가 띄운 세션이 아니라 환경이 없다 — `--as system` 은 **환경 없는 셸에서만** 받는다(총괄실 사람으로 기록).
  // 방 세션(PPANAM_TEAM 있음)이 --as system 을 대면 아래 검사에 걸린다 — 위조 방지는 그대로(대표 09-16 "대리 판단은 나리").
  const who = !me && o.as === 'system' ? { actor: 'system', team: 'hq' } : me;
  if (!who) { console.error('오류: 방이 지정되지 않은 셸에서는 판정할 수 없습니다. 대표는 관제탑 화면에서, 나리는 --as system 으로 판정합니다.'); process.exit(1); }
  if (o.as && o.as !== who.actor) { console.error(`오류: 너는 '${who.actor}' 다. '${o.as}' 로 판정할 수 없다.`); process.exit(1); }
  const by = who.actor;
  const decision = words[0];
  const reason = words.slice(1).join(' ');
  let r;
  try { r = decideApproval(o.id, { by, decision, reason, team: who.team, boss: o.boss }); }
  catch (e) { console.error('오류: ' + e.message); process.exit(1); }

  console.log(fmt(r));

  if (r.status !== 'pending') {
    console.log(`${r.status === 'passed' ? '통과' : '반려'}입니다. 서버가 ${r.team} 팀에 들려줍니다.`);
  } else {
    const left = leftOf(r);
    console.log(`아직 ${left.map((w) => nameOf(r.team, w)).join('·')} 판정이 남았습니다.`);
  }
  process.exit(0);
}

usage();
process.exit(2);
