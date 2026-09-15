// 승인 알림자 — 요청·판정·실행 결과를 귀에 넣는 유일한 자리.
//
// 전에는 알림이 "요청하거나 판정한 프로세스" 의 부수 효과였다. approve.mjs 가 요청 순간 총괄실에 한 번
// 들려주고, 자기가 판정을 확정했을 때만 요청한 방에 들려줬다. 그래서
//   - 서버가 꺼져 있을 때 올린 요청은 총괄실에 영영 안 닿았고 (apr_d25aaf62, 2026-09-02),
//   - 문서가 정한 순서(톰 결정 → 제리 대조)로 제리가 마지막이면 outside.mjs 경로라 실무는 통과를 못 들었고,
//   - 대표의 C 판정(화면)도 note 만 남아 요청한 방은 몰랐다 (Fable 재점검, 2026-09-12).
//
// 이제 알림은 서버의 일이다. 폴링 틱마다 큐를 접어 보고, 아직 안 알린 것만 알린다. 알린 것은
// state/notifier.json 에 남겨 재시작해도 두 번 알리지 않는다. 큐 파일이 진실이고 이 파일은 흔적이다.
//
// 세 가지를 알린다.
//   (a) B 요청 → 총괄실 귀에. 톰이 결정하고 제리에게 대조를 시킨다.
//   (b) 요청의 상태가 pending 이 아니게 되면(통과·반려·무효) → 요청한 방 귀에. 실무가 기다리던 답이다.
//       통과한 B 에 action.type 'milestone' 이 박혀 있으면 그 마일스톤을 now 로 — "다음 마일스톤 착수" 의 실행.
//       통과한 C 에 action.type 'roadmap' 이 박혀 있으면 제안 파일을 roadmap.json 으로 — /kickoff 의 실행.
//   (c) 실행자 결과(pushed · push-failed · stale · invalid) → 요청한 방 귀에.
//   (d) 요청 블록(6-1절, 결정 49·51) — 통과한 B 에 action.type 'request' 면 블록을 열고, 블록의 새 줄(goal·say·done·ack·confirm·stop)을
//       쓴 사람 빼고 나머지 두 자리 귀에 넣고, milestone 모드 블록은 그 마일스톤이 pass 가 되면 닫는다.
//   (e) 대리 결정(6절 "대리 결정", 결정 85) — 대표 차례가 10분 넘게 답이 없고 대표가 10분 넘게 조용하면 총괄실에 B "대리 결정 — …" 을 올린다.
//       톰·제리 둘 다 PASS 면 (b-1) 이 applyProxy — C 통과 · FAIL 풀기 · 물음에 답. 돈·바깥으로 나가는 건 안 올린다.
//
// 팀 방은 라운드가 열려 있을 때만 들려준다. 닫혀 있으면 세션이 없거나 훅이 기록하지 않는다 — 다음 틱에 다시 본다.
// 총괄실은 늘 열려 있다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listApprovals, readCast, readState, writeState, readRoadmap, isOffice, quiet, emit, paths, setMilestoneStatus,
  proxyCandidates, requestApproval, decideApproval, resumeRound, startRound, APPROVAL_GRADES, needsOf, readDelegation, delegationTag, teamExists,
} from '../bus/bus.mjs';

// 다시 부르기(R25) — 총괄실에 한 번 넣고 답이 없으면 30분마다, 세 번까지. 그 뒤엔 요청한 방에 한 줄 남기고 사람 몫.
export const REASK_MS = Number(process.env.PPANAM_REASK_MS || 30 * 60_000);
export const REASK_MAX = Number(process.env.PPANAM_REASK_MAX || 3);
import { listRequests, openRequest, closeByMilestone } from '../bus/requests.mjs';
import * as session from './session.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(REPO, 'state', 'notifier.json');
const EXEC = path.join(REPO, 'state', 'executor.json');

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return { told: {} }; }
}
function writeStore(s) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(s, null, 2) + '\n');
}
function readExec() {
  try { return JSON.parse(fs.readFileSync(EXEC, 'utf8')).done ?? {}; } catch { return {}; }
}

/** 화면용 — 어느 요청을 언제 알렸나. */
export function notified() { return readStore().told ?? {}; }

/** 이 방의 귀가 열려 있나. 총괄실은 늘, 팀 방은 라운드가 열려 있을 때만. */
const canHear = (team) => isOffice(team) || readState(team).phase !== 'idle';

