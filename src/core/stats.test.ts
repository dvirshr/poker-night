import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titles, playerStats, monthly, monthName, type Night, type Transfer } from './stats.ts';

const n = (gameId: string, playedOn: string, playerId: string, net: number, totalIn = 100, rebuys = 0): Night =>
  ({ gameId, playedOn, closedAt: `${playedOn}T23:00:00Z`, playerId, name: playerId.toUpperCase(), totalIn, rebuys, net });

const nights: Night[] = [
  // Oct 2: A +50, B -30, C -20
  n('g1', '2026-10-02', 'a', 50), n('g1', '2026-10-02', 'b', -30, 200, 1), n('g1', '2026-10-02', 'c', -20),
  // Oct 9: A +10, B -40, C +30
  n('g2', '2026-10-09', 'a', 10), n('g2', '2026-10-09', 'b', -40, 300, 2), n('g2', '2026-10-09', 'c', 30),
  // Oct 16: A +5, B -5
  n('g3', '2026-10-16', 'a', 5), n('g3', '2026-10-16', 'b', -5),
  // Nov 6: C +60, A -60
  n('g4', '2026-11-06', 'c', 60), n('g4', '2026-11-06', 'a', -60),
];

test('titles: shark, rebuy king, regular, hot and cold streaks', () => {
  const t = titles(nights);
  const keys = (p: string) => (t.get(p) ?? []).map(x => x.key).sort();
  // net: a=+5, b=-75, c=+70 -> shark c
  assert.ok(keys('c').includes('shark'));
  assert.ok(keys('b').includes('rebuys'));
  assert.ok(keys('b').includes('cold')); // b lost 3 in a row
  assert.ok(!keys('a').includes('hot')); // a's last 3: +10, +5, -60
  // regular: a and b both played 4 and 3 -> a with 4
  assert.ok(keys('a').includes('regular'));
});

test('titles: no title on a tie for first', () => {
  const t = titles([n('g', '2026-10-01', 'x', 20), n('g', '2026-10-01', 'y', 20), n('g', '2026-10-01', 'z', -40)]);
  assert.ok(![...t.values()].flat().some(x => x.key === 'shark'));
});

test('player stats and cumulative trend', () => {
  const s = playerStats(nights, 'a');
  assert.equal(s.nights, 4);
  assert.equal(s.netTotal, 5);
  assert.equal(s.profitablePct, 75);
  assert.equal(s.best!.net, 50);
  assert.equal(s.worst!.net, -60);
  assert.deepEqual(s.trend.map(x => x.cumulative), [50, 60, 65, 5]);
});

test('monthly summary', () => {
  const transfers: Transfer[] = [
    { gameId: 'g1', fromPlayerId: 'b', toPlayerId: 'a', amountIls: 30 },
    { gameId: 'g2', fromPlayerId: 'b', toPlayerId: 'c', amountIls: 30 },
    { gameId: 'g2', fromPlayerId: 'b', toPlayerId: 'a', amountIls: 10 },
    { gameId: 'g4', fromPlayerId: 'a', toPlayerId: 'c', amountIls: 60 },
  ];
  const m = monthly(nights, transfers);
  assert.deepEqual(m.map(x => x.month), ['2026-11', '2026-10']);
  const oct = m[1];
  assert.equal(oct.nights, 3);
  assert.equal(oct.king!.name, 'A'); // a +65
  assert.equal(oct.bestNight!.net, 50);
  assert.equal(oct.biggestTransfer!.amountIls, 30);
  assert.equal(monthName('2026-10'), 'אוקטובר 2026');
});

import { league } from './stats.ts';

test('league: one lucky night does not top the average table', () => {
  const ns: Night[] = [
    ...['g1', 'g2', 'g3', 'g4'].flatMap((g, i) => [n(g, `2026-10-0${i + 1}`, 'maya', 80), n(g, `2026-10-0${i + 1}`, 'ron', -80)]),
    n('g4', '2026-10-04', 'yossi', 300), n('g4', '2026-10-04', 'ron', -300),
  ];
  const t = league(ns, { sort: 'avg' });
  assert.deepEqual(t.map(r => [r.playerId, r.qualified]), [['maya', true], ['ron', true], ['yossi', false]]);
  assert.equal(t[0].avg, 80);
  // by total too, yossi is listed last until he has 3 nights
  assert.equal(league(ns, { sort: 'total' }).at(-1)!.playerId, 'yossi');
});

