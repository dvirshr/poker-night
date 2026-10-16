import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { supabase, heError } from '../../../lib/supabase';
import { enqueue } from '../../../lib/queue';
import { useGame } from '../../../lib/useGame';
import { chipsToIls } from '../../../core/settle';
import { C, ils } from '../../../lib/theme';
import { Screen, Txt, Num, Btn, Card, ErrorBar, LivePill, Row, Back, Loading, tap } from '../../../ui/kit';

function KeepAwake() {
  useKeepAwake();
  return null;
}

export default function Count() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGame(id);
  const [cur, setCur] = useState<string | null>(null);
  const [digits, setDigits] = useState('');

  const game = g.game;
  useEffect(() => {
    if (game?.status === 'closed') router.replace(`/game/${id}/summary`);
  }, [game, id]);

  const counted = g.totals.filter(t => t.counted);
  const countedSum = counted.reduce((s, t) => s + t.totalOut, 0);
  const nextUncounted = useMemo(() => g.seats.find(s => !g.totals.find(t => t.playerId === s.player_id)?.counted)?.player_id ?? null, [g.seats, g.totals]);
  useEffect(() => {
    if (cur === null && nextUncounted) setCur(nextUncounted);
  }, [cur, nextUncounted]);

  if (!g.loaded || !game) return <Loading />;
  const stack = game.start_stack_chips ?? game.buy_in_ils;
  const allCounted = g.seats.length > 0 && counted.length === g.seats.length;
  const pct = g.pot ? Math.min(100, Math.round((countedSum / g.pot) * 100)) : 0;
  const curT = cur ? g.totals.find(t => t.playerId === cur) : undefined;
  const curName = g.seats.find(s => s.player_id === cur)?.display_name ?? '';
  const chips = parseInt(digits || '0', 10);
  const value = chipsToIls(chips, game.buy_in_ils, stack);

  const activeCashOut = (pid: string) => {
    const reversed = new Set(g.rows.filter(r => r.type === 'reversal').map(r => r.reverses_entry_id));
    return g.rows.find(r => r.player_id === pid && r.type === 'cash_out' && !reversed.has(r.id));
  };

  const save = (n: number) => {
    if (!cur) return;
    enqueue({ game_id: id, player_id: cur, type: 'cash_out', amount_ils: chipsToIls(n, game.buy_in_ils, stack), chips_count: n });
    setDigits('');
    const next = g.seats.find(s => s.player_id !== cur && !g.totals.find(t => t.playerId === s.player_id)?.counted);
    setCur(next?.player_id ?? null);
  };

  const press = (k: string) => {
    tap();
    if (k === 'del') return setDigits(d => d.slice(0, -1));
    setDigits(d => (d + k).replace(/^0+/, '').slice(0, 7));
  };

  const progress = (
    <View style={{ gap: 6, marginVertical: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Num size={13}>{`נספרו ${ils(countedSum)} מתוך ${ils(g.pot)}`}</Num>
        <Num muted size={13}>{`נשארו ${ils(g.pot - countedSum)}`}</Num>
      </Row>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: C.raised, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 8, backgroundColor: countedSum > g.pot ? C.neg : C.acc }} />
      </View>
    </View>
  );

  const tabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {g.seats.map(s => {
        const t = g.totals.find(x => x.playerId === s.player_id);
        const on = s.player_id === cur;
        return (
          <Pressable
            key={s.player_id}
            disabled={!g.isBanker}
            onPress={() => { tap(); setCur(s.player_id); setDigits(''); }}
            style={{ height: 40, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? C.acc : t?.counted ? C.surf : 'transparent', borderWidth: on ? 0 : 1, borderColor: C.line }}
          >
            <Txt weight="bold" size={14} color={on ? C.accInk : t?.counted ? C.text : C.muted}>{`${t?.counted ? '✓ ' : ''}${s.display_name}`}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  // ---------- viewer ----------
  if (!g.isBanker) {
    return (
      <Screen>
        <Back label="לשולחן" to={`/game/${id}`} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={26} weight="black">ספירת צ׳יפים</Txt>
          <LivePill live={g.live} />
        </Row>
        {progress}
        {g.seats.map(s => {
          const t = g.totals.find(x => x.playerId === s.player_id)!;
          const mine = g.mySeat?.player_id === s.player_id;
          return (
            <Card key={s.player_id} accent={mine} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, paddingVertical: 12 }}>
              <Txt weight="bold">{s.display_name}{mine ? ' · אני' : ''}</Txt>
              {t.counted ? <Num weight="bold">{ils(t.totalOut)}</Num> : <Txt muted size={13}>טרם נספר</Txt>}
            </Card>
          );
        })}
      </Screen>
    );
  }

  // ---------- banker ----------
  const existing = cur ? activeCashOut(cur) : undefined;
  return (
    <Screen
      footer={
        allCounted ? (
          <Btn title="לסיכום ואיזון" onPress={() => router.push(`/game/${id}/summary`)} disabled={g.unsynced > 0} />
        ) : existing ? undefined : (
          <Row>
            <Btn title="הפסיד הכול" kind="ghost" style={{ flex: 1 }} onPress={() => save(0)} disabled={!cur} />
            <Btn title="שמירה והבא" style={{ flex: 2 }} onPress={() => save(chips)} disabled={!cur || !digits} />
          </Row>
        )
      }
    >
      <KeepAwake />
      <Row style={{ justifyContent: 'space-between' }}>
        <Back label="לשולחן" to={`/game/${id}`} />
        <LivePill live={g.live} unsynced={g.unsynced} />
      </Row>
      <Txt size={26} weight="black">ספירת צ׳יפים</Txt>
      <Num muted size={13}>{`${ils(game.buy_in_ils)} = ${stack.toLocaleString('he-IL')} צ׳יפים`}</Num>
      <ErrorBar text={g.error ? heError({ message: g.error }) : null} onClose={() => g.setError(null)} />
      {tabs}
      {progress}

      {cur && curT && (
        existing ? (
          <Card style={{ alignItems: 'center', gap: 8 }}>
            <Txt weight="bold">{curName}</Txt>
            <Num size={34} weight="black" center>{`${(existing.chips_count ?? 0).toLocaleString('he-IL')} צ׳יפים`}</Num>
            <Num size={20} weight="black" color={C.acc} center>{`= ${ils(existing.amount_ils)}`}</Num>
            <Btn small kind="ghost" title="ספירה מחדש" onPress={() => enqueue({ game_id: id, player_id: cur, type: 'reversal', amount_ils: existing.amount_ils, reverses_entry_id: existing.id })} />
          </Card>
        ) : (
          <>
            <Card style={{ alignItems: 'center', gap: 2 }}>
              <Txt weight="bold">
                {curName}
                <Txt muted>{` · נכנס ${ils(curT.totalIn)}`}</Txt>
              </Txt>
              <Row style={{ alignItems: 'baseline' }}>
                <Num size={48} weight="black">{chips.toLocaleString('he-IL')}</Num>
                <Txt muted>צ׳יפים</Txt>
              </Row>
              <Num size={20} weight="black" color={C.acc} center>{`= ${ils(value)}`}</Num>
            </Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, direction: 'ltr' }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map(k => (
                <Pressable key={k} onPress={() => press(k)} accessibilityLabel={k === 'del' ? 'מחיקה' : k} style={({ pressed }) => ({ width: '31.5%', height: 58, borderRadius: 14, backgroundColor: pressed ? C.raised : C.surf, alignItems: 'center', justifyContent: 'center' })}>
                  <Txt size={24} weight="medium" center>{k === 'del' ? '⌫' : k}</Txt>
                </Pressable>
              ))}
            </View>
          </>
        )
      )}
      {!cur && allCounted && (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Txt muted size={13}>כולם נספרו. הקשה על שחקן לבדיקה או לספירה מחדש.</Txt>
          {g.seats.map(s => {
            const t = g.totals.find(x => x.playerId === s.player_id)!;
            return (
              <Card key={s.player_id} onPress={() => setCur(s.player_id)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }}>
                <Txt weight="bold">{s.display_name}</Txt>
                <Num weight="bold">{ils(t.totalOut)}</Num>
              </Card>
            );
          })}
        </View>
      )}
      {!allCounted && counted.length === 0 && (
        <Btn
          small
          kind="ghost"
          title="חזרה למשחק (ביטול הספירה)"
          style={{ marginTop: 16 }}
          onPress={async () => {
            const { error } = await supabase.from('games').update({ status: 'open' }).eq('id', id);
            if (error) return g.setError(heError(error));
            router.replace(`/game/${id}`);
          }}
        />
      )}
    </Screen>
  );
}
