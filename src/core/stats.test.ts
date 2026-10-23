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
