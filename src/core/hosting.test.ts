import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHost, hostTable, type HostedNight } from './hosting.ts';

const night = (id: string, d: string, host: string | null): HostedNight => ({ gameId: id, playedOn: d, createdAt: `${d}T20:00:00Z`, hostId: host });
const order = ['ron', 'gal', 'maya'];

test('next host follows the fixed order and wraps around', () => {
  assert.equal(nextHost(order, []), 'ron');
  assert.equal(nextHost(order, [night('a', '2026-10-01', 'ron')]), 'gal');
  assert.equal(nextHost(order, [night('a', '2026-10-01', 'ron'), night('b', '2026-10-08', 'gal'), night('c', '2026-10-15', 'maya')]), 'ron');
});

test('nights without a host, or a host outside the order, do not move the turn', () => {
  const ns = [night('a', '2026-10-01', 'gal'), night('b', '2026-10-08', null), night('c', '2026-10-15', 'guest')];
  assert.equal(nextHost(order, ns), 'maya');
});

test('swapped turns: the last host decides who is next', () => {
  // maya hosted out of turn after ron → next is after maya
  assert.equal(nextHost(order, [night('a', '2026-10-01', 'ron'), night('b', '2026-10-08', 'maya')]), 'ron');
});

test('table: times, last date, who is next', () => {
  const t = hostTable(order, [night('a', '2026-10-01', 'ron'), night('b', '2026-10-08', 'gal'), night('c', '2026-10-15', 'ron')]);
  assert.deepEqual(t.map(r => [r.playerId, r.times, r.last, r.isNext]), [
    ['ron', 2, '2026-10-15', false], ['gal', 1, '2026-10-08', true], ['maya', 0, null, false],
  ]);
});
