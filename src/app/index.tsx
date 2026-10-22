import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase, heError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { C } from '../lib/theme';
import { pendingInvite, clearPendingInvite } from '../lib/invite';
import { Screen, H1, Card, Txt, Btn, Field, Seg, ErrorBar, Row, Badge , RefreshBtn, useOnResume } from '../ui/kit';

type Membership = { id: string; role: string; status: string; group_id: string; groups: { name: string } | null };
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
  const [retry, setRetry] = useState<{ code: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [m, g, p] = await Promise.all([
      supabase.from('players').select('id, role, status, group_id, groups(name)').eq('profile_id', userId).neq('status', 'left'),
      supabase.from('games').select('id, name, status, group_id').neq('status', 'closed').order('created_at', { ascending: false }),
      supabase.from('profiles').select('display_name').eq('id', userId).single(),
    ]);
    if (m.error) setErr(heError(m.error));
    setGroups((m.data ?? []) as unknown as Membership[]);
    setGames((g.data ?? []) as OpenGame[]);
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
        const again = await supabase.from('players').select('id, role, status, group_id, groups(name)').eq('profile_id', userId).neq('status', 'left');
        setGroups((again.data ?? []) as unknown as Membership[]);
      }
    }
  }, [userId]);
  useFocusEffect(useCallback(() => void load(), [load]));
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

  const groupName = (id: string) => groups.find(g => g.group_id === id)?.groups?.name ?? '';

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <H1 sub={me ? `שלום ${me}` : undefined}>ערב פוקר</H1>
        <Row>
          <RefreshBtn onPress={load} />
          <Btn title="יציאה" kind="ghost" small style={{ paddingHorizontal: 14 }} onPress={() => supabase.auth.signOut()} />
        </Row>
      </Row>
      <ErrorBar text={err} onClose={() => setErr(null)} />
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
        <View style={{ gap: 10, marginBottom: 20 }}>
          <Txt weight="bold" size={16}>ערבים פתוחים</Txt>
          {games.map(g => (
            <Card key={g.id} accent onPress={() => router.push(`/game/${g.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold" size={17}>{g.name}</Txt>
                <Badge solid text={g.status === 'open' ? 'משחקים' : 'בספירה'} />
              </Row>
              <Txt muted size={13}>{groupName(g.group_id)}</Txt>
            </Card>
          ))}
        </View>
      )}

      <Txt weight="bold" size={16} style={{ marginBottom: 10 }}>הקבוצות שלי</Txt>
      <View style={{ gap: 10, marginBottom: 20 }}>
        {groups.length === 0 && <Txt muted>עוד אין קבוצות. פתח קבוצה חדשה או הצטרף עם קוד הזמנה.</Txt>}
        {groups.map(g =>
          g.status === 'pending' ? (
            <Card key={g.id}>
              <Txt weight="bold">ממתין לאישור מנהל</Txt>
              <Txt muted size={13}>תקבל גישה ברגע שמנהל הקבוצה יאשר</Txt>
            </Card>
          ) : (
            <Card key={g.id} onPress={() => router.push(`/group/${g.group_id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold" size={17}>{g.groups?.name}</Txt>
                {g.role === 'admin' && <Badge text="מנהל" />}
              </Row>
            </Card>
          ),
        )}
      </View>

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
      <Txt size={11} color={C.line} center>v0.1</Txt>
    </Screen>
  );
}
