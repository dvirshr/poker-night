import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, heError } from '../../../lib/supabase';
import { useGame } from '../../../lib/useGame';
import { finishOrder } from '../../../core/clock';
import { minTransfers, potPayouts, tournamentPrizes, type PlayerTotals } from '../../../core/settle';
import { C, ils, medal } from '../../../lib/theme';
import { Screen, Txt, Num, Btn, Card, ErrorBar, LivePill, Row, Back, Loading, Badge, tap } from '../../../ui/kit';
import { PayoutEditor, payoutValid } from '../../../ui/tournament';

export default function Finish() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGame(id);
  const [order, setOrder] = useState<string[] | null>(null); // null = follow the eliminations
  const [payout, setPayout] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (g.game?.status === 'closed') router.replace(`/game/${id}/summary`);
  }, [g.game?.status, id]);

  const auto = useMemo(() => finishOrder(g.seats), [g.seats]);
  // a player added after I reordered still shows up
  const list = order ? [...order.filter(p => auto.includes(p)), ...auto.filter(p => !order.includes(p))] : auto;
  const split = payout ?? g.game?.payout_pct ?? [100];
  const n = g.seats.length;
  const ok = payoutValid(split, n);
  const prizes = ok ? [...tournamentPrizes(g.pot, split, split.map((_, i) => String(i))).values()] : [];
  const prizeOf = (pid: string) => prizes[list.indexOf(pid)] ?? 0;

  // the totals as they will be once the prizes are written
  const final: PlayerTotals[] = g.totals.map(t => ({ ...t, counted: true, totalOut: prizeOf(t.playerId), net: prizeOf(t.playerId) - t.totalIn }));
  const cash = g.game?.settlement_mode === 'cash_on_table';
  const plan = ok
    ? cash
      ? potPayouts(final).map(p => ({ from_player_id: null, to_player_id: p.toPlayerId, amount_ils: p.amountIls, method: 'from_pot' as const }))
      : minTransfers(final).map(t => ({ from_player_id: t.fromPlayerId, to_player_id: t.toPlayerId, amount_ils: t.amountIls, method: 'transfer' as const }))
    : [];

  if (!g.loaded || !g.game) return <Loading />;
  const game = g.game;
  const nameOf = (pid: string | null) => g.seats.find(s => s.player_id === pid)?.display_name ?? '';
  const alive = g.seats.filter(s => !s.eliminated_at).length;
  const move = (i: number, d: -1 | 1) => {
    tap();
    const l = [...list];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    setOrder(l);
  };

  const close = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('close_tournament', { p_game: id, p_order: list, p_payout: split, p_settlements: plan });
    setBusy(false);
    if (error) g.setError(heError(error));
    else router.replace(`/game/${id}/summary`);
  };

  return (
    <Screen footer={g.isBanker ? <Btn title="🏆 אישור וסגירת הטורניר" onPress={close} busy={busy} disabled={!ok || g.unsynced > 0 || n < 2} /> : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back label="לשולחן" to={`/game/${id}`} />
        <LivePill live={g.live} unsynced={g.unsynced} onRefresh={g.reload} />
      </Row>
      <Txt size={26} weight="black">סיום הטורניר</Txt>
      <Txt muted size={13} style={{ marginTop: 4, marginBottom: 12 }}>{`${game.name} · קופה ${ils(g.pot)} · ${n} שחקנים`}</Txt>
      <ErrorBar text={g.error ? heError({ message: g.error }) : null} onClose={() => g.setError(null)} />

      {alive > 1 && (
        <Card style={{ borderWidth: 1, borderColor: C.neg, marginBottom: 12 }}>
          <Txt weight="bold">{`עוד ${alive} שחקנים לא סומנו כמודחים`}</Txt>
          <Txt muted size={13}>אפשר לסגור בכל זאת (למשל חלוקה בהסכמה). סדרו את המקומות עם החיצים.</Txt>
        </Card>
      )}

      <Txt weight="bold" size={16} style={{ marginBottom: 8 }}>מקומות</Txt>
      <View style={{ gap: 6, marginBottom: 16 }}>
        {list.map((pid, i) => {
          const t = g.totals.find(x => x.playerId === pid);
          const prize = prizes[i] ?? 0;
          return (
            <Card key={pid} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
              <Row>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: medal(i + 1), alignItems: 'center', justifyContent: 'center' }}>
                  <Txt weight="black" color={i < 3 ? C.accInk : C.text} center>{String(i + 1)}</Txt>
                </View>
                <View>
                  <Txt weight="bold">{nameOf(pid)}</Txt>
                  <Txt muted size={12}>{`נכנס ${ils(t?.totalIn ?? 0)}${g.seats.find(s => s.player_id === pid)?.eliminated_at ? '' : ' · עדיין במשחק'}`}</Txt>
                </View>
              </Row>
              <Row>
                <View style={{ alignItems: 'flex-end' }}>
                  {prize > 0 && <Num weight="black" color={C.acc}>{ils(prize)}</Num>}
                  <Num size={12} color={prize - (t?.totalIn ?? 0) >= 0 ? C.pos : C.neg}>{ils(prize - (t?.totalIn ?? 0), true)}</Num>
                </View>
                {g.isBanker && (
                  <View style={{ gap: 2 }}>
                    <Pressable hitSlop={6} disabled={i === 0} onPress={() => move(i, -1)} accessibilityLabel={`${nameOf(pid)} למעלה`}>
                      <Txt weight="bold" color={i === 0 ? C.line : C.acc} size={18}>▲</Txt>
                    </Pressable>
                    <Pressable hitSlop={6} disabled={i === list.length - 1} onPress={() => move(i, 1)} accessibilityLabel={`${nameOf(pid)} למטה`}>
                      <Txt weight="bold" color={i === list.length - 1 ? C.line : C.acc} size={18}>▼</Txt>
                    </Pressable>
                  </View>
                )}
              </Row>
            </Card>
          );
        })}
      </View>

      <Txt weight="bold" size={16} style={{ marginBottom: 8 }}>חלוקת הפרסים</Txt>
      {g.isBanker ? (
        <PayoutEditor value={split} onChange={setPayout} players={n} pot={g.pot} />
      ) : (
        <Txt muted>{split.map((p, i) => `מקום ${i + 1}: ${p}%`).join(' · ')}</Txt>
      )}

      {ok && (
        <>
          <Row style={{ justifyContent: 'space-between', marginTop: 18, marginBottom: 8 }}>
            <Txt weight="bold" size={16}>{cash ? 'מי לוקח מהקופה' : `מי מעביר למי · ${plan.length} העברות`}</Txt>
            <Badge text={cash ? 'מזומן' : 'רישום · ביט'} />
          </Row>
          <View style={{ gap: 6 }}>
            {plan.length === 0 && <Txt muted>אין העברות</Txt>}
            {plan.map((s, i) => (
              <Card key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}>
                {cash ? <Txt weight="bold">{nameOf(s.to_player_id)}</Txt> : (
                  <Txt><Txt weight="bold">{nameOf(s.from_player_id)}</Txt><Txt muted>{' מעביר ל'}</Txt><Txt weight="bold">{nameOf(s.to_player_id)}</Txt></Txt>
                )}
                <Num weight="black" size={18}>{ils(s.amount_ils)}</Num>
              </Card>
            ))}
          </View>
        </>
      )}
      <Txt muted size={12} style={{ marginTop: 12 }}>{g.isBanker ? 'בסגירה נרשמים המקומות והפרסים ביומן, והטורניר ננעל.' : 'הבנקאי סוגר את הטורניר'}</Txt>
    </Screen>
  );
}