test('league: win rate, tournaments by place, cash by top net', () => {
  const ns: Night[] = [
    { ...n('c1', '2026-10-01', 'a', 50), gameType: 'cash' }, { ...n('c1', '2026-10-01', 'b', -50), gameType: 'cash' },
    { ...n('t1', '2026-10-02', 'a', -100), gameType: 'tournament', place: 2 }, { ...n('t1', '2026-10-02', 'b', 100), gameType: 'tournament', place: 1 },
    { ...n('t2', '2026-10-03', 'a', 20), gameType: 'tournament', place: 1 }, { ...n('t2', '2026-10-03', 'b', -20), gameType: 'tournament', place: 2 },
  ];
  const all = league(ns, { sort: 'wins' });
  assert.deepEqual(all.map(r => [r.playerId, r.wins, r.winPct]), [['a', 2, 67], ['b', 1, 33]]);
  const tour = league(ns, { sort: 'wins', kind: 'tournament' });
  assert.deepEqual(tour.map(r => [r.playerId, r.wins, r.podiums]), [['a', 1, 2], ['b', 1, 2]]);
});

test('league: only the nights I played', () => {
  const ns = [n('g1', '2026-10-01', 'me', 10), n('g1', '2026-10-01', 'x', -10), n('g2', '2026-10-02', 'x', 500), n('g2', '2026-10-02', 'y', -500)];
  const t = league(ns, { sort: 'total', withPlayer: 'me' });
  assert.deepEqual(t.map(r => [r.playerId, r.net]), [['me', 10], ['x', -10]]);
});

import { headToHead } from './stats.ts';

test('head to head: only shared nights, places in tournaments', () => {
  const ns: Night[] = [
    n('g1', '2026-10-01', 'me', 50), n('g1', '2026-10-01', 'ron', -50),
    n('g2', '2026-10-02', 'ron', 900), n('g2', '2026-10-02', 'maya', -900), // I was not there
    { ...n('t1', '2026-10-03', 'me', -100), gameType: 'tournament', place: 3 }, { ...n('t1', '2026-10-03', 'ron', -100), gameType: 'tournament', place: 2 },
    { ...n('t1', '2026-10-03', 'maya', 200), gameType: 'tournament', place: 1 },
  ];
  const h = headToHead(ns, 'me');
  const ron = h.find(x => x.otherId === 'ron')!;
  assert.deepEqual([ron.nights, ron.myNet, ron.otherNet, ron.meAhead, ron.otherAhead], [2, -50, -150, 1, 1]);
  assert.deepEqual(h.map(x => x.otherId), ['ron', 'maya']);
});

import { periods } from './stats.ts';

test('periods: month and calendar year, #1 by money and by wins (ties shared)', () => {
  const ns: Night[] = [
    n('a1', '2026-01-10', 'maya', 300), n('a1', '2026-01-10', 'ron', -300),
    n('a2', '2026-01-17', 'ron', 50), n('a2', '2026-01-17', 'maya', -50),
    n('a3', '2026-01-24', 'ron', 40), n('a3', '2026-01-24', 'maya', -40),
    n('b1', '2025-12-20', 'gal', 10), n('b1', '2025-12-20', 'ron', -10),
  ];
  const y = periods(ns, [], 'year');
  assert.deepEqual(y.map(p => p.key), ['2026', '2025']);
  // 2026: money -> maya (+210), wins -> ron (2 of 3)
  assert.deepEqual(y[0].moneyKing.map(s => s.playerId), ['maya']);
  assert.deepEqual(y[0].winsKing.map(s => [s.playerId, s.wins]), [['ron', 2]]);
  const m = periods(ns, [], 'month');
  assert.equal(m[0].key, '2026-01');
  // tie on wins in a month: both kings
  const tie = periods([n('c1', '2026-03-01', 'x', 10), n('c1', '2026-03-01', 'y', -10), n('c2', '2026-03-08', 'y', 30), n('c2', '2026-03-08', 'x', -30)], [], 'month');
  assert.deepEqual(tie[0].winsKing.map(s => s.playerId), ['y', 'x']); // y first: more money
  assert.deepEqual(tie[0].moneyKing.map(s => s.playerId), ['y']);
});
