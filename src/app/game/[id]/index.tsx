import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { supabase, heError } from '../../../lib/supabase';
import { enqueue } from '../../../lib/queue';
import { useGame, type Row as Entry } from '../../../lib/useGame';
import { chipsToIls } from '../../../core/settle';
import { C, ils } from '../../../lib/theme';
import { Screen, Txt, Num, Btn, Card, Field, ErrorBar, LivePill, Badge, Row, Back, Loading, tap } from '../../../ui/kit';
import { ClockBar } from '../../../ui/tournament';
import { useAlertPref, useBlindAlertsSync } from '../../../lib/useClock';
import { tournamentPrizes } from '../../../core/settle';

const SEAT_W = 92;
const SEAT_H = 58;

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק׳` : `לפני ${Math.floor(m / 60)} שע׳`;
}
const typeLabel: Record<Entry['type'], string> = { buy_in: 'כניסה', rebuy: 'כניסה חוזרת', cash_out: 'ספירה', reversal: 'ביטול', adjustment: 'איזון' };

function KeepAwake() {
  useKeepAwake();
  return null;
}

export default function Table() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGame(id);
  const [width, setWidth] = useState(0);
  const [sheet, setSheet] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [handing, setHanding] = useState(false);
  const alerts = useAlertPref(id, g.isBanker);
  useBlindAlertsSync(g.game, g.levels, alerts.on);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const game = g.game;
  useEffect(() => {
    if (!game) return;
    if (game.status === 'closed') router.replace(`/game/${id}/summary`);
  }, [game, id]);

  const last = useMemo(() => {
    const reversed = new Set(g.rows.filter(r => r.type === 'reversal').map(r => r.reverses_entry_id));
    return [...g.rows].reverse().find(r => (r.type === 'rebuy' || r.type === 'buy_in') && !reversed.has(r.id));
  }, [g.rows]);

  if (!g.loaded || !game) return <Loading />;

  const nameOf = (pid: string) => g.seats.find(s => s.player_id === pid)?.display_name ?? '';
  const tot = (pid: string) => g.totals.find(t => t.playerId === pid)!;
  const n = g.seats.length;
  const oval = n <= 10 && width > 0;
  const W = width;
  const H = Math.round(W * 1.2);
  const pos = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const rx = W / 2 - SEAT_W / 2 - 2;
    const ry = H / 2 - SEAT_H / 2 - 2;
    return { left: W / 2 + rx * Math.cos(a) - SEAT_W / 2, top: H / 2 + ry * Math.sin(a) - SEAT_H / 2 };
  };
  const me = g.mySeat ? tot(g.mySeat.player_id) : null;
  const rebuysLeft = (pid: string) => (game.rebuy_policy === 'none' ? 0 : game.max_rebuys - tot(pid).rebuys);

  const seatCard = (pid: string, style: object) => {
    const s = g.seats.find(x => x.player_id === pid)!;
    const t = tot(pid);
    const mine = g.mySeat?.player_id === pid;
    const isBankerSeat = s.profile_id === game.banker_profile_id;
    const gone = t.counted || out(pid);
    return (
      <Pressable
        key={pid}
        disabled={!g.isBanker}
        onPress={() => { tap(); setSheet(pid); }}
        accessibilityLabel={`${s.display_name}, ${ils(t.totalIn)}`}
        style={[{ width: SEAT_W, height: SEAT_H, borderRadius: 14, backgroundColor: mine ? C.raised : C.surf, borderWidth: mine ? 2.5 : 1.5, borderColor: mine ? C.acc : C.line, alignItems: 'center', justifyContent: 'center', gap: 2, opacity: gone ? 0.55 : 1, borderStyle: gone ? 'dashed' : 'solid' }, style]}
      >
        <Row style={{ gap: 4 }}>
          <Txt weight="bold" size={14}>{s.display_name}</Txt>
          {t.rebuys > 0 && <Badge text={`×${t.rebuys + 1}`} />}
        </Row>
        <Row style={{ gap: 4 }}>
          <Num muted size={12}>{out(pid) ? 'בחוץ' : t.counted ? `יצא · ${ils(t.totalOut)}` : ils(t.totalIn)}</Num>
          {mine && <Badge solid text="אני" />}
          {!mine && isBankerSeat && <Badge text="בנקאי" />}
        </Row>
      </Pressable>
    );
  };

  const counting = game.status === 'counting';
  const tour = game.game_type === 'tournament';
  const out = (pid: string) => tour && !!g.seats.find(s => s.player_id === pid)?.eliminated_at;
  const alive = g.seats.filter(s => !s.eliminated_at).length;
  const split = game.payout_pct ?? [100];
  const prizes = tour && split.length <= Math.max(n, 1) ? [...tournamentPrizes(g.pot, split, split.map((_, i) => String(i))).values()] : [];
  const setOut = async (pid: string, v: boolean) => {
    const { error } = await supabase.from('game_players').update({ eliminated_at: v ? new Date().toISOString() : null }).eq('game_id', id).eq('player_id', pid);
    if (error) return g.setError(heError(error));
    setSheet(null);
    void g.reload();
  };

  return (
    <Screen
      footer={
        g.isBanker ? (
          tour ? (
            <Row>
              <Btn title="+ שחקן" kind="ghost" style={{ flex: 1 }} onPress={() => setAdding(true)} />
              <Btn title="🏆 סיום הטורניר" kind={alive <= 1 ? 'primary' : 'ghost'} style={{ flex: 2 }} disabled={g.unsynced > 0} onPress={() => router.push(`/game/${id}/finish`)} />
            </Row>
          ) : counting ? (
            <Btn title="להמשך הספירה" onPress={() => router.push(`/game/${id}/count`)} />
          ) : (
            <Row>
              <Btn title="+ שחקן" kind="ghost" style={{ flex: 1 }} onPress={() => setAdding(true)} />
              <Btn
                title="סוגרים חשבון"
                style={{ flex: 2 }}
                disabled={g.unsynced > 0}
                onPress={async () => {
                  const { error } = await supabase.from('games').update({ status: 'counting' }).eq('id', id);
                  if (error) return g.setError(heError(error));
                  router.push(`/game/${id}/count`);
                }}
              />
            </Row>
          )
        ) : tour ? (
          <Btn title="⏱ שעון הבליינדים" kind="ghost" onPress={() => router.push(`/game/${id}/clock`)} />
        ) : counting ? (
          <Btn title="לצפייה בספירה" kind="ghost" onPress={() => router.push(`/game/${id}/count`)} />
        ) : undefined
      }
    >
      {g.isBanker && <KeepAwake />}
      <Back label="הקבוצה" to={`/group/${game.group_id}`} />
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Txt size={26} weight="black">{game.name}</Txt>
          <Txt muted size={13}>
            {`${tour ? '🏆 טורניר · ' : ''}${game.settlement_mode === 'cash_on_table' ? 'מזומן על השולחן' : 'רישום · ביט'} · כניסה ${ils(game.buy_in_ils)}${game.rebuy_policy === 'none' ? ' · בלי ריבאיים' : ` · עד ${game.max_rebuys} ריבאיים`}`}
          </Txt>
          <Txt muted size={13}>{g.isBanker ? 'אתה הבנקאי' : `צפייה · בנקאי: ${g.seats.find(s => s.profile_id === game.banker_profile_id)?.display_name ?? '—'}`}</Txt>
        </View>
        <LivePill live={g.live} unsynced={g.unsynced} onRefresh={g.reload} />
      </Row>
      <ErrorBar text={g.error ? heError({ message: g.error }) : null} onClose={() => g.setError(null)} />
      {tour && <ClockBar game={game} levels={g.levels} />}
      {tour && (
        <Card style={{ marginBottom: 8, paddingVertical: 10, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt weight="bold">{alive <= 1 && n > 1 ? '🏆 יש מנצח! אפשר לסיים את הטורניר' : `נשארו ${alive} מתוך ${n}`}</Txt>
            <Txt muted size={12}>{`${split.length} מקומות בפרסים`}</Txt>
          </Row>
          {prizes.length > 0 && <Txt muted size={13}>{prizes.map((p, i) => `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${ils(p)}`).join('   ')}</Txt>}
        </Card>
      )}
      {counting && (
        <Card style={{ marginBottom: 10 }}>
          <Txt weight="bold">הספירה התחילה</Txt>
          <Txt muted size={13}>אי אפשר להוסיף כניסות בשלב הזה</Txt>
        </Card>
      )}
      {last && (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 6 }}>
          <Txt size={13}>
            <Txt size={13} weight="bold">{nameOf(last.player_id)}</Txt>
            {` ${last.type === 'rebuy' ? 'נכנס שוב' : 'נכנס'} · `}
            <Txt size={13} weight="bold" color={C.acc}>{`+${last.amount_ils} ₪`}</Txt>
          </Txt>
          <Txt muted size={12}>{last.pending ? 'שומר…' : ago(last.created_at)}</Txt>
        </Card>
      )}

      <View onLayout={e => setWidth(Math.min(e.nativeEvent.layout.width, 440))} style={{ width: '100%', alignItems: 'center' }}>
        {oval ? (
          <View style={{ width: W, height: H, marginVertical: 8 }}>
            <View style={{ position: 'absolute', left: W * 0.22, top: H * 0.12, width: W * 0.56, height: H * 0.76, borderRadius: W, backgroundColor: g.felt.felt, borderWidth: 10, borderColor: g.felt.rail, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Txt muted size={13} center>קופה</Txt>
              <Num size={36} weight="black" color={C.acc} center>{ils(g.pot)}</Num>
              <Txt muted size={12} center>{`${g.totals.reduce((s, t) => s + 1 + t.rebuys, 0)} כניסות`}</Txt>
            </View>
            {g.seats.map((s, i) => seatCard(s.player_id, { position: 'absolute', ...pos(i) }))}
          </View>
        ) : width > 0 ? (
          <View style={{ width: '100%', gap: 10 }}>
            <Card style={{ alignItems: 'center', backgroundColor: g.felt.felt }}>
              <Txt muted size={13} center>קופה</Txt>
              <Num size={36} weight="black" color={C.acc} center>{ils(g.pot)}</Num>
            </Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {g.seats.map(s => seatCard(s.player_id, {}))}
            </View>
          </View>
        ) : null}
      </View>

      {!g.isBanker && me && (
        <Card accent style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ gap: 4 }}>
            <Txt muted size={13}>המצב שלי</Txt>
            <Txt weight="bold" size={17}>{tour ? (out(me.playerId) ? `בחוץ · נכנסתי ${ils(me.totalIn)}` : `במשחק · נכנסתי ${ils(me.totalIn)}`) : me.counted ? `יצאתי עם ${ils(me.totalOut)} · ${ils(me.net, true)}` : `נכנסתי ${ils(me.totalIn)} · ${me.rebuys + 1} כניסות`}</Txt>
          </View>
          {game.rebuy_policy !== 'none' && <Txt muted size={12}>{`נשארו ${Math.max(0, rebuysLeft(me.playerId))} ריבאיים`}</Txt>}
        </Card>
      )}
      {g.isBanker && !counting && <Txt muted size={12} center style={{ marginTop: 6 }}>{tour ? 'הקשה על שחקן: ריבאי, הדחה או תיקון' : 'הקשה על שחקן: כניסה חוזרת או תיקון'}</Txt>}
      {(g.isBanker || g.isAdmin) && (
        <Btn small kind="ghost" title="העברת תפקיד הבנקאי" style={{ marginTop: 14 }} onPress={() => setHanding(true)} />
      )}
      <Btn small kind="ghost" title="📜 יומן הערב" style={{ marginTop: 10 }} onPress={() => router.push(`/game/${id}/log`)} />

      <PlayerSheet
        open={!!sheet && g.isBanker}
        onClose={() => setSheet(null)}
        name={sheet ? nameOf(sheet) : ''}
        entries={g.rows.filter(r => r.player_id === sheet)}
        totalIn={sheet ? tot(sheet).totalIn : 0}
        left={sheet ? rebuysLeft(sheet) : 0}
        quick={game.quick_rebuys}
        canRebuy={!counting && game.rebuy_policy !== 'none' && !(sheet && tot(sheet).counted) && !(sheet && out(sheet))}
        canLeave={!tour && !!sheet && !tot(sheet).counted}
        tour={tour}
        isOut={!!sheet && out(sheet)}
        onOut={v => sheet && setOut(sheet, v)}
        counting={counting}
        buyIn={game.buy_in_ils}
        stack={game.start_stack_chips ?? game.buy_in_ils}
        onLeave={chips => {
          enqueue({ game_id: id, player_id: sheet!, type: 'cash_out', amount_ils: chipsToIls(chips, game.buy_in_ils, game.start_stack_chips ?? game.buy_in_ils), chips_count: chips, note: counting ? null : 'יציאה באמצע הערב' });
          setSheet(null);
        }}
        onRebuy={amt => {
          enqueue({ game_id: id, player_id: sheet!, type: 'rebuy', amount_ils: amt });
          setSheet(null);
        }}
        onReverse={e => enqueue({ game_id: id, player_id: e.player_id, type: 'reversal', amount_ils: e.amount_ils, reverses_entry_id: e.id })}
      />
      <HandOver
        open={handing}
        onClose={() => setHanding(false)}
        groupId={game.group_id}
        current={game.banker_profile_id}
        seatedProfiles={g.seats.map(s => s.profile_id).filter((x): x is string => !!x)}
        unsynced={g.unsynced}
        onPick={async profileId => {
          const { error } = await supabase.from('games').update({ banker_profile_id: profileId }).eq('id', id);
          if (error) return g.setError(heError(error));
          setHanding(false);
          void g.reload();
        }}
      />
      <AddPlayer
        open={adding}
        onClose={() => setAdding(false)}
        groupId={game.group_id}
        seated={g.seats.map(s => s.player_id)}
        onAdd={async pid => {
          const s = await supabase.from('game_players').insert({ game_id: id, player_id: pid, seat_no: n + 1 });
          if (s.error) return g.setError(heError(s.error));
          enqueue({ game_id: id, player_id: pid, type: 'buy_in', amount_ils: game.buy_in_ils });
          setAdding(false);
          void g.reload();
        }}
      />
    </Screen>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000a' }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 12, maxHeight: '80%', width: '100%', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderColor: C.line }}>
        {children}
      </View>
    </Modal>
  );
}

function PlayerSheet(p: {
  open: boolean; onClose: () => void; name: string; entries: Entry[]; totalIn: number; left: number; quick: number[];
  canRebuy: boolean; onRebuy: (n: number) => void; onReverse: (e: Entry) => void;
  canLeave: boolean; counting: boolean; buyIn: number; stack: number; onLeave: (chips: number) => void;
  tour: boolean; isOut: boolean; onOut: (v: boolean) => void;
}) {
  const [other, setOther] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [chips, setChips] = useState('');
  useEffect(() => { if (!p.open) { setLeaving(false); setChips(''); } }, [p.open]);
  const n = parseInt(chips, 10);
  const value = Number.isFinite(n) ? chipsToIls(n, p.buyIn, p.stack) : 0;
  const reversed = new Set(p.entries.filter(e => e.type === 'reversal').map(e => e.reverses_entry_id));
  const live = p.entries.filter(e => e.type !== 'reversal' && !reversed.has(e.id));
  return (
    <Sheet open={p.open} onClose={p.onClose}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={22} weight="black">{p.name}</Txt>
        <Num weight="bold" color={C.acc}>{`נכנס ${ils(p.totalIn)}`}</Num>
      </Row>
      {p.canRebuy ? (
        p.left > 0 ? (
          <>
            <Txt muted size={13}>{`כניסה חוזרת · נשארו ${p.left}`}</Txt>
            <Row style={{ flexWrap: 'wrap' }}>
              {p.quick.map(q => <Btn key={q} small title={`+${q} ₪`} style={{ flex: 1, minWidth: 90 }} onPress={() => p.onRebuy(q)} />)}
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Field label="סכום אחר" value={other} onChangeText={t => setOther(t.replace(/\D/g, ''))} keyboardType="number-pad" />
              </View>
              <Btn small kind="ghost" title="הוספה" style={{ marginTop: 8 }} disabled={!parseInt(other, 10)} onPress={() => { p.onRebuy(parseInt(other, 10)); setOther(''); }} />
            </Row>
          </>
        ) : (
          <Txt color={C.neg}>הגיע למקסימום הריבאיים</Txt>
        )
      ) : null}
      {p.tour && (
        p.isOut ? (
          <Btn small kind="ghost" title="↩ החזרה לטורניר (הודח בטעות)" onPress={() => p.onOut(false)} />
        ) : (
          <Btn small kind="danger" title="❌ הודח מהטורניר" onPress={() => p.onOut(true)} />
        )
      )}
      {p.tour && !p.isOut && <Txt muted size={12}>שחקן שעושה ריבאי לא מסמנים כמודח. מקומות נקבעים לפי סדר ההדחה.</Txt>}
      {p.canLeave && (
        leaving ? (
          <Card style={{ gap: 8, borderWidth: 1, borderColor: C.line }}>
            <Txt weight="bold">{p.counting ? 'ספירת צ׳יפים' : 'יציאה מהשולחן'}</Txt>
            <Field label="כמה צ׳יפים יש לו עכשיו" value={chips} onChangeText={t => setChips(t.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" autoFocus />
            <Num weight="black" size={20} color={C.acc}>{`= ${ils(value)}`}</Num>
            <Txt muted size={12}>נרשם עכשיו כספירה שלו. בסוף הערב הוא כבר יופיע כנספר. אפשר לבטל מההיסטוריה אם הוא חוזר.</Txt>
            <Row>
              <Btn small kind="ghost" title="ביטול" style={{ flex: 1 }} onPress={() => { setLeaving(false); setChips(''); }} />
              <Btn small title={p.counting ? 'שמירת ספירה' : 'רישום יציאה'} style={{ flex: 2 }} disabled={chips === ''} onPress={() => p.onLeave(n)} />
            </Row>
          </Card>
        ) : (
          <Btn small kind={p.counting ? 'primary' : 'ghost'} title={p.counting ? 'הזנת ספירה' : 'יציאה מהשולחן (ספירה עכשיו)'} onPress={() => setLeaving(true)} />
        )
      )}
      <Txt weight="bold" size={14}>היסטוריה</Txt>
      <ScrollView style={{ maxHeight: 220 }}>
        {live.length === 0 && <Txt muted size={13}>אין רישומים</Txt>}
        {live.map(e => (
          <Row key={e.id} style={{ justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Txt size={14}>{`${e.type === 'cash_out' ? 'יציאה' : typeLabel[e.type]} · ${e.type === 'cash_out' && e.chips_count != null ? `${e.chips_count.toLocaleString('he-IL')} צ׳יפים = ` : ''}${ils(e.amount_ils)}${e.pending ? ' · שומר…' : ''}`}</Txt>
            <Btn small kind="danger" title="ביטול" style={{ height: 36, paddingHorizontal: 12 }} onPress={() => p.onReverse(e)} />
          </Row>
        ))}
      </ScrollView>
      <Txt muted size={11}>ביטול לא מוחק: נרשמת שורת ביטול, וההיסטוריה נשמרת.</Txt>
    </Sheet>
  );
}

function HandOver({ open, onClose, groupId, current, seatedProfiles, unsynced, onPick }: {
  open: boolean; onClose: () => void; groupId: string; current: string; seatedProfiles: string[]; unsynced: number; onPick: (profileId: string) => void;
}) {
  const [list, setList] = useState<{ profile_id: string; display_name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    supabase.from('players').select('profile_id, display_name').eq('group_id', groupId).eq('status', 'active').not('profile_id', 'is', null).order('display_name')
      .then(({ data }) => {
        const rows = ((data ?? []) as { profile_id: string; display_name: string }[]).filter(p => p.profile_id && p.profile_id !== current);
        // players sitting at the table first
        rows.sort((a, b) => Number(seatedProfiles.includes(b.profile_id)) - Number(seatedProfiles.includes(a.profile_id)));
        setList(rows);
      });
  }, [open, groupId, current, seatedProfiles]);
  return (
    <Sheet open={open} onClose={onClose}>
      <Txt size={22} weight="black">העברת תפקיד הבנקאי</Txt>
      <Txt muted size={13}>כל מה שנרשם עד עכשיו נשמר. הבנקאי החדש ממשיך מאותה נקודה, וכולם רואים את ההחלפה.</Txt>
      {unsynced > 0 ? (
        <Txt color={C.neg}>{`יש ${unsynced} רישומים שעוד לא נשמרו בשרת. חכו ל"מעודכן" ואז נסו שוב.`}</Txt>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {list.map(p => (
            <Btn key={p.profile_id} small kind="ghost" title={`${p.display_name}${seatedProfiles.includes(p.profile_id) ? '' : ' · לא בשולחן'}`} onPress={() => onPick(p.profile_id)} />
          ))}
          {list.length === 0 && <Txt muted size={13}>אין עוד חברים עם חשבון באפליקציה. אורחים לא יכולים להיות בנקאים.</Txt>}
        </View>
      )}
    </Sheet>
  );
}

function AddPlayer({ open, onClose, groupId, seated, onAdd }: { open: boolean; onClose: () => void; groupId: string; seated: string[]; onAdd: (pid: string) => void }) {
  const [list, setList] = useState<{ id: string; display_name: string }[]>([]);
  const [guest, setGuest] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    supabase.from('players').select('id, display_name').eq('group_id', groupId).eq('status', 'active').order('display_name')
      .then(({ data }) => setList((data ?? []).filter(p => !seated.includes(p.id))));
  }, [open, groupId, seated]);
  return (
    <Sheet open={open} onClose={onClose}>
      <Txt size={22} weight="black">שחקן מצטרף</Txt>
      <ErrorBar text={err} onClose={() => setErr(null)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {list.map(p => <Btn key={p.id} small kind="ghost" title={p.display_name} onPress={() => onAdd(p.id)} />)}
        {list.length === 0 && <Txt muted size={13}>כל חברי הקבוצה כבר בשולחן</Txt>}
      </View>
      <Field label="או אורח חדש" value={guest} onChangeText={setGuest} maxLength={40} />
      <Btn
        small
        title="הוספת אורח"
        disabled={!guest.trim()}
        onPress={async () => {
          const { data, error } = await supabase.from('players').insert({ group_id: groupId, display_name: guest.trim(), is_guest: true }).select('id').single();
          if (error) return setErr(heError(error));
          setGuest('');
          onAdd(data.id);
        }}
      />
    </Sheet>
  );
}
