import test from 'node:test';
import assert from 'node:assert/strict';
import { addressees, readCast } from '../../../bus/bus.mjs';
import { personaOf, claudeActors } from '../../../server/session.mjs';

test('나리(system)를 이름으로 부르면 잡힌다', () => {
  const cast = readCast('dev').agents;
  const got = addressees('나리, 이거 봐 주세요.', cast);
  assert.ok(got.includes('system'), JSON.stringify(got));
});

test('dev 팀엔 system.md 가 없어 hq 의 것을 쓴다', () => {
  const p = personaOf('dev', 'system');
  assert.ok(p && p.length > 0);
});

test('claudeActors 에 system 이 들어간다(model: claude 로 바뀜)', () => {
  const actors = claudeActors('dev');
  assert.ok(actors.includes('system'), JSON.stringify(actors));
});
