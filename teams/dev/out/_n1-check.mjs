import test from 'node:test';
import assert from 'node:assert/strict';
import { addressees, readCast } from '../../../bus/bus.mjs';
import { personaOf, claudeActors } from '../../../server/session.mjs';

test('나리(system)를 이름으로 부르면 잡힌다 — dev 방에서도', () => {
  const cast = readCast('dev').agents;
  const got = addressees('나리, 이거 봐 주세요.', cast);
  assert.ok(got.includes('system'), JSON.stringify(got));
});

test('dev 팀엔 system.md 가 없어 hq 의 것을 쓴다', () => {
  const p = personaOf('dev', 'system');
  assert.ok(p && p.length > 0);
});

test('세션은 hq 하나뿐 — 다른 팀은 claudeActors 에 system 이 안 들어간다(N1 재정의)', () => {
  assert.ok(claudeActors('hq').includes('system'));
  assert.ok(!claudeActors('dev').includes('system'));
  assert.ok(!claudeActors('marketing').includes('system'));
});
