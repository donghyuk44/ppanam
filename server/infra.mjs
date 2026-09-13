// 밑바닥 넷 재기 — 서버 · 외부 감사(codex) 연결 · 세션 · 디스크 (결정 92 "뭐가 막혔나" 의 `where: infra`, M6 준비).
//
// 방 안의 막힘(needsBoss·bossCall·승인·요청)은 요약이 알지만 방 밑이 죽은 건 아무 데도 안 떴다 — 솔라가 curl 로 손수 봤다(R25).
// 여기는 **재기만** 한다. 잰 값 `{ ok, at, timeout, detail }` 을 그대로 넘기고, "죽음·모름" 을 가르는 건 순수 함수
// `server/public/notify.js blockedOf` 다(peopleOf 와 같은 경계 — 화면과 round.mjs check 가 같은 함수를 쓴다).
// 하네스 밤 시계에서 물려받은 것(out/watchdogs/README.md): 틱마다 무조건 기록 · 셸은 성공했는지 확인 · 딱 넷만, 더 안 늘린다.
// 파일 `state/infra.json` 은 덮어쓴다 — 자라는 파일을 만들지 않는다(솔라). 이력은 필요해지면 그때.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT, outsideCooldown } from '../bus/bus.mjs';

export const INFRA_TICK_MS = 2 * 60_000;              // 하네스 밤 시계와 같은 2분
export const INFRA_TIMEOUT_MS = 3 * INFRA_TICK_MS;    // 세 틱 동안 못 재면 blockedOf 가 unknown 으로
export const PROBE_MS = 10_000;                        // 재기 하나가 이 안에 안 끝나면 실패로 적는다
export const DISK_WARN_BYTES = 3 * 1024 ** 3;          // 하네스 디스크 시계와 같은 3G
export const INFRA_FILE = path.join(ROOT, 'state', 'infra.json');
export const INFRA_KEYS = ['server', 'codex', 'sessions', 'disk'];

/** `df -k <경로>` 출력에서 남은 바이트. 순수 함수 — round.mjs check 가 돌린다. 못 읽으면 null. */
export function parseDf(stdout) {
  const lines = String(stdout ?? '').trim().split('\n');
  if (lines.length < 2) return null;
  // 머리줄에서 Available 이 몇째 칸인지 센다. 값줄은 파일시스템 이름에 공백이 있으면 그만큼 칸이 밀린다 — 머리줄 "Mounted on" 은 두 낱말이지만 값은 하나라 하나 뺀다.
  const head = lines[0].trim().split(/\s+/);
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  const availAt = head.findIndex((h) => /^avail/i.test(h));
  if (availAt < 0) return null;
  const shift = cols.length - (head.length - 1);
  const availKb = Number(cols[availAt + Math.max(0, shift)]);
  return Number.isFinite(availKb) ? availKb * 1024 : null;
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: PROBE_MS, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});
const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${PROBE_MS / 1000}초 안에 답 없음`)), PROBE_MS))]);
const gb = (b) => `${(b / 1024 ** 3).toFixed(1)}G`;

/**
 * 넷을 한 번 잰다. 어느 하나가 던져도 나머지는 잰다 — 각자 `{ ok, at, timeout, detail }`.
 * @param port          서버 포트 — 자기 자신에게 HTTP 로 물어 리스너가 답하는지 본다
 * @param sessionHealth () => { alive, zombie } — 메모리의 claude 세션 중 프로세스가 끝났는데 맵에 남은 것(좀비)
 */
export async function probeAll({ port, sessionHealth }) {
  const at = new Date().toISOString();
  const wrap = (ok, detail) => ({ ok, at, timeout: INFRA_TIMEOUT_MS, detail });
  const tries = {
    server: async () => {
      const r = await withTimeout(fetch(`http://127.0.0.1:${port}/api/approvals`));
      return wrap(r.status === 200, `HTTP ${r.status}`);
    },
    codex: async () => {
      // 바이너리만 보면 한도 소진(R25)이 "산 것" 으로 나온다(솔라) — 쿨다운 파일이 있으면 그게 답이다.
      const cd = outsideCooldown();
      if (cd) return wrap(false, `계정 사용 한도 — ${cd.until.slice(0, 16)} 까지`);
      try { const where = (await run('which', ['codex'])).trim(); return wrap(true, where); }
      catch { return wrap(false, 'codex CLI 없음 — node bus/outside.mjs --setup'); }
    },
    sessions: async () => {
      const h = sessionHealth ? sessionHealth() : { alive: 0, zombie: 0 };
      return wrap(h.zombie === 0, `살아 있음 ${h.alive} · 좀비 ${h.zombie}`);
    },
    disk: async () => {
      const avail = parseDf(await run('df', ['-k', ROOT]));
      if (avail == null) return wrap(false, 'df 출력을 못 읽음');
      return wrap(avail >= DISK_WARN_BYTES, `남은 ${gb(avail)} (경고 ${gb(DISK_WARN_BYTES)} 아래)`);
    },
  };
  const out = {};
  for (const k of INFRA_KEYS) {
    try { out[k] = await tries[k](); }
    catch (e) { out[k] = wrap(false, String(e?.message ?? e).slice(0, 120)); }
  }
  return out;
}

export function readInfra() {
  try { return JSON.parse(fs.readFileSync(INFRA_FILE, 'utf8')); } catch { return null; }
}
// 임시 파일에 쓴 뒤 rename — 틱 도중 죽어도 반쪽 JSON 이 안 남는다(레오, R25). 장애를 알리는 파일이 장애가 되면 안 된다.
function writeInfra(state) {
  const tmp = `${INFRA_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(INFRA_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1) + '\n');
    fs.renameSync(tmp, INFRA_FILE);
  } catch (e) {
    console.error('[infra] state/infra.json 쓰기 실패 — ' + e.message);
    try { fs.rmSync(tmp, { force: true }); } catch { /* 없으면 그만 */ }
  }
}

/**
 * 2분마다 재서 파일에 덮어쓰고 `onChange(state)` 를 부른다. 첫 재기는 바로.
 * 서버가 켜질 때 이전 값이 파일에 있어도 그걸 산 값으로 안 쓴다 — 첫 재기 전까지 latest 는 null(안 잰 것은 막힘이 아니다).
 */
export function startInfra({ port, sessionHealth, onChange = null }) {
  // 지난 프로세스가 쓰다 죽은 임시 파일(다른 pid 이름)은 아무도 안 치운다 — 켤 때 한 번 쓸어 낸다.
  try {
    const dir = path.dirname(INFRA_FILE), base = path.basename(INFRA_FILE);
    for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '.') && f.endsWith('.tmp')) fs.rmSync(path.join(dir, f), { force: true });
  } catch { /* state/ 가 아직 없으면 그만 */ }
  let latest = null, ticking = false;
  const tick = async () => {
    if (ticking) return;   // 앞 재기가 늦으면 겹치지 않게
    ticking = true;
    try { latest = await probeAll({ port, sessionHealth }); writeInfra(latest); onChange?.(latest); }
    catch (e) { console.error('[infra] 재기 실패 — ' + e.message); }
    finally { ticking = false; }
  };
  tick();
  const timer = setInterval(tick, INFRA_TICK_MS);
  timer.unref?.();
  return { latest: () => latest, tick };
}
