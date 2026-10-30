import { Linking, View } from 'react-native';
import { C } from '../lib/theme';
import { Screen, Txt, Card, Back, Btn } from '../ui/kit';

export const CONTACT_URL = 'https://github.com/dvirshr/poker-night/issues';
const UPDATED = 'אוקטובר 2026';

const PRIVACY: { title: string; items: string[] }[] = [
  {
    title: 'מה נשמר',
    items: [
      'פרטי חשבון: שם תצוגה, כתובת מייל וסיסמה (הסיסמה נשמרת מוצפנת ואף אחד לא רואה אותה).',
      'נתוני הקבוצה: חברים, ערבים, כניסות, ספירות, התחשבנות, תוצאות טורנירים וסטטיסטיקות.',
      'לא נשמרים פרטי תשלום, מספר טלפון, אנשי קשר, מיקום, תמונות או כל מידע אחר מהטלפון.',
    ],
  },
  {
    title: 'מי רואה מה',
    items: [
      'נתוני קבוצה גלויים רק לחברים המאושרים באותה קבוצה. ההרשאות נאכפות בשרת, לא רק באפליקציה.',
      'כתובת המייל שלך לא מוצגת לחברים אחרים.',
      'אין פרסומות, אין מעקב שיווקי, והמידע לא נמכר ולא מועבר לאף גורם.',
    ],
  },
  {
    title: 'איפה זה נשמר',
    items: [
      'הנתונים שמורים בשירות הענן Supabase, בחיבור מוצפן.',
      'האתר מתארח ב-GitHub Pages. בשימוש בקישור, GitHub עשוי לרשום נתוני גלישה טכניים כמו כתובת IP.',
    ],
  },
  {
    title: 'מחיקת חשבון',
    items: [
      'אפשר למחוק את החשבון בכל רגע מתוך האפליקציה: מסך החשבון (👤) ← מחיקת חשבון.',
      'המחיקה מוחקת את פרטי ההתחברות שלך, כולל המייל והסיסמה, ולא ניתן לשחזר אותה.',
      'היסטוריית הערבים של הקבוצה נשארת כמו שהיא, תחת השם שלך כאורח בלי חשבון, כדי שהקופות וההתחשבנות של כל החברים יישארו נכונות.',
      'רוצים שגם השם יוסר מההיסטוריה? מנהל הקבוצה יכול לשנות את שם השחקן, או לפנות אלינו.',
    ],
  },
];

const TERMS: string[] = [
  'האפליקציה היא כלי רישום בלבד: היא עוזרת לתעד כניסות, ספירות והתחשבנות בין חברים.',
  'אין באפליקציה משחק, הימור או העברת כספים. כל תשלום בין שחקנים נעשה מחוץ לאפליקציה ובאחריותם.',
  'המשתמשים אחראים לפעול לפי החוק במקום מגוריהם. השימוש מיועד לבני 18 ומעלה.',
  'האפליקציה ניתנת כמות שהיא (AS IS). אנחנו עושים מאמץ שהנתונים יהיו מדויקים וזמינים, אבל באחריות הבנקאי לבדוק את הקופה לפני סגירת ערב.',
  'אפשר לעדכן את התנאים מעת לעת. עדכון מהותי יופיע באפליקציה.',
];

/** Privacy policy and terms of use. Public: reachable before signing in (required by the app stores). */
export default function Privacy() {
  return (
    <Screen>
      <Back />
      <Txt size={26} weight="black">פרטיות ותנאי שימוש</Txt>
      <Txt muted size={13} style={{ marginTop: 4, marginBottom: 12 }}>{`עודכן: ${UPDATED}`}</Txt>
      <View style={{ gap: 10 }}>
        {PRIVACY.map(sec => (
          <Section key={sec.title} title={sec.title} items={sec.items} />
        ))}
        <Section title="תנאי שימוש" items={TERMS} />
        <Card style={{ gap: 8 }}>
          <Txt weight="bold" size={16} color={C.acc}>יצירת קשר</Txt>
          <Txt size={14}>שאלות, בקשות לגבי מידע או תקלות:</Txt>
          <Btn small kind="ghost" title="פנייה דרך GitHub" onPress={() => void Linking.openURL(CONTACT_URL)} />
        </Card>
      </View>
      <View style={{ height: 24 }} />
    </Screen>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <Card style={{ gap: 8 }}>
      <Txt weight="bold" size={16} color={C.acc}>{title}</Txt>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Txt color={C.acc}>•</Txt>
          <Txt size={14} style={{ flex: 1, lineHeight: 21 }}>{it}</Txt>
        </View>
      ))}
    </Card>
  );
}
