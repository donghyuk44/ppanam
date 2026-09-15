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
 * 오늘(우리 시각, UTC+9) 그 팀이 쓴 것 — 토큰 합·비용 합. 현황판 "오늘 쓴 것" 한 줄이 이걸 쓴다.
 * 톰 걱정(캐시 토큰)은 costUsd 가 이미 답한다 — Claude 의 total_cost_usd 는 캐시 생성·읽기 단가를
 * 이미 반영한 값이라, "오늘 쓴 것" 한 줄은 costUsd 를 앞세우면 된다. cacheReadTokens 는 "그중 캐시로
 * 아낀 몫"을 보여주고 싶을 때 쓰는 참고 값이다(값이 크면 클수록 캐시가 잘 먹었다는 뜻 — 반대로 비용이
 * 적게 드는 것).
 */
export function todayUsage(team, now = new Date(), file = USAGE_PATH) {
  const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const today = kstDate(now.toISOString());
  const rows = readRows(file).filter((r) => r.team === team && kstDate(r.ts) === today);
  const inputTokens = rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  const outputTokens = rows.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
  const cacheReadTokens = rows.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
  const cacheCreateTokens = rows.reduce((s, r) => s + (r.cacheCreateTokens ?? 0), 0);
  const costUsd = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return { date: today, turns: rows.length, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, costUsd };
}

export const USAGE_FILE = USAGE_PATH;
