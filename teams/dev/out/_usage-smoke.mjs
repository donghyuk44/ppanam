import { recordUsage, todayUsage } from '../../../server/usage.mjs';
recordUsage('dev', 'ops', 32, { usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.01, duration_ms: 2000 });
console.log(JSON.stringify(todayUsage('dev')));
