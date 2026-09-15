import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordUsage, todayUsage } from '../../../server/usage.mjs';

// 진짜 장부(state/usage.jsonl)를 건드리지 않는다 — 임시 경로에만 쓴다(테라 지적, R32: 시험이 진짜 장부를 오염시켰다).
const tmpFile = path.join(os.tmpdir(), `usage-test-${process.pid}.jsonl`);

test('recordUsage 가 한 줄을 남기고 todayUsage 가 그것을 더한다', () => {
  recordUsage('dev', 'ops', 999, { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, total_cost_usd: 0.001, duration_ms: 100 }, tmpFile);
  const t = todayUsage('dev', new Date(), tmpFile);
  assert.equal(t.inputTokens, 10);
  assert.equal(t.cacheReadTokens, 100);
  assert.equal(t.turns, 1);
});

test('usage 필드가 없어도 던지지 않는다', () => {
  assert.doesNotThrow(() => recordUsage('dev', 'ops', 999, {}, tmpFile));
});

test.after(() => { try { fs.unlinkSync(tmpFile); } catch { /* 이미 없으면 그만 */ } });
