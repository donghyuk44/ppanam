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
  readCast, readRoadmap, readTail, listRounds, parseJSONL,
  readState, startRound, endRound,
} from '../bus/bus.mjs';
import * as session from './session.mjs';

const PORT = Number(process.env.PORT || 4321);

// 기본은 이 PC 안에서만. 입력창에 쓴 지시가 길잡이에게 그대로 가기 때문에,
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

const summaries = () => Object.fromEntries(
  listTeams().map((t) => [t.id, { ...teamSummary(t.id), session: session.status(t.id) }]),
);

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
    });
  }

  if (url.pathname === '/api/team') {
    if (!teamExists(team)) return json(res, 404, { error: 'no such team' });
    return json(res, 200, {
      team,
      cast: readCast(team),
      roadmap: readRoadmap(team),
      rounds: listRounds(team).slice(0, 40),
      summary: teamSummary(team),
      ...readTail(team, { limit: PAGE }),
    });
  }

  if (url.pathname === '/api/log') {
    if (!teamExists(team)) return json(res, 404, { error: 'no such team' });
    return json(res, 200, readTail(team, {
      limit: Number(q.get('limit')) || PAGE,
      before: q.get('before') || null,
    }));
  }

  // 지시. 대표가 쓴 말이 길잡이 세션으로 들어간다.
  //
  // 여기서 말풍선을 만들지 않는다 — 프롬프트가 세션에 들어가면 UserPromptSubmit
  // 훅이 대표 말풍선을 남긴다. 여기서 또 남기면 같은 말이 두 번 뜬다.
  if (url.pathname === '/api/say' && req.method === 'POST') {
    readBody(req, res, ({ text, team: t }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      const say = String(text ?? '').trim();
      if (!say) return json(res, 400, { error: '빈 지시입니다.' });

      // 라운드 밖에서는 훅이 기록하지 않는다. 지시해도 화면에 아무것도 안 뜨니,
      // 고장으로 보이기 전에 여기서 막는다.
      if (readState(t).phase !== 'running') {
        return json(res, 409, { error: '라운드를 먼저 여세요.', needsRound: true });
      }

      try {
        json(res, 200, { ok: true, ...session.send(t, say) });
      } catch (e) {
        json(res, 500, { error: `길잡이에게 전달하지 못했습니다 — ${e.message}` });
      }
    });
    return;
  }

  // 라운드 열기·닫기. 이게 없으면 지시하려고 결국 터미널로 돌아가야 한다.
  if (url.pathname === '/api/round' && req.method === 'POST') {
    readBody(req, res, ({ team: t, action, topic, milestone, verdict, summary }) => {
      if (!teamExists(t)) return json(res, 404, { error: '그런 팀이 없습니다.' });
      try {
        if (action === 'start') {
          return json(res, 200, startRound(t, {
            topic: topic ? String(topic).trim() : null,
            milestone: milestone == null ? null : Number(milestone),
          }));
        }
        if (action === 'end') {
          // 판정은 감사역이 낸다. 여기서는 verdict 없이 닫는 것이 기본이다.
          const n = endRound(t, {
            verdict: verdict ? String(verdict).toUpperCase() : null,
            summary: summary ? String(summary).trim() : null,
          });
          session.reset(t); // 비워지는 건 AI 컨텍스트뿐이다. 대화록은 그대로 남는다
          return json(res, 200, { round: n });
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

setInterval(() => {
  for (const t of listTeams()) {
    const events = pollTeam(t.id);
    if (events.length) broadcast({ kind: 'events', team: t.id, events });
  }
  // 레일의 계기판 값이 바뀌었을 때만 보낸다.
  const s = summaries();
  const raw = JSON.stringify(s);
  if (raw !== lastSummaries) {
    lastSummaries = raw;
    broadcast({ kind: 'summaries', summaries: s });
  }
}, POLL_MS);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ kind: 'hello', summaries: summaries() }));
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
