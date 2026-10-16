import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { pending, subscribe as onQueue, takeError } from './queue';
import { playerTotals, potOf, gapOf, type LedgerEntry, type PlayerTotals } from '../core/settle';
import { useAuth } from './auth';

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
};
export type Seat = { player_id: string; seat_no: number | null; display_name: string; profile_id: string | null };
export type Row = {
  id: string;
  player_id: string;
  type: LedgerEntry['type'];
  amount_ils: number;
  chips_count: number | null;
  reverses_entry_id: string | null;
  note: string | null;
  created_at: string;
  pending?: boolean;
};
export type Settlement = { from_player_id: string | null; to_player_id: string; amount_ils: number; method: 'from_pot' | 'transfer' };
export type Live = 'live' | 'reconnecting';

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [g, gp, le, st] = await Promise.all([
      supabase.from('games').select('*').eq('id', gameId).single(),
      supabase.from('game_players').select('player_id, seat_no, players(display_name, profile_id)').eq('game_id', gameId),
      supabase.from('ledger_entries').select('*').eq('game_id', gameId).order('created_at'),
      supabase.from('settlements').select('from_player_id, to_player_id, amount_ils, method').eq('game_id', gameId),
    ]);
    const err = g.error ?? gp.error ?? le.error ?? st.error;
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setGame(g.data as Game);
    setSeats(
      (gp.data ?? [])
        .map((r: any) => ({ player_id: r.player_id, seat_no: r.seat_no, display_name: r.players.display_name, profile_id: r.players.profile_id }))
        .sort((a: Seat, b: Seat) => (a.seat_no ?? 99) - (b.seat_no ?? 99) || a.display_name.localeCompare(b.display_name, 'he')),
    );
    setServer((le.data ?? []) as Row[]);
    setSettlements((st.data ?? []) as Settlement[]);
    setLoaded(true);
  }, [gameId]);

  const reload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 250);
  }, [load]);

  // realtime: every member sees the table move
  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`game:${gameId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ledger_entries', filter: `game_id=eq.${gameId}` }, p => {
        setServer(s => (s.some(r => r.id === (p.new as Row).id) ? s : [...s, p.new as Row]));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'settlements', filter: `game_id=eq.${gameId}` }, reload)
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
        rows.map(r => ({ id: r.id, playerId: r.player_id, type: r.type, amountIls: r.amount_ils, chipsCount: r.chips_count, reversesEntryId: r.reverses_entry_id })),
      ),
    [seats, rows],
  );

  const isBanker = !!game && game.banker_profile_id === userId;
  const mySeat = seats.find(s => s.profile_id === userId) ?? null;
  const unsynced = queued.length;

  return {
    game, seats, rows, totals, settlements, live, error, setError, loaded, isBanker, mySeat, unsynced,
    pot: potOf(totals), gap: gapOf(totals), reload: load,
  };
}
