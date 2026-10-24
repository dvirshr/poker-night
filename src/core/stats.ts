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
  gameType?: 'cash' | 'tournament';
  place?: number | null; // tournament finish place
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

  // shark: best average per night among players with enough nights (one lucky night is not a shark)
  const games = new Set(nights.map(n => n.gameId)).size;
  const min = Math.min(MIN_NIGHTS, games);
  const avg = new Map([...per].filter(([, ns]) => ns.length >= min).map(([pid, ns]) => [pid, ns.reduce((s, n) => s + n.net, 0) / ns.length]));
  const shark = leader(avg, Number.MIN_VALUE);
  if (shark) add(shark, { key: 'shark', emoji: '🦈', label: 'הכריש', why: `הממוצע הכי גבוה: ${Math.round(avg.get(shark)!)} ₪ לערב` });

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
  /** tournaments: wins, top-3 finishes, % finishing with a prize */
  wins: number;
  podiums: number;
  itmPct: number;
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
    wins: ns.filter(n => n.gameType === 'tournament' && n.place === 1).length,
    podiums: ns.filter(n => n.gameType === 'tournament' && n.place != null && n.place <= 3).length,
    itmPct: (() => {
      const t = ns.filter(n => n.gameType === 'tournament');
      return t.length ? Math.round((100 * t.filter(n => n.net + n.totalIn > 0).length) / t.length) : 0;
    })(),
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

// ---------- league ----------
/** Below this many nights a player is listed but does not compete for places (unless the group has fewer nights). */
export const MIN_NIGHTS = 3;

export type LeagueSort = 'total' | 'avg' | 'wins';
export interface LeagueRow {
  playerId: string;
  name: string;
  nights: number;
  net: number;
  avg: number; // exact, round for display
  wins: number;
  winPct: number; // 0..100, rounded
  podiums: number; // tournament top 3
  qualified: boolean;
}

/** Did this player win this night? Tournament: 1st place. Cash: the top net (ties share it), and only if positive. */
function winners(nights: Night[]): Set<string> {
  const byGame = new Map<string, Night[]>();
  for (const n of nights) byGame.set(n.gameId, [...(byGame.get(n.gameId) ?? []), n]);
  const out = new Set<string>();
  for (const [g, ns] of byGame) {
    if (ns[0].gameType === 'tournament') ns.filter(n => n.place === 1).forEach(n => out.add(`${g}:${n.playerId}`));
    else {
      const top = Math.max(...ns.map(n => n.net));
      if (top > 0) ns.filter(n => n.net === top).forEach(n => out.add(`${g}:${n.playerId}`));
    }
  }
  return out;
}

/**
 * League table from closed nights.
 *   kind       = only cash nights / only tournaments
 *   withPlayer = only the nights this player played ("how I do against the others when we play together")
 *   sort       = total net, average per night, or win rate
 * Players with fewer than MIN_NIGHTS (in the filtered set) are listed last, not ranked.
 */
export function league(all: Night[], opts: { sort: LeagueSort; kind?: 'all' | 'cash' | 'tournament'; withPlayer?: string | null }): LeagueRow[] {
  let nights = opts.kind && opts.kind !== 'all' ? all.filter(n => (n.gameType ?? 'cash') === opts.kind) : all;
  if (opts.withPlayer) {
    const mine = new Set(nights.filter(n => n.playerId === opts.withPlayer).map(n => n.gameId));
    nights = nights.filter(n => mine.has(n.gameId));
  }
  const min = Math.min(MIN_NIGHTS, new Set(nights.map(n => n.gameId)).size);
  const won = winners(nights);
  const rows = [...byPlayer(nights)].map(([pid, ns]) => {
    const net = ns.reduce((s, n) => s + n.net, 0);
    const wins = ns.filter(n => won.has(`${n.gameId}:${pid}`)).length;
    return {
      playerId: pid,
      name: ns[ns.length - 1].name,
      nights: ns.length,
      net,
      avg: net / ns.length,
      wins,
      winPct: Math.round((100 * wins) / ns.length),
      podiums: ns.filter(n => n.gameType === 'tournament' && n.place != null && n.place <= 3).length,
      qualified: ns.length >= min,
    };
  });
  const key = (r: LeagueRow) => (opts.sort === 'avg' ? r.avg : opts.sort === 'wins' ? r.wins / r.nights : r.net);
  return rows.sort((a, b) =>
    Number(b.qualified) - Number(a.qualified) || key(b) - key(a) || b.nights - a.nights || a.name.localeCompare(b.name, 'he'));
}

export const byKind = (nights: Night[], kind: 'all' | 'cash' | 'tournament') =>
  kind === 'all' ? nights : nights.filter(n => (n.gameType ?? 'cash') === kind);

export interface HeadToHead {
  otherId: string;
  otherName: string;
  nights: number; // played together
  myNet: number;
  otherNet: number;
  meAhead: number; // nights I finished above (tournament: better place; cash: higher net)
  otherAhead: number;
}

/** Me against every other player, counting only the nights we both played. */
export function headToHead(nights: Night[], me: string): HeadToHead[] {
  const games = new Map<string, Night[]>();
  for (const n of nights) games.set(n.gameId, [...(games.get(n.gameId) ?? []), n]);
  const out = new Map<string, HeadToHead>();
  for (const ns of games.values()) {
    const mine = ns.find(n => n.playerId === me);
    if (!mine) continue;
    for (const o of ns) {
      if (o.playerId === me) continue;
      const h = out.get(o.playerId) ?? { otherId: o.playerId, otherName: o.name, nights: 0, myNet: 0, otherNet: 0, meAhead: 0, otherAhead: 0 };
      h.otherName = o.name;
      h.nights += 1;
      h.myNet += mine.net;
      h.otherNet += o.net;
      const tour = mine.gameType === 'tournament' && mine.place != null && o.place != null;
      const diff = tour ? o.place! - mine.place! : mine.net - o.net;
      if (diff > 0) h.meAhead += 1;
      else if (diff < 0) h.otherAhead += 1;
      out.set(o.playerId, h);
    }
  }
  return [...out.values()].sort((a, b) => b.nights - a.nights || a.otherName.localeCompare(b.otherName, 'he'));
}