// 요청자는 그 팀 사람이지만 판정자는 총괄실(톰·제리) 아니면 대표다.
function nameOf(team, actor) {
  const own = readCast(team).agents?.[actor]?.name;
  if (['boss', 'guide', 'review', 'ops'].includes(actor)) return own ?? actor;
  return readCast('hq').agents?.[actor]?.name ?? own ?? actor;
}

function requestText(r) {
  const who = nameOf(r.team, r.by);
  const a = r.action;
  return `승인 요청 ${r.id} [등급 B${r.small ? ' · 작은' : ''}] — ${r.team} 팀 ${who}: ${r.what}` +
    (r.small ? '\n작은 B — 재시작·문구·임시 파일 같은 것. 톰 혼자 보면 닫힌다, 제리 대조는 생략(점검-0916 3-9). 작은 게 아니면 REVISE 로 돌려보내 큰 카드로 다시 올리게.' : '') +
    (r.detail ? `\n상세: ${r.detail}` : '') +
    (a?.type === 'push' ? `\n대상: ${a.remote ?? 'origin'}/${a.branch} @ ${String(a.sha).slice(0, 8)} — 통과하면 서버가 정확히 이 커밋을 민다` : '') +
    (a?.type === 'milestone' ? `\n대상: 마일스톤 ${a.n} 착수 — 통과하면 서버가 로드맵의 now 를 옮긴다` : '') +
    (a?.type === 'request' ? `\n대상: ${a.to.team}/${a.to.actor} 에게 요청 블록${a.mode === 'milestone' ? ` (마일스톤 ${a.until?.milestone ?? '?'} 끝까지 — 공동 프로젝트)` : ''}${a.why ? ` · 왜: ${a.why}` : ''}${a.due ? ` · 기한: ${a.due}` : ''} — 통과하면 서버가 블록을 열고 너는 감시자로 들어간다(결정 51: 목표 한 줄 node bus/request.mjs --goal <id> "…")` : '') +
    (a?.type === 'proxy' ? `\n대리 결정 (결정 85 — 대표가 10분 넘게 답이 없다): ${a.kind === 'approval' ? `C 승인 ${a.ref} 를 대표 대신 통과시킬까` : a.kind === 'unblock' ? `${a.team} 방의 FAIL 을 대표 대신 풀까` : `${a.team} 방의 물음에 대표 대신 답할까 — 답은 너의 PASS 이유에 적어라, 그 글이 그 방에 '대리 결정' 으로 남는다`}. 둘 다 PASS 여야 실행되고 하나라도 REVISE 면 대표를 기다린다. 돈·바깥으로 나가는 건 여기 안 온다.` : '') +
    `\n\n판정하세요. 마일스톤 조건을 채웠는지, 컷리스트를 안 넘었는지 보고 결정하${r.small ? '세요.' : '고, 제리에게 원문 대조를 시키세요.'}` +
    `\n  node bus/approve.mjs --decide ${r.id} --as chief PASS|REVISE "이유"` +
    (r.small ? '' : `\n  node bus/outside.mjs --team hq --ask "승인 요청 ${r.id} 대조: ${r.what}"`);
}

function decidedText(r) {
  const dec = r.decisions.map((d) => `${nameOf(r.team, d.by)} ${d.decision}${d.reason ? '(' + d.reason + ')' : ''}`).join(' · ');
  if (r.status === 'passed') return `승인 ${r.id} 통과 — ${r.what}.${dec ? ' ' + dec + '.' : ''} 진행하세요.`;
  if (r.status === 'revised') return `승인 ${r.id} 반려 — ${r.what}.${dec ? ' ' + dec + '.' : ''} 고쳐서 다시 요청하세요.`;
  if (r.status === 'void') return `승인 ${r.id} 무효 — ${r.what}.${r.voidReason ? ' 이유: ' + r.voidReason + '.' : ''}`;
  return null;
}

function execText(r, d) {
  const out = d.out ? ` · ${String(d.out).split('\n').slice(-2).join(' ').slice(0, 300)}` : '';
  return `승인 ${r.id} 실행 결과 — ${d.ok ? '푸시 완료' : '밀지 않았습니다'}${out}`;
}

