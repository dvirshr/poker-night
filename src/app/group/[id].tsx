import { useCallback, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase, heError } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { C, ils } from '../../lib/theme';
import { inviteLink, inviteMessage } from '../../lib/invite';
import { Screen, H1, Card, Txt, Num, Btn, Field, Seg, ErrorBar, Row, Badge, Back, RefreshBtn, useOnResume } from '../../ui/kit';

type Player = { id: string; display_name: string; role: string; status: string; is_guest: boolean; profile_id: string | null };
type Game = { id: string; name: string; status: string; played_on: string };
type League = { player_id: string; display_name: string; games_played: number; net_total: number; net_avg: number; wins: number };

export default function Group() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [group, setGroup] = useState<{ name: string; banker_mode: string } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [league, setLeague] = useState<League[]>([]);
  const [tab, setTab] = useState<'league' | 'history' | 'members' | 'settings'>('league');
  const [invite, setInvite] = useState<string | null>(null);
  const [guest, setGuest] = useState('');
  const [link, setLink] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, p, gm, l] = await Promise.all([
      supabase.from('groups').select('name, banker_mode').eq('id', id).single(),
      supabase.from('players').select('id, display_name, role, status, is_guest, profile_id').eq('group_id', id).order('display_name'),
      supabase.from('games').select('id, name, status, played_on').eq('group_id', id).order('created_at', { ascending: false }),
      supabase.from('league_table').select('*').eq('group_id', id).order('net_total', { ascending: false }),
    ]);
    if (g.error) return setErr(heError(g.error));
    setGroup(g.data);
    setPlayers((p.data ?? []) as Player[]);
    setGames((gm.data ?? []) as Game[]);
    setLeague((l.data ?? []) as League[]);
  }, [id]);
  useFocusEffect(useCallback(() => void load(), [load]));
  useOnResume(useCallback(() => void load(), [load]));

  const me = players.find(p => p.profile_id === userId);
  const isAdmin = me?.role === 'admin';
  const canOpen = group?.banker_mode === 'opener_is_banker' || isAdmin;
  const open = games.find(g => g.status !== 'closed');
  const active = players.filter(p => p.status === 'active');
  const pendingList = players.filter(p => p.status === 'pending');
  const guests = active.filter(p => !p.profile_id);

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setErr(null);
    const { error } = await fn();
    if (error) setErr(heError(error));
    void load();
  };

  const makeInvite = async () => {
    const { data, error } = await supabase.from('group_invites').insert({ group_id: id }).select('code').single();
    if (error) return setErr(heError(error));
    setInvite(data.code);
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back label="הקבוצות שלי" to="/" />
        <RefreshBtn onPress={load} />
      </Row>
      <H1 sub={`${active.length} שחקנים${isAdmin ? ' · אתה מנהל' : ''}`}>{group?.name ?? ''}</H1>
      <ErrorBar text={err} onClose={() => setErr(null)} />

      {open ? (
        <Card accent onPress={() => router.push(`/game/${open.id}`)} style={{ marginBottom: 16 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt weight="bold" size={17}>{open.name}</Txt>
            <Badge solid text={open.status === 'open' ? 'משחקים עכשיו' : 'בספירה'} />
          </Row>
          <Txt muted size={13}>הקשה לכניסה לשולחן</Txt>
        </Card>
      ) : (
        <View style={{ marginBottom: 16, gap: 6 }}>
          <Btn title="+ ערב חדש" onPress={() => router.push({ pathname: '/game/new', params: { group: id } })} disabled={!canOpen} />
          {!canOpen && <Txt muted size={12}>בקבוצה הזו רק מנהל פותח ערב וממנה בנקאי</Txt>}
        </View>
      )}

      {isAdmin && pendingList.length > 0 && (
        <Card style={{ marginBottom: 16, gap: 10 }}>
          <Txt weight="bold">ממתינים לאישור</Txt>
          {pendingList.map(p => {
            const same = guests.find(g => g.display_name === p.display_name);
            const choice = link[p.id] ?? same?.id ?? '';
            const taken = active.some(a => a.display_name === p.display_name);
            const needsName = choice === '' && taken;
            const newName = names[p.id] ?? `${p.display_name} 2`;
            return (
              <View key={p.id} style={{ gap: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 }}>
                <Txt weight="bold">{p.display_name}</Txt>
                {same ? (
                  <>
                    <Txt size={13} color={C.acc}>{`יש כבר אורח בשם "${same.display_name}" עם היסטוריה. זה אותו אדם?`}</Txt>
                    <Seg
                      value={choice}
                      onChange={v => setLink(l => ({ ...l, [p.id]: v }))}
                      options={[
                        { v: same.id, t: `כן, לחבר להיסטוריה של ${same.display_name}` },
                        { v: '', t: 'לא, אדם אחר' },
                        ...guests.filter(g => g.id !== same.id).map(g => ({ v: g.id, t: g.display_name })),
                      ]}
                    />
                  </>
                ) : guests.length > 0 ? (
                  <Seg
                    label="זה שחקן שכבר רשום אצלנו?"
                    value={choice}
                    onChange={v => setLink(l => ({ ...l, [p.id]: v }))}
                    options={[{ v: '', t: 'שחקן חדש' }, ...guests.map(g => ({ v: g.id, t: g.display_name }))]}
                  />
                ) : null}
                {needsName && (
                  <Field
                    label="השם תפוס. באיזה שם הוא יופיע?"
                    value={newName}
                    onChangeText={t => setNames(n => ({ ...n, [p.id]: t }))}
                    maxLength={40}
                  />
                )}
                <Btn
                  small
                  title={choice ? 'אישור וחיבור להיסטוריה' : 'אישור'}
                  disabled={needsName && (!newName.trim() || active.some(a => a.display_name === newName.trim()))}
                  onPress={() =>
                    run(() =>
                      supabase.rpc('approve_member', {
                        p_pending: p.id,
                        p_link_guest: choice || null,
                        p_new_name: needsName ? newName.trim() : null,
                      }),
                    )
                  }
                />
              </View>
            );
          })}
        </Card>
      )}

      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { v: 'league', t: 'טבלת ליגה' },
          { v: 'history', t: 'היסטוריה' },
          { v: 'members', t: 'שחקנים' },
          ...(isAdmin ? [{ v: 'settings' as const, t: 'הגדרות' }] : []),
        ]}
      />

      {tab === 'league' && (
        <View style={{ gap: 6 }}>
          {league.length === 0 && <Txt muted>הטבלה תתמלא אחרי הערב הראשון שנסגר</Txt>}
          {league.map((l, i) => (
            <Card key={l.player_id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
              <Row>
                <Num weight="black" size={16} color={C.muted}>{i + 1}</Num>
                <View>
                  <Txt weight="bold">{l.display_name}</Txt>
                  <Txt muted size={12}>{`${l.games_played} ערבים · ${l.wins} נצחונות · ממוצע ${ils(l.net_avg, true)}`}</Txt>
                </View>
              </Row>
              <Num weight="black" size={18} color={l.net_total > 0 ? C.pos : l.net_total < 0 ? C.neg : C.muted}>{ils(l.net_total, true)}</Num>
            </Card>
          ))}
        </View>
      )}

      {tab === 'history' && (
        <View style={{ gap: 6 }}>
          {games.filter(g => g.status === 'closed').length === 0 && <Txt muted>עוד אין ערבים סגורים</Txt>}
          {games
            .filter(g => g.status === 'closed')
            .map(g => (
              <Card key={g.id} onPress={() => router.push(`/game/${g.id}/summary`)}>
                <Txt weight="bold">{g.name}</Txt>
                <Txt muted size={12}>{new Date(g.played_on).toLocaleDateString('he-IL')}</Txt>
              </Card>
            ))}
        </View>
      )}

      {tab === 'members' && (
        <View style={{ gap: 6 }}>
          {active.map(p => (
            <Card key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}>
              <Txt weight="bold">{p.display_name}</Txt>
              <Row>
                {p.role === 'admin' && <Badge text="מנהל" />}
                {!p.profile_id && <Badge text="אורח" />}
                {p.profile_id === userId && <Badge solid text="אני" />}
              </Row>
            </Card>
          ))}
          <Card style={{ marginTop: 10, gap: 4 }}>
            <Field label="הוספת אורח (בלי אפליקציה)" value={guest} onChangeText={setGuest} maxLength={40} />
            <Btn
              small
              title="הוספה"
              disabled={!guest.trim()}
              onPress={() =>
                run(async () => {
                  const r = await supabase.from('players').insert({ group_id: id, display_name: guest.trim(), is_guest: true });
                  if (!r.error) setGuest('');
                  return r;
                })
              }
            />
          </Card>
          {isAdmin && (
            <Card style={{ marginTop: 10, gap: 10 }}>
              <Txt weight="bold">הזמנת חברים</Txt>
              {invite ? (
                <>
                  <Num size={28} weight="black" color={C.acc} center>{invite}</Num>
                  <Txt muted size={12} center>בתוקף 7 ימים</Txt>
                  <Row>
                    <Btn small kind="ghost" title="העתקת קישור" style={{ flex: 1 }} onPress={() => Clipboard.setStringAsync(inviteLink(invite))} />
                    <Btn
                      small
                      kind="ghost"
                      title="שיתוף"
                      style={{ flex: 1 }}
                      onPress={() => Share.share({ message: inviteMessage(group?.name ?? '', invite) })}
                    />
                  </Row>
                </>
              ) : (
                <Btn small title="יצירת קוד הזמנה" onPress={makeInvite} />
              )}
            </Card>
          )}
        </View>
      )}

      {tab === 'settings' && isAdmin && group && (
        <View style={{ gap: 12 }}>
          <Card style={{ gap: 6 }}>
            <Txt weight="bold" size={16}>מי פותח ערב</Txt>
            <Seg
              value={group.banker_mode}
              onChange={v => run(() => supabase.from('groups').update({ banker_mode: v }).eq('id', id))}
              options={[
                { v: 'opener_is_banker', t: 'כל חבר רשום' },
                { v: 'admin_assigns', t: 'מנהל בלבד' },
              ]}
            />
            <Txt muted size={12}>
              {group.banker_mode === 'opener_is_banker'
                ? 'כל חבר עם חשבון יכול לפתוח ערב, והוא הבנקאי. מתאים לערבים שהמנהל לא מגיע אליהם.'
                : 'רק מנהל פותח ערב וממנה בנקאי. אם אין מנהל בערב, אי אפשר לפתוח.'}
            </Txt>
          </Card>

          <Card style={{ gap: 6 }}>
            <Txt weight="bold" size={16}>מנהלים</Txt>
            <Txt muted size={12} style={{ marginBottom: 4 }}>מנהל מאשר חברים חדשים, ממנה בנקאי ומשנה הגדרות. כדאי שיהיה יותר מאחד.</Txt>
            {active
              .filter(p => p.profile_id)
              .map(p => {
                const admin = p.role === 'admin';
                const lastAdmin = admin && active.filter(a => a.role === 'admin').length === 1;
                return (
                  <Row key={p.id} style={{ justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
                    <Row>
                      <Txt weight="bold">{p.display_name}</Txt>
                      {admin && <Badge text="מנהל" />}
                      {p.profile_id === userId && <Badge solid text="אני" />}
                    </Row>
                    {admin ? (
                      <Btn
                        small
                        kind="ghost"
                        title={lastAdmin ? 'מנהל יחיד' : 'הסרת ניהול'}
                        disabled={lastAdmin}
                        style={{ height: 40, paddingHorizontal: 12 }}
                        onPress={() => run(() => supabase.from('players').update({ role: 'member' }).eq('id', p.id))}
                      />
                    ) : (
                      <Btn
                        small
                        kind="ghost"
                        title="מינוי למנהל"
                        style={{ height: 40, paddingHorizontal: 12 }}
                        onPress={() => run(() => supabase.from('players').update({ role: 'admin' }).eq('id', p.id))}
                      />
                    )}
                  </Row>
                );
              })}
            {active.filter(p => !p.profile_id).length > 0 && (
              <Txt muted size={11} style={{ marginTop: 4 }}>אורחים בלי חשבון לא יכולים להיות מנהלים.</Txt>
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}
