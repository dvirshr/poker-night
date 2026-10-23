import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGroupStats } from '../../../lib/useGroupStats';
import { playerStats } from '../../../core/stats';
import { C, ils } from '../../../lib/theme';
import { Screen, Txt, Num, Card, Row, Back, Loading } from '../../../ui/kit';

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
  const s = useMemo(() => playerStats(stats.nights, pid), [stats.nights, pid]);
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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
        {tile('נטו מצטבר', ils(s.netTotal, true), s.netTotal > 0 ? C.pos : s.netTotal < 0 ? C.neg : undefined)}
        {tile('ערבים', String(s.nights))}
        {tile('ערבים ברווח', `${s.profitablePct}%`)}
        {tile('כניסה ממוצעת לערב', ils(s.avgIn))}
      </View>

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
