// Group statistics from closed games only. Pure functions: same input, same output.

export interface Night {
  gameId: string;
  playedOn: string; // YYYY-MM-DD
  closedAt: string | null;
  playerId: string;
  name: string;
  totalIn: number;
  rebuys: number;
  net: number;
}

export interface Transfer {
  gameId: string;
  fromPlayerId: string | null;
  toPlayerId: string;
  amountIls: number;
}

export interface Title {
  key: 'shark' | 'rebuys' | 'hot' | 'cold' | 'regular';
  emoji: string;
  label: string;
  why: string;
}

const order = (a: Night, b: Night) =>
  a.playedOn.localeCompare(b.playedOn) || (a.closedAt ?? '').localeCompare(b.closedAt ?? '') || a.gameId.localeCompare(b.gameId);

const byPlayer = (nights: Night[]) => {
  const m = new Map<string, Night[]>();
  for (const n of [...nights].sort(order)) {
    if (!m.has(n.playerId)) m.set(n.playerId, []);
    m.get(n.playerId)!.push(n);
  }
  return m;
};

/** The single leader of a numeric measure; no title when nobody qualifies or there is a tie for first. */
function leader(m: Map<string, number>, min: number): string | null {
  const rows = [...m.entries()].filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]);
  if (!rows.length || (rows[1] && rows[1][1] === rows[0][1])) return null;
  return rows[0][0];
}

/** Rotating titles, recomputed after every closed night. */
export function titles(nights: Night[]): Map<string, Title[]> {
  const out = new Map<string, Title[]>();
  const add = (pid: string, t: Title) => out.set(pid, [...(out.get(pid) ?? []), t]);
  const per = byPlayer(nights);

  const netTotal = new Map([...per].map(([pid, ns]) => [pid, ns.reduce((s, n) => s + n.net, 0)]));
  const shark = leader(netTotal, 1);
  if (shark) add(shark, { key: 'shark', emoji: '🦈', label: 'הכריש', why: `מוביל הליגה (${netTotal.get(shark)} ₪)` });

  const rebuys = new Map([...per].map(([pid, ns]) => [pid, ns.reduce((s, n) => s + n.rebuys, 0)]));
  const king = leader(rebuys, 1);
  if (king) add(king, { key: 'rebuys', emoji: '🔁', label: 'מלך הריבאיים', why: `${rebuys.get(king)} כניסות חוזרות` });

  const played = new Map([...per].map(([pid, ns]) => [pid, ns.length]));
  const regular = leader(played, 3);
  if (regular) add(regular, { key: 'regular', emoji: '🎯', label: 'המתמיד', why: `${played.get(regular)} ערבים` });

  for (const [pid, ns] of per) {
    const last3 = ns.slice(-3);
    if (last3.length === 3 && last3.every(n => n.net > 0)) add(pid, { key: 'hot', emoji: '🔥', label: 'על גל', why: '3 ערבים ברווח ברצף' });
    if (last3.length === 3 && last3.every(n => n.net < 0)) add(pid, { key: 'cold', emoji: '🥶', label: 'קר', why: '3 ערבים בהפסד ברצף' });
  }
  return out;
}

export interface PlayerStats {
  nights: number;
  netTotal: number;
  profitablePct: number;
  best: Night | null;
  worst: Night | null;
  avgIn: number;
  rebuys: number;
  /** cumulative net after each night, oldest first */
  trend: { playedOn: string; net: number; cumulative: number }[];
}

export function playerStats(nights: Night[], playerId: string): PlayerStats {
  const ns = nights.filter(n => n.playerId === playerId).sort(order);
  let cum = 0;
  const trend = ns.map(n => ({ playedOn: n.playedOn, net: n.net, cumulative: (cum += n.net) }));
  const best = ns.reduce<Night | null>((b, n) => (!b || n.net > b.net ? n : b), null);
  const worst = ns.reduce<Night | null>((w, n) => (!w || n.net < w.net ? n : w), null);
  return {
    nights: ns.length,
    netTotal: cum,
    profitablePct: ns.length ? Math.round((100 * ns.filter(n => n.net > 0).length) / ns.length) : 0,
    best,
    worst,
    avgIn: ns.length ? Math.round(ns.reduce((s, n) => s + n.totalIn, 0) / ns.length) : 0,
    rebuys: ns.reduce((s, n) => s + n.rebuys, 0),
    trend,
  };
}

export interface MonthSummary {
  month: string; // YYYY-MM
  nights: number;
  pot: number;
  king: { name: string; net: number } | null;
  bestNight: { name: string; net: number; playedOn: string } | null;
  biggestTransfer: { from: string; to: string; amountIls: number } | null;
  players: number;
}

export function monthly(nights: Night[], transfers: Transfer[]): MonthSummary[] {
  const months = new Map<string, Night[]>();
  for (const n of nights) {
    const k = n.playedOn.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k)!.push(n);
  }
  const nameOf = new Map(nights.map(n => [n.playerId, n.name]));
  const gameMonth = new Map(nights.map(n => [n.gameId, n.playedOn.slice(0, 7)]));
  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, ns]) => {
      const sums = new Map<string, number>();
      for (const n of ns) sums.set(n.playerId, (sums.get(n.playerId) ?? 0) + n.net);
      const kingId = leader(sums, 1);
      const best = ns.reduce<Night | null>((b, n) => (!b || n.net > b.net ? n : b), null);
      const ts = transfers.filter(t => gameMonth.get(t.gameId) === month && t.fromPlayerId);
      const big = ts.reduce<Transfer | null>((b, t) => (!b || t.amountIls > b.amountIls ? t : b), null);
      return {
        month,
        nights: new Set(ns.map(n => n.gameId)).size,
        pot: ns.reduce((s, n) => s + n.totalIn, 0),
        king: kingId ? { name: nameOf.get(kingId) ?? '', net: sums.get(kingId)! } : null,
        bestNight: best && best.net > 0 ? { name: best.name, net: best.net, playedOn: best.playedOn } : null,
        biggestTransfer: big ? { from: nameOf.get(big.fromPlayerId!) ?? '', to: nameOf.get(big.toPlayerId) ?? '', amountIls: big.amountIls } : null,
        players: sums.size,
      };
    });
}

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const monthName = (ym: string) => `${HE_MONTHS.at(Number(ym.slice(5, 7)) - 1) ?? ''} ${ym.slice(0, 4)}`;
