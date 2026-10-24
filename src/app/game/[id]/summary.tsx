import { useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase, heError } from '../../../lib/supabase';
import { enqueue } from '../../../lib/queue';
import { useGame, type Settlement } from '../../../lib/useGame';
import { minTransfers, potPayouts, proportionalAdjustments } from '../../../core/settle';
import { C, ils, medal } from '../../../lib/theme';
import { Screen, Txt, Num, Btn, Card, ErrorBar, LivePill, Row, Back, Badge, Loading, RefreshBtn, ConfirmBtn } from '../../../ui/kit';
import { Fireworks } from '../../../ui/Fireworks';

const CELEBRATED = 'poker.celebrated.v1';
const wasCelebrated = (id: string) => {
  try { return (JSON.parse(localStorage.getItem(CELEBRATED) ?? '[]') as string[]).includes(id); } catch { return false; }
};
const markCelebrated = (id: string) => {
  try {
    const l = JSON.parse(localStorage.getItem(CELEBRATED) ?? '[]') as string[];
    localStorage.setItem(CELEBRATED, JSON.stringify([...l.slice(-50), id]));
  } catch { /* ignore */ }
};

export default function Summary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGame(id);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [copied, setCopied] = useState(false);

  const game = g.game;
  const closed = game?.status === 'closed';
  const tour = game?.game_type === 'tournament';
  useEffect(() => {
    if (tour && !closed) router.replace(`/game/${id}/finish`); // an open tournament closes from the finish screen
  }, [tour, closed, id]);
  useEffect(() => {
    if (closed && !wasCelebrated(id)) {
      markCelebrated(id);
      setCelebrate(true);
    }
  }, [closed, id]);

  const nameOf = (pid: string | null) => g.seats.find(s => s.player_id === pid)?.display_name ?? '';
  const placeOf = (pid: string) => g.seats.find(s => s.player_id === pid)?.finish_place ?? 99;
  const ranked = useMemo(
    () => [...g.totals].sort((a, b) => (tour ? placeOf(a.playerId) - placeOf(b.playerId) : 0) || b.net - a.net || nameOf(a.playerId).localeCompare(nameOf(b.playerId), 'he')),
    [g.totals, g.seats, tour], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const allCounted = g.totals.length > 0 && g.totals.every(t => t.counted);

  // settlements: from the server once closed, otherwise the preview the close will write
  const plan: Settlement[] = useMemo(() => {
    if (closed) return g.settlements;
    if (!game || !allCounted || g.gap !== 0) return [];
    return game.settlement_mode === 'cash_on_table'
      ? potPayouts(g.totals).map(p => ({ from_player_id: null, to_player_id: p.toPlayerId, amount_ils: p.amountIls, method: 'from_pot' as const }))
      : minTransfers(g.totals).map(t => ({ from_player_id: t.fromPlayerId, to_player_id: t.toPlayerId, amount_ils: t.amountIls, method: 'transfer' as const }));
  }, [closed, g.settlements, game, allCounted, g.gap, g.totals]);

  if (!g.loaded || !game) return <Loading />;
  const cash = game.settlement_mode === 'cash_on_table';
  const podium = (tour ? ranked.filter(t => t.totalOut > 0) : ranked.filter(t => t.net > 0)).slice(0, 3);
  const rest = ranked.filter(t => !podium.includes(t));
  const mine = g.mySeat?.player_id;

  const shareText = () => {
    const lines = [`${tour ? '🏆 טורניר' : '🃏 סגירת חשבון'} – ${game.name}`, `קופה: ${ils(g.pot)}`, ''];
    podium.forEach((t, i) => lines.push(`${['🥇', '🥈', '🥉'][i]} ${nameOf(t.playerId)} ${tour ? `פרס ${ils(t.totalOut)} (${ils(t.net, true)})` : ils(t.net, true)}`));
    rest.forEach(t => lines.push(`• ${tour ? `${placeOf(t.playerId)}. ` : ''}${nameOf(t.playerId)} ${ils(t.net, true)}`));
    lines.push('', cash ? 'חלוקת הקופה:' : 'העברות:');
    plan.forEach(s => lines.push(cash ? `• ${nameOf(s.to_player_id)} לוקח ${ils(s.amount_ils)}` : `• ${nameOf(s.from_player_id)} ← ${nameOf(s.to_player_id)}: ${ils(s.amount_ils)}`));
    return lines.join('\n');
  };

  const close = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('close_game', { p_game: id, p_settlements: plan });
    setBusy(false);
    if (error) g.setError(heError(error));
    else void g.reload();
  };

  const balance = () => {
    for (const [pid, amt] of proportionalAdjustments(g.totals)) {
      enqueue({ game_id: id, player_id: pid, type: 'adjustment', amount_ils: amt, note: 'איזון יחסי' });
    }
  };

  const myLine = (() => {
    if (!mine) return null;
    if (cash) {
      const s = plan.find(p => p.to_player_id === mine);
      return s ? `לוקח מהקופה ${ils(s.amount_ils)}` : 'לא לוקח מהקופה';
    }
    const out = plan.filter(p => p.from_player_id === mine).map(p => `מעביר ל${nameOf(p.to_player_id)} ${ils(p.amount_ils)}`);
    const inn = plan.filter(p => p.to_player_id === mine).map(p => `מקבל מ${nameOf(p.from_player_id)} ${ils(p.amount_ils)}`);
    return [...out, ...inn].join(' · ') || 'אין העברות';
  })();

  // ---------- footer ----------
  let footer: React.ReactNode;
  if (closed) {
    footer = (
      <Row>
        <Btn small kind="ghost" title={copied ? 'הועתק ✓' : 'העתקה'} style={{ flex: 1 }} onPress={async () => { await Clipboard.setStringAsync(shareText()); setCopied(true); }} />
        <Btn small kind="ghost" title="שיתוף בוואטסאפ" style={{ flex: 2 }} onPress={() => Share.share({ message: shareText() })} />
      </Row>
    );
  } else if (g.isBanker && allCounted && g.gap === 0) {
    footer = <ConfirmBtn title="אישור וסגירת הערב" onConfirm={close} busy={busy} disabled={g.unsynced > 0}
      confirmTitle="לסגור את הערב?" message={`קופה ${ils(g.pot)} · ${plan.length} ${cash ? 'תשלומים מהקופה' : 'העברות'}.\n\nאחרי הסגירה הערב ננעל ואי אפשר לשנות אותו.`} />;
  }

  return (
    <Screen footer={footer}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back label={closed ? 'הקבוצה' : 'לספירה'} to={closed ? `/group/${game.group_id}` : `/game/${id}/count`} />
        {!closed ? <LivePill live={g.live} unsynced={g.unsynced} onRefresh={g.reload} /> : <RefreshBtn onPress={g.reload} />}
      </Row>
      <Txt size={26} weight="black">{tour ? '🏆 תוצאות הטורניר' : cash ? 'חלוקת הקופה' : 'סגירת חשבון'}</Txt>
      <Row style={{ marginTop: 4, marginBottom: 12 }}>
        <Txt muted size={13}>{`${game.name} · קופה ${ils(g.pot)} · `}</Txt>
        {g.gap === 0 && allCounted ? <Txt size={13} color={C.pos}>✓ מאוזנת</Txt> : <Txt size={13} color={C.neg}>לא מאוזנת</Txt>}
      </Row>
      <ErrorBar text={g.error ? heError({ message: g.error }) : null} onClose={() => g.setError(null)} />

      {!closed && !allCounted && (
        <Card><Txt>עוד לא כל השחקנים נספרו</Txt></Card>
      )}

      {!closed && allCounted && g.gap !== 0 && (
        <Card style={{ borderWidth: 1, borderColor: C.neg, gap: 10 }}>
          <Txt weight="bold" size={17}>{g.gap > 0 ? `נספר ${ils(g.gap)} יותר מהקופה` : `חסרים ${ils(-g.gap)} בספירה`}</Txt>
          {g.isBanker ? (
            <>
              <Txt muted size={13}>איזון יחסי: כל יציאה מוכפלת באותו יחס, מעוגל לשקל, ונרשם ביומן כשורת איזון.</Txt>
              <Btn small title="איזון יחסי" onPress={balance} disabled={g.unsynced > 0} />
              <Btn small kind="ghost" title="חזרה לספירה" onPress={() => router.replace(`/game/${id}/count`)} />
            </>
          ) : (
            <Txt muted size={13}>הבנקאי מטפל בפער</Txt>
          )}
        </Card>
      )}

      {(closed || (allCounted && g.gap === 0)) && (
        <>
          {!closed && <Txt muted size={13} style={{ marginBottom: 6 }}>{g.isBanker ? 'בדוק ואשר. אחרי הסגירה הערב ננעל.' : 'ממתין לאישור הבנקאי'}</Txt>}
          <View style={{ position: 'relative' }}>
            <Fireworks play={celebrate} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 20, borderBottomWidth: 1, borderBottomColor: C.line }}>
              {[1, 0, 2].map(i => {
                const t = podium[i];
                if (!t) return <View key={i} style={{ flex: 1 }} />;
                const h = [92, 64, 48][i];
                return (
                  <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                    <Txt weight="bold" center>{nameOf(t.playerId)}{t.playerId === mine ? ' · אני' : ''}</Txt>
                    {tour && <Num weight="black" color={C.acc} center>{ils(t.totalOut)}</Num>}
                    <Num weight={tour ? 'regular' : 'black'} size={tour ? 12 : 15} color={t.net >= 0 ? C.pos : C.neg} center>{ils(t.net, true)}</Num>
                    <View style={{ width: '100%', height: h, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: medal(i + 1), alignItems: 'center', justifyContent: 'center' }}>
                      <Txt size={24} weight="black" color={C.accInk} center>{String(i + 1)}</Txt>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          <View style={{ paddingVertical: 8 }}>
            {rest.map(t => (
              <Row key={t.playerId} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <Txt>{tour ? `${placeOf(t.playerId)}. ` : ''}{nameOf(t.playerId)}{t.playerId === mine ? ' · אני' : ''}</Txt>
                <Num weight="bold" color={t.net < 0 ? C.neg : C.muted}>{ils(t.net, true)}</Num>
              </Row>
            ))}
          </View>

          {myLine && (
            <Card accent style={{ marginBottom: 12 }}>
              <Txt muted size={13}>אני</Txt>
              <Txt weight="bold" size={16}>{myLine}</Txt>
            </Card>
          )}

          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Txt weight="bold" size={16}>{cash ? 'כמה כל אחד לוקח מהקופה' : `מי מעביר למי · ${plan.length} העברות`}</Txt>
            <Badge text={cash ? 'מזומן' : 'רישום · ביט'} />
          </Row>
          <View style={{ gap: 6 }}>
            {plan.length === 0 && <Txt muted>אין העברות</Txt>}
            {plan.map((s, i) => {
              const me = s.from_player_id === mine || s.to_player_id === mine;
              return (
                <Card key={i} accent={me} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}>
                  {cash ? (
                    <Txt weight="bold">{nameOf(s.to_player_id)}</Txt>
                  ) : (
                    <Txt>
                      <Txt weight="bold">{nameOf(s.from_player_id)}</Txt>
                      <Txt muted>{' מעביר ל'}</Txt>
                      <Txt weight="bold">{nameOf(s.to_player_id)}</Txt>
                    </Txt>
                  )}
                  <Num weight="black" size={18}>{ils(s.amount_ils)}</Num>
                </Card>
              );
            })}
          </View>
          {closed && <Txt muted size={12} style={{ marginTop: 10 }}>רישום בלבד. התשלומים עצמם באחריות השחקנים.</Txt>}
          <Btn small kind="ghost" title="📜 יומן הערב המלא" style={{ marginTop: 12 }} onPress={() => router.push(`/game/${id}/log`)} />
        </>
      )}
    </Screen>
  );
}
