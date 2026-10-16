import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type LedgerEntry, playerTotals, potOf, gapOf, chipsToIls, proportionalAdjustments,
  minTransfers, potPayouts, tournamentPrizes, largestRemainder,
} from './settle.ts';

const players = ['avi', 'ron', 'ido', 'gal', 'maya', 'tal'];
let n = 0;
const e = (playerId: string, type: LedgerEntry['type'], amountIls: number, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ id: `e${++n}`, playerId, type, amountIls, ...extra });

// The sample evening from the mockups: buy-in 120 = 1,200 chips, Ron rebought once.
function sampleEvening(): LedgerEntry[] {
  const es = players.map(p => e(p, 'buy_in', 120));
  es.push(e('ron', 'rebuy', 120));
  const counts: Record<string, number> = { maya: 2800, avi: 1800, tal: 1500, ido: 1100, gal: 600, ron: 600 };
  for (const [p, chips] of Object.entries(counts)) {
    es.push(e(p, 'cash_out', chipsToIls(chips, 120, 1200), { chipsCount: chips }));
  }
  return es;
}

test('sample evening: pot 840, balanced, nets as in the mockup', () => {
  const t = playerTotals(players, sampleEvening());
  assert.equal(potOf(t), 840);
  assert.equal(gapOf(t), 0);
  const net = Object.fromEntries(t.map(x => [x.playerId, x.net]));
  assert.deepEqual(net, { avi: 60, ron: -180, ido: -10, gal: -60, maya: 160, tal: 30 });
});

test('ledger mode: minimum transfers settle every net exactly, at most n-1', () => {
  const t = playerTotals(players, sampleEvening());
  const tr = minTransfers(t);
  assert.ok(tr.length <= players.length - 1);
  const bal = new Map(players.map(p => [p, 0]));
  for (const x of tr) {
    bal.set(x.fromPlayerId, bal.get(x.fromPlayerId)! - x.amountIls);
    bal.set(x.toPlayerId, bal.get(x.toPlayerId)! + x.amountIls);
  }
  for (const x of t) assert.equal(bal.get(x.playerId), x.net, x.playerId);
  assert.deepEqual(tr, [
    { fromPlayerId: 'ron', toPlayerId: 'maya', amountIls: 160 },
    { fromPlayerId: 'gal', toPlayerId: 'avi', amountIls: 60 },
    { fromPlayerId: 'ron', toPlayerId: 'tal', amountIls: 20 },
    { fromPlayerId: 'ido', toPlayerId: 'tal', amountIls: 10 },
  ]);
});

test('cash on the table: payouts from the pot equal what each counted', () => {
  const p = potPayouts(playerTotals(players, sampleEvening()));
  assert.equal(p.reduce((s, x) => s + x.amountIls, 0), 840);
  assert.deepEqual(p[0], { toPlayerId: 'maya', amountIls: 280 });
});

test('reversal cancels a typo and keeps it in history', () => {
  const es = sampleEvening();
  const typo = e('gal', 'rebuy', 1200);
  es.push(typo, e('gal', 'reversal', 1200, { reversesEntryId: typo.id }));
  const t = playerTotals(players, es);
  assert.equal(potOf(t), 840);
  assert.equal(es.length, 15);
});

test('chips to shekels, including rounding', () => {
  assert.equal(chipsToIls(600, 120, 1200), 60);
  assert.equal(chipsToIls(2805, 120, 1200), 281); // 280.5 rounds up, like Postgres round()
  assert.equal(chipsToIls(0, 120, 1200), 0);
  assert.throws(() => chipsToIls(-1, 120, 1200));
});

