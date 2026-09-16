// 토큰 장부 — 자리·회차별로 얼마나 썼는지 남긴다 (대표 지적, 09-16: "톰 역할 토큰을 걱정했는데 지금은 잴 수가 없다").
//
// stream-json 의 result 메시지에 usage·total_cost_usd 가 실려 온다. 여기서 자리(session.mjs drain())가
// 그 result 를 받을 때 recordUsage 를 부르면, 한 줄을 state/usage.jsonl 에 덧붙인다. 이 파일은 그 한 줄을
// 쓰는 것과, 오늘치를 팀별로 더하는 것만 한다 — 캡처 지점(어디서 부르는가)은 session.mjs 몫이다.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../bus/bus.mjs';

const USAGE_PATH = path.join(ROOT, 'state', 'usage.jsonl');

/**
 * stream-json result 메시지 하나를 한 줄로 남긴다. msg 는 session.mjs 의 drain() 이 받는 그대로 —
 * 필드가 없으면(엔진마다 다를 수 있다) 0으로 채운다, 던지지 않는다(장부가 턴을 막으면 안 된다).
 */
export function recordUsage(team, actor, round, msg, file = USAGE_PATH) {
  const u = msg?.usage ?? {};
  const row = {
    ts: new Date().toISOString(),
    team, actor, round: round ?? null,
    sessionId: msg?.session_id ?? null,   // costUsd 를 세션 단위로 다시 더하려면 이게 있어야 한다 — 아래 참고
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreateTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    costUsd: typeof msg?.total_cost_usd === 'number' ? msg.total_cost_usd : null,
    durationMs: typeof msg?.duration_ms === 'number' ? msg.duration_ms : null,
  };
  try { fs.appendFileSync(file, JSON.stringify(row) + '\n'); } catch { /* 장부 실패는 턴을 막지 않는다 */ }
  return row;
}

function readRows(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

/**
 * costUsd 는 claude CLI 가 그 세션(프로세스) 시작부터 지금까지 쓴 돈의 누적값이다 — 그 턴 하나의 값이
 * 아니다. T2(회차가 닫혀도 세션을 안 버림) 뒤로는 한 세션이 여러 회차·여러 날을 살 수 있어, 이 줄들을
 * 그냥 더하면 같은 세션의 턴마다 이미 앞 턴의 비용까지 얹힌 값을 또 더하게 된다(독립검수 실측 — 3.8배
 * 부풀었다). 세션(sessionId)별로 시각순 정렬해 이전 값과의 차이만 그 턴이 실제로 쓴 돈이다 — 첫 턴은
 * 이전 값이 0 이라 그대로. sessionId 가 없는(엔진이 안 준) 줄도 같은 자리(session.mjs 가 team·actor 마다
 * 프로세스 하나만 띄운다)가 이어 쓴 누적값이라 똑같이 부푼다(나리 실측 09-16: 총괄 chief 12.9→14.3→14.6 을
 * 그냥 더해 총괄 $329 중 $214 가 이 몫이었다) — team:actor 로 묶어 같은 델타를 낸다.
 * --resume 뒤 누적이 작아지면(새 프로세스가 자기 시작부터 다시 세므로) 그 줄부터는 옛 최고값과의 차가
 * 아니라 그 줄 자체의 값을 델타로 삼는다 — 그냥 Math.max(0, cur - prev) 로 0 을 주면 누적이 옛 최고값을
 * 다시 넘을 때까지 여러 턴이 델타 0 으로 사라졌다(2판 코드 점검 #8, "오늘 쓴 것"이 작게 나옴). 입력·출력
 * 토큰은 턴마다의 실제 값이라(세션 누적이 아니다) 그대로 더한다 — 부푸는 건 costUsd 뿐이다.
 * @returns rows 와 같은 길이 — 각 줄에 { ...row, costDelta } 를 붙인다. 순수 함수(round.mjs check 가 돌려본다).
 */
export function withCostDeltas(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = r.sessionId ?? `${r.team}:${r.actor}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)).push(r);
  }
  for (const group of byKey.values()) {
    group.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    let prev = 0;
    for (const r of group) {
      const cur = r.costUsd ?? prev;
      r.costDelta = cur < prev ? Math.max(0, cur) : Math.max(0, cur - prev);   // 작아졌으면 새 프로세스 — 그 값 자체가 델타
      prev = cur;
    }
  }
  return rows;
}

/**
 * 오늘(우리 시각, UTC+9) 그 팀이 쓴 것 — 토큰 합·비용 합. 현황판 "오늘 쓴 것" 한 줄이 이걸 쓴다.
 * 델타는 세션 전체 이력이 있어야 정확하다(위 withCostDeltas) — 그래서 전체를 읽어 델타를 구한 다음
 * 오늘 것만 골라 더한다. 톰 걱정(캐시 토큰)은 costUsd 가 이미 답한다 — Claude 의 total_cost_usd 는
 * 캐시 생성·읽기 단가를 이미 반영한 값이다. cacheReadTokens 는 "그중 캐시로 아낀 몫" 참고 값이다.
 */
export function todayUsage(team, now = new Date(), file = USAGE_PATH) {
  const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const today = kstDate(now.toISOString());
  const all = withCostDeltas(readRows(file).filter((r) => r.team === team));
  const rows = all.filter((r) => kstDate(r.ts) === today);
  const inputTokens = rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  const outputTokens = rows.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
  const cacheReadTokens = rows.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
  const cacheCreateTokens = rows.reduce((s, r) => s + (r.cacheCreateTokens ?? 0), 0);
  const costUsd = rows.reduce((s, r) => s + (r.costDelta ?? 0), 0);
  return { date: today, turns: rows.length, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, costUsd };
}

export const USAGE_FILE = USAGE_PATH;
