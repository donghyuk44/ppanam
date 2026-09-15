import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordUsage, todayUsage, USAGE_FILE } from '../../../server/usage.mjs';

test('recordUsage 가 한 줄을 남기고 todayUsage 가 그것을 더한다', () => {
  const before = fs.existsSync(USAGE_FILE) ? fs.readFileSync(USAGE_FILE, 'utf8').length : 0;
  recordUsage('dev', 'ops', 999, { usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001, duration_ms: 100 });
  const after = fs.readFileSync(USAGE_FILE, 'utf8');
  assert.ok(after.length > before);
  const t = todayUsage('dev');
  assert.ok(t.inputTokens >= 10);
  assert.ok(t.turns >= 1);
});

test('usage 필드가 없어도 던지지 않는다', () => {
  assert.doesNotThrow(() => recordUsage('dev', 'ops', 999, {}));
});
