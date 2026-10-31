import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockAt, anchorForLevel, resumedAnchor, upcomingLevels, makeStructure, finishOrder, mmss, type Level } from './clock.ts';
import { tournamentPrizes } from './settle.ts';

const M = 60_000;
const L: Level[] = [
  { level_no: 2, small_blind: 50, big_blind: 100, duration_min: 20 },
  { level_no: 1, small_blind: 25, big_blind: 50, duration_min: 15 },
  { level_no: 3, small_blind: 100, big_blind: 200, duration_min: 20 },
];
const T0 = Date.UTC(2026, 9, 24, 19, 0);

test('not started: level 1, full time', () => {
  const c = clockAt(L, null, null, T0);
  assert.equal(c.started, false);
  assert.equal(c.idx, 0);
  assert.equal(c.remainingMs, 15 * M);
});

test('running: level by elapsed time, sorted by level number', () => {
  assert.deepEqual([clockAt(L, T0, null, T0 + 5 * M).idx, clockAt(L, T0, null, T0 + 5 * M).remainingMs], [0, 10 * M]);
  assert.equal(clockAt(L, T0, null, T0 + 15 * M).idx, 1); // exactly at the change
  assert.equal(clockAt(L, T0, null, T0 + 40 * M).remainingMs, 15 * M);
});

test('pause freezes, resume continues from the same point', () => {
  const paused = clockAt(L, T0, T0 + 5 * M, T0 + 60 * M);
  assert.equal(paused.paused, true);
  assert.equal(paused.remainingMs, 10 * M);
  const a = resumedAnchor(T0, T0 + 5 * M, T0 + 60 * M);
  assert.equal(clockAt(L, a, null, T0 + 60 * M).remainingMs, 10 * M);
});

test('past the last level: stays on the last level at 0', () => {
  const c = clockAt(L, T0, null, T0 + 999 * M);
  assert.equal(c.idx, 2);
  assert.equal(c.over, true);
  assert.equal(c.remainingMs, 0);
});

test('jump to a level, also while paused', () => {
  const now = T0 + 3 * M;
  assert.equal(clockAt(L, anchorForLevel(L, 2, now, null), null, now).idx, 2);
  const a = anchorForLevel(L, 1, now, now);
  const c = clockAt(L, a, now, now + 10 * M);
  assert.deepEqual([c.idx, c.remainingMs, c.paused], [1, 20 * M, true]);
});

test('alerts: one per future level change, none while paused', () => {
  const up = upcomingLevels(L, T0, null, T0 + 1 * M);
  assert.deepEqual(up.map(u => [u.at - T0, u.level.small_blind]), [[15 * M, 50], [35 * M, 100]]);
  assert.deepEqual(upcomingLevels(L, T0, null, T0 + 20 * M).map(u => u.idx), [2]);
  assert.equal(upcomingLevels(L, T0, T0 + M, T0 + 2 * M).length, 0);
});

test('structure generator: BB = 2×SB along the ladder', () => {
  const s = makeStructure(25, 15, 6);
  assert.deepEqual(s.map(l => `${l.small_blind}/${l.big_blind}`), ['25/50', '50/100', '75/150', '100/200', '150/300', '200/400']);
  assert.ok(s.every((l, i) => l.level_no === i + 1 && l.duration_min === 15));
});

test('finish order: still in first, then last out first', () => {
  const o = finishOrder([
    { player_id: 'gal', seat_no: 3, eliminated_at: '2026-10-24T20:00:00Z' },
    { player_id: 'maya', seat_no: 4, eliminated_at: null },
    { player_id: 'ron', seat_no: 2, eliminated_at: '2026-10-24T21:00:00Z' },
    { player_id: 'avi', seat_no: 1, eliminated_at: '2026-10-24T22:00:00Z' },
  ]);
  assert.deepEqual(o, ['maya', 'avi', 'ron', 'gal']);
});

test('prizes match the server (same cases as the SQL tests)', () => {
  const p = (pot: number, pct: number[]) => [...tournamentPrizes(pot, pct, pct.map((_, i) => `p${i}`)).values()];
  assert.deepEqual(p(500, [60, 30, 10]), [300, 150, 50]);
  assert.deepEqual(p(333, [50, 30, 20]), [166, 100, 67]);
  assert.deepEqual(p(7, [34, 33, 33]), [3, 2, 2]);
});

test('mm:ss', () => {
  assert.equal(mmss(15 * M), '15:00');
  assert.equal(mmss(61_001), '1:02');
  assert.equal(mmss(3_725_000), '1:02:05');
});

import { autoStructure, paceInfo, averageStackBB } from './clock.ts';

test('auto structure: 6 players × 5000, 3 hours, 20-minute levels', () => {
  const l = autoStructure({ stack: 5000, players: 6, hours: 3, minutes: 20 });
  assert.equal(l.length, 9 + 4);
  assert.deepEqual([l[0].small_blind, l[0].big_blind], [25, 50]); // 100 big blinds each
  for (let i = 1; i < l.length; i++) assert.ok(l[i].small_blind > l[i - 1].small_blind, 'strictly rising');
  assert.ok(l.every(x => x.big_blind === 2 * x.small_blind && x.duration_min === 20));
  // at the planned end (level 9) the big blind is about 1/20 of all 30,000 chips
  const bbEnd = l[8].big_blind;
  assert.ok(bbEnd >= 1000 && bbEnd <= 2000, `end big blind ${bbEnd}`);
  console.log(l.map(x => `${x.small_blind}/${x.big_blind}`).join(' '));
});

test('auto structure follows the game: more players or rebuys → bigger blinds at the end; longer night → slower', () => {
  const base = autoStructure({ stack: 5000, players: 6, hours: 3, minutes: 20 });
  const more = autoStructure({ stack: 5000, players: 10, hours: 3, minutes: 20 });
  const reb = autoStructure({ stack: 5000, players: 6, hours: 3, minutes: 20, rebuys: true });
  const long = autoStructure({ stack: 5000, players: 6, hours: 5, minutes: 20 });
  assert.ok(more[8].big_blind > base[8].big_blind);
  assert.ok(reb[8].big_blind > base[8].big_blind);
  assert.ok(long[8].big_blind < base[8].big_blind);
  const small = autoStructure({ stack: 1000, players: 4, hours: 2, minutes: 15 });
  assert.deepEqual([small[0].small_blind, small[0].big_blind], [5, 10]);
  for (let i = 1; i < small.length; i++) assert.ok(small[i].small_blind > small[i - 1].small_blind);
  const two = autoStructure({ stack: 200, players: 2, hours: 2, minutes: 30 });
  for (let i = 1; i < two.length; i++) assert.ok(two[i].small_blind > two[i - 1].small_blind);
});

test('pace info and live average stack', () => {
  const l = autoStructure({ stack: 5000, players: 6, hours: 3, minutes: 20 });
  const p = paceInfo(l, 5000, 180);
  assert.equal(p.startDepth, 100);
  assert.equal(p.atEnd.level_no, 9);
  assert.equal(averageStackBB(8, 5000, 4, 400), 25); // 8 entries (6 + 2 rebuys), 4 left, BB 400
  assert.equal(averageStackBB(8, 5000, 0, 400), null);
});
