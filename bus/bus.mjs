// 이벤트 버스 코어.
//
// 세 가지가 서로 다르다는 점이 이 파일의 전제다.
//
//   1. AI 컨텍스트  — 라운드마다 비운다. 에이전트는 현재 라운드의 이벤트만 읽는다.
//   2. 대화록       — 절대 비우지 않는다. teams/<팀>/log.jsonl 에 영원히 쌓인다.
//                     사람이 위로 스크롤하면 반년 전 대화도 나와야 한다.
//   3. 산출물       — 마일스톤의 결과물. teams/<팀>/out/ 에 파일로 남는다.
//
// 서버는 log.jsonl 을 tail 해서 새 줄만 브라우저로 밀어준다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findOutPaths, outItem } from '../server/public/outlink.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEAMS_PATH = path.join(ROOT, 'state', 'teams.json');

export const EVENT_TYPES = new Set([
  'message', 'enter', 'tool', 'verdict',
  'round_start', 'round_end', 'milestone', 'note',
]);
export const VERDICTS = new Set(['PASS', 'REVISE', 'FAIL']);

/**
 * 마일스톤당 허용되는 반박 횟수. 넘으면 자동 FAIL — 사람을 부른다.
 * 라운드가 아니라 마일스톤의 것이다. 라운드를 닫고 다시 열면 0 으로 돌아가던 시절에 R10·R11 이 각각 3회를 채우고도
 * 같은 마일스톤이 이어졌다 (2026-09-12). 0 으로 돌리는 것은 감사 PASS 와 대표의 재개뿐이다 (대표 결정, 2026-09-13).
 */
export const MAX_ATTEMPTS = 3;

/* ── 보호 브랜치 ──
 *
 * 실행자가 밀지 않고, 푸시 요청에 묶이지 않는 브랜치 — 원격의 기본 브랜치다. 메인 병합은 C 등급이라 B 로 우회할
 * 수 없어야 한다. 'main'·'master' 를 박아 두면 기본 브랜치 이름이 다른 저장소(이 저장소가 그렇다)에서 아무것도
 * 못 막는다 (대표 결정 9, 2026-09-13). 원격 HEAD 를 모르면 null — 부르는 쪽은 막는 쪽으로 처리한다.
 * (`git remote set-head origin -a` 로 잡힌다.)
 */
export function protectedBranch() {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^refs\/remotes\/origin\/(.+)$/.exec(ref)?.[1] ?? null;
  } catch { return null; }
}

/** 이 브랜치·SHA 를 푸시 요청에 묶어도 되는가. 안 되면 던진다. approve.mjs 가 HEAD 를 읽어 부른다. */
export function pushAction(branch, sha, remote = 'origin') {
  if (!branch || branch === 'HEAD') throw new Error('분리된 HEAD 는 푸시 대상이 될 수 없습니다. 브랜치를 체크아웃하세요.');
  const guarded = protectedBranch();
  if (!guarded) throw new Error('원격 기본 브랜치를 모릅니다 (refs/remotes/origin/HEAD 없음). git remote set-head origin -a 뒤에 다시 요청하세요.');
  if (branch === guarded) throw new Error(`'${branch}' 는 원격 기본 브랜치라 B 로 밀 수 없습니다. 메인 병합은 C 등급 — 대표가 직접 합니다.`);
  return { type: 'push', remote, branch, sha };
}

/* ── 총괄 배달 ──
 *
 * 총괄이 대표의 지시를 팀에 옮길 때, 요약만 보내면 팀에는 근거가 남지 않는다.
 * 나중에 감사역이 "이 지시의 근거가 어디 있냐"고 물었을 때 답할 것이 총괄의
 * 요약뿐이면 그건 근거가 아니다. 요약은 반드시 무언가를 떨어뜨린다.
 *
 * 그래서 원문과 해석을 한 봉투에 넣되, 훅이 받는 즉시 두 개의 이벤트로 가른다.
 * 한 말풍선 안에 두 블록으로 두면 언젠가 섞인다. 스키마가 강제해야 한다.
 */
export const RELAY_ORIGIN = '⟦대표 원문 — 손대지 않음⟧';
export const RELAY_ASSIGN = '⟦총괄 배분⟧';

/**
 * 이미 대화록에 있는 말을 다른 세션의 귀에 넣을 때 붙이는 표시.
 *
 * 외부감사가 한 말은 그가 직접 대화록에 남긴다. 그 말을 실무가 들으려면 실무
 * 세션에도 넣어줘야 하는데, 그대로 넣으면 훅이 대표 말풍선으로 또 남긴다.
 * 이 표시가 붙은 것은 훅이 기록하지 않는다 — 말한 사람이 이미 남겼기 때문이다.
 *
 * 이게 없으면 둘은 서로의 말을 못 듣는다. 대화가 아니라 각자 독백이 된다.
 */
export const RELAY_QUIET = '⟦들려주기 — 기록하지 않음⟧';

export const isQuietRelay = (text) => String(text ?? '').startsWith(RELAY_QUIET);

/**
 * 턴의 종류를 말하는 표시. 들려주기 안에 들어간다.
 *   ⟦판정 요청⟧ <대상>  — 답의 첫 줄이 PASS/REVISE/FAIL 이면 훅이 판정 카드로 남긴다 (모든 엔진이 같은 규약).
 *   ⟦일지⟧             — 답은 대화록에 남지 않는다. 서버가 받아 journal/<자리>.md 에 붙인다.
 * 훅은 UserPromptSubmit 에서 종류를 state/turn/<방>.<자리> 에 적고 Stop 에서 읽는다 — 에이전트가 기억할 규칙이 아니다.
 */
