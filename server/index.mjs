#!/usr/bin/env node
// 작전실 서버.
//
// 모든 팀의 log.jsonl 을 동시에 tail 해서, 새 줄이 생기면 WebSocket 으로 밀어준다.
// 대화록은 지워지지 않으므로 화면 초기화 신호 같은 건 없다 —
// 라운드 경계는 round_start / round_end 이벤트가 구분선으로 표시한다.
//
//   npm start   →   http://localhost:4321

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  paths, listTeams, defaultTeam, teamExists, teamSummary,
  readCast, readRoadmap, readTail, listRounds, parseJSONL, emit,
  readState, startRound, assertEndable, resumeRound, readLog, isOffice, quiet, addressee,
  listApprovals, decideApproval, APPROVAL_GRADES, approvalPreview, approvalArtifacts, outFile,
} from '../bus/bus.mjs';
import * as bus from '../bus/bus.mjs';
import { listRequests, requestCounts } from '../bus/requests.mjs';
import * as session from './session.mjs';
import { runExecutor } from './executor.mjs';
import { runNotifier, notified } from './notifier.mjs';
import { runNightly, yesterdayKey } from './nightly.mjs';
import { noticeEvents, startVerdict, snapshot, setClock, wake, restoreQueues, expireFlows, autoVerdicts } from './conductor.mjs';
import * as world from './world.mjs';
import { startInfra } from './infra.mjs';
import * as gemini from './gemini.mjs';
import { bossOk, NOT_YET } from './public/bosswords.js';

const PORT = Number(process.env.PORT || 4321);
// 밑바닥 넷(서버·codex·세션·디스크) — 2분마다 재서 값만 넘긴다(결정 92 "막힌 것" 의 infra, M6 준비). 첫 재기 전엔 null — 안 잰 것은 막힘이 아니다.
let infra = { latest: () => null };

// 기본은 이 PC 안에서만. 입력창에 쓴 지시가 실무에게 그대로 가기 때문에,
// 열어두면 같은 네트워크의 누구나 이 PC 에서 파일을 읽고 명령을 실행할 수 있다.
// 폰에서 보려면 VPN(Tailscale) 안에서 HOST=0.0.0.0 을 명시한다.
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const POLL_MS = 250;
const PAGE = 150;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  // 산출물의 글은 브라우저가 그 자리에서 보여 주게 — text/markdown 은 내려받기가 된다.
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  // 마을 3D 부품(Kenney glTF, M5). octet-stream 이어도 GLTFLoader 는 읽지만 종류를 맞춰 둔다.
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};

const json = (res, code, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'content-type': MIME['.json'], 'content-length': buf.length });
  res.end(buf);
};

/**
 * 파일 하나를 그대로 낸다. 없거나 폴더면 404. 모르는 확장자는 내려받기.
 * 화면 파일은 늘 다시 확인하게(no-cache + Last-Modified) — 고친 CSS 가 대표 화면에 안 보여 "아직 그대로" 가 됐다(R25 대시보드 86줄).
 * 안 바뀐 파일은 304 로 짧게 — 마을 glb 몇 MB 를 열 때마다 다시 보내지 않게. req 를 주면 If-Modified-Since 를 본다.
 */
function sendFile(res, file, extra = {}, req = null) {
  fs.stat(file, (serr, st) => {
    if (serr || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    const mtime = new Date(Math.floor(st.mtimeMs / 1000) * 1000);   // HTTP 날짜는 초 단위 — 그대로 비교하면 늘 "바뀜"
    const since = req?.headers['if-modified-since'] ? Date.parse(req.headers['if-modified-since']) : NaN;
    const head = { 'cache-control': 'no-cache', 'last-modified': mtime.toUTCString(), ...extra };
    if (Number.isFinite(since) && since >= mtime.getTime()) { res.writeHead(304, head); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': data.length, ...head });
      res.end(data);
    });
  });
}

/**
 * 팀 방의 cast 에 총괄실의 chief 를 합친다.
 *
 * 배달(bus/dispatch.mjs)이 팀 방에 chief 이벤트를 남기는데 팀 cast.json 에는 그 자리가 없어
 * 화면에 "chief / 알 수 없음" 으로 떴다. cast.json 을 다섯 번 복제하는 대신 여기서 합친다.
 */
function castOf(team) {
  const cast = readCast(team);
  if (isOffice(team) || cast.agents?.chief) return cast;
  const chief = readCast('hq').agents?.chief;
  // 옮겨온 말(meta.from)의 화자로만 빌린다. `from` 을 달아 두면 화면이 이 방 사람 명단(헤더·칩)에서 뺀다 —
  // 개발실 헤더에 "톰 자는 중" 이 떴다 (레오 R15 감사).
  return chief ? { ...cast, agents: { ...cast.agents, chief: { ...chief, from: 'hq' } } } : cast;
}

/**
 * 팀별 요약. 왼쪽 레일과 관제탑이 같은 값을 읽는다.
 *
 * 관제탑은 안 보고 있는 팀까지 한 화면에 놓으므로, 그 팀의 캐스트 이름과
 * 지금 마일스톤 제목까지 함께 실어야 카드가 말이 된다.
 */
