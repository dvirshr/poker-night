import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { UpdateBanner } from '../ui/UpdateBanner';
import { Brand, IconBtn, Icon } from '../ui/brand';
import { Pressable } from 'react-native';
import { supabase, heError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { C, ils } from '../lib/theme';
import { pendingInvite, clearPendingInvite } from '../lib/invite';
import { Screen, H1, Card, Txt, Btn, Field, Seg, ErrorBar, Row, Badge , RefreshBtn, useOnResume } from '../ui/kit';

type Membership = { id: string; role: string; status: string; group_id: string; groups: { name: string; archived_at: string | null; deleted_at: string | null } | null };
type OpenGame = { id: string; name: string; status: string; group_id: string };

export default function Home() {
  const { userId } = useAuth();
  const [groups, setGroups] = useState<Membership[]>([]);
  const [games, setGames] = useState<OpenGame[]>([]);
  const [me, setMe] = useState('');
  const [panel, setPanel] = useState<'none' | 'new' | 'join'>('none');
  const [name, setName] = useState('');
  const [bankerMode, setBankerMode] = useState<'opener_is_banker' | 'admin_assigns'>('opener_is_banker');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [retry, setRetry] = useState<{ code: string; name: string } | null>(null);
  const [operator, setOperator] = useState(false);
  // per group: players, last night, league leader; per open night: players and pot
  const [info, setInfo] = useState<Record<string, { players: number; last: string | null; leader: string | null }>>({});
  const [live, setLive] = useState<Record<string, { players: number; pot: number }>>({});

  const load = useCallback(async () => {
    if (!userId) return;
    const [m, g, p] = await Promise.all([
      supabase.from('players').select('id, role, status, group_id, groups(name, archived_at, deleted_at)').eq('profile_id', userId).neq('status', 'left'),
      supabase.from('games').select('id, name, status, group_id').in('status', ['open', 'counting']).order('created_at', { ascending: false }),
      supabase.from('profiles').select('display_name').eq('id', userId).single(),
    ]);
    if (m.error) setErr(heError(m.error));
    const mine = (m.data ?? []) as unknown as Membership[];
    setGroups(mine);
    setGames((g.data ?? []) as OpenGame[]);
    void loadExtras(mine.filter(x => x.status === 'active').map(x => x.group_id), ((g.data ?? []) as OpenGame[]).map(x => x.id));
    const myName = p.data?.display_name ?? '';
    setMe(myName);
    const code = pendingInvite();
    if (code && myName) {
      clearPendingInvite();
      const { error } = await supabase.rpc('join_group', { p_code: code, p_display_name: myName });
      if (error && /name taken/i.test(error.message)) {
        setRetry({ code, name: '' });
      } else if (error) setErr(heError(error));
      else {
        setNotice('ביקשת להצטרף לקבוצה. מחכים לאישור המנהל.');
        const again = await supabase.from('players').select('id, role, status, group_id, groups(name, archived_at, deleted_at)').eq('profile_id', userId).neq('status', 'left');
        setGroups((again.data ?? []) as unknown as Membership[]);
      }
    }
  }, [userId]);
  const loadExtras = async (groupIds: string[], gameIds: string[]) => {
    if (!groupIds.length) return;
    const [pl, last, lg, tot] = await Promise.all([
      supabase.from('players').select('group_id').in('group_id', groupIds).eq('status', 'active'),
      supabase.from('games').select('group_id, played_on').in('group_id', groupIds).eq('status', 'closed').order('played_on', { ascending: false }),
      supabase.from('league_table').select('group_id, display_name, net_total').in('group_id', groupIds).order('net_total', { ascending: false }),
      gameIds.length ? supabase.from('game_totals').select('game_id, players, pot').in('game_id', gameIds) : Promise.resolve({ data: [] as { game_id: string; players: number; pot: number }[] }),
    ]);
    const out: Record<string, { players: number; last: string | null; leader: string | null }> = {};
    for (const id of groupIds) out[id] = { players: 0, last: null, leader: null };
    for (const r of (pl.data ?? []) as { group_id: string }[]) out[r.group_id].players++;
    for (const r of (last.data ?? []) as { group_id: string; played_on: string }[]) if (!out[r.group_id].last) out[r.group_id].last = r.played_on;
    for (const r of (lg.data ?? []) as { group_id: string; display_name: string; net_total: number }[]) if (!out[r.group_id].leader && r.net_total > 0) out[r.group_id].leader = r.display_name;
    setInfo(out);
    const lv: Record<string, { players: number; pot: number }> = {};
    for (const r of (tot.data ?? []) as { game_id: string; players: number; pot: number }[]) lv[r.game_id] = { players: r.players, pot: r.pot };
    setLive(lv);
  };
  useFocusEffect(useCallback(() => { void load(); supabase.rpc('is_app_admin').then(({ data }) => setOperator(data === true)); }, [load]));
  useOnResume(useCallback(() => void load(), [load]));

  const retryJoin = async () => {
    if (!retry) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc('join_group', { p_code: retry.code, p_display_name: retry.name.trim() });
    setBusy(false);
    if (error) return setErr(heError(error));
    setRetry(null);
    setNotice('ביקשת להצטרף לקבוצה. מחכים לאישור המנהל.');
    void load();
  };

  const createGroup = async () => {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.from('groups').insert({ name: name.trim(), banker_mode: bankerMode }).select('id').single();
    setBusy(false);
    if (error) return setErr(heError(error));
    setPanel('none');
    setName('');
    router.push(`/group/${data.id}`);
  };

  const join = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc('join_group', { p_code: code.trim(), p_display_name: me });
    setBusy(false);
    if (error && /name taken/i.test(error.message)) {
      setPanel('none');
      return setRetry({ code: code.trim(), name: '' });
    }
    if (error) return setErr(heError(error));
    setPanel('none');
    setCode('');
    void load();
  };

  // archived groups go to the bottom; deleted groups are shown only to their admins (to restore)
  const liveGroups = groups.filter(g => g.status === 'pending' || (!g.groups?.archived_at && !g.groups?.deleted_at));
  const oldGroups = groups.filter(g => g.status !== 'pending' && (g.groups?.deleted_at ? g.role === 'admin' : !!g.groups?.archived_at));
  const groupName = (id: string) => groups.find(g => g.group_id === id)?.groups?.name ?? '';

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Brand sub={me ? `שלום ${me}` : undefined} />
        <Row style={{ gap: 8 }}>
          {operator && <IconBtn name="shield" label="ניהול מערכת" onPress={() => router.push('/admin')} />}
          <IconBtn name="refresh" label="רענון" onPress={load} />
          <IconBtn name="help" label="איך זה עובד" onPress={() => router.push('/help')} />
          <IconBtn name="user" label="החשבון שלי" onPress={() => router.push('/account')} />
        </Row>
      </Row>
      <ErrorBar text={err} onClose={() => setErr(null)} />
      <UpdateBanner />
      {retry && (
        <Card accent style={{ marginBottom: 12, gap: 4 }}>
          <Txt weight="bold" size={16}>{`השם "${me}" כבר תפוס בקבוצה`}</Txt>
          <Txt muted size={13} style={{ marginBottom: 8 }}>יש שם כבר חבר אחר עם השם הזה. בחר שם שהחבר'ה יזהו, למשל עם אות משפחה.</Txt>
          <Field label="השם שלך בקבוצה" value={retry.name} onChangeText={t => setRetry(r => (r ? { ...r, name: t } : r))} maxLength={40} placeholder={`${me} ל.`} />
          <Btn title="שליחת בקשה" onPress={retryJoin} disabled={!retry.name.trim() || retry.name.trim() === me} busy={busy} />
        </Card>
      )}
      {notice && (
        <Card accent style={{ marginBottom: 12 }}>
          <Txt weight="bold">{notice}</Txt>
        </Card>
      )}

      {games.length > 0 && (
        <View style={{ gap: 10, marginBottom: 22 }}>
          {games.map(g => (
            <Card key={g.id} onPress={() => router.push(`/game/${g.id}`)} style={{ borderWidth: 1.5, borderColor: C.acc, backgroundColor: '#211B10', gap: 4 }}>
              <Row style={{ gap: 8 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.pos }} />
                <Txt size={12} weight="bold" color={C.pos}>{g.status === 'open' ? 'משחקים עכשיו' : 'בספירה'}</Txt>
              </Row>
              <Txt weight="display" size={23}>{`${g.name} · ${groupName(g.group_id)}`}</Txt>
              {live[g.id] && <Txt muted size={13}>{`${live[g.id].players} שחקנים · קופה ${ils(live[g.id].pot)}`}</Txt>}
            </Card>
          ))}
        </View>
      )}

      <Txt weight="display" size={20} muted style={{ marginBottom: 10 }}>הקבוצות שלי</Txt>
      <View style={{ gap: 10, marginBottom: 20 }}>
        {liveGroups.length === 0 && <Txt muted>עוד אין קבוצות. פתח קבוצה חדשה או הצטרף עם קוד הזמנה.</Txt>}
        {liveGroups.map(g =>
          g.status === 'pending' ? (
            <Card key={g.id}>
              <Txt weight="bold">ממתין לאישור מנהל</Txt>
              <Txt muted size={13}>תקבל גישה ברגע שמנהל הקבוצה יאשר</Txt>
            </Card>
          ) : (
            <Card key={g.id} onPress={() => router.push(`/group/${g.group_id}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Txt weight="display" size={20}>{g.groups?.name}</Txt>
                {info[g.group_id] && (
                  <Txt muted size={13}>{[
                    `${info[g.group_id].players} שחקנים`,
                    info[g.group_id].last ? `ערב אחרון ${shortDate(info[g.group_id].last!)}` : 'עוד לא שיחקו',
                    info[g.group_id].leader ? `מוביל: ${info[g.group_id].leader}` : null,
                  ].filter(Boolean).join(' · ')}</Txt>
                )}
              </View>
              <Row style={{ gap: 10 }}>
                {g.role === 'admin' && <Badge text="מנהל" />}
                {g.role === 'admin' && (
                  <Pressable hitSlop={10} accessibilityLabel="הגדרות הקבוצה" onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.group_id, tab: 'settings' } })}>
                    <Icon name="gear" size={21} />
                  </Pressable>
                )}
                <Icon name="chev" size={18} color={C.muted} />
              </Row>
            </Card>
          ),
        )}
      </View>

      {oldGroups.length > 0 && (
        <View style={{ gap: 8, marginBottom: 20 }}>
          <Btn small kind="ghost" title={`${showOld ? '▾' : '▸'} ארכיון וקבוצות שנמחקו (${oldGroups.length})`} onPress={() => setShowOld(v => !v)} />
          {showOld && oldGroups.map(g => (
            <Card key={g.id} onPress={() => router.push(`/group/${g.group_id}`)} style={{ opacity: 0.75 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold" size={16}>{g.groups?.name}</Txt>
                <Badge text={g.groups?.deleted_at ? 'נמחקה' : 'בארכיון'} />
              </Row>
              {g.groups?.deleted_at && <Txt muted size={12}>רק מנהלי הקבוצה רואים אותה. אפשר לשחזר מההגדרות.</Txt>}
            </Card>
          ))}
        </View>
      )}

      {panel === 'none' && (
        <View style={{ gap: 10 }}>
          <Btn title="+ קבוצה חדשה" onPress={() => setPanel('new')} />
          <Btn title="הצטרפות עם קוד" kind="ghost" onPress={() => setPanel('join')} />
        </View>
      )}

      {panel === 'new' && (
        <Card style={{ gap: 4 }}>
          <Field label="שם הקבוצה" value={name} onChangeText={setName} placeholder="החבר'ה של חמישי" maxLength={60} />
          <Seg
            label="מי הבנקאי של הערב"
            value={bankerMode}
            onChange={setBankerMode}
            options={[{ v: 'opener_is_banker', t: 'מי שפותח את השולחן' }, { v: 'admin_assigns', t: 'מנהל ממנה' }]}
          />
          <Btn title="יצירה" onPress={createGroup} disabled={!name.trim()} busy={busy} />
          <Btn title="ביטול" kind="ghost" small onPress={() => setPanel('none')} />
        </Card>
      )}

      {panel === 'join' && (
        <Card style={{ gap: 4 }}>
          <Field label="קוד הזמנה" value={code} onChangeText={setCode} autoCapitalize="none" placeholder="למשל a1b2c3d4e5" />
          <Txt muted size={12} style={{ marginBottom: 10 }}>תצטרף בשם "{me}". מנהל הקבוצה יאשר אותך.</Txt>
          <Btn title="הצטרפות" onPress={join} disabled={code.trim().length < 6} busy={busy} />
          <Btn title="ביטול" kind="ghost" small onPress={() => setPanel('none')} />
        </Card>
      )}
      <View style={{ height: 24 }} />
      <Txt size={11} color={C.muted} center>{appVersion()}</Txt>
    </Screen>
  );
}

/** Android: the APK's version (0.1.N, set by the build). Web: when the site was last updated. */
function appVersion() {
  if (Platform.OS !== 'web') return `אנדרואיד · גרסה ${Constants.expoConfig?.version ?? '?'}`;
  const b = process.env.EXPO_PUBLIC_BUILD_TIME;
  return b ? `אתר · עודכן ${new Date(b).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'אתר';
}

/** "24.10" (or "היום") */
function shortDate(d: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (d === today) return 'היום';
  const [, m, day] = d.split('-');
  return `${parseInt(day, 10)}.${parseInt(m, 10)}`;
}
