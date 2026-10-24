import { useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { GUIDE, WEB_LINK, APK_LINK, type GuideRole } from '../lib/guide';
import { C } from '../lib/theme';
import { Screen, Txt, Card, Seg, Back, Btn } from '../ui/kit';

/** In-app user guide: player, banker, admin. Open to everyone, also before signing in. */
export default function Help() {
  const { role } = useLocalSearchParams<{ role?: GuideRole }>();
  const [tab, setTab] = useState<GuideRole>(role && GUIDE.some(g => g.role === role) ? role : 'player');
  const part = GUIDE.find(g => g.role === tab)!;
  return (
    <Screen>
      <Back />
      <Txt size={26} weight="black">איך זה עובד</Txt>
      <Txt muted size={13} style={{ marginTop: 4, marginBottom: 12 }}>בחר את התפקיד שלך בערב</Txt>
      <Seg value={tab} onChange={setTab} options={GUIDE.map(g => ({ v: g.role, t: g.tab }))} />
      <Card accent style={{ marginBottom: 12 }}>
        <Txt weight="black" size={18}>{part.title}</Txt>
        <Txt size={14}>{part.intro}</Txt>
      </Card>
      <View style={{ gap: 10 }}>
        {part.sections.map(sec => (
          <Card key={sec.title} style={{ gap: 8 }}>
            <Txt weight="bold" size={16} color={C.acc}>{sec.title}</Txt>
            {sec.items.map((it, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <Txt color={C.acc}>•</Txt>
                <Txt size={14} style={{ flex: 1, lineHeight: 21 }}>{it}</Txt>
              </View>
            ))}
            {sec.title === 'התקנה' && (
              <View style={{ gap: 8, marginTop: 4 }}>
                {Platform.OS === 'web' && <Btn small title="הורדה לאנדרואיד" onPress={() => void Linking.openURL(APK_LINK)} />}
                <Btn small kind="ghost" title="קישור לאתר" onPress={() => void Linking.openURL(WEB_LINK)} />
              </View>
            )}
          </Card>
        ))}
      </View>
      <Btn small kind="ghost" title="שיתוף המדריך בוואטסאפ" style={{ marginTop: 14 }}
        onPress={() => void Share.share({ message: `🃏 ערב פוקר · איך זה עובד (בלי הרשמה):\n${WEB_LINK}/help${tab === 'player' ? '' : `?role=${tab}`}` })} />
    </Screen>
  );
}
