import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { supabase, heError } from '../lib/supabase';
import { C } from '../lib/theme';
import { Screen, Txt, Num, Card, Back, Seg, ErrorBar, Row, Badge, RefreshBtn, Loading } from '../ui/kit';

type Stats = { accounts: number; groups: number; active_groups: number; open_now: number; games_7d: number; games_30d: number; players_30d: number };
type G = { game_id: string; group_name: string; game_name: string; game_type: string; status: string; opened_by: string | null; banker: string | null; players: number; created_at: string; closed_at: string | null };

const STATUS: Record<string, { t: string; c: string }> = {
  open: { t: 'משחקים', c: C.pos }, counting: { t: 'בספירה', c: C.acc }, closed: { t: 'נסגר', c: C.muted }, cancelled: { t: 'בוטל', c: C.neg },
};
const when = (iso: string) => new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** App operators only: what is happening across all groups. No money, no emails. */
export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [games, setGames] = useState<G[] | null>(null);
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, g] = await Promise.all([supabase.rpc('admin_stats'), supabase.rpc('admin_games', { p_days: days })]);
    if (s.error || g.error) { setErr(heError(s.error ?? g.error)); setGames([]); return; }
    setStats(s.data as Stats);
    setGames((g.data ?? []) as G[]);
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const list = (games ?? []).filter(g => filter === 'all' || g.status === 'open' || g.status === 'counting');

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back />
        <RefreshBtn onPress={load} />
      </Row>
      <Txt size={26} weight="black">ניהול מערכת</Txt>
      <Txt muted size={12} style={{ marginBottom: 12 }}>כל הקבוצות באפליקציה. בלי סכומים ובלי כתובות מייל.</Txt>
      <ErrorBar text={err} onClose={() => setErr(null)} />
      {stats && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {([
            ['משחקים עכשיו', stats.open_now], ['ערבים · 7 ימים', stats.games_7d], ['ערבים · 30 יום', stats.games_30d],
            ['שחקנים · 30 יום', stats.players_30d], ['קבוצות פעילות', stats.active_groups], ['קבוצות', stats.groups], ['חשבונות', stats.accounts],
          ] as [string, number][]).map(([t, v]) => (
            <Card key={t} style={{ minWidth: 100, flexGrow: 1, alignItems: 'center', paddingVertical: 10 }}>
              <Num weight="black" size={24} center color={t === 'משחקים עכשיו' && v > 0 ? C.pos : C.text}>{String(v)}</Num>
              <Txt muted size={12} center>{t}</Txt>
            </Card>
          ))}
        </View>
      )}
      <Seg value={days} onChange={setDays} options={[{ v: 1, t: 'היום' }, { v: 7, t: '7 ימים' }, { v: 30, t: '30 יום' }, { v: 365, t: 'שנה' }]} />
      <Seg value={filter} onChange={setFilter} options={[{ v: 'all', t: 'כל הערבים' }, { v: 'open', t: 'פתוחים עכשיו' }]} />
      {games == null ? <Loading /> : list.length === 0 ? <Txt muted>אין ערבים בטווח הזה</Txt> : (
        <View style={{ gap: 8 }}>
          {list.map(g => (
            <Card key={g.game_id} style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold" size={15} style={{ flex: 1 }}>{`${g.group_name} · ${g.game_name}`}</Txt>
                <Badge text={STATUS[g.status]?.t ?? g.status} />
              </Row>
              <Txt size={13}>{`${g.game_type === 'tournament' ? '🏆 טורניר' : '💵 קאש'} · ${g.players} שחקנים · פתח: ${g.opened_by ?? '—'}${g.banker && g.banker !== g.opened_by ? ` · בנקאי: ${g.banker}` : ''}`}</Txt>
              <Txt muted size={12}>{`נפתח ${when(g.created_at)}${g.closed_at ? ` · נסגר ${when(g.closed_at)}` : ''}`}</Txt>
            </Card>
          ))}
        </View>
      )}
      <View style={{ height: 24 }} />
    </Screen>
  );
}
