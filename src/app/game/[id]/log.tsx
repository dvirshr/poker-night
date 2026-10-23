import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { useGame, type Row as Entry } from '../../../lib/useGame';
import { C, ils } from '../../../lib/theme';
import { Screen, Txt, Num, Card, Row, Back, Seg, LivePill, Badge, Loading } from '../../../ui/kit';

const label: Record<Entry['type'], string> = {
  buy_in: 'כניסה',
  rebuy: 'כניסה חוזרת',
  cash_out: 'ספירה',
  reversal: 'ביטול',
  adjustment: 'איזון',
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/** Every ledger line of the night, newest first, visible to all players: the shared source of truth. */
export default function GameLog() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGame(id);
  const [who, setWho] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string>('all');

  const authors = useMemo(() => [...new Set(g.rows.map(r => r.created_by).filter((x): x is string => !!x))], [g.rows]);
  useEffect(() => {
    if (!authors.length) return;
    supabase.from('profiles').select('id, display_name').in('id', authors)
      .then(({ data }) => setWho(Object.fromEntries((data ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]))));
  }, [authors.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!g.loaded || !g.game) return <Loading />;
  const nameOf = (pid: string) => g.seats.find(s => s.player_id === pid)?.display_name ?? '';
  const byId = new Map(g.rows.map(r => [r.id, r]));
  const reversed = new Set(g.rows.filter(r => r.type === 'reversal').map(r => r.reverses_entry_id));
  const rows = [...g.rows]
    .filter(r => filter === 'all' || r.player_id === filter)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const describe = (r: Entry) => {
    if (r.type === 'reversal') {
      const t = r.reverses_entry_id ? byId.get(r.reverses_entry_id) : undefined;
      return `ביטול ${t ? `${label[t.type]} ${ils(t.amount_ils)}` : ''}`;
    }
    if (r.type === 'cash_out') {
      const chips = r.chips_count != null ? `${r.chips_count.toLocaleString('he-IL')} צ׳יפים = ` : '';
      return `${r.note?.includes('יציאה') ? 'יציאה מהשולחן' : 'ספירה'} · ${chips}${ils(r.amount_ils)}`;
    }
    if (r.type === 'adjustment') return `איזון ${ils(r.amount_ils, true)}`;
    return `${label[r.type]} ${ils(r.amount_ils)}`;
  };

  const color = (r: Entry) => (r.type === 'reversal' ? C.neg : r.type === 'adjustment' ? C.acc : C.text);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back label="חזרה" />
        <LivePill live={g.live} unsynced={g.unsynced} onRefresh={g.reload} />
      </Row>
      <Txt size={26} weight="black">יומן הערב</Txt>
      <Txt muted size={13} style={{ marginBottom: 10 }}>{`${g.game.name} · כל רישום, ביטול ואיזון, עם שעה ומי רשם. אי אפשר למחוק או לשנות.`}</Txt>

      <Seg value={filter} onChange={setFilter} options={[{ v: 'all', t: 'כולם' }, ...g.seats.map(s => ({ v: s.player_id, t: s.display_name }))]} />

      <View style={{ gap: 6 }}>
        {rows.length === 0 && <Txt muted>אין רישומים</Txt>}
        {rows.map(r => {
          const cancelled = reversed.has(r.id);
          return (
            <Card key={r.id} style={{ paddingVertical: 10, gap: 2, opacity: cancelled ? 0.55 : 1 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold">{nameOf(r.player_id)}</Txt>
                <Num muted size={12}>{r.pending ? 'שומר…' : time(r.created_at)}</Num>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={14} color={color(r)} style={cancelled ? { textDecorationLine: 'line-through' } : undefined}>{describe(r)}</Txt>
                {cancelled && <Badge text="בוטל" />}
              </Row>
              <Txt muted size={11}>
                {`${r.created_by ? `נרשם ע״י ${who[r.created_by] ?? '…'}` : 'נרשם ע״י מנהל המערכת'}${r.note ? ` · ${r.note}` : ''}`}
              </Txt>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
