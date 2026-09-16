import test from 'node:test';
import fs from 'node:fs';
import { pruneStaleSessions } from '../../../server/session.mjs';

test('실제 sessions.json 에서 유령 다섯이 지워지는지', () => {
  const before = JSON.parse(fs.readFileSync('state/sessions.json', 'utf8'));
  console.log('전:', JSON.stringify(before));
  const changed = pruneStaleSessions();
  const after = JSON.parse(fs.readFileSync('state/sessions.json', 'utf8'));
  console.log('후:', JSON.stringify(after), 'changed:', changed);
});
