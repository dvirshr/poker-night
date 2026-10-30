import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { pendingInvite, APP_URL } from '../lib/invite';
import { supabase, heError } from '../lib/supabase';
import { C } from '../lib/theme';
import { Screen, H1, Field, Btn, Seg, ErrorBar, Txt, Card } from '../ui/kit';

export default function Login() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const invited = !!pendingInvite();
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>(
    params.mode === 'forgot' ? 'forgot' : params.mode === 'up' || (invited && params.mode !== 'in') ? 'up' : 'in');
  const [sent, setSent] = useState(false);
  const [invite, setInvite] = useState<{ group_name: string; inviter: string } | null>(null);
  useEffect(() => {
    const code = pendingInvite();
    if (!code) return;
    supabase.rpc('invite_info', { p_code: code }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : null;
      if (row) setInvite(row);
    });
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    const e = email.trim().toLowerCase();
    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: `${APP_URL}/reset` });
      setBusy(false);
      if (error) setErr(heError(error));
      else setSent(true);
      return;
    }
    const { error } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email: e, password })
        : await supabase.auth.signUp({ email: e, password, options: { data: { full_name: name.trim() } } });
    setBusy(false);
    if (error) setErr(heError(error));
  };

  const ok = email.includes('@') && (mode === 'forgot' || (password.length >= 6 && (mode === 'in' || name.trim().length > 0)));

  if (mode === 'forgot') {
    return (
      <Screen>
        <View style={{ height: 40 }} />
        <H1 sub="נשלח אליך קישור לקביעת סיסמה חדשה">שכחתי סיסמה</H1>
        <ErrorBar text={err} onClose={() => setErr(null)} />
        {sent ? (
          <Card accent style={{ gap: 6, marginBottom: 12 }}>
            <Txt weight="bold" size={16}>אם המייל רשום, נשלח אליו קישור ✓</Txt>
            <Txt muted size={13}>לפתוח את המייל ולהיכנס לקישור. כדאי לבדוק גם בספאם. הקישור תקף לזמן קצר.</Txt>
          </Card>
        ) : (
          <>
            <Field label="המייל שאיתו נרשמת" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Btn title="שליחת קישור" onPress={submit} disabled={!ok} busy={busy} />
          </>
        )}
        <Btn small kind="ghost" title="חזרה לכניסה" style={{ marginTop: 12 }} onPress={() => { setMode('in'); setSent(false); setErr(null); }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ height: 40 }} />
      <H1 sub="ניהול ערב פוקר: קופה, כניסות, ספירה והתחשבנות">ערב פוקר</H1>
      <Seg value={mode as 'in' | 'up'} onChange={setMode} options={[{ v: 'in', t: 'התחברות' }, { v: 'up', t: 'הרשמה' }]} />
      {invited && (
        <Card accent style={{ marginBottom: 14 }}>
          <Txt weight="bold" size={16}>{invite ? `${invite.inviter} הזמין אותך לקבוצה "${invite.group_name}"` : 'הוזמנת לקבוצת פוקר'}</Txt>
          <Txt muted size={13}>אחרי ההרשמה תצורף לקבוצה, והמנהל יאשר אותך</Txt>
        </Card>
      )}
      <ErrorBar text={err} onClose={() => setErr(null)} />
      {mode === 'up' && <Field label="השם שיופיע לחבר'ה" value={name} onChangeText={setName} maxLength={40} />}
      <Field label="מייל" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="סיסמה (6 תווים לפחות)" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
      <Btn title={mode === 'in' ? 'כניסה' : 'יצירת חשבון'} onPress={submit} disabled={!ok} busy={busy} />
      {mode === 'in' && <Btn small kind="ghost" title="שכחתי סיסמה" style={{ marginTop: 8 }} onPress={() => { setMode('forgot'); setErr(null); }} />}
      {mode === 'up' && <Txt muted size={12} center style={{ marginTop: 8 }}>ההרשמה מהווה הסכמה לתנאי השימוש ולמדיניות הפרטיות</Txt>}
      <View style={{ height: 16 }} />
      <Txt muted size={12} center>מבקשים רק שם, מייל וסיסמה. אין פרטי תשלום ואין גישה לשום דבר בטלפון.</Txt>
      <Txt muted size={12} center>עדיף סיסמה חדשה, לא זו של הבנק או המייל. מתחברים פעם אחת.</Txt>
      <Btn small kind="ghost" title="❓ איך זה עובד" style={{ marginTop: 8 }} onPress={() => router.push('/help')} />
      <Btn small kind="ghost" title="פרטיות ותנאי שימוש" style={{ marginTop: 4 }} onPress={() => router.push('/privacy')} />
    </Screen>
  );
}