/** 통과한 요청에 박힌 행동 중 서버가 상태로 실행하는 것. 셸 실행(푸시)은 executor.mjs 의 몫이다. */
function applyAction(r, store) {
  const a = r.action;
  if (!a) return null;
  if (r.grade === 'B' && a.type === 'milestone' && Number.isInteger(a.n)) {
    const ok = setMilestoneStatus(r.team, a.n, 'now');
    let text = ok ? `마일스톤 ${a.n} 착수 — 로드맵의 now 를 옮겼습니다.` : `마일스톤 ${a.n} 을 로드맵에서 찾지 못했습니다.`;
    emit(r.team, { actor: 'system', type: 'milestone', text, meta: { index: a.n, approval: r.id } });
    // 라운드를 닫으며 서버가 올린 요청(endRound, autoOpen)이면 라운드까지 연다 — 닫힌 방엔 차례가 안 와서 아무도 못 연다(대표 실측 09-14, 마케팅 여섯 시간).
    // 누가 먼저 열어 뒀으면(대표 화면) startRound 가 던진다 — 그건 실패가 아니다.
    if (ok && a.autoOpen) {
      try { const st = startRound(r.team, { topic: a.title ?? null }); text += ` 라운드 ${st.round} 을 열었습니다.`; }
      catch (e) { text += ` 라운드는 안 열었습니다 — ${String(e.message).slice(0, 80)}`; }
    } else if (ok) {
      // 로드맵 교체가 열린 라운드 중에 들어가면(R29) round.json 의 milestone 이 옛 단계에 그대로 남는다 — 안 맞추면
      // 이 라운드가 닫힐 때 옛 마일스톤을 또 pass 로 찍고 다음 단계를 잘못 센다(나리 실측, apr_115838b4).
      const st = readState(r.team);
      if (st.phase !== 'idle' && st.milestone !== a.n) {
        writeState(r.team, { milestone: a.n, attempt: st.attempts?.[a.n] ?? 0 });
        emit(r.team, { actor: 'system', type: 'note', text: `열린 라운드 ${st.round} 의 마일스톤을 ${st.milestone} → ${a.n} 로 맞췄습니다.` });
        text += ` 열린 라운드 ${st.round} 도 맞췄습니다.`;
      }
    }
    return text;
  }
  if (r.grade === 'C' && a.type === 'roadmap' && typeof a.file === 'string') {
    // 제안 파일은 그 팀의 out/ 안에만 있을 수 있다. 다른 곳을 가리키면 안 한다.
    const dir = paths(r.team).out;
    const src = path.resolve(dir, path.basename(a.file));
    let text;
    try {
      const proposed = JSON.parse(fs.readFileSync(src, 'utf8'));
      if (!Array.isArray(proposed.milestones)) throw new Error('milestones 가 배열이 아님');
      fs.writeFileSync(paths(r.team).roadmap, JSON.stringify(proposed, null, 2) + '\n');
      text = `로드맵 교체 — ${path.basename(src)} 를 roadmap.json 으로 옮겼습니다 (마일스톤 ${proposed.milestones.length}개).`;
    } catch (e) {
      text = `로드맵을 교체하지 못했습니다 — ${String(e.message).slice(0, 120)}`;
    }
    emit(r.team, { actor: 'system', type: 'note', text, meta: { approval: r.id } });
    return text;
  }
  if (r.grade === 'B' && a.type === 'request' && a.to?.team) {
    // 팀 사이 요청 블록 (결정 49) — 파일을 열고 두 방에 시작 note. 같은 승인으로 두 번 열지 않는다(openRequest 가 본다).
    try {
      const q = openRequest(r);
      return `요청 블록 ${q.id} 이 열렸습니다 — ${q.to.team}/${q.to.actor} 와 1:1, 톰이 감시자. node bus/request.mjs --say ${q.id} "…"`;
    } catch (e) {
      const text = `요청 블록을 열지 못했습니다 — ${String(e.message).slice(0, 120)}`;
      emit(r.team, { actor: 'system', type: 'note', text, meta: { approval: r.id } });
      return text;
    }
  }
  if (r.grade === 'B' && a.type === 'proxy') return applyProxy(r, store);
  return null;
}

/**
 * 대리 결정 실행 (결정 85) — 톰·제리 둘 다 PASS 한 대리 요청. 방에는 "대리 결정" 으로 남고, hq/out/proxy-decisions.md 맨 위에 한 줄.
 * 실패해도 조용히 넘기지 않는다 — 그 방에 note.
 */
