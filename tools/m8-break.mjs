// 8단계 실패 수습 — 일부러 깨뜨리는 시험 셋. node --test tools/m8-break.mjs 로 돈다(셸 허용 목록이 그 모양뿐).
// 어느 시험인지는 state/m8-break.json 의 { "test": "A1"|"A2"|"B", "team": "dev" } 로 정한다. 서버가 새 코드로 떠 있어야 한다.
//   A1  외부 자리(레오)의 **엔진**을 죽인다 — 상주 agy 프로세스(pool). 기대: note "상주 gemini 가 답을 못 냈습니다 … agy -p 로 한 번 더" → 레오 답.
//   A2  외부 자리의 **호출 프로세스**(node bus/outside.mjs)를 죽인다. 기대: note "…이 답을 못 냈습니다 — SIGKILL 로 죽음 … 큐에 남기고 3분 뒤" → 3분 뒤 레오 답.
//   B   클로드 자리(솔라)의 **세션 프로세스**를 턴 도중 죽인다. 기대: note "솔라 세션이 끊겼습니다 (SIGKILL 로 죽음) … 한 번 다시 보냅니다" → 솔라 답.
// 방에 시스템 말로 이름을 불러 차례를 만들고, 프로세스가 뜨면 죽이고, 대화록에서 note·답을 기다려 그대로 찍는다. 기록은 방(log.jsonl)에 남는다 — 이 출력은 out/m8-failures.md 에 옮긴다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { emit, readLog, ROOT } from '../bus/bus.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'm8-break.json'), 'utf8'));
const team = spec.team || 'dev';
const URL = process.env.PPANAM_URL || `http://127.0.0.1:${process.env.PORT || 4321}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = () => execFileSync('ps', ['-eww', '-o', 'pid,ppid,etime,command'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').slice(1)
  .map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], etime: m[3], head: m[4].slice(0, 200) }; }).filter(Boolean);
const serverPid = () => ps().find((r) => /^node server\/index\.mjs/.test(r.head))?.pid ?? null;
const kidsOf = (pid) => ps().filter((r) => r.ppid === pid);
const stamp = () => new Date().toISOString().slice(11, 19);
const say = (s) => console.log(`${stamp()} ${s}`);
async function waitFor(label, fn, { timeout = 120_000, every = 500 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) { say(`⏱ ${label} — ${Math.round(timeout / 1000)}초 안에 안 옴`); return null; }
    await sleep(every);
  }
}
const after = (id) => { const log = readLog(team); const i = log.findIndex((e) => e.id === id); return i >= 0 ? log.slice(i + 1) : []; };
const show = (e) => `[${e.ts.slice(11, 19)}] ${e.actor}/${e.type}: ${String(e.text).replace(/\s+/g, ' ').slice(0, 200)}${e.meta?.retry || e.meta?.outsideRetry || e.meta?.sessionRetry ? ' · meta ' + JSON.stringify(e.meta.retry ?? e.meta.outsideRetry ?? e.meta.sessionRetry).slice(0, 200) : ''}`;

const sp = serverPid();
if (!sp) { say('서버 없음'); process.exit(1); }
say(`서버 pid ${sp} · 시험 ${spec.test} · 방 ${team}`);
const boot = await (await fetch(`${URL}/api/boot`)).json();
say(`서버 부팅 응답 ok · 위임 ${boot.delegation ? '중' : '없음'}`);

if (spec.test === 'A1' || spec.test === 'A2') {
  const mark = emit(team, { actor: 'system', type: 'message', text: `레오, 8단계 실패 수습 시험 ${spec.test} 입니다 — 이 말에 한 줄만 답해 주세요. 답하는 중에 ${spec.test === 'A1' ? '상주 gemini 프로세스' : '호출 프로세스(outside.mjs)'}를 일부러 죽입니다.` });
  say(`방에 시스템 말 ${mark.id} — 레오 호명`);
  const child = await waitFor('outside.mjs 프로세스', () => kidsOf(sp).find((r) => /^node .*bus\/outside\.mjs/.test(r.head) && r.head.includes(`--team ${team}`)) ?? null, { timeout: 60_000, every: 300 });
  if (!child) process.exit(1);
  say(`outside.mjs 떴다 pid ${child.pid} — ${child.head.slice(0, 90)}`);
  if (spec.test === 'A1') {
    // 상주 agy 는 서버의 자식(pool) — 이 방 것을 고르려면 서버 /api 가 없으니 outside.mjs 가 물음을 넣은 뒤(첫 낱말 전) 죽여야 한다. 2초 뒤 가장 최근에 바쁜 상주 하나를 죽인다.
    await sleep(2500);
    const agys = kidsOf(sp).filter((r) => /^agy /.test(r.head));
    say(`상주 agy ${agys.length}개 — 전부 SIGKILL (어느 것이 이 방 것인지 밖에서는 모른다; 다른 방은 다음 물음에 다시 뜬다)`);
    for (const a of agys) { process.kill(a.pid, 'SIGKILL'); say(`  SIGKILL → agy pid ${a.pid} (${a.etime})`); }
  } else {
    await sleep(1500);
    process.kill(child.pid, 'SIGKILL'); say(`SIGKILL → outside.mjs pid ${child.pid}`);
  }
  const note1 = await waitFor('재시도 note', () => after(mark.id).find((e) => e.type === 'note' && (e.meta?.retry || e.meta?.outsideRetry)) ?? null, { timeout: 90_000 });
  if (note1) say(`note: ${show(note1)}`);
  const wait = spec.test === 'A2' ? 4 * 60_000 : 150_000;
  const answer = await waitFor('레오 답', () => after(mark.id).find((e) => e.actor === 'outside' && e.type === 'message' && new Date(e.ts) > new Date(mark.ts)) ?? null, { timeout: wait, every: 2000 });
  if (answer) say(`레오: ${show(answer)}`);
  say('그 뒤 note 들:'); for (const e of after(mark.id).filter((e) => e.type === 'note')) say('  ' + show(e));
  process.exit(answer ? 0 : 1);
}

if (spec.test === 'B') {
  const actor = spec.actor || 'ops', name = spec.name || '솔라';
  const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'sessions.json'), 'utf8'));
  const mark = emit(team, { actor: 'system', type: 'message', text: `${name}, 8단계 실패 수습 시험 B 입니다 — 이 말에 한 줄만 답해 주세요. 답하는 중에 네 세션 프로세스를 일부러 죽입니다(SIGKILL). 새 세션으로 같은 차례가 다시 가야 한다.` });
  say(`방에 시스템 말 ${mark.id} — ${name} 호명`);
  const busy = await waitFor(`${name} 세션 busy`, async () => { const b = await (await fetch(`${URL}/api/boot`)).json(); const s = b.summaries?.[team]?.sessions?.[actor]; return s?.busy ? s : null; }, { timeout: 60_000, every: 300 });
  if (!busy) process.exit(1);
  say(`${name} 일하는 중 — 세션 ${String(busy.sessionId ?? '').slice(0, 8)}`);
  await sleep(spec.delayMs ?? 4000);   // 훅이 턴 종류를 적고 첫 도구 줄이 나올 즈음
  const id = busy.sessionId ?? ids[`${team}:${actor}`];
  const proc = kidsOf(sp).find((r) => /^claude /.test(r.head) && id && r.head.includes(`--resume ${id}`))
    ?? kidsOf(sp).find((r) => /^claude /.test(r.head) && !/--resume/.test(r.head) && r.etime.length <= 5 && Number(r.etime.split(':')[0]) < 2);   // 새 세션(id 아직 없음)이면 막 뜬 것
  if (!proc) { say('세션 프로세스를 못 찾음'); process.exit(1); }
  process.kill(proc.pid, 'SIGKILL'); say(`SIGKILL → claude pid ${proc.pid} (${proc.etime}) ${proc.head.slice(0, 80)}`);
  const note1 = await waitFor('재개 note', () => after(mark.id).find((e) => e.type === 'note' && e.meta?.sessionRetry) ?? null, { timeout: 60_000 });
  if (note1) say(`note: ${show(note1)}`);
  const answer = await waitFor(`${name} 답`, () => after(mark.id).find((e) => e.actor === actor && e.type === 'message') ?? null, { timeout: 240_000, every: 2000 });
  if (answer) say(`${name}: ${show(answer)}`);
  say('그 뒤 note 들:'); for (const e of after(mark.id).filter((e) => e.type === 'note')) say('  ' + show(e));
  process.exit(answer ? 0 : 1);
}
say(`모르는 시험 ${spec.test}`);
process.exit(2);
