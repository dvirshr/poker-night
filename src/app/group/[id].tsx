import { useCallback, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase, heError } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { C, ils, medal } from '../../lib/theme';
import { inviteLink, inviteMessage } from '../../lib/invite';
import { useGroupStats, titleBadges } from '../../lib/useGroupStats';
import { hostTable } from '../../core/hosting';
import { monthName, periods, byKind, type Standing, league as leagueRows, MIN_NIGHTS, type LeagueRow, type LeagueSort } from '../../core/stats';
import { THEMES, type ThemeKey } from '../../lib/theme';
import { Screen, H1, Card, Txt, Num, Btn, Field, Seg, ErrorBar, Row, Badge, Back, RefreshBtn, useOnResume } from '../../ui/kit';

type Player = { id: string; display_name: string; role: string; status: string; is_guest: boolean; profile_id: string | null };
type Game = { id: string; name: string; status: string; played_on: string; created_at: string; game_type?: string; host_player_id?: string | null };
type League = { player_id: string; display_name: string; games_played: number; net_total: number; net_avg: number; wins: number; game_type?: string; podiums?: number };

export default function Group() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [group, setGroup] = useState<{ name: string; banker_mode: string; table_theme?: ThemeKey; hosting_enabled?: boolean; host_rotation?: string[] } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [league, setLeague] = useState<League[]>([]);
  const [kind, setKind] = useState<'all' | 'cash' | 'tournament'>('all');
  const [sort, setSort] = useState<LeagueSort>('total');
  const [mineOnly, setMineOnly] = useState(false);
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [tab, setTab] = useState<'league' | 'month' | 'history' | 'hosting' | 'members' | 'settings'>('league');
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
  const open = games.find(g => g.status === 'open' || g.status === 'counting');
  const active = players.filter(p => p.status === 'active');
  const pendingList = players.filter(p => p.status === 'pending');
  const hostingOn = !!group?.hosting_enabled;
  const rotation = (group?.host_rotation ?? []).filter(pid => active.some(p => p.id === pid));
  const hostedNights = games.map(g => ({ gameId: g.id, playedOn: g.played_on, createdAt: g.created_at, hostId: g.host_player_id ?? null }));
  const pname = (pid: string | null | undefined) => players.find(p => p.id === pid)?.display_name ?? '';
  const setRotation = (r: string[]) => run(() => supabase.from('groups').update({ host_rotation: r }).eq('id', id));
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
          <Txt muted size={13}>{open.host_player_id ? `🏠 אצל ${pname(open.host_player_id)} · הקשה לכניסה לשולחן` : 'הקשה לכניסה לשולחן'}</Txt>
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
          { v: 'month', t: 'חודשי ושנתי' },
          { v: 'history', t: 'היסטוריה' },
          ...(hostingOn ? [{ v: 'hosting' as const, t: '🏠 סבב מארחים' }] : []),
          { v: 'members', t: 'שחקנים' },
          ...(isAdmin ? [{ v: 'settings' as const, t: 'הגדרות' }] : []),
        ]}
      />

      {tab === 'league' && (() => {
        const rows = leagueRows(stats.nights, { sort, kind, withPlayer: mineOnly ? me?.id : null });
        const metric = (r: LeagueRow) => (sort === 'avg' ? ils(Math.round(r.avg), true) : sort === 'wins' ? `${r.winPct}%` : ils(r.net, true));
        const tone = (r: LeagueRow) => (sort === 'wins' ? C.text : r.net > 0 ? C.pos : r.net < 0 ? C.neg : C.muted);
        let rank = 0;
        return (
          <View style={{ gap: 6 }}>
            <Seg value={sort} onChange={setSort} options={[{ v: 'total', t: 'סה״כ' }, { v: 'avg', t: 'ממוצע לערב' }, { v: 'wins', t: '% נצחונות' }]} />
            {(
              <Seg value={kind} onChange={setKind} options={[{ v: 'all', t: 'הכל' }, { v: 'cash', t: '💵 קאש' }, { v: 'tournament', t: '🏆 טורנירים' }]} />
            )}
            {me && (
              <Seg value={mineOnly ? 1 : 0} onChange={v => setMineOnly(v === 1)} options={[{ v: 0, t: 'כל הערבים' }, { v: 1, t: 'רק ערבים שהשתתפתי' }]} />
            )}
            {rows.length === 0 && <Txt muted>הטבלה תתמלא אחרי הערב הראשון שנסגר</Txt>}
            {stats.titles.size > 0 && !mineOnly && kind === 'all' && (
              <Txt muted size={12} style={{ marginBottom: 4 }}>
                {[...new Map([...stats.titles.values()].flat().map(t => [t.key, t])).values()].map(t => `${t.emoji} ${t.label}`).join(' · ')}
              </Txt>
            )}
            {rows.map((r, i) => {
              const firstOut = !r.qualified && (i === 0 || rows[i - 1].qualified);
              if (r.qualified) rank += 1;
              return (
                <View key={r.playerId} style={{ gap: 6 }}>
                  {firstOut && <Txt muted size={12} style={{ marginTop: 8 }}>{`פחות מ־${MIN_NIGHTS} ערבים · לא מדורגים עדיין`}</Txt>}
                  <Card onPress={() => router.push(`/player/${id}/${r.playerId}`)} accent={r.playerId === me?.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, opacity: r.qualified ? 1 : 0.55 }}>
                    <Row>
                      <Num weight="black" size={16} color={C.muted}>{r.qualified ? String(rank) : '–'}</Num>
                      <View>
                        <Txt weight="bold">{`${r.name} ${titleBadges(stats.titles.get(r.playerId))}`}</Txt>
                        <Txt muted size={12}>{kind === 'tournament'
                          ? `${r.nights === 1 ? 'טורניר אחד' : `${r.nights} טורנירים`} · ${r.wins} 🏆 · ${r.podiums} פודיומים · סה״כ ${ils(r.net, true)}`
                          : `${r.nights === 1 ? 'ערב אחד' : `${r.nights} ערבים`} · ${r.wins === 1 ? 'נצחון אחד' : `${r.wins} נצחונות`} · ${sort === 'total' ? `ממוצע ${ils(Math.round(r.avg), true)}` : `סה״כ ${ils(r.net, true)}`}`}</Txt>
                      </View>
                    </Row>
                    <Num weight="black" size={18} color={tone(r)}>{metric(r)}</Num>
                  </Card>
                </View>
              );
            })}
            {mineOnly && <Txt muted size={12} style={{ marginTop: 4 }}>מחושב רק מהערבים שבהם שיחקת: איך כל אחד עשה כשישבתם יחד</Txt>}
          </View>
        );
      })()}

      {tab === 'month' && (() => {
        const list = periods(byKind(stats.nights, kind), stats.transfers, period);
        const names = (l: Standing[]) => l.map(x => x.name).join(' + ');
        const tie = (l: Standing[]) => (l.length > 1 ? ' (שוויון)' : '');
        const title = (k: string) => (period === 'month' ? monthName(k) : `שנת ${k}`);
        const unit = kind === 'tournament' ? 'טורנירים' : 'ערבים';
        return (
          <View style={{ gap: 8 }}>
            <Seg value={period} onChange={setPeriod} options={[{ v: 'month', t: 'חודשי' }, { v: 'year', t: 'שנתי' }]} />
            <Seg value={kind} onChange={setKind} options={[{ v: 'all', t: 'הכל' }, { v: 'cash', t: '💵 קאש' }, { v: 'tournament', t: '🏆 טורנירים' }]} />
            {list.length === 0 && <Txt muted>הסיכום יופיע אחרי הערב הראשון שנסגר</Txt>}
            {list.map(m => {
              const extras = [
                m.bestNight ? `🚀 הערב הכי טוב: ${m.bestNight.name} ${ils(m.bestNight.net, true)} (${new Date(m.bestNight.playedOn).toLocaleDateString('he-IL')})` : '',
                m.biggestTransfer ? `💸 ההעברה הכי גדולה: ${m.biggestTransfer.from} ← ${m.biggestTransfer.to} ${ils(m.biggestTransfer.amountIls)}` : '',
              ].filter(Boolean);
              const statLine = `${m.nights} ${unit} · ${m.players} שחקנים · ${ils(m.pot)} עברו בקופה`;
              const lines = [
                `🃏 ${group?.name ?? ''} · ${title(m.key)}${kind === 'cash' ? ' · קאש' : kind === 'tournament' ? ' · טורנירים' : ''}`,
                statLine,
                ...(period === 'year'
                  ? [
                      m.byWins.length ? `🏆 נצחונות: ${m.byWins.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.name} ${r.wins}`).join('  ')}` : '',
                      m.byMoney.length ? `💰 כסף: ${m.byMoney.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.name} ${ils(r.net, true)}`).join('  ')}` : '',
                    ]
                  : [
                      m.winsKing.length ? `🏆 מנצח החודש: ${names(m.winsKing)} · ${m.winsKing[0].wins} נצחונות${tie(m.winsKing)}` : '',
                      m.moneyKing.length ? `💰 מלך הכסף: ${names(m.moneyKing)} ${ils(m.moneyKing[0].net, true)}${tie(m.moneyKing)}` : '',
                    ]),
                ...extras,
              ].filter(Boolean);
              const podium = (label: string, rows: Standing[], value: (r: Standing) => string) => (
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt muted size={12}>{label}</Txt>
                  {rows.map((r, i) => (
                    <Row key={r.playerId} style={{ gap: 6 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: medal(i + 1), alignItems: 'center', justifyContent: 'center' }}>
                        <Txt size={11} weight="black" color={C.accInk} center>{String(i + 1)}</Txt>
                      </View>
                      <Txt size={14} weight={i === 0 ? 'bold' : 'regular'} style={{ flexShrink: 1 }}>{r.name}</Txt>
                      <Num size={13} muted>{value(r)}</Num>
                    </Row>
                  ))}
                  {rows.length === 0 && <Txt muted size={13}>—</Txt>}
                </View>
              );
              return (
                <Card key={m.key} style={{ gap: 8 }}>
                  <Txt weight="black" size={18}>{title(m.key)}</Txt>
                  <Txt muted size={13}>{statLine}</Txt>
                  {period === 'year' ? (
                    <Row style={{ alignItems: 'flex-start', gap: 12 }}>
                      {podium('🏆 נצחונות', m.byWins, r => String(r.wins))}
                      {podium('💰 כסף', m.byMoney, r => ils(r.net, true))}
                    </Row>
                  ) : (
                    <View style={{ gap: 4 }}>
                      <Txt size={14}>{m.winsKing.length ? `🏆 מנצח החודש: ` : '🏆 אין מנצח החודש'}<Txt size={14} weight="bold">{names(m.winsKing)}</Txt>{m.winsKing.length ? ` · ${m.winsKing[0].wins} נצחונות${tie(m.winsKing)}` : ''}</Txt>
                      <Txt size={14}>{m.moneyKing.length ? `💰 מלך הכסף: ` : '💰 אף אחד לא ברווח'}<Txt size={14} weight="bold">{names(m.moneyKing)}</Txt>{m.moneyKing.length ? ` ${ils(m.moneyKing[0].net, true)}${tie(m.moneyKing)}` : ''}</Txt>
                    </View>
                  )}
                  {extras.map((l, i) => <Txt key={i} size={13} muted>{l}</Txt>)}
                  <Btn small kind="ghost" title="שיתוף הסיכום" style={{ marginTop: 4 }} onPress={() => Share.share({ message: lines.join('\n') })} />
                </Card>
              );
            })}
          </View>
        );
      })()}

      {tab === 'history' && (
        <View style={{ gap: 6 }}>
          {games.filter(g => g.status === 'closed').length === 0 && <Txt muted>עוד אין ערבים סגורים</Txt>}
          {games
            .filter(g => g.status === 'closed')
            .map(g => (
              <Card key={g.id} onPress={() => router.push(`/game/${g.id}/summary`)}>
                <Txt weight="bold">{`${g.game_type === 'tournament' ? '🏆 ' : ''}${g.name}`}</Txt>
                <Txt muted size={12}>{`${new Date(g.played_on).toLocaleDateString('he-IL')}${g.host_player_id ? ` · 🏠 אצל ${pname(g.host_player_id)}` : ''}`}</Txt>
              </Card>
            ))}
        </View>
      )}

      {tab === 'hosting' && hostingOn && (() => {
        const rows = hostTable(rotation, hostedNights);
        const next = rows.find(r => r.isNext);
        const outside = [...new Set(games.map(g => g.host_player_id).filter((x): x is string => !!x && !rotation.includes(x)))]
          .map(pid => ({ pid, times: games.filter(g => g.host_player_id === pid).length }));
        const total = games.filter(g => g.host_player_id).length;
        const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('he-IL') : '—');
        return (
          <View style={{ gap: 8 }}>
            {next ? (
              <Card accent style={{ gap: 2 }}>
                <Txt muted size={13}>הבא בתור לארח</Txt>
                <Txt weight="black" size={24}>{`🏠 ${pname(next.playerId)}`}</Txt>
              </Card>
            ) : (
              <Card><Txt muted>{isAdmin ? 'עוד אין סדר אירוח. בונים אותו בלשונית "הגדרות".' : 'המנהל עוד לא קבע סדר אירוח'}</Txt></Card>
            )}
            {rows.length > 0 && (
              <Card style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt muted size={11} style={{ width: 28 }}>תור</Txt>
                  <Txt muted size={11} style={{ flex: 2 }}>שחקן</Txt>
                  <Txt muted size={11} style={{ flex: 1, textAlign: 'center' }}>אירח</Txt>
                  <Txt muted size={11} style={{ flex: 1.6, textAlign: 'center' }}>פעם אחרונה</Txt>
                </Row>
                {rows.map((r, i) => (
                  <Row key={r.playerId} style={{ justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line }}>
                    <Num weight="bold" color={C.muted} style={{ width: 28 }}>{String(i + 1)}</Num>
                    <Txt weight={r.isNext ? 'black' : 'bold'} color={r.isNext ? C.acc : C.text} style={{ flex: 2 }}>{`${pname(r.playerId)}${r.isNext ? ' · הבא' : ''}`}</Txt>
                    <Num weight="bold" style={{ flex: 1, textAlign: 'center' }}>{String(r.times)}</Num>
                    <Txt muted size={13} style={{ flex: 1.6, textAlign: 'center' }}>{day(r.last)}</Txt>
                  </Row>
                ))}
                <Txt muted size={11}>{`סה״כ ${total} ערבים עם מארח. "הבא" נקבע לפי מי שאירח אחרון והסדר ברשימה, כך שהחלפת תור מסתדרת לבד.`}</Txt>
              </Card>
            )}
            {outside.length > 0 && (
              <Card style={{ gap: 4 }}>
                <Txt weight="bold">אירחו מחוץ לסבב</Txt>
                {outside.map(o => <Txt key={o.pid} size={14}>{`${pname(o.pid)} · ${o.times === 1 ? 'פעם אחת' : `${o.times} פעמים`}`}</Txt>)}
              </Card>
            )}
          </View>
        );
      })()}

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
          <Card style={{ gap: 8 }}>
            <Txt weight="bold" size={16}>🏠 סבב מארחים</Txt>
            <Seg value={hostingOn ? 1 : 0} onChange={v => run(() => supabase.from('groups').update({ hosting_enabled: v === 1 }).eq('id', id))}
              options={[{ v: 0, t: 'כבוי' }, { v: 1, t: 'פעיל' }]} />
            {hostingOn && (
              <>
                <Txt muted size={12}>הסדר שבו מארחים. בפתיחת ערב, הבא בתור מסומן אוטומטית כמארח (אפשר לשנות).</Txt>
                {rotation.map((pid, i) => (
                  <Row key={pid} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Row>
                      <Num weight="bold" color={C.muted}>{String(i + 1)}</Num>
                      <Txt weight="bold">{pname(pid)}</Txt>
                    </Row>
                    <Row style={{ gap: 14 }}>
                      <Pressable hitSlop={8} disabled={i === 0} onPress={() => { const r = [...rotation]; [r[i - 1], r[i]] = [r[i], r[i - 1]]; setRotation(r); }}>
                        <Txt weight="bold" size={18} color={i === 0 ? C.line : C.acc}>▲</Txt>
                      </Pressable>
                      <Pressable hitSlop={8} disabled={i === rotation.length - 1} onPress={() => { const r = [...rotation]; [r[i + 1], r[i]] = [r[i], r[i + 1]]; setRotation(r); }}>
                        <Txt weight="bold" size={18} color={i === rotation.length - 1 ? C.line : C.acc}>▼</Txt>
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => setRotation(rotation.filter(x => x !== pid))} accessibilityLabel={`הוצאת ${pname(pid)} מהסבב`}>
                        <Txt weight="bold" size={18} color={C.danger}>✕</Txt>
                      </Pressable>
                    </Row>
                  </Row>
                ))}
                {active.filter(p => !rotation.includes(p.id)).length > 0 && (
                  <>
                    <Txt muted size={12} style={{ marginTop: 4 }}>להוספה לסוף הסבב:</Txt>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {active.filter(p => !rotation.includes(p.id)).map(p => (
                        <Btn key={p.id} small kind="ghost" title={`+ ${p.display_name}`} style={{ height: 38, paddingHorizontal: 12 }} onPress={() => setRotation([...rotation, p.id])} />
                      ))}
                    </View>
                  </>
                )}
                <Txt muted size={11}>יש כבר סבב קיים? שים בסוף הרשימה את מי שאירח אחרון, וכך הבא אחריו יהיה ראשון.</Txt>
              </>
            )}
          </Card>
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
