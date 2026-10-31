import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { supabase, heError } from '../lib/supabase';
import { C } from '../lib/theme';
import { Screen, Txt, Num, Card, Back, Seg, ErrorBar, Row, Badge, RefreshBtn, Loading, Btn, Field, ConfirmBtn } from '../ui/kit';

type Stats = { accounts: number; groups: number; active_groups: number; open_now: number; games_7d: number; games_30d: number; players_30d: number };
type G = { game_id: string; group_name: string; game_name: string; game_type: string; status: string; opened_by: string | null; banker: string | null; players: number; created_at: string; closed_at: string | null };
type Grp = { group_id: string; name: string; created_at: string; archived_at: string | null; deleted_at: string | null; members: number; accounts: number; admins: string | null; games: number; last_game: string | null; open_now: boolean };
type U = { profile_id: string; display_name: string; created_at: string; deleted_at: string | null; groups: number; admin_of: string | null; last_game: string | null; is_operator: boolean };
type L = { at: string; operator: string; action: string; group_name: string | null; game_name: string | null };

const STATUS: Record<string, string> = { open: 'משחקים', counting: 'בספירה', closed: 'נסגר', cancelled: 'בוטל' };
const ACTION: Record<string, string> = {
  group_archive: 'העביר לארכיון', group_unarchive: 'החזיר מהארכיון', group_delete: 'מחק קבוצה', group_restore: 'שחזר קבוצה', game_cancel: 'ביטל ערב',
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

/** App operators only: what is happening across all groups, and the operator's actions. No money, no emails. */
export default function Admin() {
  const [tab, setTab] = useState<'overview' | 'groups' | 'users' | 'log'>('overview');
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back />
        <RefreshBtn onPress={reload} />
      </Row>
      <Txt size={26} weight="black">ניהול מערכת</Txt>
      <Txt muted size={12} style={{ marginBottom: 12 }}>רק למפעילי האפליקציה. בלי סכומים ובלי כתובות מייל. כל פעולה נרשמת ביומן.</Txt>
      <ErrorBar text={err} onClose={() => setErr(null)} />
      <Seg value={tab} onChange={setTab} options={[{ v: 'overview', t: 'סקירה' }, { v: 'groups', t: 'קבוצות' }, { v: 'users', t: 'משתמשים' }, { v: 'log', t: 'יומן' }]} />
      {tab === 'overview' && <Overview key={tick} onError={setErr} />}
      {tab === 'groups' && <Groups key={tick} onError={setErr} />}
      {tab === 'users' && <Users key={tick} onError={setErr} />}
      {tab === 'log' && <Log key={tick} onError={setErr} />}
      <View style={{ height: 24 }} />
    </Screen>
  );
}

function Overview({ onError }: { onError: (m: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [games, setGames] = useState<G[] | null>(null);
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<'all' | 'open'>('all');
  const load = useCallback(async () => {
    const [s, g] = await Promise.all([supabase.rpc('admin_stats'), supabase.rpc('admin_games', { p_days: days })]);
    if (s.error || g.error) { onError(heError(s.error ?? g.error)); setGames([]); return; }
    setStats(s.data as Stats);
    setGames((g.data ?? []) as G[]);
  }, [days, onError]);
  useEffect(() => { void load(); }, [load]);
  const cancel = async (id: string) => {
    const { error } = await supabase.rpc('op_cancel_game', { p_game: id });
    if (error) onError(heError(error));
    void load();
  };
  const list = (games ?? []).filter(g => filter === 'all' || g.status === 'open' || g.status === 'counting');
  return (
    <>
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
                <Badge text={STATUS[g.status] ?? g.status} />
              </Row>
              <Txt size={13}>{`${g.game_type === 'tournament' ? '🏆 טורניר' : '💵 קאש'} · ${g.players} שחקנים · פתח: ${g.opened_by ?? '—'}${g.banker && g.banker !== g.opened_by ? ` · בנקאי: ${g.banker}` : ''}`}</Txt>
              <Txt muted size={12}>{`נפתח ${when(g.created_at)}${g.closed_at ? ` · נסגר ${when(g.closed_at)}` : ''}`}</Txt>
              {(g.status === 'open' || g.status === 'counting') && (
                <ConfirmBtn kind="danger" title="ביטול הערב" confirmTitle="לבטל את הערב?" okTitle="כן, לבטל"
                  message={`"${g.game_name}" בקבוצה "${g.group_name}" יוקפא ולא ייספר. שום רישום לא נמחק. החברים יראו "הערב בוטל".`}
                  onConfirm={() => void cancel(g.game_id)} />
              )}
            </Card>
          ))}
        </View>
      )}
    </>
  );
}