const summaryOf = (team) => {
  const s = teamSummary(team);
  const roadmap = readRoadmap(team);
  const now = roadmap.milestones?.find((m) => m.n === s.milestone) ?? null;
  const sessions = session.statusAll(team);
  const conductor = snapshot(team);
  return {
    ...s,
    session: session.status(team),
    sessions,                            // 자리별 — 참여 카드의 상태 점
    conductor,                           // 누구 차례가 쌓여 있나, 판정 흐름은 어디까지 왔나
    milestoneTitle: now?.title ?? null,
    deliverable: now?.deliverable ?? null,
    progress: readProgress(team),
    cast: castOf(team).agents ?? {},
    approvals: {
      pending: listApprovals({ team, status: 'pending' }).length,
      passedToday: listApprovals({ team, status: 'passed' })
        .filter((r) => (r.decidedAt ?? '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    },
    people: peopleOf(team, sessions, conductor, s.phase),
    requests: requestCounts(team),      // 요청 블록(6-1절) — 이 팀이 요청했거나 받은 것 중 열린·닫힌 수
    // 오늘 대표에게 한 말 — "전체" 탭의 오늘 보고 줄 (결정 50·52). 판별은 bus.bossNotesOf.
    bossNotes: bus.bossNotesOf(readLog(team), readCast(team).agents ?? {}),
  };
};

/**
 * 사람별 집계 (결정 40 · M2) — 대화록에서 나오는 것(bus.peopleOf)에 세션 상태와 일지 첫 문장을 얹는다.
 * claude 자리는 세션의 alive·busy·lastSignal, codex 자리는 사회자의 outsideBusy 와 마지막 발언 시각(스트림이 없다, alive 는 null).
 * 일 상태 `state` 는 그 위에서 bus.workStateOf 가 정한다 (결정 58 ① — 마을 시계가 아니라 일 상태).
 * 대표의 오늘 판정 수는 이 방 승인 요청에 대표가 내린 결정 수. 계약은 docs/event-schema.md 3절 "사람별 집계".
 */
function peopleOf(team, sessions, conductor, phase) {
  const cast = readCast(team).agents ?? {};
  const people = bus.peopleOf(readLog(team), cast, { progress: bus.readProgress(team) });   // 상황판 boss 칸이 비면 bossCall 없음(나리 결정 ③)
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  for (const [id, p] of Object.entries(people)) {
    if (id === 'boss') {
      p.todayDecisions = listApprovals({ team }).flatMap((r) => r.decisions ?? [])
        .filter((d) => d.by === 'boss' && new Date(d.ts ?? 0).getTime() >= dayStart.getTime()).length;
      continue;
    }
    if (bus.isForeign(cast[id]?.model)) {   // codex·gemini — 결정 77 의 그 자리. 'gpt' 직접 비교 금지
      // 사회자가 띄운 호출(outsideBusy) 이든 CLI --ask 든, outside.mjs 가 도는 동안은 일하는 중 — 표시 파일(bus.outsideRunning). 도는 중이면 신호는 시작 시각.
      const running = bus.outsideRunning(team, id);
      p.busy = !!conductor.outsideBusy || !!running; p.alive = null; p.lastSignal = running?.since ?? p.lastSaidAt;
    }
    else { p.busy = !!sessions[id]?.busy; p.alive = !!sessions[id]?.alive; p.lastSignal = sessions[id]?.lastSignal ?? null; }
    p.state = bus.workStateOf(p, phase);
    p.journalFirst = session.journalFirstSentence(team, id);
  }
  return people;
}
const summaries = () => Object.fromEntries(listTeams().map((t) => [t.id, summaryOf(t.id)]));

/** 대기 중인 승인 카드 — 행동(action)을 지금 상태로 푼 preview 와 산출물 목록(결정 36)을 붙여서 (결정 20-2). 대기 건수가 바뀔 때만 받아 가므로 git·파일을 읽어도 된다. */
// proxyable: 톰·제리가 대리할 수 있는 C 인가(bus.proxyEligible — 돈·바깥이면 false). 종 배지가 위임 중 대표 손이 필요한 것만 세는 데 쓴다(나리 결정 ②).
const pendingCards = () => listApprovals({ status: 'pending' }).map((r) => ({ ...r, preview: approvalPreview(r), artifacts: approvalArtifacts(r), proxyable: bus.proxyEligible(r) }));

/**
 * teams/<팀>/progress.json — 지금 어디까지 왔나 (결정 23). 로드맵이 목적지라면 이건 현재 위치다. 실무가 bus/progress.mjs 로 턴 끝·닫기마다 쓴다.
 * 계약 모양(doing·blocked·boss·next·done)으로 읽는다 — 옛 issues·left 는 bus.normalizeProgress 가 blocked·next 로. 없으면 null.
 * fresh: 이 라운드 시작 뒤 갱신됐나 — 상황판이 "낡음" 을 표시한다.
 */
function readProgress(team) {
  const p = bus.readProgress(team);
  return p ? { ...p, fresh: bus.progressFresh(team) } : null;
}

/**
 * 한 것(doneOf) 한 줄의 사람 이름. 승인 판정·대리 결정은 총괄실 사람이 한 것 — 개발 카드의 B 판정 'outside' 를 개발 캐스트로 풀면 제리가 "레오" 로 서서
 * 현황 ② 사람 줄에 레오가 둘(개발 판정·총괄 인용) 섰다(나리 실측 r27-tower-412, 09-15 23:57). 화면의 열쇠(app.js home)와 같은 선: decision·proxy 는 hq, 나머지는 그 방 → hq 순.
 */
function doneName(team, it) {
  if (!it.by) return null;
  const home = (it.kind === 'decision' || it.kind === 'proxy') ? 'hq' : team;
  return readCast(home).agents?.[it.by]?.name ?? readCast('hq').agents?.[it.by]?.name ?? readCast(team).agents?.[it.by]?.name ?? it.by;
}

/** teams/<팀>/journal/<자리>.md 의 맨 위 문단. 상황판의 "어제" 다. */
function latestJournal(team) {
  const dir = path.join(paths(team).dir, 'journal');
  let names;
  try { names = fs.readdirSync(dir); } catch { return {}; }
  const out = {};
  for (const n of names) {
    if (!n.endsWith('.md')) continue;
    try {
      const s = fs.readFileSync(path.join(dir, n), 'utf8');
      const first = s.split(/\n(?=## )/)[0].trim();
      if (first) out[n.slice(0, -3)] = first.slice(0, 600);
    } catch { /* 넘어간다 */ }
  }
  return out;
}

/** teams/<팀>/out/ 의 산출물. 라운드의 통과 조건은 완료율이 아니라 제출 가능한 물건이다. */
/**
 * teams/<팀>/out/ 의 파일 — 하위 폴더까지(깊이 3). 전에는 바로 밑만 읽어 `out/shots/`·`out/screens/` 의 그림이 안 세졌다 —
 * 분석 탭 "산출물" 수가 적게 나오고, 아침 보고서(결정 80 ⑤ "어제 나온 그림")가 읽을 것이 없었다(M6 준비 실측). `name` 은 out/ 기준 상대 경로.
 */
const OUT_DEPTH = 3;
function listOut(team) {
  const root = paths(team).out;
  const out = [];
  const walk = (dir, rel, depth) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const file = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
      try {
        const st = fs.statSync(file);
        if (st.isDirectory()) { if (depth < OUT_DEPTH) walk(file, r, depth + 1); continue; }
        if (!st.isFile()) continue;
        out.push({ name: r, size: st.size, at: st.mtime.toISOString() });
      } catch { /* 읽는 사이에 사라졌다면 넘어간다 */ }
    }
  };
  walk(root, '', 1);
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** POST 본문을 JSON 으로 읽는다. 64KB 를 넘으면 끊는다. */
function readBody(req, res, done, max = 64_000) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > max) req.destroy(); });
  req.on('end', () => {
    try { done(JSON.parse(body || '{}')); }
    catch { json(res, 400, { error: '본문을 읽지 못했습니다.' }); }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const team = q.get('team');

  if (url.pathname === '/api/boot') {
    return json(res, 200, {
      teams: listTeams(),
      defaultTeam: defaultTeam(),
      summaries: summaries(),
      approvals: pendingCards(),
      told: notified(),
      grades: APPROVAL_GRADES,
      infra: infra.latest(),   // 밑바닥 넷 — blockedOf 의 infra 입력. 바뀌면 ws `infra` 로 온다
      pauses: bus.readPauses(),   // 멈춘 구간(state/pauses.json) — 화면이 기다린 시간에서 뺀다(blockedOf). 자주 안 바뀌어 boot 로만
      delegation: bus.readDelegation(),   // 위임(결정 136) { to, until, decision } 또는 null — 종 배지가 위임 중 돈·바깥만 센다(나리 결정 ②). until 은 화면이 본다

      // 개인 카드의 엔진·모델·강도 고르기 (결정 69) — 목록은 bus.mjs 하나.
      castOptions: { engines: bus.ENGINES, claude: bus.CLAUDE_MODELS, codex: bus.CODEX_MODELS, gemini: bus.GEMINI_MODELS, efforts: bus.EFFORTS },
    });
  }

  // 자리의 엔진·모델·추론 강도 (결정 69) — 대표가 관제탑 개인 카드에서 고른다. 이 서버는 이 PC 안에서만 열려 있어 화면 = 대표다.
  // cast.json 은 C 잠금 파일이라 서버가 대신 쓴다. 다음 턴부터 — claude 자리는 턴이 끝난 뒤 세션을 내리고(id 는 남김), codex 는 매 턴 읽는다.
  if (url.pathname === '/api/cast' && req.method === 'POST') {
    readBody(req, res, ({ team: t, actor, model, llm, codexModel, geminiModel, effort, fallback, suspended }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      let r;
      try { r = bus.updateCastAgent(t, actor, { model, llm, codexModel, geminiModel, effort, fallback, suspended }); }
      catch (e) { return json(res, 400, { error: e.message }); }
      let restart = null;
      if (Object.keys(r.to).length) {
        emit(t, { actor: 'system', type: 'note', text: bus.castChangeText(r.agent.name ?? actor, r.to), meta: { castChange: { actor, from: r.from, to: r.to } } });
        // 엔진이 claude 인 자리만 세션이 있다. codex·gemini 로 바뀐 자리의 claude 세션은 그냥 내린다 — 다음 차례는 outside.mjs 가 받는다.
        restart = r.agent.model === 'claude' || bus.isForeign(r.to.model) ? session.restartAfterTurn(t, actor) : null;
      }
      return json(res, 200, { agent: r.agent, from: r.from, to: r.to, restart });
    });
    return;
  }

  // 승인 큐. 대표는 화면에서 C 등급을 판정한다. B 는 톰·제리가 CLI 로 한다.
  if (url.pathname === '/api/approvals' && req.method === 'GET') {
    return json(res, 200, { pending: pendingCards(), all: listApprovals(), told: notified() });
  }
  if (url.pathname === '/api/approvals' && req.method === 'POST') {
    readBody(req, res, ({ id, decision, reason }) => {
      try {
        // 화면에서 오는 판정은 대표의 것이다. 이 서버는 이 PC 안에서만 열려 있다.
        return json(res, 200, decideApproval(id, { by: 'boss', decision, reason }));
      } catch (e) { return json(res, 400, { error: e.message }); }
    });
    return;
  }

  // 요청 블록 (6-1절) — 접은 목록, 최근 순. 대표는 여기서 안 누른다 — 자리가 없다(결정 46). 스레드 줄은 CLI(bus/request.mjs)로만.
  if (url.pathname === '/api/requests' && req.method === 'GET') {
    if (team && !teamExists(team)) return json(res, 404, { error: 'no such team' });
    return json(res, 200, { requests: listRequests({ team: team || null }) });
  }

  if (url.pathname === '/api/team') {
    if (!teamExists(team)) return json(res, 404, { error: 'no such team' });
    return json(res, 200, {
      team,
      cast: castOf(team),
      roadmap: readRoadmap(team),
      rounds: listRounds(team).slice(0, 40),
      // 부팅·방송과 같은 요약이어야 한다. state+log 만 든 얇은 것을 주면 방에 들어간 직후 세션·차례가 비어
      // 일하는 사람이 "자는 중" 으로 보였다 (독립검수 #1, 2026-09-13).
      summary: summaryOf(team),
      journal: latestJournal(team),
      ...readTail(team, { limit: PAGE }),
    });
  }

  if (url.pathname === '/api/log') {
    if (!teamExists(team)) return json(res, 404, { error: 'no such team' });
    // 라운드 하나를 통째로. 마을 탭이 재생할 때 쓴다 — 페이지네이션이 아니라 한 판이 단위다.
    if (q.get('round') != null) {
      // 양의 정수만. 'abc' 나 빈 값이 NaN·0 으로 조용히 빈 배열이 되면 재생이 "기록 없음" 으로 보인다 (레오 W1 감사)
      if (!/^[1-9]\d*$/.test(q.get('round'))) return json(res, 400, { error: 'round 는 1 이상의 정수입니다.' });
      const n = Number(q.get('round'));
      // readLog 는 파일 크기·수정시각 캐시(readJSONLCached)라 매 요청 파싱이 아니라 필터만 돈다
      const events = readLog(team).filter((e) => e.round === n);
      return json(res, 200, { events, more: false, total: events.length });
    }
    return json(res, 200, readTail(team, {
      limit: Number(q.get('limit')) || PAGE,
      before: q.get('before') || null,
    }));
  }

  // 예정 작업 표(결정 128) — teams/hq/out/plan-table.md 를 그대로 읽어 대시보드 맨 위에 띄운다. 읽기만, 톰이 파일로 관리한다.
  // 대시보드 = "앞으로 언제 뭐가 되나"(나리 정본 · 헨리 시안 1판 dashboard.svg · 결정 128). text·at 은 1판(plan-table.md) 그대로, 그 위에 앞날 띠 —
  // 팀마다 bus.plansOf(로드맵 × 회차 평균 길이, 순수) + 대표가 정해야 열리는 것(C 승인 · 상황판 boss[] · gated 단계). 계약 3절 "화면 넷 + 카드".
  if (url.pathname === '/api/dashboard') {
    const file = path.join(paths('hq').out, 'plan-table.md');
    let text = null, at = null;
    try { text = fs.readFileSync(file, 'utf8'); at = fs.statSync(file).mtime.toISOString(); } catch { /* 1판 표가 아직 없다 */ }
    const now = Date.now();
    // 도면 순서 — 총괄실 먼저(헨리 시안 2판-b 25·71행 · 결정 50 팀 다섯 · 나리 위임 5번 "총괄실 계획표는 톰이 쓴다"). 1판은 비서실이었다 — 비서실은 대표↔세라 채팅방이라 계획표가 있을 자리가 아니다(하영 T1).
    const order = ['hq', 'marketing', 'dev', 'design', 'finance'];
    const rows = listTeams().filter((t) => t.id !== 'sera').sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
    // bossGates 는 대표 문(gateBoss)인 단계뿐 — 다른 팀·다른 일 뒤(테라 붙인 뒤)는 점선이지만 대표님이 여실 단계가 아니다(T4). C 승인·상황판 boss[] 는 관제탑 ③ 내 차례의 목록이라 여기 또 두면 '같은 것을 두 군데' 다(톰 req_2749e30e).
    const bossGates = [];
    const teamsOut = rows.map((t) => {
      const plan = bus.plansOf({ roadmap: readRoadmap(t.id), state: isOffice(t.id) ? { phase: 'idle' } : readState(t.id), rounds: isOffice(t.id) ? [] : listRounds(t.id), progress: bus.readProgress(t.id), now, pauses: bus.readPauses() });
      for (const s of plan.stages) if (s.status === 'gated' && s.gateBoss) bossGates.push({ kind: 'stage', team: t.id, what: `${s.n != null ? s.n + '단계 ' : ''}${s.title} — ${s.gate}`, id: s.n });
      const cast = readCast(t.id), owner = bus.roomRules(t.id).owner;
      const color = cast.agents?.[owner]?.color ?? null;
      // hasRoadmap: 계획표 파일이 있나 — 없으면 "계획표 아직 없어요", 있는데 남은 단계가 없으면 "다음 단계 아직 없어요"(하영 1-2 빈칸 말 둘). owners: 담당 점 둘(1-3)
      return { id: t.id, name: t.name, room: t.room, color, hasRoadmap: fs.existsSync(paths(t.id).roadmap), owners: bus.ownersOf(cast, { owner }), ...plan };
    });
    // '팀별 단계' 절은 서버가 roadmap 에서 만들어 끼운다(톰 09-14: "손으로 세는 건 썩는다") — 톰이 쓰는 건 위·아래 두 표뿐. 정본은 표 파일 + roadmap 둘이 한 화면에.
    const merged = bus.swapSection(text ?? '', '팀별 단계', bus.stageTable(teamsOut, { now }));
    return json(res, 200, { text: merged, at, now: new Date(now).toISOString(), teams: teamsOut, bossGates });
  }

  // 누가 뭘 했나 — 한 목록(결정 92, 계약 3절 "한 것 — 한 목록"): 다섯 방 doneOf 를 창으로 잘라 합친다. 관제탑 ②(헨리 시안 2판)·보고서 ①이 같은 문을 쓴다.
  // since·until 은 ISO 또는 ms, 기본은 우리 시각 오늘 0시~지금(dayStartSeoul). 비서실은 대화록이 보고뿐이라 뺀다.
  if (url.pathname === '/api/done') {
    const now = Date.now();
    const since = url.searchParams.get('since'), until = url.searchParams.get('until');
    const win = { since: since ? (Number.isFinite(Number(since)) ? Number(since) : since) : null, until: until ? (Number.isFinite(Number(until)) ? Number(until) : until) : null, now };
    const items = listTeams().filter((t) => !bus.roomRules(t.id).speakers)
      .flatMap((t) => bus.doneOf(readLog(t.id), readCast(t.id).agents ?? {}, { team: t.id, approvals: listApprovals({ team: t.id }), ...win })
        .map((it) => ({ ...it, teamName: t.name, name: doneName(t.id, it) })))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return json(res, 200, { since: new Date(win.since != null ? new Date(win.since).getTime() : bus.dayStartSeoul(now)).toISOString(), until: new Date(win.until != null ? new Date(win.until).getTime() : now).toISOString(), items });
  }

  // 보고서 = "어제 하루가 어땠나"(나리 정본 · 결정 80) 의 아래층 — 기계가 모으는 것만: 창 안의 doneOf 팀별 · 각 방 '다음' · 창 안 mtime 의 out/ 그림 · 대리 결정 · 사람 글(teams/hq/out/daily/<날짜>.md, 있으면).
  // 틀(다섯 절·글)은 경영팀 몫이라 여기서 안 짠다. 창은 since·until(ISO/ms), 기본 "어젯밤" = 어제 18시 ~ 오늘 9시(우리 시각). 계약 3절 "화면 넷 + 카드".
  if (url.pathname === '/api/report') {
    const now = Date.now();
    const day0 = bus.dayStartSeoul(now);
    const num = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : Date.parse(v));
    const since = num(url.searchParams.get('since')) ?? day0 - 6 * 3600_000, until = num(url.searchParams.get('until')) ?? Math.min(now, day0 + 9 * 3600_000);
    const rooms = listTeams().filter((t) => !bus.roomRules(t.id).speakers);
    const doneBy = rooms.map((t) => ({ team: t.id, name: t.name, items: bus.doneOf(readLog(t.id), readCast(t.id).agents ?? {}, { team: t.id, approvals: listApprovals({ team: t.id }), since, until, now })
      .map((it) => ({ ...it, name: doneName(t.id, it) })) }));
    const next = Object.fromEntries(rooms.map((t) => [t.id, bus.readProgress(t.id)?.next ?? []]));
    const images = rooms.flatMap((t) => listOut(t.id).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name) && Date.parse(f.at) >= since && Date.parse(f.at) < until).map((f) => ({ team: t.id, name: f.name, at: f.at, url: `/out/${t.id}/${f.name.split('/').map(encodeURIComponent).join('/')}` })));
    const proxy = rooms.flatMap((t) => readLog(t.id).filter((e) => e.type === 'note' && e.meta?.proxy && Date.parse(e.ts) >= since && Date.parse(e.ts) < until).map((e) => ({ team: t.id, id: e.id, ts: e.ts, text: e.text, approval: e.meta.approval ?? null })));
    const dayKey = new Date(until - 1 + 9 * 3600_000).toISOString().slice(0, 10);   // 창의 끝 날(우리 시각) — 아침 보고서 파일 이름
    let chief = null; try { chief = fs.readFileSync(path.join(paths('hq').out, 'daily', `${dayKey}.md`), 'utf8'); } catch { /* 그날 글이 없다 */ }
    // 자정 마감 한 장(M7) — 창의 끝 날 바로 전날(마지막으로 닫힌 하루) 의 대표용 장. 없으면 null — 지어내지 않는다.
    const nightDay = yesterdayKey(until - 1);
    let nightly = null; try { nightly = { day: nightDay, file: `hq/out/nightly/${nightDay}.md`, md: fs.readFileSync(path.join(paths('hq').out, 'nightly', `${nightDay}.md`), 'utf8') }; } catch { /* 아직 자정이 안 왔거나 서버가 없었다 */ }
    // 보고서 탭(헨리 report 1판, 새 7단계) — 띠의 빨간 구간(FAIL·답 없는 물음, bus.blockedSpansOf 순수) · 팀 줄(단계 N/M · 회차 · 지금 단계 · 방·색). 총괄실도 줄 하나(단계 없음).
    const pausesNow = bus.readPauses();
    const blocked = rooms.filter((t) => !isOffice(t.id)).flatMap((t) => bus.blockedSpansOf(readLog(t.id), readCast(t.id).agents ?? {}, { team: t.id, since, until, now, pauses: pausesNow }).map((sp) => ({ ...sp, teamName: t.name, name: sp.by ? (readCast(t.id).agents?.[sp.by]?.name ?? sp.by) : null })));
    const teamRows = listTeams().filter((t) => !bus.roomRules(t.id).speakers).map((t) => {
      const s = teamSummary(t.id), rm = readRoadmap(t.id);
      const nowM = rm.milestones?.find((m) => m.n === s.milestone) ?? null;
      return { id: t.id, name: t.name, room: t.room, color: readCast(t.id).agents?.[t.kind === 'office' ? 'chief' : 'guide']?.color ?? null, office: t.kind === 'office',
        milestone: s.milestone ?? null, milestoneTitle: nowM?.title ?? null, round: s.round ?? null, done: s.milestonesDone ?? 0, total: s.milestonesTotal ?? 0, phase: s.phase ?? 'idle',
        guide: readCast(t.id).agents?.[t.kind === 'office' ? 'chief' : 'guide']?.name ?? null };
    });
    return json(res, 200, { since: new Date(since).toISOString(), until: new Date(until).toISOString(), done: doneBy, next, images, proxy, chief, chiefFile: chief ? `hq/out/daily/${dayKey}.md` : null, nightly, blocked, teams: teamRows });
  }

  // 카드 재료 (작업 C5) — 팀 하나의 상황판 넷(doing·done·blocked·boss) + 결재 큐(대기 중) + 회차(round·milestone·phase) + 로드맵의 지금 마일스톤 제목.
  // 이 문장들은 그대로 화면에 나갈 수 있어 대표 화면 사람 말 검사(결정 140)를 거친다 — app.js bossLine·bossTitle 과 같은 규칙, 다만 여기는 API 라 펼침 없이 안 맞는 줄은 NOT_YET 으로 바꿔 낸다.
  // 시각은 그대로 ISO 문자열(우리 시각 변환은 화면 몫) — bus.mjs 가 이미 그렇게 저장한다.
  const cardMatch = url.pathname.match(/^\/api\/card\/([^/]+)$/);
  if (cardMatch) {
    const t = decodeURIComponent(cardMatch[1]);
    if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
    const line = (s) => { const v = String(s ?? '').trim(); return v ? (bossOk(v) ? v : NOT_YET) : null; };
    const lines = (arr) => (arr ?? []).map(line).filter(Boolean);

    const p = readProgress(t);   // 이 파일 위쪽 readProgress — bus.readProgress 에 fresh 를 얹은 것(다른 라우트와 같은 것을 쓴다)
    const progress = { doing: lines(p?.doing), done: lines(p?.done), blocked: lines(p?.blocked), boss: lines(p?.boss), at: p?.at ?? null, fresh: p?.fresh ?? null };

    // 결재 큐 — 대기 중인 것만. 제목은 화면의 bossTitle 과 같은 규칙: --boss 한 줄이 자에 맞으면 그것, 아니면 원문.
    const approvals = listApprovals({ team: t, status: 'pending' }).map((r) => {
      const title = bossOk(r.boss) ? r.boss : r.what;
      return { id: r.id, grade: r.grade, title: line(title), at: r.ts };
    });

    const state = readState(t);
    const roadmap = readRoadmap(t);
    const milestone = roadmap.milestones?.find((m) => m.n === state.milestone) ?? null;

    return json(res, 200, {
      team: t,
      progress,
      approvals,
      round: { round: state.round ?? 0, milestone: state.milestone ?? 0, phase: state.phase ?? 'idle' },
      milestoneTitle: milestone?.title ?? null,
    });
  }

  // 팀 하나를 깊게 본다. 대화록을 다시 훑지 않고도 무슨 일이 있었는지 알 수 있어야 한다.
  // 분석 = "왜 자꾸 이렇게 되나"(헨리 분석 1판 analysis.svg · 하영 화면 글 틀 3절, 9단계 ③) — 다섯 팀을 같은 자로. 값은 approvals·rounds·pauses 에서만(bus.stuckOf·slowedOf·repeatsOf 순수).
  if (url.pathname === '/api/analysis' && url.searchParams.get('all') === '1') {
    const ids = listTeams().filter((t) => t.id !== 'sera').map((t) => t.id);
    const roundsByTeam = Object.fromEntries(ids.filter((id) => !isOffice(id)).map((id) => [id, listRounds(id)]));
    const approvals = listApprovals({});
    const pauses = bus.readPauses();
    return json(res, 200, { now: new Date().toISOString(), teams: ids, stuck: bus.stuckOf(approvals, ids), slowed: bus.slowedOf(roundsByTeam, pauses), repeats: bus.repeatsOf(approvals, roundsByTeam) });
  }
  if (url.pathname === '/api/analysis') {
    if (!teamExists(team)) return json(res, 404, { error: '그런 팀이 없습니다.' });

    const rounds = listRounds(team);          // 최신순
    const log = readLog(team);
    const roadmap = readRoadmap(team);

    // 판정 분포. rounds.jsonl 이 이걸 위해 있는 색인이다.
    const verdicts = { PASS: 0, REVISE: 0, FAIL: 0, none: 0 };
    let attemptSum = 0;
    for (const r of rounds) {
      const v = r.verdict && verdicts[r.verdict] !== undefined ? r.verdict : 'none';
      verdicts[v] += 1;
      attemptSum += r.attempts ?? 0;
    }

    // 누가 얼마나 말했나. 도구 로그는 발언이 아니므로 따로 센다.
    const byActor = {};
    let tools = 0;
    for (const e of log) {
      if (e.type === 'tool') { tools += 1; continue; }
      if (e.type !== 'message' && e.type !== 'verdict') continue;
      byActor[e.actor] = (byActor[e.actor] ?? 0) + 1;
    }

    return json(res, 200, {
      team,
      cast: castOf(team),
      roadmap,
      summary: teamSummary(team),
      rounds: rounds.slice(0, 60),
      out: listOut(team),
      stats: {
        roundsDone: rounds.length,
        verdicts,
        attemptAvg: rounds.length ? Math.round((attemptSum / rounds.length) * 10) / 10 : 0,
        byActor,
        tools,
        logCount: log.length,
        firstAt: log[0]?.ts ?? null,
        lastAt: log[log.length - 1]?.ts ?? null,
      },
    });
  }

  // 지시. 대표가 쓴 말이 실무 세션으로 들어간다.
  //
  // 여기서 말풍선을 만들지 않는다 — 프롬프트가 세션에 들어가면 UserPromptSubmit
  // 훅이 대표 말풍선을 남긴다. 여기서 또 남기면 같은 말이 두 번 뜬다.
  if (url.pathname === '/api/say' && req.method === 'POST') {
    readBody(req, res, ({ text, team: t, quiet: q }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      const say = String(text ?? '').trim();
      if (!say) return json(res, 400, { error: '빈 지시입니다.' });

      // 방이 닫혀 있어도 채팅은 된다(결정 127 ② — 대표가 직접 겪은 불편, 오늘 첫째).
      // 전엔 여기서 막았다 — 훅이 idle 이면 안 적어서 막지 않으면 말이 화면에서 그냥 사라졌다.
      // 이제 서버가 훅에 "이번 턴은 적어라" 표시를 켜고 그대로 실무를 깨운다. 총괄실은 라운드가 없다.
      const phase = isOffice(t) ? 'running' : readState(t).phase;
      if (phase === 'idle' && !q) bus.allowIdleChat(t);
      // FAIL 로 막힌 방이다. 입력창은 대표의 것이므로 대표가 말한 것이고, 그 말이 곧 판단이다 — 푼다.
      // 들려주기(quiet)는 다른 세션이 옮기는 말이라 풀지 않는다.
      if (phase === 'blocked' && !q) resumeRound(t, { text: say });

      try {
        // quiet 는 이미 대화록에 있는 말을 세션의 귀에만 넣는 것이다.
        // 대표가 첫머리에 이름을 불렀으면 그 사람에게 간다("안젤, 이거 봐줘") — 방의 모든 자리가 자기 세션을 갖는다.
        // 아니면 방 주인에게. 나머지는 각자 다음 차례에 듣는다 (server/conductor.mjs).
        const cast = readCast(t).agents ?? {};
        const to = q ? null : addressee(say, cast);
        // 대표가 외부감사(codex)를 불렀다. codex 는 세션이 없어 넣을 곳이 없다 — 서버가 대표 말풍선을 직접 남기고
        // 사회자가 그를 깨운다. 주인은 다음 차례에 듣는다 (레오 감사, 2026-09-12: 다니엘은 대표가 불러도 안 깼다).
        if (to && bus.isForeign(cast[to]?.model)) {
          const rec = emit(t, { actor: 'boss', type: 'message', text: say });
          return json(res, 200, { ok: true, to, queued: 0, event: rec.id });
        }
        // 주인이 codex 자리다 (결정 69 ① — 대표가 실무를 codex 로 바꿨다). 세션이 없으니 말풍선을 남기고 사회자가 깨운다.
        // 들려주기(quiet)는 codex 가 다음 차례에 커서로 듣는다 — 넣을 곳이 없어 그냥 받은 것으로.
        const owner = session.ownerOf(t);
        if (!to && bus.isForeign(cast[owner]?.model)) {
          if (q) return json(res, 200, { ok: true, to: owner, queued: 0 });
          const rec = emit(t, { actor: 'boss', type: 'message', text: say });
          wake(t, owner);
          return json(res, 200, { ok: true, to: owner, queued: 0, event: rec.id });
        }
        const actor = to && (cast[to]?.model === 'claude') ? to : undefined;
        const sent = session.send(t, q ? quiet(say) : say, actor);
        if (sent.refused) return json(res, 409, { error: sent.reason, closing: true });
        json(res, 200, { ok: true, to: actor ?? session.ownerOf(t), ...sent });
      } catch (e) {
        json(res, 500, { error: `실무에게 전달하지 못했습니다 — ${e.message}` });
      }
    });
    return;
  }

  // 방에 그림 올리기 (대표 결정 130 ② — "이미지 업로드하고싶은데 안 되네"). base64 로 받아 teams/<팀>/in/ 에 저장하고
  // in/<파일> 을 적은 말로 /api/say 와 같은 규칙(idle 채팅 표시·FAIL 풀기·호명·codex/claude 배달)을 그대로 태운다.
  // /api/say 코드를 공유 함수로 뽑지 않고 나란히 둔 것은 지금 그 경로가 결정 127 로 막 바뀌어서 — 여기서 리팩터로 흔들지 않는다.
  const UPLOAD_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  const UPLOAD_MAX = 8 * 1024 * 1024;   // base64 문자열 기준 — 디코드하면 6MB 안팎. 채팅 그림이지 자료실이 아니다.
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    readBody(req, res, ({ team: t, data, mime, quiet: q }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      const ext = UPLOAD_MIME[String(mime ?? '')];
      if (!ext) return json(res, 400, { error: `그림 형식만 됩니다 (png·jpg·gif·webp) — 받은 것: ${mime}` });
      const b64 = String(data ?? '').replace(/^data:[^,]*,/, '');
      if (!b64) return json(res, 400, { error: '그림이 비어 있습니다.' });
      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch { return json(res, 400, { error: '그림을 읽지 못했습니다.' }); }
      if (!buf.length) return json(res, 400, { error: '그림을 읽지 못했습니다.' });

      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      const dir = paths(t).in;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buf);

      const say = `그림을 올렸습니다: in/${name}`;
      const phase = isOffice(t) ? 'running' : readState(t).phase;
      if (phase === 'idle' && !q) bus.allowIdleChat(t);
      if (phase === 'blocked' && !q) resumeRound(t, { text: say });
      try {
        const cast = readCast(t).agents ?? {};
        const to = q ? null : addressee(say, cast);
        if (to && bus.isForeign(cast[to]?.model)) {
          const rec = emit(t, { actor: 'boss', type: 'message', text: say });
          return json(res, 200, { ok: true, to, name });
        }
        const owner = session.ownerOf(t);
        if (!to && bus.isForeign(cast[owner]?.model)) {
          if (!q) { emit(t, { actor: 'boss', type: 'message', text: say }); wake(t, owner); }
          return json(res, 200, { ok: true, to: owner, name });
        }
        const actor = to && (cast[to]?.model === 'claude') ? to : undefined;
        const sent = session.send(t, q ? quiet(say) : say, actor);
        if (sent.refused) return json(res, 409, { error: sent.reason, closing: true });
        json(res, 200, { ok: true, to: actor ?? session.ownerOf(t), name, ...sent });
      } catch (e) {
        json(res, 500, { error: `실무에게 전달하지 못했습니다 — ${e.message}` });
      }
    }, UPLOAD_MAX);
    return;
  }

  // 올린 그림 보기 — teams/<팀>/in/** 을 읽기 전용으로. out/ 과 같은 경계(bus.inFile), 폴더만 다르다.
  if (url.pathname.startsWith('/in/') && (req.method === 'GET' || req.method === 'HEAD')) {
    let segs;
    try { segs = url.pathname.split('/').slice(2).map(decodeURIComponent); } catch { segs = []; }
    const file = segs.length >= 2 ? bus.inFile(segs[0], segs.slice(1).join('/')) : null;
    if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    return sendFile(res, file, {}, req);
  }

  // 판정. 내부감사 → 외부감사 순서로 판정 차례를 준다. 실무가 /verdict 로, 대표가 화면에서 부른다.
  if (url.pathname === '/api/verdict' && req.method === 'POST') {
    readBody(req, res, ({ team: t, target }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      try { return json(res, 200, { ok: true, flow: startVerdict(t, target) }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    });
    return;
  }

  // 세상의 시계. GET 은 지금 자리, POST { debugHour } 는 시험용 시각 고정(null 이면 실제 시각).
  // 마을에서 캐릭터를 눌렀을 때 — 누구인가(인격 파일의 "너라는 사람"), 어제(일지 맨 위 문단), 최근 발언, 지금 상태.
  if (url.pathname === '/api/actor') {
    if (!teamExists(team)) return json(res, 404, { error: '그런 팀이 없습니다.' });
    const actor = q.get('actor') ?? '';
    const cast = castOf(team).agents ?? {};
    if (!/^[a-z]+$/.test(actor) || !cast[actor] || actor === 'boss' || actor === 'system') return json(res, 404, { error: '그런 자리가 없습니다.' });   // 대표는 사람, system 은 하네스 — 카드가 없다
    const a = cast[actor];
    const persona = session.personaCard(team, actor);
    const journal = session.journalOf(team, actor, 1);
    const recent = readLog(team)
      .filter((e) => e.actor === actor && (e.type === 'message' || e.type === 'verdict') && !/^\(패스\)/.test(String(e.text ?? '').trim()))
      .slice(-8)
      .map((e) => ({ id: e.id, ts: e.ts, type: e.type, round: e.round ?? null, verdict: e.meta?.verdict ?? null, text: String(e.text ?? '').slice(0, 300) }));
    const st = bus.isForeign(a.model) ? { engine: bus.engineName(a.model) } : session.status(team, actor);
    return json(res, 200, {
      team, actor, name: a.name ?? actor, title: a.title ?? null, does: a.does ?? null, color: a.color ?? null, model: a.model ?? null,   // title(직책)·does(하는 일) — req_94013782
      persona, journal: journal ? { first: session.journalFirstSentence(team, actor), latest: journal.text.slice(0, 900), total: journal.total } : null,
      recent, status: st, world: world.snapshot().actors?.[`${team}:${actor}`] ?? null,
    });
  }
  // 상주 gemini(결정 122) — outside.mjs 가 부를 때마다 agy 를 새로 띄우지 않고 서버가 들고 있는 프로세스에 한 줄 쓴다. 이 PC 안에서만 열린 서버라 화면 = 대표.
  if (url.pathname === '/api/gemini/ask' && req.method === 'POST') {
    readBody(req, res, async ({ team: t, actor, prompt, model, effort, resume }) => {
      if (!teamExists(t) || !actor || !prompt || !model) return json(res, 400, { error: 'team · actor · prompt · model 이 있어야 합니다.' });
      try { return json(res, 200, await gemini.ask({ team: t, actor, prompt, model, effort: effort ?? null, resume: resume ?? null })); }
      catch (e) { return json(res, 502, { error: String(e?.message ?? e).slice(0, 300) }); }
    }, 2_000_000);   // 인격 + 방 대화가 실린다 — 한글은 글자당 3바이트
    return;
  }
  if (url.pathname === '/api/gemini/status') return json(res, 200, { pool: gemini.status() });
  if (url.pathname === '/api/world' && req.method === 'GET') return json(res, 200, world.snapshot());
  if (url.pathname === '/api/world' && req.method === 'POST') {
    readBody(req, res, ({ debugHour }) => {
      const c = world.setDebugHour(debugHour);
      const w = world.snapshot();
      lastWorld = JSON.stringify(w); broadcast({ kind: 'world', world: w });
      json(res, 200, { config: c, world: w });
    });
    return;
  }

  // 라운드 열기·닫기. 이게 없으면 지시하려고 결국 터미널로 돌아가야 한다.
  if (url.pathname === '/api/round' && req.method === 'POST') {
    readBody(req, res, ({ team: t, action, topic, milestone, auditor, verdict, summary, next }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      if (isOffice(t)) return json(res, 400, { error: '총괄실에는 라운드가 없습니다. 늘 열려 있습니다.' });
      try {
        if (action === 'start') {
          return json(res, 200, startRound(t, {
            topic: topic ? String(topic).trim() : null,
            milestone: milestone == null ? null : Number(milestone),
            // 이 회차의 안 걸음 감사 자리(결정 125) — CLI --auditor 와 같은 자리.
            auditor: auditor ? String(auditor).trim() : null,
          }));
        }
        if (action === 'end') {
          // 판정은 감사역이 낸다. 여기서는 verdict 없이 닫는 것이 기본이다.
          const opts = {
            verdict: verdict ? String(verdict).toUpperCase() : null,
            summary: summary ? String(summary).trim() : null,
            // --next (결정 25): 닫은 그 자리에서 다음 라운드를 연다. 마일스톤·주제·감사 자리는 있으면 그대로, 없으면 로드맵의 now·비움.
            next: next && typeof next === 'object'
              ? {
                  milestone: next.milestone == null || Number.isNaN(Number(next.milestone)) ? null : Number(next.milestone),
                  topic: next.topic ? String(next.topic).trim() : null,
                  auditor: next.auditor ? String(next.auditor).trim() : null,
                }
              : next ? { milestone: null, topic: null, auditor: null } : null,
          };
          const st = readState(t);
          if (!st.round || st.phase === 'idle') return json(res, 409, { error: '진행 중인 라운드가 없습니다.' });
          // 닫아도 되는지는 미루기 전에 본다 — 미룬 뒤 일지까지 받고 나서 거부되면 그 일지가 헛돈다. endRound 가 닫기 직전에 한 번 더 본다.
          try { assertEndable(t, opts); } catch (e) { return json(res, 409, { error: e.message, refused: true }); }
          // 누가 일하는 중이면 턴이 끝난 뒤 닫는다. 지금 닫으면 마지막 발언이 훅에서 버려진다.
          if (session.closeWhenIdle(t, opts)) return json(res, 202, { deferred: true, round: st.round, next: !!opts.next });
          // 일지 → 닫기 → 비우기. 일지가 있어야 다음 세션이 어제를 인용한다. 일지는 자리당 최대 3분이라 응답을 기다리게 하면
          // CLI 가 5초 만에 "서버 없음" 으로 보고 직접 닫았고, 서버는 뒤늦게 "라운드 없음" 으로 던져 세션 비우기를 건너뛰었다
          // (R13, 대표 결정 26). 받았다고 바로 답하고 뒤에서 닫는다. 끝나면 note 가 방에 남는다.
          if (session.isClosing(t)) return json(res, 409, { error: '이미 닫는 중입니다.' });
          session.closeRound(t, opts)
            .then((r) => emit(t, { actor: 'system', type: 'note', text: session.closedText(r), meta: { closed: r.round } }))
            .catch((e) => emit(t, { actor: 'system', type: 'note', text: `라운드를 닫지 못했습니다 — ${e.message}` }));
          return json(res, 202, { accepted: true, round: st.round, next: !!opts.next });
        }
        return json(res, 400, { error: 'action 은 start 또는 end 입니다.' });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    });
    return;
  }

  // 산출물 보기 (대표 결정 36) — teams/<팀>/out/** 을 읽기 전용으로. 카드와 발언의 그림·md 링크가 여기로 온다.
  // 어디를 여는지는 bus.outFile 하나가 정한다(.. · 숨김 · 없는 팀은 null). 파일이 바뀌면 바로 새것 — 캐시 없음.
  // HEAD 도 받는다 — `curl -I` 가 GET 만 받는 첫 판에서 404 였다(레오 R16). 본문은 node http 가 HEAD 면 알아서 뺀다.
  if (url.pathname.startsWith('/out/') && (req.method === 'GET' || req.method === 'HEAD')) {
    let segs;
    try { segs = url.pathname.split('/').slice(2).map(decodeURIComponent); } catch { segs = []; }
    const file = segs.length >= 2 ? outFile(segs[0], segs.slice(1).join('/')) : null;
    if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    return sendFile(res, file, {}, req);
  }

  // 경로는 풀어서 연다 — Kenney 부품 폴더 이름에 빈칸이 있다("GLB format"). 안 풀면 `GLB%20format` 을 찾아 404 (레오 R24).
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  try { rel = decodeURIComponent(rel); } catch { res.writeHead(400); return res.end('bad path'); }
  // `%00` 은 풀면 널 문자 — fs.readFile 이 콜백이 아니라 그 자리에서 던져 서버가 죽는다. 먼저 거른다.
  if (rel.includes('\0')) { res.writeHead(400); return res.end('bad path'); }
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  sendFile(res, file, {}, req);
});

// 세상의 시계가 사회자의 침묵 차례를 켜고 끈다 — 밤·휴식엔 아무도 깨우지 않는다 (W2).
setClock(() => world.clock().mode);

const wss = new WebSocketServer({ server, path: '/ws' });
const broadcast = (msg) => {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
};

/* ── 모든 팀의 대화록을 동시에 tail ── */

const cursors = new Map(); // team → { offset, partial }

function pollTeam(id) {
  const p = paths(id);
  let size;
  try { size = fs.statSync(p.log).size; } catch { return []; }

  let c = cursors.get(id);
  if (!c) { c = { offset: 0, partial: '' }; cursors.set(id, c); }

  // 대화록은 줄어들 일이 없지만, 누가 파일을 손으로 지웠다면 처음부터 다시 읽는다.
  if (size < c.offset) { c.offset = 0; c.partial = ''; }
  if (size === c.offset) return [];

  const fd = fs.openSync(p.log, 'r');
  try {
    const buf = Buffer.alloc(size - c.offset);
    fs.readSync(fd, buf, 0, buf.length, c.offset);
    c.offset = size;
    c.partial += buf.toString('utf8');
    const lines = c.partial.split('\n');
    c.partial = lines.pop() ?? ''; // 개행이 안 붙은 마지막 조각은 보류
    return parseJSONL(lines.join('\n'));
  } finally {
    fs.closeSync(fd);
  }
}

let lastSummaries = '';
let lastWorld = '';

setInterval(() => {
  for (const t of listTeams()) {
    const events = pollTeam(t.id);
    if (events.length) {
      broadcast({ kind: 'events', team: t.id, events });
      // 사회자에게 넘긴다 — 누가 불렸나, 방이 조용한가. 기동 시 커서 맞추기(아래)는 여기를 거치지 않는다.
      try { noticeEvents(t.id, events); } catch (e) { console.error('conductor:', e.message); }
    }
  }
  // 굳은 판정 흐름을 놓는다(결정 117 곁다리) — 외부감사가 답을 못 내면 waiting 으로 굳어 다음 /verdict 가 거부됐다.
  try { expireFlows(); } catch (e) { console.error('conductor expire:', e.message); }
  // 말로 부른 판정에 10분 안 카드가 없으면 흐름을 돌린다(나리 점검-0916 3-7) — "재보겠습니다" 로 끝나는 외부감사.
  try { autoVerdicts(); } catch (e) { console.error('conductor auto verdict:', e.message); }
  // 통과한 B 푸시를 서버가 대신 민다. 한 번에 하나씩, 겹치지 않게.
  runExecutor();
  // 승인 요청·결말·실행 결과를 귀에 넣는다. 알림은 서버의 일이다.
  try { runNotifier(); } catch (e) { console.error('notifier:', e.message); }
  // 자정 마감(M7) — 날짜가 바뀌어 있으면 지난 하루를 팀마다 한 장 + 대표용 한 장으로. 안에서 겹침·오류를 스스로 막는다(한 날 한 번).
  runNightly({ session }).catch((e) => console.error('nightly:', e.message));

  // 레일의 계기판 값이 바뀌었을 때만 보낸다.
  const s = summaries();
  const raw = JSON.stringify(s);
  if (raw !== lastSummaries) {
    lastSummaries = raw;
    broadcast({ kind: 'summaries', summaries: s });
  }
  // 마을의 시계와 자리 — 분이 바뀌거나 누가 일하기 시작할 때만 보낸다.
  const w = world.snapshot();
  const rawW = JSON.stringify(w);
  if (rawW !== lastWorld) { lastWorld = rawW; broadcast({ kind: 'world', world: w }); }
}, POLL_MS);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ kind: 'hello', summaries: summaries(), world: world.snapshot(), infra: infra.latest() }));
});

