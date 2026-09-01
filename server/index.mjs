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
} from '../bus/bus.mjs';

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';
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

const summaries = () => Object.fromEntries(listTeams().map((t) => [t.id, teamSummary(t.id)]));

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

  if (url.pathname === '/api/say' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 64_000) req.destroy(); });
    req.on('end', () => {
      try {
        const { text, team: t } = JSON.parse(body || '{}');
        if (!teamExists(t)) return json(res, 404, { error: 'no such team' });
        if (!text || !String(text).trim()) return json(res, 400, { error: 'empty' });
        json(res, 200, emit(t, { actor: 'boss', type: 'message', text: String(text).trim() }));
      } catch (e) {
        json(res, 400, { error: String(e) });
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

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  ppanam 작전실   http://localhost:${PORT}`);
  console.log(`  팀 ${listTeams().map((t) => t.name).join(' · ')}`);
  console.log('');
  console.log(`  발언   node bus/say.mjs --as guide "안녕하세요"`);
  console.log(`  라운드 node bus/round.mjs start "주제" -m 1`);
  console.log(`  현황   node bus/round.mjs status`);
  console.log(`  시연   npm run demo`);
  console.log('');
});