function applyProxy(r, store) {
  const a = r.action;
  const who = ['chief', 'outside'];
  const tag = delegationTag();   // 위임 중이면 " — 대리, 나리 위임 136"(결정 136) — note 와 판정 이유 둘 다에
  const reasons = r.decisions.map((d) => `${nameOf('hq', d.by)}: ${d.reason || '(이유 없음)'}`).join(' · ') + tag;
  let text;
  try {
    if (a.kind === 'approval') {
      const after = decideApproval(a.ref, { by: 'boss', decision: 'PASS', reason: `대리 결정(톰·제리) — ${reasons}`, proxy: who });
      text = `대리 결정${tag} — C 승인 ${a.ref} 를 대표 대신 통과시켰습니다 (${after.status}). ${reasons}`;
    } else if (a.kind === 'unblock') {
      const st = resumeRound(a.team, { text: reasons, proxy: who });
      text = st ? `대리 결정${tag} — ${a.team} 방의 FAIL 을 대표 대신 풀었습니다. ${reasons}` : `${a.team} 방은 이미 막혀 있지 않습니다 — 할 게 없었습니다.`;
    } else if (a.kind === 'answer') {
      const tom = r.decisions.find((d) => d.by === 'chief')?.reason || reasons;
      emit(a.team, { actor: 'system', type: 'note', text: `대리 결정${tag} — 톰·제리: ${tom}`, meta: { proxy: who, proxyAnswer: a.ref, approval: r.id } });
      text = `대리 결정${tag} — ${a.team} 방의 물음에 대표 대신 답했습니다: ${tom}`;
    } else text = `모르는 대리 종류: ${a.kind}`;
  } catch (e) {
    text = `대리 결정을 실행하지 못했습니다 — ${String(e.message).slice(0, 160)}`;
    emit(a.team ?? 'hq', { actor: 'system', type: 'note', text, meta: { approval: r.id } });
    return text;
  }
  // ③ 일일보고서 맨 위 "대표님 대신 정한 것" — 대표가 아침에 보고 뒤집을 수 있게. 최신이 위.
  // 결정은 이미 실행됐으니 이 줄이 빠지면 아침 검토 기록이 사라진다 — 못 쓰면 store 에 두고 다음 살피기에 다시 쓴다(레오 REVISE R23).
  const line = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${a.kind} · ${a.team ?? '-'} · ${r.what} — ${reasons} (${r.id})\n`;
  (store.proxyLines ??= []).push(line);
  flushProxyLines(store);
  return text;
}

const PROXY_FILE = path.join(paths('hq').out, 'proxy-decisions.md');
/** 대리 결정 줄을 파일 맨 위에 쓴다. 실패하면 줄은 store 에 남고 총괄실에 note(같은 오류면 한 번), 다음 살피기(30초)에 다시. */
function flushProxyLines(store) {
  const lines = store.proxyLines ?? [];
  if (!lines.length) return false;
  try {
    const old = fs.existsSync(PROXY_FILE) ? fs.readFileSync(PROXY_FILE, 'utf8').replace(/^# [^\n]*\n(?:[^\n]*\n)?\n?/, '') : '';
    fs.mkdirSync(path.dirname(PROXY_FILE), { recursive: true });
    fs.writeFileSync(PROXY_FILE, `# 대표님 대신 정한 것 (결정 85 — 톰·제리 대리 결정, 최신이 위)\n대표가 뒤집으려면 그 방에 한마디 — 그 말이 곧 판단이다.\n\n${lines.slice().reverse().join('')}${old}`);
    store.proxyLines = [];
    store.proxyLinesError = null;
    return true;
  } catch (e) {
    const msg = String(e.message).slice(0, 120);
    console.error('[notifier] proxy-decisions.md 쓰기 실패 — ' + msg);
    // 파일은 흔적이고 진실은 대화록이다 — 각 방의 '대리 결정 — …' 줄(meta.proxy)이 원본. 아침 보고서는 파일만 보지 말고 그 줄도 센다(M6 보고서 탭).
    if (store.proxyLinesError !== msg) emit('hq', { actor: 'system', type: 'note', text: `대리 결정 기록(hq/out/proxy-decisions.md)을 쓰지 못했습니다 — ${msg}. 줄 ${lines.length}개를 들고 30초 뒤 다시 씁니다. 그 사이 원본은 각 방 대화록의 '대리 결정 — …' 줄입니다.` });
    store.proxyLinesError = msg;
    return true;   // store 가 바뀌었다(줄·오류) — 저장
  }
}