export const TURN_VERDICT = '⟦판정 요청⟧';
export const TURN_JOURNAL = '⟦일지⟧';
export function turnKindOf(text) {
  const s = String(text ?? '');
  if (s.includes(TURN_JOURNAL)) return 'journal';
  if (s.includes(TURN_VERDICT)) return 'verdict';
  return null;
}
export const TURN_DIR = path.join(ROOT, 'state', 'turn');
// 파일 이름에 세션 id 가 들어간다. 같은 방·자리에 세션이 둘(닫히는 것과 새것)이면 한 파일을 덮어썼다 (레오 감사, 2026-09-12).
// 서버가 턴을 stdin 에 쓰기 전에 먼저 적고(session.mjs write), 훅의 UserPromptSubmit 도 적는다 — 비동기 훅이 늦어도 서버 것이 있다.
const turnFile = (team, actor, sid) => path.join(TURN_DIR, sid ? `${team}.${actor}.${String(sid).replace(/[^A-Za-z0-9_-]/g, '_')}` : `${team}.${actor}`);
export function writeTurn(team, actor, kind, extra = '', sid = null) {
  fs.mkdirSync(TURN_DIR, { recursive: true });
  fs.writeFileSync(turnFile(team, actor, sid), extra ? `${kind}:${extra}` : kind);
}
export function takeTurn(team, actor, sid = null) {
  const parse = (s) => { const i = s.indexOf(':'); return i < 0 ? { kind: s, extra: '' } : { kind: s.slice(0, i), extra: s.slice(i + 1) }; };
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
  const drop = (f) => { try { fs.unlinkSync(f); } catch { /* 없다 */ } };
  const plainFile = turnFile(team, actor, null);
  if (sid) {
    const f = turnFile(team, actor, sid);
    const s = read(f);
    if (s != null) {
      drop(f);
      // 서버가 세션 id 를 아직 모를 때(첫 턴) 적은 일반 마커가 같은 턴의 것이면 같이 치운다. 내용이 다르면 남의 것이다 —
      // 무조건 지우면 다른 세션의 마커가 사라진다 (레오 감사, 2026-09-12).
      if (read(plainFile) === s) drop(plainFile);
      return parse(s);
    }
  }
  const s = read(plainFile);
  if (s == null) return null;
  drop(plainFile);
  return parse(s);
}

/** 판정의 첫 줄 규약. PASS/REVISE/FAIL 한 단어면 그 판정, 아니면 null. */
export function splitVerdictLine(text) {
  const [first, ...rest] = String(text ?? '').split('\n');
  const v = first.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (VERDICTS.has(v)) return { verdict: v, body: rest.join('\n').trim() || String(text) };
  return null;
}

