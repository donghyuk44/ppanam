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
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  paths, listTeams, defaultTeam, teamExists, teamSummary,
  readCast, readRoadmap, readTail, listRounds, parseJSONL, emit,
  readState, startRound, assertEndable, resumeRound, readLog, isOffice, quiet, addressee,
  listApprovals, decideApproval, APPROVAL_GRADES,
} from '../bus/bus.mjs';
import * as session from './session.mjs';
import { runExecutor } from './executor.mjs';
import { runNotifier, notified } from './notifier.mjs';
import { noticeEvents, startVerdict, snapshot, setClock } from './conductor.mjs';
import * as world from './world.mjs';

const PORT = Number(process.env.PORT || 4321);

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
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

const json = (res, code, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'content-type': MIME['.json'], 'content-length': buf.length });
  res.end(buf);
};

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
  return chief ? { ...cast, agents: { ...cast.agents, chief } } : cast;
}

/**
 * 팀별 요약. 왼쪽 레일과 관제탑이 같은 값을 읽는다.
 *
 * 관제탑은 안 보고 있는 팀까지 한 화면에 놓으므로, 그 팀의 캐스트 이름과
 * 지금 마일스톤 제목까지 함께 실어야 카드가 말이 된다.
 */
const summaries = () => Object.fromEntries(listTeams().map((t) => {
  const s = teamSummary(t.id);
  const roadmap = readRoadmap(t.id);
  const now = roadmap.milestones?.find((m) => m.n === s.milestone) ?? null;
  return [t.id, {
    ...s,
    session: session.status(t.id),
    sessions: session.statusAll(t.id),   // 자리별 — 참여 카드의 상태 점
    conductor: snapshot(t.id),           // 누구 차례가 쌓여 있나, 판정 흐름은 어디까지 왔나
    milestoneTitle: now?.title ?? null,
    deliverable: now?.deliverable ?? null,
    progress: readProgress(t.id),
    cast: castOf(t.id).agents ?? {},
    approvals: {
      pending: listApprovals({ team: t.id, status: 'pending' }).length,
      passedToday: listApprovals({ team: t.id, status: 'passed' })
        .filter((r) => (r.decidedAt ?? '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    },
  }];
}));

/**
 * teams/<팀>/progress.json — 지금 어디까지 왔나. 로드맵이 목적지라면 이건 현재 위치다.
 * 한 것 · 하는 중 · 남은 것 · 이슈. 로드맵(C 등급)과 분리해 두므로 누구든 갱신할 수 있다.
 * 없으면 null — 카드는 그 블록을 그리지 않는다.
 */
function readProgress(team) {
  try { return JSON.parse(fs.readFileSync(path.join(paths(team).dir, 'progress.json'), 'utf8')); }
  catch { return null; }
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
function listOut(team) {
  const dir = paths(team).out;
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (!st.isFile()) continue;
      out.push({ name, size: st.size, at: st.mtime.toISOString() });
    } catch { /* 읽는 사이에 사라졌다면 넘어간다 */ }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** POST 본문을 JSON 으로 읽는다. 64KB 를 넘으면 끊는다. */
function readBody(req, res, done) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 64_000) req.destroy(); });
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
      approvals: listApprovals({ status: 'pending' }),
      told: notified(),
      grades: APPROVAL_GRADES,
    });
  }

  // 승인 큐. 대표는 화면에서 C 등급을 판정한다. B 는 톰·제리가 CLI 로 한다.
  if (url.pathname === '/api/approvals' && req.method === 'GET') {
    return json(res, 200, { pending: listApprovals({ status: 'pending' }), all: listApprovals(), told: notified() });
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

  if (url.pathname === '/api/team') {
    if (!teamExists(team)) return json(res, 404, { error: 'no such team' });
    return json(res, 200, {
      team,
      cast: castOf(team),
      roadmap: readRoadmap(team),
      rounds: listRounds(team).slice(0, 40),
      summary: teamSummary(team),
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

  // 팀 하나를 깊게 본다. 대화록을 다시 훑지 않고도 무슨 일이 있었는지 알 수 있어야 한다.
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

      // 작전실은 라운드 밖에서 훅이 기록하지 않는다. 지시해도 화면에 아무것도
      // 안 뜨니, 고장으로 보이기 전에 여기서 막는다. 총괄실은 라운드가 없다.
      const phase = isOffice(t) ? 'running' : readState(t).phase;
      if (phase === 'idle') {
        return json(res, 409, { error: '라운드를 먼저 여세요.', needsRound: true });
      }
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
        if (to && cast[to]?.model === 'gpt') {
          const rec = emit(t, { actor: 'boss', type: 'message', text: say });
          return json(res, 200, { ok: true, to, queued: 0, event: rec.id });
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
    const st = a.model === 'gpt' ? { engine: 'codex' } : session.status(team, actor);
    return json(res, 200, {
      team, actor, name: a.name ?? actor, role: a.role ?? null, color: a.color ?? null, model: a.model ?? null,
      persona, journal: journal ? { latest: journal.text.slice(0, 900), total: journal.total } : null,
      recent, status: st, world: world.snapshot().actors?.[`${team}:${actor}`] ?? null,
    });
  }
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
    readBody(req, res, ({ team: t, action, topic, milestone, verdict, summary }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      if (isOffice(t)) return json(res, 400, { error: '총괄실에는 라운드가 없습니다. 늘 열려 있습니다.' });
      try {
        if (action === 'start') {
          return json(res, 200, startRound(t, {
            topic: topic ? String(topic).trim() : null,
            milestone: milestone == null ? null : Number(milestone),
          }));
        }
        if (action === 'end') {
          // 판정은 감사역이 낸다. 여기서는 verdict 없이 닫는 것이 기본이다.
          const opts = {
            verdict: verdict ? String(verdict).toUpperCase() : null,
            summary: summary ? String(summary).trim() : null,
          };
          const st = readState(t);
          if (!st.round || st.phase === 'idle') return json(res, 409, { error: '진행 중인 라운드가 없습니다.' });
          // 닫아도 되는지는 미루기 전에 본다 — 미룬 뒤 일지까지 받고 나서 거부되면 그 일지가 헛돈다. endRound 가 닫기 직전에 한 번 더 본다.
          try { assertEndable(t, opts); } catch (e) { return json(res, 409, { error: e.message, refused: true }); }
          // 누가 일하는 중이면 턴이 끝난 뒤 닫는다. 지금 닫으면 마지막 발언이 훅에서 버려진다.
          if (session.closeWhenIdle(t, opts)) return json(res, 202, { deferred: true, round: st.round });
          // 일지 → 닫기 → 비우기. 일지가 있어야 다음 세션이 어제를 인용한다.
          session.closeRound(t, opts)
            .then((r) => json(res, 200, r))
            .catch((e) => json(res, 400, { error: e.message }));
          return;
        }
        return json(res, 400, { error: 'action 은 start 또는 end 입니다.' });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    });
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
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
  // 통과한 B 푸시를 서버가 대신 민다. 한 번에 하나씩, 겹치지 않게.
  runExecutor();
  // 승인 요청·결말·실행 결과를 귀에 넣는다. 알림은 서버의 일이다.
  try { runNotifier(); } catch (e) { console.error('notifier:', e.message); }

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
  ws.send(JSON.stringify({ kind: 'hello', summaries: summaries(), world: world.snapshot() }));
});

// 기동 시 이미 쌓여 있던 대화록의 끝으로 커서를 옮긴다 (다시 밀지 않기 위해).
for (const t of listTeams()) pollTeam(t.id);

// 서버가 내려가면 팀 세션도 같이 닫는다. 세션 id 는 남기므로 다시 띄우면 이어진다.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { session.stopAll(); process.exit(0); });
}

server.listen(PORT, HOST, () => {
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