/**
 * (e) 대리 결정 요청 (결정 85) — 대표 차례가 10분 넘게 답이 없고 대표가 10분 넘게 조용하면, 총괄실에 B 요청 "대리 결정 — …" 을 올린다.
 * 같은 일에 한 번(store.proxied[key]). 올린 뒤는 평소 B 길 — (a) 가 톰에게 들려주고, 통과하면 (b-1) 이 applyProxy 를 부른다.
 */
let proxyCheckedAt = 0;
function runProxy(store) {
  // 다섯 방 대화록을 훑는 일이라 틱(250ms)마다가 아니라 30초에 한 번. 10분 재는 데 30초 늦는 건 상관없다.
  if (Date.now() - proxyCheckedAt < 30_000) return false;
  proxyCheckedAt = Date.now();
  let changed = false;
  store.proxied ??= {};
  if (flushProxyLines(store)) changed = true;   // 지난번에 못 쓴 대리 결정 줄이 있으면 먼저 다시 쓴다
  const { items, excluded } = proxyCandidates({ withExcluded: true });
  // ④ 돈·바깥으로 나가는 것 — 대리 후보가 아니다. 조용히 빠지면 대표가 아침에 왜 답이 없었는지 모른다 — 총괄실에 한 번 남긴다.
  for (const it of excluded) {
    if (store.proxied[it.key]?.excluded) continue;
    emit('hq', { actor: 'system', type: 'note', text: `대표 차례가 10분 넘게 답이 없지만 대리로 정하지 않습니다 — 돈이 나가거나 바깥으로 나가는 일이라 대표만 정합니다(결정 85 ④): ${it.kind} · ${it.team} · ${it.what.slice(0, 100)}` });
    store.proxied[it.key] = { excluded: true, at: new Date().toISOString() };
    changed = true;
  }
  for (const it of items) {
    const prev = store.proxied[it.key];
    if (prev?.id) continue;   // 올라간 것만 건너뛴다 — 실패한 것은 다음 살피기(30초)에 다시 (레오 REVISE R23: 실패도 기록하면 영원히 건너뛰어 조용히 죽는다)
    try {
      const dg = readDelegation();
      const r = requestApproval('hq', {
        by: 'system', grade: 'B',
        what: `대리 결정 — ${it.what.slice(0, 120)}`,
        detail: dg && it.kind === 'approval'
          ? `대표 위임 중(결정 ${dg.decision ?? '136'}, ${dg.until.slice(0, 16).replace('T', ' ')}Z 까지) — C 카드는 기다리지 않고 바로 올립니다. 종류: ${it.kind} · 방: ${it.team} · 대상: ${it.ref}. 둘 다 PASS 면 서버가 실행하고 방에 '대리 — 나리 위임' 으로 남깁니다.`
          : `대표 차례가 ${Math.round((Date.now() - new Date(it.since).getTime()) / 60000)}분째 답이 없습니다(결정 85). 종류: ${it.kind} · 방: ${it.team} · 대상: ${it.ref}. 둘 다 PASS 면 서버가 실행하고 방에 '대리 결정' 으로 남깁니다.`,
        action: { type: 'proxy', kind: it.kind, team: it.team, ref: it.ref },
      });
      store.proxied[it.key] = { id: r.id, at: new Date().toISOString() };
      changed = true;
    } catch (e) {
      // 실패는 방에 남기고(같은 오류가 이어지면 한 번만) 다음 살피기에 다시 시도한다 — 조용히 사라지지 않게.
      const msg = String(e.message).slice(0, 120);
      console.error('[notifier] 대리 결정 요청 실패 — ' + msg);
      if (prev?.error !== msg) emit('hq', { actor: 'system', type: 'note', text: `대리 결정 요청(${it.kind} · ${it.team})을 올리지 못했습니다 — ${msg}. 30초 뒤 다시 시도합니다.` });
      store.proxied[it.key] = { error: msg, at: new Date().toISOString() };
      changed = true;
    }
  }
  return changed;
}