test('proportional balancing: miscount of +5 on a 300 pot (same case as the DB test)', () => {
  const es = ['avi', 'ron', 'gal'].map(p => e(p, 'buy_in', 100));
  es.push(e('avi', 'cash_out', 203), e('ron', 'cash_out', 102), e('gal', 'cash_out', 0));
  const t = playerTotals(['avi', 'ron', 'gal'], es);
  assert.equal(gapOf(t), 5);
  const adj = proportionalAdjustments(t);
  assert.deepEqual(Object.fromEntries(adj), { avi: -3, ron: -2 });
  for (const [p, a] of adj) es.push(e(p, 'adjustment', a));
  assert.equal(gapOf(playerTotals(['avi', 'ron', 'gal'], es)), 0);
});

test('proportional balancing also fixes a shortfall', () => {
  const es = ['a', 'b'].map(p => e(p, 'buy_in', 100));
  es.push(e('a', 'cash_out', 150), e('b', 'cash_out', 40)); // 190 counted, pot 200
  const adj = proportionalAdjustments(playerTotals(['a', 'b'], es));
  assert.equal([...adj.values()].reduce((s, x) => s + x, 0), 10);
});

test('tournament: free number of paid places and split', () => {
  const order = ['maya', 'avi', 'tal', 'ido', 'gal', 'ron'];
  const p3 = tournamentPrizes(600, [50, 30, 20], order);
  assert.deepEqual([...p3.values()], [300, 180, 120, 0, 0, 0]);
  const p2 = tournamentPrizes(700, [70, 30], order);
  assert.equal(p2.get('maya'), 490);
  assert.equal(p2.get('avi'), 210);
  const odd = tournamentPrizes(100, [34, 33, 33], order);   // sums exactly despite rounding
  assert.equal([...odd.values()].reduce((s, x) => s + x, 0), 100);
  assert.throws(() => tournamentPrizes(600, [50, 30], order), /sum to 100/);
  assert.throws(() => tournamentPrizes(600, [100], []), /more paid places/);
});

test('guards: unbalanced pot cannot be settled', () => {
  const es = ['a', 'b'].map(p => e(p, 'buy_in', 100));
  es.push(e('a', 'cash_out', 150), e('b', 'cash_out', 40));
  const t = playerTotals(['a', 'b'], es);
  assert.throws(() => minTransfers(t), /balance the pot/);
  assert.throws(() => potPayouts(t), /not balanced/);
});

test('property: 2,000 random evenings always settle exactly with at most n-1 transfers', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let k = 0; k < 2000; k++) {
    const ids = Array.from({ length: 2 + Math.floor(rnd() * 11) }, (_, i) => `p${i}`); // 2..12 players
    const es: LedgerEntry[] = ids.map(id => e(id, 'buy_in', 100));
    for (const id of ids) if (rnd() < 0.4) es.push(e(id, 'rebuy', [50, 100, 200][Math.floor(rnd() * 3)]));
    const pot = potOf(playerTotals(ids, es));
    const counted = largestRemainder(pot, ids.map(id => ({ key: id, weight: Math.floor(rnd() * 10) })).filter(w => w.weight > 0).length
      ? ids.map(id => ({ key: id, weight: Math.floor(rnd() * 10) + (id === 'p0' ? 1 : 0) }))
      : ids.map(id => ({ key: id, weight: 1 })));
    for (const id of ids) es.push(e(id, 'cash_out', counted.get(id)! + (rnd() < 0.2 ? 3 : 0))); // occasional miscount
    let t = playerTotals(ids, es);
    for (const [p, a] of proportionalAdjustments(t)) es.push(e(p, 'adjustment', a));
    t = playerTotals(ids, es);
    assert.equal(gapOf(t), 0);
    const tr = minTransfers(t);
    assert.ok(tr.length <= ids.length - 1);
    const bal = new Map(ids.map(id => [id, 0]));
    for (const x of tr) {
      assert.ok(x.amountIls > 0 && Number.isInteger(x.amountIls));
      bal.set(x.fromPlayerId, bal.get(x.fromPlayerId)! - x.amountIls);
      bal.set(x.toPlayerId, bal.get(x.toPlayerId)! + x.amountIls);
    }
    for (const x of t) assert.equal(bal.get(x.playerId), x.net);
  }
});
