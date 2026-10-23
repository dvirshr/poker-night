import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { titles, type Night, type Transfer } from '../core/stats';

/** All closed nights of a group, for titles, player cards and the monthly summary. */
export function useGroupStats(groupId: string) {
  const [nights, setNights] = useState<Night[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const load = useCallback(async () => {
    const g = await supabase.from('games').select('id, played_on, closed_at').eq('group_id', groupId).eq('status', 'closed');
    const games = (g.data ?? []) as { id: string; played_on: string; closed_at: string | null }[];
    if (!games.length) {
      setNights([]);
      setTransfers([]);
      return;
    }
    const ids = games.map(x => x.id);
    const [t, s] = await Promise.all([
      supabase.from('game_player_totals').select('game_id, player_id, display_name, total_in, rebuys, net').in('game_id', ids),
      supabase.from('settlements').select('game_id, from_player_id, to_player_id, amount_ils').in('game_id', ids),
    ]);
    const meta = new Map(games.map(x => [x.id, x]));
    setNights(
      ((t.data ?? []) as any[]).map(r => ({
        gameId: r.game_id,
        playedOn: meta.get(r.game_id)!.played_on,
        closedAt: meta.get(r.game_id)!.closed_at,
        playerId: r.player_id,
        name: r.display_name,
        totalIn: r.total_in,
        rebuys: r.rebuys,
        net: r.net,
      })),
    );
    setTransfers(((s.data ?? []) as any[]).map(r => ({ gameId: r.game_id, fromPlayerId: r.from_player_id, toPlayerId: r.to_player_id, amountIls: r.amount_ils })));
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const titleMap = useMemo(() => titles(nights), [nights]);
  return { nights, transfers, titles: titleMap, reload: load };
}

export const titleBadges = (list: { emoji: string }[] | undefined) => (list ?? []).map(t => t.emoji).join(' ');