/** 블록의 줄 하나를 상대 귀에 넣을 글 — 누가 무슨 줄을 썼나. */
function lineText(q, l) {
  const who = l.by ? nameOf(l.by.team, l.by.actor) : '서버';
  const head = `요청 블록 ${q.id} (${q.what})`;
  const verb = { goal: '목표', say: '', done: '됐다', ack: '받았다', confirm: '확인', stop: '끊음', close: '닫힘' }[l.kind] ?? l.kind;
  const tail = l.kind === 'say' ? `${who}: ${l.text}` : `${who} ${verb}${l.text ? ` — ${l.text}` : ''}`;
  const hint = l.kind === 'done' ? ' · 받았으면 node bus/request.mjs --ack ' + q.id
    : l.kind === 'ack' ? ' · 톰이 --confirm 으로 닫는다'
    : l.kind === 'say' ? ` · 답은 node bus/request.mjs --say ${q.id} "…"` : '';
  return `${head} — ${tail}${hint}`;
}

/** 블록의 세 자리 중 이 줄을 쓴 사람을 뺀 나머지 — 귀에 넣을 곳. 방마다 한 번(같은 방 두 자리는 없다). */
function listeners(q, l) {
  const seats = [q.from, q.to, { team: 'hq', actor: 'chief' }];
  const out = [];
  for (const s of seats) {
    if (l.by && s.team === l.by.team && s.actor === l.by.actor) continue;
    if (!out.some((x) => x.team === s.team)) out.push(s);
  }
  return out;
}

/**
 * (d) 요청 블록 — 새 줄을 귀에, milestone 모드는 마일스톤이 pass 면 닫기. 알린 줄 수는 store.requests[id].sent[team].
 * 방이 못 들으면(라운드 닫힘) 그 방 몫만 다음 틱으로 미룬다 — 열리면 밀린 줄을 한 번에 듣는다.
 */
function runRequests(store, send) {
  let changed = false;
  store.requests ??= {};
  for (const q0 of listRequests()) {
    let q = q0;
    if (q.mode === 'milestone' && q.status !== 'closed' && q.until?.team) {
      const ms = (readRoadmap(q.until.team).milestones ?? []).find((m) => m.n === q.until.milestone);
      if (ms?.status === 'pass') { q = closeByMilestone(q, readState(q.until.team).round || null); changed = true; }
    }
    const t = store.requests[q.id] ??= { sent: {} };
    for (const s of [q.from, q.to, { team: 'hq', actor: 'chief' }]) {
      const n = t.sent[s.team] ?? 0;
      if (n >= q.thread.length) continue;
      if (!canHear(s.team)) continue;
      let k = n;
      for (; k < q.thread.length; k++) {
        const l = q.thread[k];
        if (!listeners(q, l).some((x) => x.team === s.team)) continue;
        try { send(s.team, lineText(q, l)); }
        catch (e) { emit(s.team, { actor: 'system', type: 'note', text: `요청 블록 ${q.id} 의 줄을 세션에 넣지 못했습니다 — ${String(e.message).slice(0, 120)}` }); break; }
      }
      if (k !== n) { t.sent[s.team] = k; changed = true; }
    }
  }
  return changed;
}

/**
 * 폴링 틱마다 불린다. send 를 바꿔 끼울 수 있게 해 두었다 — 시험에서는 세션을 안 띄운다.
 */
