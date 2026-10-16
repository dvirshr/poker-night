import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { savePendingInvite } from '../../lib/invite';
import { Screen, H1, Btn, Txt, Loading } from '../../ui/kit';

/** Landing page of an invite link: remember the code, then sign in / up. Home finishes the join. */
export default function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session, ready } = useAuth();

  useEffect(() => {
    if (code) savePendingInvite(String(code).trim());
    if (ready && session) router.replace('/');
  }, [code, ready, session]);

  if (!ready || session) return <Loading />;
  return (
    <Screen>
      <View style={{ height: 40 }} />
      <H1 sub="ניהול ערב פוקר: קופה, כניסות, ספירה והתחשבנות">הוזמנת לקבוצת פוקר 🃏</H1>
      <Txt style={{ marginBottom: 20 }}>נרשמים פעם אחת, וההצטרפות לקבוצה קורית אוטומטית. מנהל הקבוצה יאשר אותך.</Txt>
      <Btn title="הרשמה" onPress={() => router.replace({ pathname: '/login', params: { mode: 'up' } })} />
      <View style={{ height: 10 }} />
      <Btn title="כבר יש לי חשבון" kind="ghost" onPress={() => router.replace('/login')} />
    </Screen>
  );
}
