import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordUsage, todayUsage, withCostDeltas } from '../../../server/usage.mjs';

// 진짜 장부(state/usage.jsonl)를 건드리지 않는다 — 임시 경로에만 쓴다(테라 지적, R32: 시험이 진짜 장부를 오염시켰다).
// 시험마다 제 파일을 쓴다 — 한 파일을 같이 쓰면 turns·costUsd 기대값이 다른 시험 줄에 걸린다.
const tmp = () => path.join(os.tmpdir(), `usage-test-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
const cleanup = [];
test.after(() => { for (const f of cleanup) { try { fs.unlinkSync(f); } catch { /* 이미 없으면 그만 */ } } });

test('recordUsage 가 한 줄을 남기고 todayUsage 가 그것을 더한다', () => {
  const f = tmp(); cleanup.push(f);
  recordUsage('dev', 'ops', 999, { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, total_cost_usd: 0.001, duration_ms: 100 }, f);
  const t = todayUsage('dev', new Date(), f);
  assert.equal(t.inputTokens, 10);
  assert.equal(t.cacheReadTokens, 100);
  assert.equal(t.turns, 1);
  assert.equal(t.costUsd, 0.001);
});

test('usage 필드가 없어도 던지지 않는다', () => {
  const f = tmp(); cleanup.push(f);
  assert.doesNotThrow(() => recordUsage('dev', 'ops', 999, {}, f));
});

// 독립검수 실측(R32) — costUsd 는 그 세션이 시작부터 지금까지 쓴 누적값이다. 한 세션이 네 턴을 돌면
// 네 번째 줄의 costUsd 에 이미 앞 세 턴의 비용이 다 들어 있다 — 그대로 더하면 3.8배 같은 과대평가가 난다.
test('같은 세션 여러 턴 — costUsd 는 세션 누적값이라 델타만 더한다(독립검수 R32)', () => {
  const f = tmp(); cleanup.push(f);
  const msg = (cost) => ({ session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: cost });
  recordUsage('dev', 'guide', 32, msg(1.0), f);
  recordUsage('dev', 'guide', 32, msg(2.5), f);
  recordUsage('dev', 'guide', 32, msg(4.0), f);
  const t = todayUsage('dev', new Date(), f);
  assert.equal(t.turns, 3);
  // 그대로 더하면 7.5 — 델타로 더하면 1.0 + 1.5 + 1.5 = 4.0(세션 끝 값과 같아야 정상이다).
  assert.equal(t.costUsd, 4.0);
});

test('세션이 다른 날짜에 걸쳐도 그날 실제로 는 만큼만 그날 것으로 센다', () => {
  const f = tmp(); cleanup.push(f);
  const rows = [
    { ts: '2026-09-15T20:00:00.000Z', team: 'dev', sessionId: 's2', costUsd: 1.0 },   // 09-16 05:00 KST
    { ts: '2026-09-16T22:00:00.000Z', team: 'dev', sessionId: 's2', costUsd: 3.0 },   // 09-17 07:00 KST — 다음 날
  ];
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const day1 = todayUsage('dev', new Date('2026-09-16T00:00:00.000Z'), f);   // KST 09-16
  const day2 = todayUsage('dev', new Date('2026-09-17T00:00:00.000Z'), f);   // KST 09-17
  assert.equal(day1.costUsd, 1.0);
  assert.equal(day2.costUsd, 2.0);   // 3.0 - 1.0 — 그날 늘어난 만큼만
});

test('withCostDeltas 는 sessionId 없는 줄을 제 값 그대로 델타로 본다', () => {
  const out = withCostDeltas([{ ts: '2026-09-16T00:00:00.000Z', costUsd: 0.5 }]);
  assert.equal(out[0].costDelta, 0.5);
});