function Groups({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<Grp[] | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'archived' | 'deleted'>('active');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('op_groups');
    if (error) { onError(heError(error)); setRows([]); return; }
    setRows((data ?? []) as Grp[]);
  }, [onError]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, action: string) => {
    const { error } = await supabase.rpc('op_set_group_state', { p_group: id, p_action: action });
    if (error) onError(heError(error));
    void load();
  };
  const state = (g: Grp) => (g.deleted_at ? 'deleted' : g.archived_at ? 'archived' : 'active');
  const list = (rows ?? []).filter(g => state(g) === show && (!q.trim() || g.name.includes(q.trim()) || (g.admins ?? '').includes(q.trim())));
  const count = (s: string) => (rows ?? []).filter(g => state(g) === s).length;
  return (
    <>
      <Seg value={show} onChange={setShow} options={[
        { v: 'active', t: `פעילות (${count('active')})` }, { v: 'archived', t: `ארכיון (${count('archived')})` }, { v: 'deleted', t: `נמחקו (${count('deleted')})` },
      ]} />
      <Field label="חיפוש לפי שם קבוצה או מנהל" value={q} onChangeText={setQ} />
      {rows == null ? <Loading /> : list.length === 0 ? <Txt muted>אין קבוצות</Txt> : (
        <View style={{ gap: 8 }}>
          {list.map(g => (
            <Card key={g.group_id} style={{ gap: 4 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold" size={16} style={{ flex: 1 }}>{g.name}</Txt>
                {g.open_now && <Badge solid text="משחקים עכשיו" />}
              </Row>
              <Txt size={13}>{`👑 ${g.admins ?? 'אין מנהל'}`}</Txt>
              <Txt size={13}>{`${g.members} שחקנים (${g.accounts} עם חשבון) · ${g.games} ערבים · אחרון: ${day(g.last_game)}`}</Txt>
              <Txt muted size={12}>{`נפתחה ${day(g.created_at)}${g.archived_at ? ` · בארכיון מ-${day(g.archived_at)}` : ''}${g.deleted_at ? ` · נמחקה ${day(g.deleted_at)}` : ''}`}</Txt>
              <Row style={{ marginTop: 6 }}>
                {state(g) === 'deleted' ? (
                  <Btn small title="♻ שחזור" style={{ flex: 1 }} onPress={() => void act(g.group_id, 'restore')} />
                ) : (
                  <>
                    {state(g) === 'archived'
                      ? <Btn small kind="ghost" title="📤 מהארכיון" style={{ flex: 1 }} onPress={() => void act(g.group_id, 'unarchive')} />
                      : <Btn small kind="ghost" title="📦 לארכיון" style={{ flex: 1 }} disabled={g.open_now} onPress={() => void act(g.group_id, 'archive')} />}
                    <View style={{ flex: 1 }}>
                      <ConfirmBtn kind="danger" title="🗑 מחיקה" confirmTitle={`למחוק את "${g.name}"?`} okTitle="כן, למחוק" disabled={g.open_now}
                        message="הקבוצה תיעלם מכל החברים שלה. שום נתון לא נמחק, ואפשר לשחזר מכאן או על ידי מנהל הקבוצה."
                        onConfirm={() => void act(g.group_id, 'delete')} />
                    </View>
                  </>
                )}
              </Row>
              {g.open_now && state(g) !== 'deleted' && <Txt muted size={11}>יש ערב פתוח: אפשר לבטל אותו בלשונית "סקירה".</Txt>}
            </Card>
          ))}
        </View>
      )}
    </>
  );
}

function Users({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<U[] | null>(null);
  const [q, setQ] = useState('');
  const [onlyAdmins, setOnlyAdmins] = useState(false);
  useEffect(() => {
    supabase.rpc('op_users').then(({ data, error }) => {
      if (error) { onError(heError(error)); setRows([]); return; }
      setRows((data ?? []) as U[]);
    });
  }, [onError]);
  const list = (rows ?? []).filter(u => !u.deleted_at && (!onlyAdmins || u.admin_of) && (!q.trim() || u.display_name.includes(q.trim()) || (u.admin_of ?? '').includes(q.trim())));
  const deleted = (rows ?? []).filter(u => u.deleted_at).length;
  return (
    <>
      <Seg value={onlyAdmins ? 1 : 0} onChange={v => setOnlyAdmins(v === 1)} options={[{ v: 0, t: `כולם (${(rows ?? []).length - deleted})` }, { v: 1, t: 'מנהלי קבוצות' }]} />
      <Field label="חיפוש לפי שם או קבוצה" value={q} onChangeText={setQ} />
      {rows == null ? <Loading /> : list.length === 0 ? <Txt muted>אין משתמשים</Txt> : (
        <View style={{ gap: 8 }}>
          {list.map(u => (
            <Card key={u.profile_id} style={{ gap: 3 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold" size={15}>{u.display_name}</Txt>
                <Row>
                  {u.is_operator && <Badge solid text="מפעיל" />}
                  {u.admin_of && <Badge text="מנהל" />}
                </Row>
              </Row>
              <Txt size={13}>{`${u.groups} קבוצות${u.admin_of ? ` · מנהל: ${u.admin_of}` : ''}`}</Txt>
              <Txt muted size={12}>{`נרשם ${day(u.created_at)} · שיחק לאחרונה ${day(u.last_game)}`}</Txt>
            </Card>
          ))}
          {deleted > 0 && <Txt muted size={12}>{`${deleted} חשבונות נמחקו (ההיסטוריה שלהם נשארה כאורחים בקבוצות)`}</Txt>}
        </View>
      )}
    </>
  );
}

function Log({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<L[] | null>(null);
  useEffect(() => {
    supabase.rpc('op_log', { p_limit: 100 }).then(({ data, error }) => {
      if (error) { onError(heError(error)); setRows([]); return; }
      setRows((data ?? []) as L[]);
    });
  }, [onError]);
  if (rows == null) return <Loading />;
  if (rows.length === 0) return <Txt muted>עוד אין פעולות מפעיל</Txt>;
  return (
    <View style={{ gap: 6 }}>
      {rows.map((l, i) => (
        <Card key={i} style={{ gap: 2, paddingVertical: 10 }}>
          <Txt size={14}>{`${l.operator} · ${ACTION[l.action] ?? l.action}${l.group_name ? ` · ${l.group_name}` : ''}${l.game_name ? ` · ${l.game_name}` : ''}`}</Txt>
          <Txt muted size={12}>{when(l.at)}</Txt>
        </Card>
      ))}
    </View>
  );
}