/** 일지에 한 문단 붙인다 — 최신이 맨 위. 첫 줄이 머리(## …)가 아니면 붙여 준다. */
export function appendJournal(team, actor, text, { round = null } = {}) {
  const body = String(text ?? '').trim();
  if (!body || /^\(?패스\)?[.·\s]*$/.test(body)) return false;
  const cast = readCast(team).agents ?? {};
  const name = cast[actor]?.name ?? actor;
  const date = new Date().toISOString().slice(0, 10);
  const head = `## ${date} · 라운드 ${round ?? readState(team).round} · ${name}`;
  const para = body.startsWith('## ') ? body : `${head}\n\n${body}`;
  const dir = path.join(paths(team).dir, 'journal');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${actor}.md`);
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch { /* 첫 문단 */ }
  fs.writeFileSync(file, para + '\n\n' + old);
  return true;
}

/**
 * 하네스가 세션에 밀어넣는 블록을 걷어낸다.
 *
 * 백그라운드 작업 완료 알림 같은 것은 대표가 한 말이 아닌데, 프롬프트로 들어오기
 * 때문에 UserPromptSubmit 훅이 대표 발언으로 남긴다. 그러면 감사역이 그걸
 * 대표 지시로 읽는다. 사람이 쓴 부분만 남기고, 남는 게 없으면 빈 문자열이다.
 */
export function stripSystemBlocks(text) {
  return String(text ?? '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ip_reminder>[\s\S]*?<\/ip_reminder>/g, '')
    .trim();
}

/**
 * 이 말이 누구를 향한 것인가.
 *
 * 대화가 대화이려면 "질문에는 답이 온다"가 성립해야 한다. 지금 구조에서는
 * 다니엘이 안젤에게 물어도 안젤에게 차례가 가지 않아 각자 독백이 된다.
 * 첫머리에 이름이 나오면 그 사람에게 차례를 넘긴다.
 *
 * 서브에이전트는 스스로 등장할 수 없으므로, 실제로는 실무에게 "누가 답해야
 * 하는지"를 알려주는 방식으로 쓴다.
 */
export function addressee(text, cast, { except = null } = {}) {
  return addressees(text, cast, { except })[0] ?? null;
}

/**
 * 한 발언이 부른 사람 전부, 부른 순서대로. 첫머리뿐 아니라 문단(빈 줄) 첫머리의 호명도 본다.
 * "대표님, … / 안젤, … / 다니엘, …" 에서 첫 24자만 보면 안젤·다니엘은 안 깨어 대표가 "죽어 있는 것 같다" 고 봤다
 * (하영 진단, 2026-09-13 — 대표 결정 22). 같은 사람은 한 번만.
 */
export function addressees(text, cast, { except = null } = {}) {
  const out = [];
  const paras = String(text ?? '').split(/\n\s*\n/);
  for (const p of paras) {
    const head = p.trim().slice(0, 24);
    for (const [id, a] of Object.entries(cast ?? {})) {
      if (id === except || id === 'system' || !a?.name || out.includes(id)) continue;
      // 이름을 정규식에 그대로 넣으면 "함동혁(댄)" 의 괄호가 그룹이 되어 영영 안 잡힌다.
      if (new RegExp('^' + escapeRegExp(a.name) + '\\s*(씨|님)?\\s*[,，、:·]').test(head)) { out.push(id); break; }
    }
  }
  return out;
}
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 대표를 불렀나. 캐스트의 대표 이름 외에 "대표님·대표·댄" 도 호명이다 — 사람들은 이름보다 직함으로 부른다. */
export function callsBoss(text, cast) {
  if (addressees(text, cast).includes('boss')) return true;
  return /(^|\n\s*\n)\s*(대표님|대표|댄)\s*(씨|님)?\s*[,，、:·]/.test(String(text ?? ''));
}
export const quiet = (text) => `${RELAY_QUIET}\n${text}`;

/**
 * 배달 봉투를 원문과 배분으로 가른다.
 * 봉투가 아니면 null 을 돌려준다 (보통의 지시는 그대로 대표 말풍선이 된다).
 */
export function splitRelay(text) {
  const s = String(text ?? '');
  const i = s.indexOf(RELAY_ORIGIN);
  const j = s.indexOf(RELAY_ASSIGN);
  if (i < 0 || j < 0 || j < i) return null;
  const origin = s.slice(i + RELAY_ORIGIN.length, j).trim();
  const assign = s.slice(j + RELAY_ASSIGN.length).trim();
  if (!origin) return null;
  return { origin, assign };
}

/* ── 승인 ──
 *
 * 대표가 자리를 비워도 팀이 달리려면 "무엇을 누가 승인하는가"가 등급으로 정해져 있어야 한다.
 * 책(에이전틱 코딩 15장)의 원칙 5 — 사람의 감독 지점은 병목이 아니라 큰 대가를 치르는
 * 실수를 막는 품질 게이트다. 아키텍처 결정·보안 변경·통합 지점·최종 검증은 사람 몫.
 *
 *   A 자동   실무 혼자.        브랜치 안 커밋, 산출물 쓰기, 라운드 열고 닫기, 감사역 부르기
 *   B 총괄   톰 결정 + 제리 대조. 둘 다 PASS 여야 한다.
 *                              원격 푸시, 다음 마일스톤 착수, 다른 팀에 일 넘기기, 세션 재시작
 *   C 대표   대표만.           메인 병합, 컷리스트·로드맵 변경, 비용 상한, 외부 발송, 인격 파일 수정
 *
 * 큐는 append-only 다 (state/approvals.jsonl). 요청 한 줄, 판정 한 줄씩 쌓이고 읽을 때 접는다.
 * 대화록과 같은 원칙 — 지우지 않는다.
 */
export const APPROVAL_GRADES = {
  A: { label: '자동', needs: [],                   desc: '브랜치 안 커밋 · 산출물 쓰기 · 라운드 열고 닫기 · 감사역 부르기' },
  B: { label: '총괄', needs: ['chief', 'outside'], desc: '원격 푸시 · 다음 마일스톤 착수 · 다른 팀에 일 넘기기 · 세션 재시작' },
  C: { label: '대표', needs: ['boss'],             desc: '메인 병합 · 컷리스트·로드맵 변경 · 비용 상한 · 외부 발송 · 인격 파일 수정' },
};
export const APPROVALS_PATH = path.join(ROOT, 'state', 'approvals.jsonl');

function appendApproval(line) {
  fs.mkdirSync(path.dirname(APPROVALS_PATH), { recursive: true });
  fs.appendFileSync(APPROVALS_PATH, JSON.stringify(line) + '\n');
}

/** 요청과 판정 줄을 접어서 요청 하나당 상태 하나로 만든다. */
export function listApprovals({ team = null, status = null } = {}) {
  const byId = new Map();
  for (const l of readJSONLCached(APPROVALS_PATH)) {
    if (l.kind === 'request') {
      byId.set(l.id, { ...l, decisions: [], status: l.grade === 'A' ? 'passed' : 'pending', decidedAt: l.grade === 'A' ? l.ts : null });
      continue;
    }
    if (l.kind === 'void') {
      // 지우지 않는다. 무효라고 한 줄 더 쓴다 — 대화록과 같은 원칙.
      const r = byId.get(l.id);
      if (r) { r.status = 'void'; r.decidedAt = l.ts; r.voidReason = l.reason ?? ''; }
      continue;
    }
    if (l.kind === 'decision') {
      const r = byId.get(l.id);
      if (!r || r.status !== 'pending') continue;
      r.decisions.push(l);
      const needs = APPROVAL_GRADES[r.grade]?.needs ?? [];
      if (l.decision === 'REVISE') { r.status = 'revised'; r.decidedAt = l.ts; }
      else if (needs.every((who) => r.decisions.some((d) => d.by === who && d.decision === 'PASS'))) {
        r.status = 'passed'; r.decidedAt = l.ts;
      }
    }
  }
  let out = [...byId.values()];
  if (team) out = out.filter((r) => r.team === team);
  if (status) out = out.filter((r) => r.status === status);
  return out;
}

export function requestApproval(team, { by = 'guide', grade, what, detail = '', action = null, files = [] }) {
  const g = String(grade || '').toUpperCase();
  if (!APPROVAL_GRADES[g]) throw new Error(`등급은 A / B / C 중 하나여야 합니다.`);
  if (!what?.trim()) throw new Error('무엇을 승인받을지가 비어 있습니다.');
  // 카드에 붙일 산출물 — teams/<팀>/out/ 기준 상대 경로. 요청 시 있어야 한다 (대표 결정 36).
  const outs = (files ?? []).map((f) => String(f).trim().replace(/^out\//, '')).filter(Boolean);
  for (const f of outs) {
    const file = outFile(team, f);
    if (!file || !fs.existsSync(file)) throw new Error(`teams/${team}/out/${f} 이 없습니다. 산출물은 out/ 에 두고 그 안의 경로로 적습니다.`);
  }
  const rec = {
    kind: 'request', id: 'apr_' + crypto.randomBytes(4).toString('hex'),
    ts: new Date().toISOString(), team, by, grade: g, what: what.trim(), detail: String(detail ?? '').trim(),
    round: readState(team).round || 0,
    // 실행 대상을 요청에 묶는다. 푸시라면 그때의 브랜치·SHA 다. 실행자는 이 값만 믿는다 —
    // 자유 텍스트를 정규식으로 훑어 "푸시인가"를 짐작하지 않는다 (레오 감사, 2026-09-02).
    ...(action ? { action } : {}),
    ...(outs.length ? { files: outs } : {}),
  };
  // 방에도 남긴다 — 화면에서 가장 약한 줄이지만, 나중에 "언제 요청했나"를 찾을 수 있어야 한다.
  // 그 줄의 id 를 레코드에 박아 카드의 "방에서 보기" 가 요청자 원문으로 건너간다 (결정 20-2).
  const ev = emit(team, {
    actor: by, type: 'note',
    text: `승인 요청 [${g}] ${rec.what}${g === 'A' ? ' — 자동 통과' : ''}`,
    meta: { approval: rec.id, grade: g },
  });
  rec.note = ev.id;
  appendApproval(rec);
  return listApprovals().find((r) => r.id === rec.id);
}

/**
 * 카드가 펼칠 "바뀌는 것" — 요청에 박힌 action 을 지금 상태로 푼다 (결정 20-2). 큐 파일에는 안 쓴다.
 * 읽을 때마다 git·파일을 보므로 API 가 카드를 줄 때만 부른다. 못 읽으면 { error } — 모르면서 승인하게 두지 않는다.
 */
export function approvalPreview(r) {
  const a = r.action;
  if (!a) return null;
  try {
    if (a.type === 'push') {
      const g = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      let base = null;
      try { base = g(['rev-parse', '--verify', '--quiet', `${a.remote ?? 'origin'}/${a.branch}`]) && `${a.remote ?? 'origin'}/${a.branch}`; } catch { /* 원격에 아직 없는 브랜치 */ }
      if (!base) { const p = protectedBranch(); base = p ? `origin/${p}` : null; }
      if (!base) return { error: '비교할 기준 브랜치를 모릅니다 (origin/HEAD 없음)' };
      const count = Number(g(['rev-list', '--count', `${base}..${a.sha}`])) || 0;
      const commits = g(['log', '--format=%s', '--max-count=8', `${base}..${a.sha}`]).split('\n').filter(Boolean);   // 제목은 앞 8개만
      const files = g(['diff', '--name-only', `${base}...${a.sha}`]).split('\n').filter(Boolean);
      return { branch: a.branch, sha: a.sha, base, count, commits, files };
    }
    if (a.type === 'milestone') {
      const m = (readRoadmap(r.team).milestones ?? []).find((x) => x.n === a.n);
      return m ? { n: a.n, title: m.title ?? a.title ?? null, deliverable: m.deliverable ?? null } : { error: `마일스톤 ${a.n} 이 로드맵에 없습니다` };
    }
    if (a.type === 'roadmap') {
      const src = path.resolve(paths(r.team).out, path.basename(String(a.file)));
      const p = JSON.parse(fs.readFileSync(src, 'utf8'));
      if (!Array.isArray(p.milestones)) return { error: `${path.basename(src)}: milestones 가 배열이 아닙니다` };
      return {
        file: path.basename(src),
        destination: p.destination ?? null,
        milestones: p.milestones.map((m) => ({ n: m.n, title: m.title ?? '', status: m.status ?? null })),
        cutList: Array.isArray(p.cutList) ? p.cutList : [],
      };
    }
    return null;
  } catch (e) {
    return { error: String(e.message).slice(0, 160) };
  }
}

/**
 * 카드가 펼칠 산출물 (대표 결정 36 — "그림이 없는데 어떻게 승인해"). 요청의 files(--out)와 what·detail 에 적힌
 * out/… 경로를 모아 지금 상태로 stat 한다. 큐 파일에는 안 쓴다. 없는 파일은 missing — 모르면서 승인하게 두지 않는다.
 */
export function approvalArtifacts(r) {
  const items = new Map();
  const add = (f) => { if (!items.has(`${f.team}/${f.rel}`)) items.set(`${f.team}/${f.rel}`, f); };
  for (const f of r.files ?? []) add(outItem(r.team, String(f).replace(/^out\//, '')));
  for (const f of findOutPaths(`${r.what ?? ''}\n${r.detail ?? ''}`, r.team)) add(f);
  return [...items.values()].map((f) => {
    const file = outFile(f.team, f.rel);
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      return { ...f, size: st.size, at: st.mtime.toISOString() };
    } catch { return { ...f, missing: true }; }
  });
}

/**
 * GET /out/<팀>/<경로> 가 여는 실제 파일. teams/<팀>/out/ 밖(..)·숨김 파일·없는 팀은 null.
 * 읽기 전용 내보내기다 — 서버는 이 경로로 쓰지 않는다 (대표 결정 36).
 */
export function outFile(team, rel) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(team ?? '')) || !teamExists(team)) return null;
  const parts = String(rel ?? '').split('/');
  if (!parts.length || parts.some((s) => !s || s === '..' || s.startsWith('.'))) return null;
  const dir = paths(team).out;
  const file = path.join(dir, ...parts);
  return file.startsWith(dir + path.sep) ? file : null;
}

export function voidApproval(id, reason = '') {
  const r = listApprovals().find((x) => x.id === id);
  if (!r) throw new Error(`그런 요청이 없습니다: ${id}`);
  appendApproval({ kind: 'void', id, reason: String(reason ?? '').trim(), ts: new Date().toISOString() });
  return listApprovals().find((x) => x.id === id);
}

export function decideApproval(id, { by, decision, reason = '', team = null }) {
  const r = listApprovals().find((x) => x.id === id);
  if (!r) throw new Error(`그런 요청이 없습니다: ${id}`);
  if (r.status !== 'pending') throw new Error(`이미 끝난 요청입니다 (${r.status}).`);
  const d = String(decision || '').toUpperCase();
  if (!['PASS', 'REVISE'].includes(d)) throw new Error('판정은 PASS 또는 REVISE 입니다.');
  const needs = APPROVAL_GRADES[r.grade].needs;
  if (!needs.includes(by)) throw new Error(`등급 ${r.grade} 는 ${needs.join('·')} 이(가) 판정합니다. '${by}' 는 아닙니다.`);
  // B 의 chief·outside 는 총괄실 사람이다 — 톰과 제리. 'outside' 라는 자리 이름은 방마다 있어서
  // 개발팀의 레오가 제리 몫의 대조를 기록할 수 있었다 (Fable 감사가 격리 실행으로 뚫었다, 2026-09-02).
  // 판정하는 프로세스가 자기 방을 같이 대야 한다. 대표(boss)는 방이 없다.
  if ((by === 'chief' || by === 'outside') && team !== 'hq') {
    throw new Error(`등급 ${r.grade} 의 ${by} 판정은 총괄실에서만 합니다 (지금 방: ${team ?? '없음'}).`);
  }
  if (r.decisions.some((x) => x.by === by)) throw new Error(`${by} 는 이미 판정했습니다.`);
  appendApproval({ kind: 'decision', id, by, decision: d, reason: String(reason ?? '').trim(), ts: new Date().toISOString() });
  const after = listApprovals().find((x) => x.id === id);
  if (after.status !== 'pending') {
    emit(r.team, {
      actor: 'system', type: 'note',
      text: `승인 ${after.status === 'passed' ? '통과' : '반려'} [${r.grade}] ${r.what}${reason ? ' — ' + reason : ''}`,
      meta: { approval: id, grade: r.grade, status: after.status },
    });
  }
  return after;
}

/* ── 파일 ── */

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return value;
}
function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/**
 * 파일이 바뀌지 않았으면 지난번 파싱 결과를 돌려준다.
 *
 * 서버는 250ms 마다 다섯 방의 요약을 만든다. 그때마다 대화록 전체를 파싱하면(teamSummary → readLog)
 * 대화록이 자랄수록 서버가 느려진다 — "하루종일 대화" 를 요구한 시스템에서 치명적이다 (Fable 재점검, 2026-09-12).
 * 크기·수정 시각이 같으면 같은 파일이다. 돌려주는 배열은 공유되므로 고치지 않는다.
 */
const jsonlCache = new Map();   // file → { size, mtimeMs, rows }
function readJSONLCached(file) {
  let st;
  try { st = fs.statSync(file); } catch { jsonlCache.delete(file); return []; }
  const hit = jsonlCache.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.rows;
  const rows = parseJSONL(safeRead(file));
  jsonlCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, rows });
  return rows;
}

export function parseJSONL(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 쓰기 도중 잘린 줄 */ }
  }
  return out;
}

/* ── 팀 ── */

export function listTeams() {
  const cfg = readJSON(TEAMS_PATH, { teams: [], default: null });
  return cfg.teams ?? [];
}

export function defaultTeam() {
  const cfg = readJSON(TEAMS_PATH, { teams: [], default: null });
  return cfg.default ?? cfg.teams?.[0]?.id ?? 'marketing';
}

export function teamExists(id) {
  return listTeams().some((t) => t.id === id);
}

/**
 * 방의 종류.
 *
 * 'team'   — 작전실. 라운드로 돌고, 로드맵과 마일스톤이 있다.
 * 'office' — 총괄실. 대표와 1:1 이라 라운드가 없다. 항상 열려 있다.
 *
 * 라운드가 없다는 건 훅의 기록 조건도 다르다는 뜻이다. 작전실은 라운드가 열려
 * 있을 때만 기록하지만(안 그러면 잡담이 다 흘러든다), 총괄실은 그 방 자체가
 * 대표와의 대화라 늘 기록한다.
 */
export function kindOf(id) {
  return listTeams().find((t) => t.id === id)?.kind ?? 'team';
}

export const isOffice = (id) => kindOf(id) === 'office';

export function paths(team) {
  const dir = path.join(ROOT, 'teams', team);
  return {
    dir,
    log: path.join(dir, 'log.jsonl'),
    rounds: path.join(dir, 'rounds.jsonl'),
    state: path.join(dir, 'round.json'),
    cast: path.join(dir, 'cast.json'),
    roadmap: path.join(dir, 'roadmap.json'),
    out: path.join(dir, 'out'),
  };
}

/* ── 상태 ── */

// attempt 는 지금 라운드의 마일스톤 값(화면·CLI 가 읽는 것), attempts 는 마일스톤 키별 값 — 라운드를 닫아도 남고 다음 startRound 가 물려받는다.
const BLANK_STATE = {
  round: 0, milestone: 0, phase: 'idle', topic: null,
  attempt: 0, attempts: {}, startedAt: null, endedAt: null,
};

export function readState(team) {
  const file = readJSON(paths(team).state, null);
  if (file) return { ...BLANK_STATE, ...file };
  // 파일이 없다 — 지워졌거나(round.json 은 git 에 없다. 이 커밋을 받은 체크아웃에서 사라진다) 처음이다.
  // 대화록이 진실이므로 거기서 되살린다. 라운드 경계는 round_start / round_end 이벤트다.
  return deriveState(team);
}

/**
 * 대화록만으로 라운드 상태를 되살린다. round.json 은 이 값의 캐시일 뿐이다.
 *
 * 마지막 경계가 round_start 면 열린 라운드다 — 번호·마일스톤·주제는 그 이벤트에 있다. 마지막 경계가 round_end 면
 * 닫힌 라운드다. 반박 횟수는 마일스톤의 것이라 대화록 전체를 훑는다 — 판정 카드의 meta.attempt 가 그 시점의 값이고,
 * PASS 카드와 대표의 재개 note 가 0 으로 돌린다.
 * (레오 감사, 2026-09-12: gitignore 만으로는 받는 쪽의 열린 라운드를 지키지 못한다.)
 */
export function deriveState(team) {
  const log = readLog(team);
  const attempts = {};
  for (const x of log) {
    const m = x.milestone ?? 0;
    if (x.type === 'verdict' && !x.meta?.stale) {
      if (x.meta?.verdict === 'PASS') attempts[m] = 0;
      else if (typeof x.meta?.attempt === 'number') attempts[m] = Math.min(Math.max(attempts[m] ?? 0, x.meta.attempt), MAX_ATTEMPTS);
    }
    if (x.type === 'note' && x.meta?.resumed) attempts[m] = 0;
  }
  let i = log.length - 1;
  for (; i >= 0; i--) if (log[i].type === 'round_start' || log[i].type === 'round_end') break;
  if (i < 0) return { ...BLANK_STATE, attempts };
  const e = log[i];
  if (e.type === 'round_end') {
    return { ...BLANK_STATE, round: e.round ?? 0, milestone: e.milestone ?? 0, phase: 'idle', endedAt: e.ts, attempts };
  }
  let phase = 'running';
  for (let j = i + 1; j < log.length; j++) {
    const x = log[j];
    if (x.type === 'verdict' && !x.meta?.stale && x.meta?.verdict === 'FAIL') phase = 'blocked';
    // 대표가 말해서 풀렸다 (resumeRound 가 남기는 note)
    if (x.type === 'note' && x.meta?.resumed) phase = 'running';
  }
  const milestone = e.milestone ?? 0;
  return {
    ...BLANK_STATE,
    round: e.round ?? 0, milestone, phase,
    topic: e.meta?.topic ?? null, attempt: attempts[milestone] ?? 0, attempts, startedAt: e.ts, endedAt: null,
  };
}

export function writeState(team, patch) {
  return writeJSON(paths(team).state, { ...readState(team), ...patch });
}

export function readCast(team) {
  return readJSON(paths(team).cast, { agents: {} });
}

export function readRoadmap(team) {
  return readJSON(paths(team).roadmap, { destination: null, milestones: [], cutList: [] });
}

/* ── 대화록 ── */

/**
 * 이벤트 한 건을 대화록에 남긴다.
 *
 * 훅은 병렬로 실행되므로 여러 프로세스가 같은 파일에 동시에 쓴다.
 * appendFileSync 한 번으로 개행까지 붙여야 줄이 섞이지 않는다.
 */
export function emit(team, event) {
  const state = readState(team);
  const record = {
    id: 'evt_' + crypto.randomBytes(5).toString('hex'),
    ts: new Date().toISOString(),
    team,
    round: event.round ?? state.round ?? 0,
    milestone: event.milestone ?? state.milestone ?? 0,
    actor: event.actor || 'system',
    type: EVENT_TYPES.has(event.type) ? event.type : 'message',
    text: typeof event.text === 'string' ? event.text : String(event.text ?? ''),
    ...(event.meta ? { meta: event.meta } : {}),
  };
  const p = paths(team);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.log, JSON.stringify(record) + '\n');
  return record;
}

/** 대화록 전체. 파일이 안 바뀌었으면 캐시다 — 돌려받은 배열을 고치지 않는다. */
export function readLog(team) {
  return readJSONLCached(paths(team).log);
}

/**
 * 대화록의 최근 limit 건. before 를 주면 그 이벤트보다 앞의 것들을 준다.
 * 위로 스크롤할 때 쓰는 페이지네이션.
 */
export function readTail(team, { limit = 200, before = null } = {}) {
  const all = readLog(team);
  const end = before ? all.findIndex((e) => e.id === before) : all.length;
  const stop = end < 0 ? all.length : end;
  const start = Math.max(0, stop - limit);
  return { events: all.slice(start, stop), more: start > 0, total: all.length };
}

/** 현재 라운드의 이벤트만. AI 에게 넘기는 컨텍스트가 이것이다. */
export function readContext(team) {
  const { round } = readState(team);
  if (!round) return [];
  return readLog(team).filter((e) => e.round === round);
}

/* ── 라운드 ── */

export function listRounds(team) {
  return parseJSONL(safeRead(paths(team).rounds)).reverse();
}

/**
 * 다음 라운드 번호.
 *
 * round.json 만 믿지 않는다. 그 파일이 지워지거나 되돌려지면 번호가 1로 돌아가
 * 대화록에 이미 있는 라운드와 충돌하기 때문이다. 기록에 남은 최대값도 함께 본다.
 */
function nextRoundNumber(team) {
  let max = readState(team).round || 0;
  for (const r of parseJSONL(safeRead(paths(team).rounds))) {
    if (typeof r.round === 'number' && r.round > max) max = r.round;
  }
  const log = readLog(team);
  for (let i = log.length - 1; i >= 0; i--) {
    if (typeof log[i].round === 'number' && log[i].round > max) max = log[i].round;
  }
  return max + 1;
}

/**
 * 로드맵이 지금 가리키는 마일스톤. 어디가 현재인지는 로드맵이 정한다.
 *
 * 이게 없으면 라운드가 직전 라운드의 번호를 물려받아, 로드맵은 3번을 하고 있는데
 * 라운드는 1번이라고 말하는 상태가 된다. 감사역이 무엇을 기준으로 볼지 알 수 없어진다.
 */
function nowMilestone(team) {
  const ms = readRoadmap(team).milestones ?? [];
  return ms.find((m) => m.status === 'now')?.n ?? null;
}

/**
 * 로드맵의 마일스톤 상태를 옮긴다. 사람도 세션도 roadmap.json 을 손으로 고치지 않는다 — 코드가 옮긴다.
 *   'pass' 는 라운드를 PASS 로 닫을 때(사실 기록), 'now' 는 "다음 마일스톤 착수" B 가 통과할 때(notifier),
 *   로드맵 전체 교체는 C 가 통과할 때. 컷리스트·로드맵 변경이 C 인 이유가 이것이다.
 * now 는 하나뿐이다 — 새로 now 가 되면 다른 now 는 wait 로.
 */
export function setMilestoneStatus(team, n, status) {
  const roadmap = readRoadmap(team);
  const ms = roadmap.milestones ?? [];
  const m = ms.find((x) => x.n === n);
  if (!m) return false;
  if (status === 'now') for (const x of ms) if (x.status === 'now' && x !== m) x.status = 'wait';
  m.status = status;
  writeJSON(paths(team).roadmap, roadmap);
  return true;
}

export function startRound(team, { topic = null, milestone = null } = {}) {
  const prev = readState(team);
  // 열린 라운드 위에 또 열면 앞 라운드는 round_end 도 rounds.jsonl 색인도 없이 사라진다.
  if (prev.phase === 'running' || prev.phase === 'blocked') {
    throw new Error(`이미 라운드 ${prev.round} 이 열려 있습니다. 먼저 닫으세요.`);
  }
  // 어느 마일스톤인가. 로드맵의 now 가 정한다. now 가 없으면(직전 것을 PASS 로 닫아 pass 가 됐다) 다음 착수는
  // B 승인이다 — 실무가 혼자 다음 것을 당겨오지 않는다. 번호를 명시하면(대표의 화면·터미널) 그건 대표 결정이다.
  const ms = readRoadmap(team).milestones ?? [];
  let target = milestone ?? nowMilestone(team);
  if (target == null) {
    if (!ms.length) target = prev.milestone || 1;   // 로드맵이 없는 방 — 번호만 이어간다
    else {
      const next = ms.find((m) => m.status !== 'pass');
      throw new Error(next
        ? `로드맵에 now 인 마일스톤이 없습니다. 다음(${next.n} ${next.title ?? ''})의 착수는 B 승인입니다 — node bus/approve.mjs --request B --next "다음 마일스톤 착수". 대표가 직접 열려면 마일스톤 번호를 지정하세요.`
        : '로드맵의 마일스톤이 전부 pass 입니다. 로드맵을 다시 짜세요 (/kickoff).');
    }
  }
  // 반박 횟수는 마일스톤의 것이다. 같은 마일스톤을 다시 열면 물려받는다 — 닫았다 여는 것으로 0 이 되지 않는다.
  const attempts = prev.attempts ?? {};
  const next = writeState(team, {
    round: nextRoundNumber(team),
    milestone: target,
    phase: 'running',
    topic: topic ?? prev.topic,
    attempt: Math.min(attempts[target] ?? 0, MAX_ATTEMPTS),
    attempts,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });
  emit(team, {
    type: 'round_start',
    actor: 'system',
    text: `라운드 ${next.round} 시작 · 마일스톤 ${next.milestone}`,
    meta: { topic: next.topic },
  });
  return next;
}

/**
 * 이 라운드를 이 판정으로 닫아도 되는가. 안 되면 이유, 되면 null.
 *
 * R3·R6·R8 은 판정 카드 없이, 또는 REVISE 카드 뒤에 `end -v PASS` 로 닫혀 로드맵에 "마일스톤 1 통과" 가 찍혔다
 * (2026-09-12). "만든 사람이 판정하지 않는다" 가 산문에만 있었다. 여기서 막는다 (대표 결정, 2026-09-13).
 *   - PASS 는 이 라운드에 판정 카드가 있고, 마지막 카드가 PASS 이며, 그 뒤에 사회자의 판정 완료 note
 *     (meta.verdictFlow: 'pass') 가 있을 때만. 마지막이 REVISE·FAIL 이면 PASS 로 못 닫는다.
 *   - FAIL 로 막힌 방(blocked)은 대표가 말해 풀기 전엔 어떤 판정으로도 닫지 못한다.
 */
export function endRefusal(team, { verdict = null } = {}) {
  const state = readState(team);
  // round 번호가 아니라 phase 로 본다. 번호는 닫힌 뒤에도 남아 있어서, 번호만 보면 같은 라운드를
  // 두 번 닫고 배너·색인·세션 리셋이 두 번 난다 (Fable 재점검, 2026-09-12).
  if (!state.round || state.phase === 'idle') return '진행 중인 라운드가 없습니다.';
  if (state.phase === 'blocked') return `대표 판단 대기 중입니다 (라운드 ${state.round}, FAIL). 대표가 이 방에 말해 풀기 전엔 닫을 수 없습니다.`;
  if (String(verdict ?? '').toUpperCase() !== 'PASS') return null;
  const events = readLog(team).filter((e) => e.round === state.round);
  let last = -1;
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'verdict' && !events[i].meta?.stale) { last = i; break; }
  if (last < 0) return 'PASS 로 닫으려면 이 라운드에 판정 카드가 있어야 합니다. 감사역을 부르세요 (node bus/round.mjs verdict).';
  const v = events[last].meta?.verdict;
  if (v !== 'PASS') return `마지막 판정이 ${v} 입니다. PASS 로 닫을 수 없습니다.`;
  if (!events.slice(last + 1).some((e) => e.type === 'note' && e.meta?.verdictFlow === 'pass')) {
    return '판정 카드는 PASS 인데 사회자의 판정 완료 note 가 없습니다. 판정은 /verdict 흐름으로 받습니다 (node bus/round.mjs verdict).';
  }
  return null;
}

/** 닫을 수 없으면 사유를 방에 남기고 던진다. 서버(/api/round)는 미루기 전에, endRound 는 닫기 직전에 부른다. */
export function assertEndable(team, opts = {}) {
  const why = endRefusal(team, opts);
  if (!why) return;
  const state = readState(team);
  if (state.round && state.phase !== 'idle') {
    emit(team, { type: 'note', actor: 'system', text: `라운드 ${state.round} 닫기 거부${opts.verdict ? ' (' + String(opts.verdict).toUpperCase() + ')' : ''} — ${why}`, meta: { endRefused: true } });
  }
  throw new Error(why);
}

/**
 * 라운드를 닫는다.
 *
 * 대화록은 그대로 둔다 — 구분선이 하나 들어갈 뿐이다.
 * 비워지는 건 AI 컨텍스트뿐이고, 그건 다음 라운드부터 round 번호가
 * 달라지면서 자연히 끊긴다 (readContext 참고).
 */
export function endRound(team, { verdict = null, summary = null } = {}) {
  assertEndable(team, { verdict });
  const state = readState(team);

  emit(team, {
    type: 'round_end',
    actor: 'system',
    text: summary || `라운드 ${state.round} 종료${verdict ? ' · ' + verdict : ''}`,
    meta: { verdict },
  });

  // PASS 로 닫혔으면 이 마일스톤은 끝났다 — 사실 기록. 다음 것을 now 로 옮기는 것은 B 승인의 일이다.
  if (String(verdict ?? '').toUpperCase() === 'PASS' && state.milestone) {
    if (setMilestoneStatus(team, state.milestone, 'pass')) {
      emit(team, { type: 'milestone', actor: 'system', text: `마일스톤 ${state.milestone} 통과 — 로드맵에 pass 로 기록`, meta: { index: state.milestone } });
    }
  }

  const events = readLog(team).filter((e) => e.round === state.round);
  const p = paths(team);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.appendFileSync(p.rounds, JSON.stringify({
    round: state.round,
    milestone: state.milestone,
    topic: state.topic,
    verdict,
    summary,
    attempts: state.attempt,
    eventCount: events.length,
    startedAt: state.startedAt,
    endedAt: new Date().toISOString(),
  }) + '\n');

  // 외부감사도 이 방의 참여자라 자기 세션을 갖는다. 라운드가 끝나면 같이 비운다 —
  // 비워지는 건 AI 컨텍스트뿐이라는 규칙은 다른 회사 모델에도 똑같이 적용된다.
  // (대화록은 그대로 남는다. 위 emit 이 이미 구분선을 그었다.)
  const outStore = path.join(ROOT, 'state', 'outside-sessions.json');
  try {
    const all = JSON.parse(fs.readFileSync(outStore, 'utf8'));
    if (team in all) {
      delete all[team];
      fs.writeFileSync(outStore, JSON.stringify(all, null, 2) + '\n');
    }
  } catch { /* 파일이 없으면 열린 세션도 없다 */ }

  writeState(team, { phase: 'idle', endedAt: new Date().toISOString() });
  return state.round;
}

/**
 * 감사 판정.
 * REVISE 는 반박 횟수를 올리고, 상한에 닿으면 FAIL 로 승격해 사람을 부른다.
 *
 * FAIL 은 멈춘다 — 인격 문장이 아니라 여기서. 방은 phase 'blocked' 가 되고, 그 뒤로는 판정을 낼 수 없다.
 * 대표가 이 방에 말을 하면 풀린다 (resumeRound). 개발팀 대화록 09-02: FAIL 두 번 뒤에도 작업이 이어졌고
 * 뒤이은 PASS 가 경고를 지웠다 — 규칙이 산문에만 있었다 (Fable 재점검, 2026-09-12).
 */
export function recordVerdict(team, { actor, verdict, text, target = 'guide', round = null }) {
  const v = String(verdict || '').toUpperCase();
  if (!VERDICTS.has(v)) throw new Error(`판정은 ${[...VERDICTS].join(' / ')} 중 하나여야 합니다.`);

  const state = readState(team);

  // 판정을 시작할 때의 라운드를 알고 왔는데 그 사이 라운드가 바뀌었다 — 외부감사가 5분 생각하는 동안
  // 라운드가 닫히고 다음이 열린 경우. 새 라운드의 반박 횟수를 올리면 안 되고, 새 라운드에 찍혀도 안 된다.
  // 자기 라운드 번호로 남기되 판정으로 세지 않는다. 지금 방이 막혀 있어도 마찬가지다 — 이건 옛 라운드의 말이다
  // (레오 감사, 2026-09-12: blocked 검사가 앞에 있어 예외가 났다).
  // 닫힌 방(idle)에 온 판정도 같다 — R12 는 닫힌 뒤에 카드 둘이 찍혔고 번호가 같아 판정으로 보였다 (2026-09-12).
  // 총괄실은 라운드가 없어 phase 가 늘 idle 이다 — 거기서는 이 검사를 하지 않는다.
  if ((round != null && round !== state.round) || (state.phase === 'idle' && !isOffice(team))) {
    return emit(team, {
      round: round ?? state.round, type: 'verdict', actor, text,
      meta: { verdict: v, target, attempt: 0, max: MAX_ATTEMPTS, stale: true },
    });
  }
  if (state.phase === 'blocked') {
    throw new Error(`대표 판단 대기 중입니다 (라운드 ${state.round}, FAIL). 대표가 이 방에 말하면 풀립니다. 그 전엔 판정을 낼 수 없습니다.`);
  }

  let attempt = state.attempt || 0;
  let final = v;

  // 반박 카운터는 마일스톤의 것이다. 총괄실은 라운드가 없어 리셋될 길이 없는데
  // 제리의 대조 REVISE 가 여기 쌓여 총괄실이 대표 호출로 잠길 뻔했다 (Fable 감사, 2026-09-02).
  // 총괄실의 REVISE 는 그냥 REVISE 다 — 세지 않는다.
  if (!isOffice(team)) {
    if (v === 'REVISE') {
      attempt = Math.min(attempt + 1, MAX_ATTEMPTS);
      if (attempt >= MAX_ATTEMPTS) final = 'FAIL';
    }
    // 감사 PASS 는 이 마일스톤의 반박 횟수를 0 으로 돌린다 — 0 복귀는 이것과 대표의 재개뿐이다.
    if (v === 'PASS') attempt = 0;
    const attempts = { ...(state.attempts ?? {}), [state.milestone]: attempt };
    // 총괄실은 라운드가 없다 — 막을 것도 없다. FAIL 은 그냥 한 마디다.
    writeState(team, final === 'FAIL' ? { attempt, attempts, phase: 'blocked' } : { attempt, attempts });
  }

  const rec = emit(team, {
    type: 'verdict', actor, text,
    meta: { verdict: final, target, attempt, max: MAX_ATTEMPTS },
  });

  if (final === 'FAIL' && !isOffice(team)) {
    emit(team, {
      type: 'note', actor: 'system',
      text: v === 'REVISE'
        ? `반박 ${MAX_ATTEMPTS}회를 채웠습니다. 대표 판단이 필요합니다 — 이 방은 대표가 말할 때까지 멈춥니다.`
        : 'FAIL — 대표 판단이 필요합니다. 이 방은 대표가 말할 때까지 멈춥니다.',
      meta: { blocked: true },
    });
  }
  return rec;
}

/**
 * 대표가 말했다 — 막힌 방을 푼다. 반박 횟수는 0 으로, 라운드는 그대로 이어진다.
 * 대표의 다음 말이 곧 판단이다. 화면의 입력창이 대표의 것이므로 서버가 /api/say 에서 부른다.
 */
export function resumeRound(team, { text = null } = {}) {
  const state = readState(team);
  if (state.phase !== 'blocked') return null;
  writeState(team, { phase: 'running', attempt: 0, attempts: { ...(state.attempts ?? {}), [state.milestone]: 0 } });
  emit(team, {
    type: 'note', actor: 'system',
    text: `대표 판단으로 재개합니다. 반박 횟수를 0 으로 되돌립니다.${text ? ' — ' + String(text).replace(/\s+/g, ' ').slice(0, 80) : ''}`,
    meta: { resumed: true },
  });
  return readState(team);
}

/** 팀 하나의 요약 — 왼쪽 레일의 계기판이 읽는 값. */
export function teamSummary(team) {
  const state = readState(team);
  const log = readLog(team);
  const roadmap = readRoadmap(team);

  // 마지막 발언 — 관제탑 카드의 본문. 도구 줄과 note 는 발언이 아니다: 마지막 줄을 그냥 집으면 카드가
  // "/Users/…/world.mjs" 를 보여 줬다 (독립검수 #10, 2026-09-13). 발언 뒤에 온 도구 줄은 따로 — "app.js 고치는 중".
  let last = null, lastTool = null;
  for (let i = log.length - 1; i >= 0 && !last; i--) {
    const e = log[i];
    if (e.type === 'message' || e.type === 'verdict') last = e;
    else if (e.type === 'tool' && !lastTool) lastTool = e;
  }
  const done = roadmap.milestones?.filter((m) => m.status === 'pass').length ?? 0;

  // 마지막 판정이 무엇이었는지 — FAIL 이면 레일에 경고가 뜬다. 같은 훑기로 이 라운드의 마지막 발언 시각과
  // "대표를 불렀는데 아직 답이 없는" 발언도 찾는다.
  let lastVerdict = null, lastSpokeAt = null, bossCall = null, bossAnswered = false;
  const cast = readCast(team).agents ?? {};
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'round_start') break;
    if (e.type === 'verdict' && lastVerdict == null) lastVerdict = e.meta?.verdict ?? null;
    if ((e.type === 'message' || e.type === 'verdict') && !lastSpokeAt) lastSpokeAt = e.ts;
    if (e.type === 'message' && e.actor === 'boss') bossAnswered = true;
    if (!bossCall && !bossAnswered && e.type === 'message' && e.actor !== 'boss' && e.actor !== 'system' && callsBoss(e.text, cast)) {
      bossCall = { id: e.id, ts: e.ts, by: e.actor };
    }
  }
  const running = state.phase === 'running';
  const silentDay = running && lastSpokeAt != null && Date.now() - new Date(lastSpokeAt).getTime() > 24 * 3600_000;

  // 대표 차례인 이유. 마지막 판정이 아니라 상태다 (전에는 FAIL 뒤에 PASS 가 오면 경고가 꺼졌다).
  // blocked · 반박 상한 · 하루 넘게 말이 없는 열린 라운드 (대표 결정, 2026-09-13 G-UX).
  const needsBossWhy = state.phase === 'blocked' ? 'blocked'
    : (running && state.attempt >= MAX_ATTEMPTS) ? 'attempts'
      : silentDay ? 'silent' : null;

  return {
    ...state,
    lastVerdict,
    lastAt: last?.ts ?? null,
    lastText: last?.text ?? null,
    lastActor: last?.actor ?? null,
    // 마지막 발언 뒤의 도구 줄 — 누가 무엇을 만지는 중인가. 없으면 null.
    lastTool: lastTool ? { actor: lastTool.actor, tool: lastTool.meta?.tool ?? null, text: lastTool.text, ts: lastTool.ts } : null,
    lastSpokeAt,
    logCount: log.length,
    milestonesDone: done,
    milestonesTotal: roadmap.milestones?.length ?? 0,
    needsBoss: needsBossWhy != null,
    needsBossWhy,
    // 이 라운드에서 누가 대표를 불렀는데 그 뒤 대표가 말하지 않았다 — 화면의 호명 배지.
    bossCall,
  };
}
