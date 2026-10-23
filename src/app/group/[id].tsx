import { useCallback, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase, heError } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { C, ils } from '../../lib/theme';
import { inviteLink, inviteMessage } from '../../lib/invite';
import { useGroupStats, titleBadges } from '../../lib/useGroupStats';
import { monthly, monthName } from '../../core/stats';
import { THEMES, type ThemeKey } from '../../lib/theme';
import { Screen, H1, Card, Txt, Num, Btn, Field, Seg, ErrorBar, Row, Badge, Back, RefreshBtn, useOnResume } from '../../ui/kit';

type Player = { id: string; display_name: string; role: string; status: string; is_guest: boolean; profile_id: string | null };
type Game = { id: string; name: string; status: string; played_on: string; game_type?: string };
type League = { player_id: string; display_name: string; games_played: number; net_total: number; net_avg: number; wins: number; game_type?: string; podiums?: number };

export default function Group() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [group, setGroup] = useState<{ name: string; banker_mode: string; table_theme?: ThemeKey } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [league, setLeague] = useState<League[]>([]);
  const [byType, setByType] = useState<League[]>([]);
  const [kind, setKind] = useState<'all' | 'cash' | 'tournament'>('all');
  const [tab, setTab] = useState<'league' | 'month' | 'history' | 'members' | 'settings'>('league');
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [guest, setGuest] = useState('');
  const [link, setLink] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, p, gm, l] = await Promise.all([
      supabase.from('groups').select('*').eq('id', id).single(),
      supabase.from('players').select('id, display_name, role, status, is_guest, profile_id').eq('group_id', id).order('display_name'),
      supabase.from('games').select('*').eq('group_id', id).order('created_at', { ascending: false }),
      supabase.from('league_table').select('*').eq('group_id', id).order('net_total', { ascending: false }),
    ]);
    // split by game type (needs the tournament update; without it the overall table still works)
    const bt = await supabase.from('league_by_type').select('*').eq('group_id', id).order('net_total', { ascending: false });
    setByType(bt.error ? [] : ((bt.data ?? []) as League[]));
    if (g.error) return setErr(heError(g.error));
    setGroup(g.data);
    setPlayers((p.data ?? []) as Player[]);
    setGames((gm.data ?? []) as Game[]);
    setLeague((l.data ?? []) as League[]);
  }, [id]);
  const stats = useGroupStats(id);
  useFocusEffect(useCallback(() => { void load(); void stats.reload(); }, [load, stats.reload]));
  useOnResume(useCallback(() => { void load(); void stats.reload(); }, [load, stats.reload]));

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
          { v: 'month', t: 'חודשי' },
          { v: 'history', t: 'היסטוריה' },
          { v: 'members', t: 'שחקנים' },
          ...(isAdmin ? [{ v: 'settings' as const, t: 'הגדרות' }] : []),
        ]}
      />

      {tab === 'league' && (
        <View style={{ gap: 6 }}>
          {new Set(byType.map(l => l.game_type)).size > 1 && (
            <Seg value={kind} onChange={setKind} options={[{ v: 'all', t: 'הכל' }, { v: 'cash', t: '💵 קאש' }, { v: 'tournament', t: '🏆 טורנירים' }]} />
          )}
          {league.length === 0 && <Txt muted>הטבלה תתמלא אחרי הערב הראשון שנסגר</Txt>}
          {stats.titles.size > 0 && (
            <Txt muted size={12} style={{ marginBottom: 4 }}>
              {[...new Map([...stats.titles.values()].flat().map(t => [t.key, t])).values()].map(t => `${t.emoji} ${t.label}`).join(' · ')}
            </Txt>
          )}
          {(kind === 'all' ? league : byType.filter(l => l.game_type === kind)).map((l, i) => (
            <Card key={l.player_id} onPress={() => router.push(`/player/${id}/${l.player_id}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
              <Row>
                <Num weight="black" size={16} color={C.muted}>{i + 1}</Num>
                <View>
                  <Txt weight="bold">{`${l.display_name} ${titleBadges(stats.titles.get(l.player_id))}`}</Txt>
                  <Txt muted size={12}>{kind === 'tournament'
                    ? `${l.games_played} טורנירים · ${l.wins} 🏆 · ${l.podiums ?? 0} פודיומים`
                    : `${l.games_played} ערבים · ${l.wins} נצחונות · ממוצע ${ils(l.net_avg, true)}`}</Txt>
                </View>
              </Row>
              <Num weight="black" size={18} color={l.net_total > 0 ? C.pos : l.net_total < 0 ? C.neg : C.muted}>{ils(l.net_total, true)}</Num>
            </Card>
          ))}
        </View>
      )}

      {tab === 'month' && (
        <View style={{ gap: 8 }}>
          {monthly(stats.nights, stats.transfers).length === 0 && <Txt muted>הסיכום יופיע אחרי הערב הראשון שנסגר</Txt>}
          {monthly(stats.nights, stats.transfers).map(m => {
            const lines = [
              `🃏 ${group?.name ?? ''} · ${monthName(m.month)}`,
              `${m.nights} ערבים · ${m.players} שחקנים · ${ils(m.pot)} עברו בקופה`,
              m.king ? `👑 מלך החודש: ${m.king.name} ${ils(m.king.net, true)}` : '',
              m.bestNight ? `🚀 הערב הכי טוב: ${m.bestNight.name} ${ils(m.bestNight.net, true)} (${new Date(m.bestNight.playedOn).toLocaleDateString('he-IL')})` : '',
              m.biggestTransfer ? `💸 ההעברה הכי גדולה: ${m.biggestTransfer.from} ← ${m.biggestTransfer.to} ${ils(m.biggestTransfer.amountIls)}` : '',
            ].filter(Boolean);
            return (
              <Card key={m.month} style={{ gap: 6 }}>
                <Txt weight="black" size={18}>{monthName(m.month)}</Txt>
                {lines.slice(1).map((l, i) => <Txt key={i} size={14}>{l}</Txt>)}
                <Btn small kind="ghost" title="שיתוף הסיכום" style={{ marginTop: 6 }} onPress={() => Share.share({ message: lines.join('\n') })} />
              </Card>
            );
          })}
        </View>
      )}

      {tab === 'history' && (
        <View style={{ gap: 6 }}>
          {games.filter(g => g.status === 'closed').length === 0 && <Txt muted>עוד אין ערבים סגורים</Txt>}
          {games
            .filter(g => g.status === 'closed')
            .map(g => (
              <Card key={g.id} onPress={() => router.push(`/game/${g.id}/summary`)}>
                <Txt weight="bold">{`${g.game_type === 'tournament' ? '🏆 ' : ''}${g.name}`}</Txt>
                <Txt muted size={12}>{new Date(g.played_on).toLocaleDateString('he-IL')}</Txt>
              </Card>
            ))}
        </View>
      )}

      {tab === 'members' && (
        <View style={{ gap: 6 }}>
          {active.map(p => (
            <View key={p.id} style={{ gap: 6 }}>
              <Card onPress={() => router.push(`/player/${id}/${p.id}`)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}>
                <Txt weight="bold">{`${p.display_name} ${titleBadges(stats.titles.get(p.id))}`}</Txt>
                <Row>
                  {p.role === 'admin' && <Badge text="מנהל" />}
                  {!p.profile_id && <Badge text="אורח" />}
                  {p.profile_id === userId && <Badge solid text="אני" />}
                  {isAdmin && (
                    <Btn
                      small
                      kind="ghost"
                      title={editing === p.id ? 'סגירה' : 'עריכה'}
                      style={{ height: 36, paddingHorizontal: 10 }}
                      onPress={() => { setEditing(editing === p.id ? null : p.id); setRename(p.display_name); }}
                    />
                  )}
                </Row>
              </Card>
              {isAdmin && editing === p.id && (
                <Card style={{ gap: 6, borderWidth: 1, borderColor: C.line }}>
                  <Field label="שינוי שם" value={rename} onChangeText={setRename} maxLength={40} />
                  <Btn
                    small
                    title="שמירת שם"
                    disabled={!rename.trim() || rename.trim() === p.display_name || active.some(a => a.display_name === rename.trim())}
                    onPress={() => run(async () => {
                      const r = await supabase.from('players').update({ display_name: rename.trim() }).eq('id', p.id);
                      if (!r.error) setEditing(null);
                      return r;
                    })}
                  />
                  <Txt muted size={11}>ההיסטוריה נשמרת. השם מתעדכן בכל הערבים והליגה.</Txt>
                  {p.profile_id && p.profile_id !== userId && (
                    <>
                      <View style={{ height: 6 }} />
                      <Btn
                        small
                        kind="danger"
                        title="ניתוק חשבון (אישור מחדש)"
                        onPress={() => run(async () => {
                          const r = await supabase.rpc('unlink_member', { p_player: p.id });
                          if (!r.error) setEditing(null);
                          return r;
                        })}
                      />
                      <Txt muted size={11}>לתיקון חיבור שגוי: השחקן כאן חוזר להיות אורח עם ההיסטוריה שלו, והחשבון חוזר לרשימת הממתינים כדי לאשר אותו נכון.</Txt>
                    </>
                  )}
                </Card>
              )}
            </View>
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
            <Txt weight="bold" size={16}>עיצוב השולחן</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {(Object.keys(THEMES) as ThemeKey[]).map(k => {
                const t = THEMES[k];
                const on = (group.table_theme ?? 'graphite') === k;
                return (
                  <Card
                    key={k}
                    onPress={() => run(() => supabase.from('groups').update({ table_theme: k }).eq('id', id))}
                    style={{ width: 92, alignItems: 'center', padding: 10, borderWidth: on ? 2 : 1, borderColor: on ? C.acc : C.line }}
                  >
                    <View style={{ width: 56, height: 34, borderRadius: 17, backgroundColor: t.felt, borderWidth: 4, borderColor: t.rail }} />
                    <Txt size={12} weight={on ? 'bold' : 'regular'} center>{t.name}</Txt>
                  </Card>
                );
              })}
            </View>
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
