import assert from 'node:assert/strict';
import { readyOf, reviewQueueOf, inProgressOf, waitingOf, overlapOf, redOf } from '../../../tools/work-board.mjs';

const items = [
  { id: 'A', team: 't1', seat: 's1', status: '통과', after: [] },
  { id: 'B', team: 't1', seat: 's1', status: '대기', after: ['A'] },        // ready (A passed)
  { id: 'C', team: 't1', seat: 's1', status: '대기', after: ['D'] },        // not ready (D not passed)
  { id: 'D', team: 't2', seat: 's2', status: '진행', bottleneck: 'x' },
  { id: 'E', team: 't2', seat: 's2', status: '감사 대기', bottleneck: 'x' },
  { id: 'F', team: 't3', seat: 's3', status: '감사 대기', bottleneck: 'x' },
  { id: 'G', team: 't3', seat: 's3', status: '막힘', bottleneck: 'y', note: '멈췄다' },
  { id: 'H', team: 't4', seat: 's4', status: '안 함', after: [] },
];

assert.deepEqual(readyOf(items).map((i) => i.id), ['B']);
assert.deepEqual(reviewQueueOf(items).map((i) => i.id), ['E', 'F']);
assert.deepEqual(inProgressOf(items).map((i) => i.id), ['D']);
assert.deepEqual(waitingOf(items).map((w) => w.item.id), ['C']);
assert.deepEqual(waitingOf(items)[0].waitingOn, ['D']);

const overlap = overlapOf(items);
assert.equal(overlap.length, 1);
assert.equal(overlap[0].team, 't2');
assert.equal(overlap[0].items.length, 2);

const red = redOf(items);
assert.deepEqual(red.blocked.map((i) => i.id), ['G']);
assert.equal(red.congested.length, 1);
assert.equal(red.congested[0].bottleneck, 'x');
assert.equal(red.congested[0].items.length, 3);

console.log('OK — 모든 자체 점검 통과');
