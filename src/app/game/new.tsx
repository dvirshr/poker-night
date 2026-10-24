import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, heError } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { C, ils } from '../../lib/theme';
import { Screen, H1, Card, Txt, Num, Btn, Field, Seg, ErrorBar, Row, Back, tap } from '../../ui/kit';
import { BlindEditor, PayoutEditor, levelsValid, payoutValid } from '../../ui/tournament';
import { makeStructure, suggestedPayout, type Level } from '../../core/clock';
import { nextHost } from '../../core/hosting';

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
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [type, setType] = useState<'cash' | 'tournament'>('cash');
  const [levels, setLevels] = useState<Level[]>(() => makeStructure(25, 15, 12));
  const [payout, setPayout] = useState<number[] | null>(null); // null = follow the number of players
  const [tStack, setTStack] = useState('5000');
  const [hosting, setHosting] = useState<{ on: boolean; rotation: string[] }>({ on: false, rotation: [] });
  const [host, setHost] = useState<string>(''); // '' = no host

  useEffect(() => {
    (async () => {
      const [g, p] = await Promise.all([
        supabase.from('groups').select('*').eq('id', group).single(),
        supabase.from('players').select('id, display_name, profile_id, role').eq('group_id', group).eq('status', 'active').order('display_name'),
      ]);
      if (g.data) setMode(g.data.banker_mode);
      // hosting rotation: tonight's host = next in turn
      if (g.data?.hosting_enabled) {
        const rot = ((g.data.host_rotation ?? []) as string[]);
        setHosting({ on: true, rotation: rot });
        const past = await supabase.from('games').select('id, played_on, created_at, host_player_id').eq('group_id', group);
        const nx = nextHost(rot.filter(pid => (p.data ?? []).some((x: { id: string }) => x.id === pid)),
          ((past.data ?? []) as { id: string; played_on: string; created_at: string; host_player_id: string | null }[])
            .map(r => ({ gameId: r.id, playedOn: r.played_on, createdAt: r.created_at, hostId: r.host_player_id })));
        if (nx) setHost(nx);
      }
      const list = (p.data ?? []) as Player[];
      setPlayers(list);
      setPicked(list.filter(x => x.profile_id === userId).map(x => x.id));
      setBanker(userId ?? '');

      // same as last time: settings and players of the group's previous game
      const last = await supabase
        .from('games')
        .select('id, name, played_on, game_type, buy_in_ils, start_stack_chips, settlement_mode, rebuy_policy, max_rebuys')
        .eq('group_id', group)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last.data) {
        const L = last.data as any;
        if ([50, 100, 120, 150, 200, 300].includes(L.buy_in_ils)) setBuyIn(L.buy_in_ils);
        else setCustom(String(L.buy_in_ils));
        setType(L.game_type);
        if (L.game_type === 'cash' && L.start_stack_chips && L.start_stack_chips !== L.buy_in_ils * 10) setChipsPerBuyIn(String(L.start_stack_chips));
        setSettle(L.settlement_mode);
        setPolicy(L.rebuy_policy === 'none' ? 'none' : 'all_night');
        setMaxRebuys(L.max_rebuys);
        const seats = await supabase.from('game_players').select('player_id').eq('game_id', L.id);
        const ids = new Set((seats.data ?? []).map((r: { player_id: string }) => r.player_id));
        const again = list.filter(x => ids.has(x.id) || x.profile_id === userId).map(x => x.id);
        if (again.length) setPicked(again);
        setCopiedFrom(new Date(L.played_on).toLocaleDateString('he-IL'));
      }
      // tournament settings from the group's last tournament (even if the last game was cash)
      const lt = await supabase.from('games').select('id, start_stack_chips, payout_pct').eq('group_id', group).eq('game_type', 'tournament')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (lt.data) {
        const T = lt.data as { id: string; start_stack_chips: number | null; payout_pct: number[] | null };
        if (T.start_stack_chips) setTStack(String(T.start_stack_chips));
        if (T.payout_pct) setPayout(T.payout_pct);
        const bl = await supabase.from('blind_levels').select('level_no, small_blind, big_blind, duration_min').eq('game_id', T.id).order('level_no');
        if (bl.data?.length) setLevels(bl.data as Level[]);
      }
    })();
  }, [group, userId]);

  const amount = custom ? parseInt(custom, 10) || 0 : buyIn;
  const tour = type === 'tournament';
  const stack = tour ? parseInt(tStack, 10) || 0 : parseInt(chipsPerBuyIn, 10) || amount * 10;
  const split = payout ?? suggestedPayout(picked.length);
  const quick = useMemo(() => [...new Set([Math.round(amount / 2), amount, amount * 2])].filter(n => n > 0), [amount]);
  const accounts = players.filter(p => p.profile_id);
  const ok = amount > 0 && picked.length >= 2 && name.trim().length > 0
    && (!tour || (stack > 0 && levelsValid(levels) && payoutValid(split, picked.length)));

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
          group_id: group, name: name.trim(), game_type: type, buy_in_ils: amount, start_stack_chips: stack, settlement_mode: settle,
          rebuy_policy: policy, max_rebuys: maxRebuys, quick_rebuys: tour ? [amount] : quick, banker_profile_id: userId,
          payout_pct: tour ? split : null,
          ...(hosting.on && host ? { host_player_id: host } : {}),
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
      // 3b. blind structure (while I am still the banker)
      if (tour) {
        const bl = await supabase.from('blind_levels').insert(levels.map((l, i) => ({ game_id: gameId, level_no: i + 1, small_blind: l.small_blind, big_blind: l.big_blind, duration_min: l.duration_min })));
        if (bl.error) throw bl.error;
      }
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
      <H1 sub={tour ? 'טורניר · כולם מתחילים עם אותה כמות צ׳יפים, הפרסים לפי מקומות' : 'קאש · כל שחקן נכנס עם הסכום שנקבע'}>ערב חדש</H1>
      <Seg label="סוג משחק" value={type} onChange={setType} options={[{ v: 'cash', t: '💵 קאש' }, { v: 'tournament', t: '🏆 טורניר' }]} />
      {copiedFrom && (
        <Card style={{ marginBottom: 12, paddingVertical: 10 }}>
          <Txt size={13}>{`↻ מוגדר כמו הערב הקודם (${copiedFrom}): אותם שחקנים, כניסה והגדרות. אפשר לשנות.`}</Txt>
        </Card>
      )}
      <ErrorBar text={err} onClose={() => setErr(null)} />

      <Field label="שם הערב" value={name} onChangeText={setName} maxLength={40} />

      <Seg
        label="סכום כניסה"
        value={custom ? -1 : buyIn}
        onChange={v => { setCustom(''); if (v > 0) setBuyIn(v); }}
        options={[50, 100, 120, 150, 200, 300].map(v => ({ v, t: `${v} ₪` }))}
      />
      <Field label="או סכום אחר (₪)" value={custom} onChangeText={t => setCustom(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="למשל 80" />
      {tour ? (
        <Field label="צ׳יפים בתחילת הטורניר (וגם בכל ריבאי)" value={tStack} onChangeText={t => setTStack(t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="5000" />
      ) : (
        <>
          <Field
            label={`צ׳יפים לכל כניסה (ברירת מחדל ${(amount * 10).toLocaleString('he-IL')})`}
            value={chipsPerBuyIn}
            onChangeText={t => setChipsPerBuyIn(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder={String(amount * 10)}
          />
          <Txt muted size={12} style={{ marginTop: -8, marginBottom: 14 }}>{`${stack.toLocaleString('he-IL')} צ׳יפים = ${ils(amount)}`}</Txt>
        </>
      )}

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

      {tour && (
        <>
          <Txt weight="bold" size={16} style={{ marginTop: 6, marginBottom: 8 }}>חלוקת פרסים</Txt>
          <Txt muted size={12} style={{ marginBottom: 8 }}>אפשר לשנות גם בסוף, לפני הסגירה</Txt>
          <PayoutEditor value={split} onChange={setPayout} players={Math.max(picked.length, 1)} pot={amount * picked.length} />
          <Txt weight="bold" size={16} style={{ marginTop: 18, marginBottom: 8 }}>מבנה בליינדים</Txt>
          <BlindEditor levels={levels} onChange={setLevels} />
          <View style={{ height: 18 }} />
        </>
      )}

      {hosting.on && (
        <Seg
          label="🏠 מארח הערב"
          value={host}
          onChange={setHost}
          options={[
            ...[...hosting.rotation.filter(pid => players.some(p => p.id === pid)), ...players.filter(p => !hosting.rotation.includes(p.id)).map(p => p.id)]
              .map(pid => ({ v: pid, t: players.find(p => p.id === pid)!.display_name })),
            { v: '', t: 'בלי מארח' },
          ]}
        />
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
