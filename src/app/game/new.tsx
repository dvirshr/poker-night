import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, heError } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { C, ils } from '../../lib/theme';
import { Screen, H1, Card, Txt, Num, Btn, Field, Seg, ErrorBar, Row, Back, tap } from '../../ui/kit';

type Player = { id: string; display_name: string; profile_id: string | null; role: string };
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export default function NewGame() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const { userId } = useAuth();
  const [mode, setMode] = useState<'opener_is_banker' | 'admin_assigns'>('opener_is_banker');
  const [players, setPlayers] = useState<Player[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState(`ערב ${DAYS[new Date().getDay()]}`);
  const [buyIn, setBuyIn] = useState(120);
  const [custom, setCustom] = useState('');
  const [chipsPerBuyIn, setChipsPerBuyIn] = useState('');
  const [settle, setSettle] = useState<'ledger' | 'cash_on_table'>('ledger');
  const [policy, setPolicy] = useState<'all_night' | 'none'>('all_night');
  const [maxRebuys, setMaxRebuys] = useState(3);
  const [banker, setBanker] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [g, p] = await Promise.all([
        supabase.from('groups').select('banker_mode').eq('id', group).single(),
        supabase.from('players').select('id, display_name, profile_id, role').eq('group_id', group).eq('status', 'active').order('display_name'),
      ]);
      if (g.data) setMode(g.data.banker_mode);
      const list = (p.data ?? []) as Player[];
      setPlayers(list);
      setPicked(list.filter(x => x.profile_id === userId).map(x => x.id));
      setBanker(userId ?? '');
    })();
  }, [group, userId]);

  const amount = custom ? parseInt(custom, 10) || 0 : buyIn;
  const stack = parseInt(chipsPerBuyIn, 10) || amount * 10;
  const quick = useMemo(() => [...new Set([Math.round(amount / 2), amount, amount * 2])].filter(n => n > 0), [amount]);
  const accounts = players.filter(p => p.profile_id);
  const ok = amount > 0 && picked.length >= 2 && name.trim().length > 0;

  const toggle = (id: string) => {
    tap();
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  };

  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      // 1. the game, with me as banker for the setup
      const g = await supabase
        .from('games')
        .insert({
          group_id: group, name: name.trim(), buy_in_ils: amount, start_stack_chips: stack, settlement_mode: settle,
          rebuy_policy: policy, max_rebuys: maxRebuys, quick_rebuys: quick, banker_profile_id: userId,
        })
        .select('id')
        .single();
      if (g.error) throw g.error;
      const gameId = g.data.id as string;
      // 2. seats
      const ordered = players.filter(p => picked.includes(p.id));
      const s = await supabase.from('game_players').insert(ordered.map((p, i) => ({ game_id: gameId, player_id: p.id, seat_no: i + 1 })));
      if (s.error) throw s.error;
      // 3. everyone's first buy-in
      const b = await supabase.from('ledger_entries').insert(ordered.map(p => ({ game_id: gameId, player_id: p.id, type: 'buy_in', amount_ils: amount })));
      if (b.error) throw b.error;
      // 4. hand the bank over if the admin picked someone else
      if (mode === 'admin_assigns' && banker && banker !== userId) {
        const h = await supabase.from('games').update({ banker_profile_id: banker }).eq('id', gameId);
        if (h.error) throw h.error;
      }
      router.replace(`/game/${gameId}`);
    } catch (e) {
      setErr(heError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Btn title={`פותחים שולחן · ${picked.length === 1 ? 'שחקן אחד' : `${picked.length} שחקנים`}`} onPress={open} disabled={!ok} busy={busy} />}>
      <Back />
      <H1 sub="קאש · כל שחקן נכנס עם הסכום שנקבע">ערב חדש</H1>
      <ErrorBar text={err} onClose={() => setErr(null)} />

      <Field label="שם הערב" value={name} onChangeText={setName} maxLength={40} />

      <Seg
        label="סכום כניסה"
        value={custom ? -1 : buyIn}
        onChange={v => { setCustom(''); if (v > 0) setBuyIn(v); }}
        options={[50, 100, 120, 150, 200, 300].map(v => ({ v, t: `${v} ₪` }))}
      />
      <Field label="או סכום אחר (₪)" value={custom} onChangeText={t => setCustom(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="למשל 80" />
      <Field
        label={`צ׳יפים לכל כניסה (ברירת מחדל ${(amount * 10).toLocaleString('he-IL')})`}
        value={chipsPerBuyIn}
        onChangeText={t => setChipsPerBuyIn(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder={String(amount * 10)}
      />
      <Txt muted size={12} style={{ marginTop: -8, marginBottom: 14 }}>{`${stack.toLocaleString('he-IL')} צ׳יפים = ${ils(amount)}`}</Txt>

      <Seg
        label="התחשבנות בסוף"
        value={settle}
        onChange={setSettle}
        options={[{ v: 'ledger', t: 'רישום בלבד · העברות בביט' }, { v: 'cash_on_table', t: 'מזומן על השולחן' }]}
      />
      <Seg label="כניסות חוזרות" value={policy} onChange={setPolicy} options={[{ v: 'all_night', t: 'כל הערב' }, { v: 'none', t: 'בלי' }]} />
      {policy === 'all_night' && (
        <Seg label="מקסימום ריבאיים לשחקן" value={maxRebuys} onChange={setMaxRebuys} options={[3, 4, 5, 6, 7].map(v => ({ v, t: String(v) }))} />
      )}

      {mode === 'admin_assigns' && accounts.length > 0 && (
        <Seg label="בנקאי הערב" value={banker} onChange={setBanker} options={accounts.map(p => ({ v: p.profile_id!, t: p.display_name }))} />
      )}

      <Row style={{ justifyContent: 'space-between', marginTop: 6, marginBottom: 10 }}>
        <Txt weight="bold" size={16}>מי משחק</Txt>
        <Num muted size={13}>{`${picked.length} מתוך ${players.length}`}</Num>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {players.map(p => {
          const on = picked.includes(p.id);
          return (
            <Pressable key={p.id} onPress={() => toggle(p.id)} style={{ height: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: on ? C.acc : C.line, backgroundColor: on ? C.raised : 'transparent', justifyContent: 'center' }}>
              <Txt weight="bold" color={on ? C.text : C.muted}>{`${on ? '✓ ' : ''}${p.display_name}`}</Txt>
            </Pressable>
          );
        })}
      </View>
      {players.length < 2 && (
        <Card style={{ marginTop: 12 }}>
          <Txt muted size={13}>צריך לפחות 2 שחקנים. אפשר להוסיף אורחים בעמוד הקבוצה, בלשונית "שחקנים".</Txt>
        </Card>
      )}
    </Screen>
  );
}
