import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { C } from '../lib/theme';
import { CONTACT_URL } from './privacy';
import { Screen, Txt, Card, Back, Btn } from '../ui/kit';

/** Public page (no sign-in): how to delete a דילר account. Linked from the store listing, as Google Play requires. */
export default function DeleteAccountInfo() {
  return (
    <Screen>
      <Back />
      <Txt size={26} weight="black">מחיקת חשבון בדילר</Txt>
      <Txt muted size={13} style={{ marginTop: 4, marginBottom: 12 }}>Deleting your Dealer account</Txt>
      <View style={{ gap: 10 }}>
        <Card style={{ gap: 6 }}>
          <Txt weight="bold" size={16} color={C.acc}>מתוך האפליקציה</Txt>
          <Txt size={14}>1. נכנסים לאפליקציה עם החשבון.</Txt>
          <Txt size={14}>2. במסך הבית לוחצים 👤 (החשבון שלי).</Txt>
          <Txt size={14}>3. בתחתית: "מחיקת החשבון", ומאשרים.</Txt>
        </Card>
        <Card style={{ gap: 6 }}>
          <Txt weight="bold" size={16} color={C.acc}>מה נמחק ומה נשמר</Txt>
          <Txt size={14}>נמחקים מיד ולצמיתות: כתובת המייל, הסיסמה ופרטי ההתחברות.</Txt>
          <Txt size={14}>נשמרים: הערבים של הקבוצה, תחת השם שלך כאורח בלי חשבון, כדי שההתחשבנות של שאר החברים לא תשתנה. מנהל הקבוצה יכול לשנות את השם.</Txt>
        </Card>
        <Card style={{ gap: 6 }}>
          <Txt weight="bold" size={16} color={C.acc}>אין גישה לאפליקציה?</Txt>
          <Txt size={14}>פונים אלינו עם המייל שאיתו נרשמת, ונמחק את החשבון תוך 30 יום.</Txt>
          <Btn small kind="ghost" title="פנייה למחיקת חשבון" onPress={() => void Linking.openURL(CONTACT_URL)} />
        </Card>
        <Card style={{ gap: 4 }}>
          <Txt muted size={13}>In English: open the app → 👤 (My account) → "Delete account" and confirm. Your email, password and login are deleted immediately; group history stays under your name as a guest. No access? Contact us with the email you signed up with.</Txt>
        </Card>
        <Btn small kind="ghost" title="מדיניות פרטיות" onPress={() => router.push('/privacy')} />
      </View>
      <View style={{ height: 24 }} />
    </Screen>
  );
}
