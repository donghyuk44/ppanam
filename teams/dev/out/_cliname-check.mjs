// 결정 208 자가 시험 — 자리 파일 여섯의 system 자리에 name(나리)·cliName(나래) 둘 다 있고 JSON 이 멀쩡한지,
// 그리고 화면 규칙(hand 'cli' 만 cliName)을 app.js 와 같은 식으로 대 본다.
import fs from 'node:fs';
let bad = 0;
for (const t of ['dev', 'design', 'marketing', 'finance', 'hq', 'sera']) {
  const c = JSON.parse(fs.readFileSync(`teams/${t}/cast.json`, 'utf8'));
  const s = c.agents.system;
  const ok = s.name === '나리' && s.cliName === '나래';
  if (!ok) bad++;
  console.log(ok ? '✓' : '✗', t, s.name, s.cliName);
}
const a = { name: '나리', cliName: '나래' };
const shown = (e) => (e.actor === 'system' && e.meta?.hand === 'cli' && a.cliName) ? a.cliName : a.name;
const cases = [
  [{ actor: 'system', meta: { hand: 'cli' } }, '나래'],
  [{ actor: 'system', meta: { hand: 'server' } }, '나리'],
  [{ actor: 'system', meta: {} }, '나리'],
  [{ actor: 'system' }, '나리'],
];
for (const [e, want] of cases) { const got = shown(e); if (got !== want) bad++; console.log(got === want ? '✓' : '✗', JSON.stringify(e.meta ?? null), '→', got); }
process.exit(bad ? 1 : 0);