// 기동 시 이미 쌓여 있던 대화록의 끝으로 커서를 옮긴다 (다시 밀지 않기 위해).
for (const t of listTeams()) pollTeam(t.id);
// 그 다음 — 지난 서버가 저장해 둔 차례를 되살린다 (결정 104). 커서를 맞춘 뒤라야 되살린 차례가 새 사건으로 두 번 안 온다.
// 세션은 여기서 안 띄운다 — 차례를 줄 때 session.send 가 그 자리 세션을 띄우고 나서 쓴다.
try { restoreQueues(); } catch (e) { console.error('conductor restore:', e.message); }

// 서버가 내려가면 팀 세션도 같이 닫는다. 세션 id 는 남기므로 다시 띄우면 이어진다.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { session.stopAll(); gemini.stopAll(); process.exit(0); });
}

server.listen(PORT, HOST, () => {
  // 리스너가 선 뒤에 잰다 — 첫 재기가 자기 자신에게 HTTP 로 묻는다. 틱마다 방송한다(2분에 한 번, 작다) — `at` 이 새로워야
  // 화면의 blockedOf 가 산 값을 unknown 으로 안 읽는다. 값이 같아도 시각은 다르다.
  infra = startInfra({ port: PORT, sessionHealth: session.health, onChange: (st) => broadcast({ kind: 'infra', infra: st }) });
  console.log('');
  console.log(`  ppanam 작전실   http://localhost:${PORT}`);
  console.log(`  팀 ${listTeams().map((t) => t.name).join(' · ')}`);
  console.log('');
  console.log('  라운드를 열고 입력창에 지시하면 됩니다. 터미널은 선택입니다.');
  console.log('');
  console.log(`  현황   node bus/round.mjs status`);
  console.log(`  시연   npm run demo`);
  if (HOST === '127.0.0.1') {
    console.log('');
    console.log('  이 PC 안에서만 열려 있습니다. 폰에서 보려면 VPN 안에서 HOST=0.0.0.0 으로 띄우세요.');
  }
  console.log('');
});
