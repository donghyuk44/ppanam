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
//
// 팀 방은 라운드가 열려 있을 때만 들려준다. 닫혀 있으면 세션이 없거나 훅이 기록하지 않는다 — 다음 틱에 다시 본다.
// 총괄실은 늘 열려 있다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listApprovals, readCast, readState, readRoadmap, isOffice, quiet, emit, paths, setMilestoneStatus,
} from '../bus/bus.mjs';
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
  return `승인 요청 ${r.id} [등급 B] — ${r.team} 팀 ${who}: ${r.what}` +
    (r.detail ? `\n상세: ${r.detail}` : '') +
    (a?.type === 'push' ? `\n대상: ${a.remote ?? 'origin'}/${a.branch} @ ${String(a.sha).slice(0, 8)} — 통과하면 서버가 정확히 이 커밋을 민다` : '') +
    (a?.type === 'milestone' ? `\n대상: 마일스톤 ${a.n} 착수 — 통과하면 서버가 로드맵의 now 를 옮긴다` : '') +
    `\n\n판정하세요. 마일스톤 조건을 채웠는지, 컷리스트를 안 넘었는지 보고 결정하고, 제리에게 원문 대조를 시키세요.` +
    `\n  node bus/approve.mjs --decide ${r.id} --as chief PASS|REVISE "이유"` +
    `\n  node bus/outside.mjs --team hq --ask "승인 요청 ${r.id} 대조: ${r.what}"`;
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
function applyAction(r) {
  const a = r.action;
  if (!a) return null;
  if (r.grade === 'B' && a.type === 'milestone' && Number.isInteger(a.n)) {
    const ok = setMilestoneStatus(r.team, a.n, 'now');
    const text = ok ? `마일스톤 ${a.n} 착수 — 로드맵의 now 를 옮겼습니다.` : `마일스톤 ${a.n} 을 로드맵에서 찾지 못했습니다.`;
    emit(r.team, { actor: 'system', type: 'milestone', text, meta: { index: a.n, approval: r.id } });
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
  return null;
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

    // (b-1) 통과한 요청에 박힌 행동은 방이 닫혀 있어도, 세션이 없어도 실행한다. 상태를 바꾸는 일이지 말이 아니다.
    // "다음 마일스톤 착수" 가 통과했는데 라운드가 닫혀 있으면 now 가 안 옮겨져 startRound 가 영영 거부됐다 —
    // 알림 가능 여부가 행동까지 막고 있었다 (레오 감사, 2026-09-12). 적용은 한 번뿐이므로 send 와 무관하게 먼저 기록한다.
    if (r.status === 'passed' && !t.applied) {
      t.applied = now();
      t.appliedText = applyAction(r);
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
  if (changed) writeStore(store);
}
