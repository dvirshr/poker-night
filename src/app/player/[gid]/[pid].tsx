import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGroupStats } from '../../../lib/useGroupStats';
import { useAuth } from '../../../lib/auth';
import { supabase } from '../../../lib/supabase';
import { playerStats, headToHead, byKind } from '../../../core/stats';
import { C, ils } from '../../../lib/theme';
import { Screen, Txt, Num, Card, Row, Back, Loading, Seg } from '../../../ui/kit';

const day = (d: string) => new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });

/** Bars per night, signed around zero: blue up for a win, orange down for a loss. Running total underneath. */
function NightBars({ trend }: { trend: { playedOn: string; net: number; cumulative: number }[] }) {
  const last = trend.slice(-12);
  const max = Math.max(1, ...last.map(t => Math.abs(t.net)));
  const H = 60;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: H * 2 + 2, direction: 'ltr' }}>
        {last.map((t, i) => {
          const h = Math.max(3, Math.round((Math.abs(t.net) / max) * H));
          return (
            <View key={i} style={{ flex: 1, height: H * 2 + 2, justifyContent: 'center' }} accessibilityLabel={`${day(t.playedOn)} ${ils(t.net, true)}`}>
              <View style={{ height: H, justifyContent: 'flex-end' }}>
                {t.net > 0 && <View style={{ height: h, backgroundColor: C.pos, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />}
              </View>
              <View style={{ height: 2, backgroundColor: C.line }} />
              <View style={{ height: H }}>
                {t.net < 0 && <View style={{ height: h, backgroundColor: C.neg, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />}
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, direction: 'ltr' }}>
        {last.map((t, i) => (
          <Txt key={i} size={10} muted center style={{ flex: 1 }}>{day(t.playedOn)}</Txt>
        ))}
      </View>
    </View>
  );
}

export default function PlayerCard() {
  const { gid, pid } = useLocalSearchParams<{ gid: string; pid: string }>();
  const stats = useGroupStats(gid);
  const { userId } = useAuth();
  const [kind, setKind] = useState<'all' | 'cash' | 'tournament'>('all');
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    supabase.from('players').select('id').eq('group_id', gid).eq('profile_id', userId).maybeSingle()
      .then(({ data }) => setMyId((data as { id: string } | null)?.id ?? null));
  }, [gid, userId]);
  const nights = useMemo(() => byKind(stats.nights, kind), [stats.nights, kind]);
  const s = useMemo(() => playerStats(nights, pid), [nights, pid]);
  const h2h = useMemo(() => (myId ? headToHead(nights, myId) : []), [nights, myId]);
  const isMe = myId === pid;
  const rows = isMe ? h2h : h2h.filter(h => h.otherId === pid);
  const name = stats.nights.find(n => n.playerId === pid)?.name ?? '';
  const myTitles = stats.titles.get(pid) ?? [];

  if (!stats.nights.length && !name) {
    return (
      <Screen>
        <Back label="הקבוצה" to={`/group/${gid}`} />
        <Txt muted>עוד אין ערבים סגורים לשחקן הזה</Txt>
      </Screen>
    );
  }
  if (!name) return <Loading />;

  const tile = (label: string, value: string, color?: string) => (
    <Card style={{ flex: 1, minWidth: 140, alignItems: 'flex-start', gap: 2 }}>
      <Txt muted size={12}>{label}</Txt>
      <Num weight="black" size={22} color={color}>{value}</Num>
    </Card>
  );

  return (
    <Screen>
      <Back label="הקבוצה" to={`/group/${gid}`} />
      <Txt size={28} weight="black">{name}</Txt>
      {myTitles.length > 0 && (
        <View style={{ gap: 2, marginTop: 4 }}>
          {myTitles.map(t => (
            <Txt key={t.key} size={14}>{`${t.emoji} ${t.label} · `}<Txt muted size={13}>{t.why}</Txt></Txt>
          ))}
        </View>
      )}

      {(
        <View style={{ marginTop: 14 }}>
          <Seg value={kind} onChange={setKind} options={[{ v: 'all', t: 'הכל' }, { v: 'cash', t: '💵 קאש' }, { v: 'tournament', t: '🏆 טורנירים' }]} />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 0 }}>
        {tile('נטו מצטבר', ils(s.netTotal, true), s.netTotal > 0 ? C.pos : s.netTotal < 0 ? C.neg : undefined)}
        {tile(kind === 'tournament' ? 'טורנירים' : 'ערבים', String(s.nights))}
        {tile('ממוצע לערב', s.nights ? ils(Math.round(s.netTotal / s.nights), true) : '—')}
        {kind === 'tournament' ? tile('🏆 נצחונות · פודיומים', `${s.wins} · ${s.podiums}`) : tile('ערבים ברווח', `${s.profitablePct}%`)}
        {kind === 'tournament' ? tile('סיים בכסף', `${s.itmPct}%`) : tile('כניסה ממוצעת לערב', ils(s.avgIn))}
      </View>

      {myId && rows.length > 0 && (
        <Card style={{ marginTop: 12, gap: 8 }}>
          <Txt weight="bold">{isMe ? 'ראש בראש: אני מול כל אחד' : `ראש בראש: אני מול ${name}`}</Txt>
          <Txt muted size={12}>רק בערבים ששנינו שיחקנו</Txt>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt muted size={11} style={{ flex: 2 }}>מול</Txt>
            <Txt muted size={11} style={{ flex: 1, textAlign: 'center' }}>ערבים</Txt>
            <Txt muted size={11} style={{ flex: 1.4, textAlign: 'center' }}>אני</Txt>
            <Txt muted size={11} style={{ flex: 1.4, textAlign: 'center' }}>היריב</Txt>
            <Txt muted size={11} style={{ flex: 1.4, textAlign: 'center' }}>מי מעל</Txt>
          </Row>
          {rows.map(h => (
            <Row key={h.otherId} style={{ justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
              <Txt weight="bold" style={{ flex: 2 }}>{h.otherName}</Txt>
              <Num style={{ flex: 1, textAlign: 'center' }}>{String(h.nights)}</Num>
              <Num weight="bold" size={13} color={h.myNet >= 0 ? C.pos : C.neg} style={{ flex: 1.4, textAlign: 'center' }}>{ils(h.myNet, true)}</Num>
              <Num size={13} color={h.otherNet >= 0 ? C.pos : C.neg} style={{ flex: 1.4, textAlign: 'center' }}>{ils(h.otherNet, true)}</Num>
              <Num weight="bold" size={13} color={h.meAhead > h.otherAhead ? C.pos : h.meAhead < h.otherAhead ? C.neg : C.muted} style={{ flex: 1.4, textAlign: 'center' }}>{`${h.meAhead} נגד ${h.otherAhead}`}</Num>
            </Row>
          ))}
          <Txt muted size={11}>מי מעל: בכמה ערבים סיימתי מעל היריב, נגד כמה הוא מעליי. בקאש לפי רווח, בטורניר לפי מקום.</Txt>
        </Card>
      )}

      {s.trend.length > 0 && (
        <Card style={{ marginTop: 12, gap: 10 }}>
          <Txt weight="bold">{`רווח והפסד לפי ערב${s.trend.length > 12 ? ' (12 אחרונים)' : ''}`}</Txt>
          <NightBars trend={s.trend} />
        </Card>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {s.best && s.best.net > 0 && tile(`הערב הכי טוב · ${day(s.best.playedOn)}`, ils(s.best.net, true), C.pos)}
        {s.worst && s.worst.net < 0 && tile(`הערב הכי קשה · ${day(s.worst.playedOn)}`, ils(s.worst.net, true), C.neg)}
      </View>
      <Row style={{ marginTop: 12 }}>
        <Txt muted size={12}>{`${s.rebuys} כניסות חוזרות בסך הכול`}</Txt>
      </Row>
    </Screen>
  );
}
