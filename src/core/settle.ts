// Pure money logic shared by the app (banker + viewers).
// Whole shekels only. Every function is deterministic: same input, same output,
// so two phones always show the same numbers and the server can re-validate them.

export type EntryType = 'buy_in' | 'rebuy' | 'cash_out' | 'reversal' | 'adjustment';

export interface LedgerEntry {
  id: string;
  playerId: string;
  type: EntryType;
  amountIls: number;
  chipsCount?: number | null;
  reversesEntryId?: string | null;
  createdAt?: string;
}

export interface PlayerTotals {
  playerId: string;
  totalIn: number;
  rebuys: number;
  counted: boolean;
  totalOut: number;
  net: number;
}

export interface Transfer {
  fromPlayerId: string;
  toPlayerId: string;
  amountIls: number;
}

export interface PotPayout {
  toPlayerId: string;
  amountIls: number;
}

const assertInt = (n: number, what: string) => {
  if (!Number.isInteger(n)) throw new Error(`${what} must be a whole number of shekels, got ${n}`);
};

/** Entries that count: not a reversal, and not reversed by a later entry. Mirrors the SQL view active_entries. */
export function activeEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const reversed = new Set(entries.filter(e => e.type === 'reversal').map(e => e.reversesEntryId));
  return entries.filter(e => e.type !== 'reversal' && !reversed.has(e.id));
}

/** Per-player totals. Mirrors the SQL view game_player_totals. */
export function playerTotals(playerIds: string[], entries: LedgerEntry[]): PlayerTotals[] {
  const map = new Map<string, PlayerTotals>(
    playerIds.map(id => [id, { playerId: id, totalIn: 0, rebuys: 0, counted: false, totalOut: 0, net: 0 }]),
  );
  for (const e of activeEntries(entries)) {
    const t = map.get(e.playerId);
    if (!t) throw new Error(`entry ${e.id} belongs to a player not in this game`);
    assertInt(e.amountIls, 'amount');
    if (e.type === 'buy_in' || e.type === 'rebuy') t.totalIn += e.amountIls;
    if (e.type === 'rebuy') t.rebuys += 1;
    if (e.type === 'cash_out') t.counted = true;
    if (e.type === 'cash_out' || e.type === 'adjustment') t.totalOut += e.amountIls;
  }
  for (const t of map.values()) t.net = t.totalOut - t.totalIn;
  return [...map.values()];
}

export function potOf(totals: PlayerTotals[]): number {
  return totals.reduce((s, t) => s + t.totalIn, 0);
}

/** Gap after counting: positive = more counted than the pot holds. Mirrors game_totals.gap. */
export function gapOf(totals: PlayerTotals[]): number {
  return totals.reduce((s, t) => s + t.totalOut, 0) - potOf(totals);
}

/** Chips counted -> shekels. Same rounding as the DB trigger (half away from zero). */
export function chipsToIls(chips: number, buyInIls: number, startStackChips: number): number {
  if (chips < 0 || !Number.isInteger(chips)) throw new Error('chips must be a non-negative whole number');
  if (startStackChips <= 0) throw new Error('starting stack must be positive');
  return Math.round((chips * buyInIls) / startStackChips);
}

/**
 * Split `total` by `weights` into whole numbers that sum exactly to `total`
 * (largest-remainder / Hamilton method). Ties broken by key order for determinism.
 */
export function largestRemainder(total: number, weights: { key: string; weight: number }[]): Map<string, number> {
  assertInt(total, 'total');
  const sumW = weights.reduce((s, w) => s + w.weight, 0);
  const out = new Map<string, number>();
  if (weights.length === 0) return out;
  if (sumW <= 0) throw new Error('weights must sum to a positive number');
  // integer remainders (not float fractions): the server computes prizes the same way, so both always agree
  const rows = weights.map(w => {
    const base = Math.floor((total * w.weight) / sumW);
    return { key: w.key, base, rem: total * w.weight - base * sumW };
  });
  let left = total - rows.reduce((s, r) => s + r.base, 0);
  const order = [...rows].sort((a, b) => b.rem - a.rem || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const r of order) {
    if (left <= 0) break;
    r.base += 1;
    left -= 1;
  }
  for (const r of rows) out.set(r.key, r.base);
  return out;
}

/**
 * Default gap handling: scale every counted amount by pot / counted, rounded so the
 * new amounts sum exactly to the pot. Returns the adjustment per player (non-zero only),
 * to be written as 'adjustment' ledger entries with a note.
 */
export function proportionalAdjustments(totals: PlayerTotals[]): Map<string, number> {
  const pot = potOf(totals);
  const counted = totals.reduce((s, t) => s + t.totalOut, 0);
  const adj = new Map<string, number>();
  if (counted === pot) return adj;
  if (counted === 0) throw new Error('nothing was counted; cannot balance proportionally');
  const target = largestRemainder(pot, totals.map(t => ({ key: t.playerId, weight: t.totalOut })));
  for (const t of totals) {
    const d = (target.get(t.playerId) ?? 0) - t.totalOut;
    if (d !== 0) adj.set(t.playerId, d);
  }
  return adj;
}

/**
 * Ledger mode: minimum transfers between players (greedy, at most n-1).
 * Biggest debtor pays biggest creditor; ties broken by player id so every device agrees.
 */
export function minTransfers(totals: PlayerTotals[]): Transfer[] {
  if (totals.reduce((s, t) => s + t.net, 0) !== 0) throw new Error('nets do not sum to zero: balance the pot first');
  const byAmount = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const debtors = totals.filter(t => t.net < 0).map(t => ({ id: t.playerId, amt: -t.net }));
  const creditors = totals.filter(t => t.net > 0).map(t => ({ id: t.playerId, amt: t.net }));
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.amt, c.amt);
    out.push({ fromPlayerId: d.id, toPlayerId: c.id, amountIls: amt });
    d.amt -= amt;
    c.amt -= amt;
    if (d.amt === 0) debtors.shift();
    if (c.amt === 0) creditors.shift();
  }
  return out;
}

/** Cash on the table: each player takes their counted amount straight from the pot. */
export function potPayouts(totals: PlayerTotals[]): PotPayout[] {
  if (gapOf(totals) !== 0) throw new Error('pot is not balanced');
  return totals
    .filter(t => t.totalOut > 0)
    .sort((a, b) => b.totalOut - a.totalOut || (a.playerId < b.playerId ? -1 : 1))
    .map(t => ({ toPlayerId: t.playerId, amountIls: t.totalOut }));
}

/**
 * Tournament: split the pot between the paid places by the evening's percentages
 * (e.g. [50, 30, 20]). `finishOrder` = player ids from 1st place down.
 * Returns the prize per player, to be written as their cash_out.
 */
export function tournamentPrizes(pot: number, payoutPct: number[], finishOrder: string[]): Map<string, number> {
  if (payoutPct.length === 0 || payoutPct.some(p => !Number.isInteger(p) || p <= 0)) {
    throw new Error('payout percentages must be positive whole numbers');
  }
  if (payoutPct.reduce((s, p) => s + p, 0) !== 100) throw new Error('payout percentages must sum to 100');
  if (finishOrder.length < payoutPct.length) throw new Error('more paid places than players');
  // keys are zero-padded place numbers so ties go to the better place
  const split = largestRemainder(pot, payoutPct.map((p, i) => ({ key: String(i).padStart(3, '0'), weight: p })));
  const prizes = new Map<string, number>(finishOrder.map(id => [id, 0]));
  payoutPct.forEach((_, i) => prizes.set(finishOrder[i], split.get(String(i).padStart(3, '0'))!));
  return prizes;
}
