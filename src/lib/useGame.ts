import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { pending, subscribe as onQueue, takeError } from './queue';
import { playerTotals, potOf, gapOf, type LedgerEntry, type PlayerTotals } from '../core/settle';
import { useAuth } from './auth';
import { useOnResume } from '../ui/kit';
import { THEMES, getMyTheme, setMyTheme, type ThemeKey } from './theme';
import type { Level } from '../core/clock';

export type Game = {
  id: string;
  group_id: string;
  name: string;
  played_on: string;
  game_type: 'cash' | 'tournament';
  settlement_mode: 'cash_on_table' | 'ledger';
  buy_in_ils: number;
  start_stack_chips: number | null;
  max_rebuys: number;
  rebuy_policy: 'all_night' | 'until_time' | 'none';
  rebuy_until: string | null;
  quick_rebuys: number[];
  status: 'open' | 'counting' | 'closed';
  banker_profile_id: string;
  closed_at: string | null;
  payout_pct: number[] | null;
  clock_anchor: string | null;
  clock_paused_at: string | null;
  blinds_rev: number;
};
export type Seat = { player_id: string; seat_no: number | null; display_name: string; profile_id: string | null; eliminated_at: string | null; finish_place: number | null };
export type Row = {
  id: string;
  player_id: string;
  type: LedgerEntry['type'];
  amount_ils: number;
  chips_count: number | null;
  reverses_entry_id: string | null;
  note: string | null;
  created_at: string;
  created_by?: string | null;
  pending?: boolean;
};
export type Settlement = { from_player_id: string | null; to_player_id: string; amount_ils: number; method: 'from_pot' | 'transfer' };
export type Live = 'live' | 'reconnecting';
export type Draw = { id: string; player_id: string; draw_no: number; pool: number; drawn_at: string };

export function useGame(gameId: string) {
  const { userId } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [server, setServer] = useState<Row[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [queued, setQueued] = useState(() => pending(gameId));
  const [live, setLive] = useState<Live>('reconnecting');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [theme, setTheme] = useState<ThemeKey>('graphite');
  const [myTheme, setMine] = useState<ThemeKey | null>(() => getMyTheme());
  const chooseTheme = useCallback((v: ThemeKey | null) => { setMyTheme(v); setMine(v); }, []);
  const [levels, setLevels] = useState<Level[]>([]);
  const [draws, setDraws] = useState<Draw[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [g, gp, le, st, bl] = await Promise.all([
      supabase.from('games').select('*').eq('id', gameId).single(),
      supabase.from('game_players').select('player_id, seat_no, eliminated_at, finish_place, players(display_name, profile_id)').eq('game_id', gameId),
      supabase.from('ledger_entries').select('*').eq('game_id', gameId).order('created_at'),
      supabase.from('settlements').select('from_player_id, to_player_id, amount_ils, method').eq('game_id', gameId),
      supabase.from('blind_levels').select('level_no, small_blind, big_blind, duration_min').eq('game_id', gameId).order('level_no'),
    ]);
    const err = g.error ?? gp.error ?? le.error ?? st.error;
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setGame(g.data as Game);
    const [me, grp] = await Promise.all([
      userId
        ? supabase.from('players').select('role').eq('group_id', (g.data as Game).group_id).eq('profile_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('groups').select('*').eq('id', (g.data as Game).group_id).maybeSingle(),
    ]);
    setIsAdmin((me.data as { role?: string } | null)?.role === 'admin');
    const tk = (grp.data as { table_theme?: ThemeKey } | null)?.table_theme;
    if (tk && THEMES[tk]) setTheme(tk);
    setSeats(
      (gp.data ?? [])
        .map((r: any) => ({
          player_id: r.player_id, seat_no: r.seat_no, display_name: r.players.display_name, profile_id: r.players.profile_id,
          eliminated_at: r.eliminated_at ?? null, finish_place: r.finish_place ?? null,
        }))
        .sort((a: Seat, b: Seat) => (a.seat_no ?? 99) - (b.seat_no ?? 99) || a.display_name.localeCompare(b.display_name, 'he')),
    );
    setServer((le.data ?? []) as Row[]);
    setSettlements((st.data ?? []) as Settlement[]);
    setLevels((bl.data ?? []) as Level[]);
    // dealer draws (missing table before the update = no draws, never an error)
    const dr = await supabase.from('game_draws').select('id, player_id, draw_no, pool, drawn_at').eq('game_id', gameId).order('draw_no');
    setDraws(dr.error ? [] : ((dr.data ?? []) as Draw[]));
    setLoaded(true);
  }, [gameId, userId]);

  const reload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 250);
  }, [load]);

  // realtime: every member sees the table move
  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`game:${gameId}:${Math.random().toString(36).slice(2, 10)}`) // unique per screen: table and count are both mounted in the stack
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ledger_entries', filter: `game_id=eq.${gameId}` }, p => {
        setServer(s => (s.some(r => r.id === (p.new as Row).id) ? s : [...s, p.new as Row]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'settlements', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_draws', filter: `game_id=eq.${gameId}` }, p => {
        setDraws(d => (d.some(x => x.id === (p.new as Draw).id) ? d : [...d, p.new as Draw].sort((a, b) => a.draw_no - b.draw_no)));
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setLive('live');
          reload(); // catch up on anything missed while disconnected
        } else setLive('reconnecting');
      });
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [gameId, load, reload]);

  useEffect(
    () =>
      onQueue(() => {
        const now = pending(gameId);
        setQueued(prev => {
          if (now.length < prev.length) reload(); // something reached the server: show the server's copy even without realtime
          return now;
        });
        const e = takeError();
        if (e) setError(e.message);
      }),
    [gameId, reload],
  );

  // phone unlocked / app reopened: the realtime socket may have died while asleep, so fetch fresh data
  useOnResume(reload);
  // safety net: if realtime is down, poll every 10 s so the table still moves
  useEffect(() => {
    if (live === 'live') return;
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [live, load]);

  const rows: Row[] = useMemo(() => {
    const ids = new Set(server.map(r => r.id));
    const extra = queued
      .filter(q => !ids.has(q.id))
      .map(q => ({
        id: q.id,
        player_id: q.player_id,
        type: q.type,
        amount_ils: q.amount_ils,
        chips_count: q.chips_count ?? null,
        reverses_entry_id: q.reverses_entry_id ?? null,
        note: q.note ?? null,
        created_at: q.queued_at,
        pending: true,
      }));
    return [...server, ...extra];
  }, [server, queued]);

  const totals: PlayerTotals[] = useMemo(
    () =>
      playerTotals(
        seats.map(s => s.player_id),
        // only rows of seated players: before the seats load (or if the phone still holds an entry
        // for a player it doesn't know yet) an unknown player must never crash the screen
        rows
          .filter(r => seats.some(s => s.player_id === r.player_id))
          .map(r => ({ id: r.id, playerId: r.player_id, type: r.type, amountIls: r.amount_ils, chipsCount: r.chips_count, reversesEntryId: r.reverses_entry_id })),
      ),
    [seats, rows],
  );

  const isBanker = !!game && game.banker_profile_id === userId;
  const mySeat = seats.find(s => s.profile_id === userId) ?? null;
  const unsynced = queued.length;

  return {
    game, seats, rows, totals, settlements, levels, draws, live, error, setError, loaded, isBanker, isAdmin, mySeat, unsynced, felt: THEMES[myTheme ?? theme], groupTheme: theme, myTheme, chooseTheme,
    pot: potOf(totals), gap: gapOf(totals), reload: load,
  };
}
