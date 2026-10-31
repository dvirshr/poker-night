// Tournament blind clock. Pure functions: every phone computes the same picture
// from the game's two timestamps (anchor, pausedAt) and the blind structure.
//   anchor   = when level 1 would have started had the clock never paused
//   pausedAt = set while paused
// All times are epoch milliseconds.

export interface Level {
  level_no: number;
  small_blind: number;
  big_blind: number;
  duration_min: number;
}

export interface ClockState {
  started: boolean;
  paused: boolean;
  idx: number; // current level index (0-based)
  remainingMs: number; // time left in the current level
  levelMs: number; // length of the current level
  over: boolean; // past the last level: stays on the last one
}

const MIN = 60_000;
export const sorted = (levels: Level[]) => [...levels].sort((a, b) => a.level_no - b.level_no);

/** Start of each level, in ms from the anchor. */
export function levelStarts(levels: Level[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const l of sorted(levels)) {
    out.push(t);
    t += l.duration_min * MIN;
  }
  return out;
}

export function clockAt(levels: Level[], anchor: number | null, pausedAt: number | null, now: number): ClockState {
  const ls = sorted(levels);
  if (!ls.length || anchor == null) {
    return { started: false, paused: false, idx: 0, remainingMs: (ls[0]?.duration_min ?? 0) * MIN, levelMs: (ls[0]?.duration_min ?? 0) * MIN, over: false };
  }
  const elapsed = Math.max(0, (pausedAt ?? now) - anchor);
  const starts = levelStarts(ls);
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (elapsed >= starts[i]) idx = i;
  const levelMs = ls[idx].duration_min * MIN;
  const end = starts[idx] + levelMs;
  const over = idx === ls.length - 1 && elapsed >= end;
  return { started: true, paused: pausedAt != null, idx, remainingMs: Math.max(0, end - elapsed), levelMs, over };
}

/** New anchor that puts the clock at the start of level idx (keeps a pause in place). */
export function anchorForLevel(levels: Level[], idx: number, now: number, pausedAt: number | null): number {
  const starts = levelStarts(levels);
  const i = Math.max(0, Math.min(idx, starts.length - 1));
  return (pausedAt ?? now) - (starts[i] ?? 0);
}

/** Resuming moves the anchor forward by the paused time. */
export const resumedAnchor = (anchor: number, pausedAt: number, now: number) => anchor + Math.max(0, now - pausedAt);

/** Future level changes, for scheduling alerts. Empty when not running. */
export function upcomingLevels(levels: Level[], anchor: number | null, pausedAt: number | null, now: number): { at: number; level: Level; idx: number }[] {
  if (anchor == null || pausedAt != null) return [];
  const ls = sorted(levels);
  const starts = levelStarts(ls);
  return ls.map((level, idx) => ({ at: anchor + starts[idx], level, idx })).filter(x => x.idx > 0 && x.at > now);
}

/** "12:05" or "1:02:05" */
export function mmss(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// common home-game ladder, in units of the starting small blind
const LADDER = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 120, 160, 200, 240, 300, 400];

/** Suggested structure: small blind grows along the ladder, big blind = 2 × small. */
export function makeStructure(startSmall: number, minutes: number, count: number): Level[] {
  const n = Math.max(1, Math.min(count, LADDER.length));
  return LADDER.slice(0, n).map((u, i) => ({ level_no: i + 1, small_blind: u * startSmall, big_blind: u * startSmall * 2, duration_min: minutes }));
}

// small blinds that are easy to make with chips: 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, ...
const NICE_SB: number[] = (() => {
  const out = new Set<number>();
  for (let k = 0; k <= 6; k++) for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8]) {
    const v = m * 10 ** k;
    if (Number.isInteger(v)) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
})();
const niceAtLeast = (x: number, above: number) => NICE_SB.find(v => v >= x && v > above) ?? NICE_SB.find(v => v > above)!;
const niceNear = (x: number, above: number) => {
  const c = NICE_SB.filter(v => v > above);
  return c.reduce((best, v) => (Math.abs(Math.log(v / x)) < Math.abs(Math.log(best / x)) ? v : best), c[0]);
};

export interface Pace { stack: number; players: number; hours: number; minutes: number; rebuys?: boolean }

/**
 * Blind structure tied to the actual game: starting stack, number of players and how long the night should run.
 *  - start: big blind ≈ 1/100 of the starting stack (100 big blinds each)
 *  - planned end: big blind ≈ 1/20 of all chips on the table, so the last players are short and must play
 *  - geometric steps in between, rounded to chip-friendly values; 4 spare levels in case it runs long
 */
export function autoStructure({ stack, players, hours, minutes, rebuys }: Pace): Level[] {
  const planned = Math.max(4, Math.round((hours * 60) / minutes));
  const sb0 = niceAtLeast(Math.max(1, stack / 200), 0);
  const chips = stack * Math.max(2, players) * (rebuys ? 1.5 : 1);
  const sbEnd = Math.max(sb0 * 4, chips / 40);
  const r = Math.max(1.15, (sbEnd / sb0) ** (1 / (planned - 1)));
  const out: Level[] = [];
  let prev = 0;
  for (let i = 0; i < planned + 4; i++) {
    const sb = i === 0 ? sb0 : niceNear(sb0 * r ** i, prev);
    out.push({ level_no: i + 1, small_blind: sb, big_blind: sb * 2, duration_min: minutes });
    prev = sb;
  }
  return out;
}

/** Plain-language summary of a structure against the stack, for the setup screen. */
export function paceInfo(levels: Level[], stack: number, plannedMin: number) {
  const first = levels[0];
  const starts = levelStarts(levels);
  let at = 0;
  for (let i = 0; i < levels.length; i++) if (starts[i] < plannedMin * 60_000) at = i;
  return {
    startDepth: first ? Math.round(stack / first.big_blind) : 0,
    atEnd: levels[at],
    totalMin: levels.reduce((s, l) => s + l.duration_min, 0),
  };
}

/** Average stack of the players still in, in big blinds: the live "pace" of a tournament. */
export function averageStackBB(entries: number, stack: number, alive: number, bigBlind: number): number | null {
  if (alive <= 0 || bigBlind <= 0 || entries <= 0) return null;
  return Math.round((entries * stack) / alive / bigBlind);
}

/**
 * Finish order from eliminations: players still in first (seat order), then the
 * eliminated ones, last out first. The banker can reorder before closing.
 */
export function finishOrder(seats: { player_id: string; seat_no: number | null; eliminated_at: string | null }[]): string[] {
  const alive = seats.filter(s => !s.eliminated_at).sort((a, b) => (a.seat_no ?? 99) - (b.seat_no ?? 99));
  const out = seats.filter(s => s.eliminated_at).sort((a, b) => b.eliminated_at!.localeCompare(a.eliminated_at!));
  return [...alive, ...out].map(s => s.player_id);
}

/** Payout presets by number of paid places. */
export const PAYOUT_PRESETS: number[][] = [[100], [70, 30], [65, 35], [60, 30, 10], [50, 30, 20], [50, 25, 15, 10], [40, 25, 20, 15]];
export const suggestedPayout = (players: number) => (players <= 4 ? [70, 30] : players <= 7 ? [60, 30, 10] : [50, 30, 20]);