export function runNotifier({ send = (team, text) => session.send(team, quiet(text)) } = {}) {
  let store = readStore();
  store.told ??= {};
  let changed = false;
  const now = () => new Date().toISOString();
  const done = readExec();

  for (const r of listApprovals()) {
    if (r.grade === 'A') continue;
    // teams.json 에 없는 방의 요청(round.mjs check 의 임시 방 _check — approvals.jsonl 은 append-only 라 174건이 남아 있다)은 알리지 않는다.
    // 전엔 (b-2) 가 send('_check', …) 로 **그 가짜 방의 claude 세션(opus)을 진짜로 띄웠다** — R28 실측: 서버 자식에 `_check:guide` 세션 13분째(테라 m8-ps).
    if (!teamExists(r.team)) continue;
    const t = store.told[r.id] ??= {};

    // (a) B 요청 — 총괄실에
    if (r.grade === 'B' && !t.requested) {
      if (r.status === 'pending') {
        try { send('hq', requestText(r)); t.requested = now(); changed = true; }
        catch (e) { emit('hq', { actor: 'system', type: 'note', text: `승인 요청 ${r.id} 를 총괄실 세션에 넣지 못했습니다 — ${String(e.message).slice(0, 120)}` }); }
      } else {
        t.requested = now(); changed = true;   // 이미 끝난 요청은 알릴 것이 없다
      }
    }
    // (a-2) 다시 부르기 — 한 번 넣고 답이 안 오면 영원히 대기였다(하네스 실측 R25: 제리 호출이 300초에 죽은 뒤 셋이 대표 화면 맨 위에 붙박이).
    // 아직 안 답한 판정자가 있고 마지막으로 넣은 지 REASK_MS 가 지났으면 그 사람 이름을 불러 다시 넣는다. 최대 REASK_MAX 번 — 그 뒤엔 방에 한 줄 남기고 사람 몫.
    if (r.grade === 'B' && r.status === 'pending' && t.requested) {
      const need = needsOf(r).filter((w) => !r.decisions?.some((d) => d.by === w));
      const lastAsk = new Date(t.reasked ?? t.requested).getTime();
      if (need.length && Date.now() - lastAsk > REASK_MS) {
        const n = (t.reaskCount ?? 0) + 1;
        if (n <= REASK_MAX) {
          const names = need.map((w) => nameOf('hq', w)).join(', ');
          try { send('hq', `${names}, 승인 요청 ${r.id} 가 ${Math.round((Date.now() - new Date(t.requested).getTime()) / 60_000)}분째 답을 기다립니다 — ${r.what}. 다시 봐 주세요 (${n}/${REASK_MAX}).\n  node bus/approve.mjs --decide ${r.id} --as <자리> PASS|REVISE "이유"`); t.reasked = now(); t.reaskCount = n; changed = true; }
          catch (e) { emit('hq', { actor: 'system', type: 'note', text: `승인 요청 ${r.id} 다시 부르기를 총괄실 세션에 넣지 못했습니다 — ${String(e.message).slice(0, 120)}` }); }
        } else if (!t.reaskGaveUp) {
          t.reaskGaveUp = now(); changed = true;
          emit(r.team, { actor: 'system', type: 'note', text: `승인 요청 ${r.id} — 총괄실을 ${REASK_MAX}번 다시 불렀는데 답이 없습니다(${need.map((w) => nameOf('hq', w)).join(', ')}). 사람이 봐야 합니다.`, meta: { approval: r.id, reaskGaveUp: true } });
        }
      }
    }

    // (b-1) 통과한 요청에 박힌 행동은 방이 닫혀 있어도, 세션이 없어도 실행한다. 상태를 바꾸는 일이지 말이 아니다.
    // "다음 마일스톤 착수" 가 통과했는데 라운드가 닫혀 있으면 now 가 안 옮겨져 startRound 가 영영 거부됐다 —
    // 알림 가능 여부가 행동까지 막고 있었다 (레오 감사, 2026-09-12). 적용은 한 번뿐이므로 send 와 무관하게 먼저 기록한다.
    if (r.status === 'passed' && !t.applied) {
      t.applied = now();
      t.appliedText = applyAction(r, store);
      changed = true;
    }

    // (b-2) 결말 — 요청한 방에
    if (r.status !== 'pending' && !t.decided) {
      if (!canHear(r.team)) continue;          // 라운드가 닫혀 있다. 열리면 알린다
      let text = decidedText(r);
      if (t.appliedText) text += ' ' + t.appliedText;
      try { send(r.team, text); t.decided = now(); changed = true; }
      catch (e) { emit(r.team, { actor: 'system', type: 'note', text: `승인 ${r.id} 결과를 세션에 넣지 못했습니다 — ${String(e.message).slice(0, 120)}` }); }
    }

    // (c) 실행 결과 — 요청한 방에
    const d = done[r.id];
    if (d && !t.executed) {
      if (!canHear(r.team)) continue;
      try { send(r.team, execText(r, d)); t.executed = now(); changed = true; }
      catch (e) { emit(r.team, { actor: 'system', type: 'note', text: `승인 ${r.id} 실행 결과를 세션에 넣지 못했습니다 — ${String(e.message).slice(0, 120)}` }); }
    }
  }
  // (d) 요청 블록
  try { if (runRequests(store, send)) changed = true; }
  catch (e) { console.error('[notifier] 요청 블록 알림 실패 — ' + String(e.message).slice(0, 200)); }   // 틱마다 도니 방에는 안 남긴다
  // (e) 대리 결정 요청 (결정 85) — 올리기만. 알림·실행은 위 (a)·(b-1) 이 다음 틱부터 평소처럼.
  try { if (runProxy(store)) changed = true; }
  catch (e) { console.error('[notifier] 대리 결정 살피기 실패 — ' + String(e.message).slice(0, 200)); }
  if (changed) writeStore(store);
}
