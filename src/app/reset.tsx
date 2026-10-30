import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import { supabase, heError } from '../lib/supabase';
import { Screen, H1, Field, Btn, ErrorBar, Txt, Card } from '../ui/kit';

/**
 * Where the "forgot password" email link lands (web).
 * Supabase sends the person back with a one-time session in the URL; we take it,
 * clear it from the address bar, and let them choose a new password.
 */
export default function Reset() {
  const [stage, setStage] = useState<'loading' | 'form' | 'bad' | 'done'>('loading');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') { setStage('bad'); return; }
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);
      const linkErr = hash.get('error_description') || query.get('error_description');
      try {
        if (linkErr) throw new Error(linkErr);
        const at = hash.get('access_token');
        const rt = hash.get('refresh_token');
        const code = query.get('code');
        if (at && rt) {
          const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) { setStage('bad'); return; }
        }
        // tokens out of the address bar (and out of the browser history)
        window.history.replaceState(null, '', window.location.pathname);
        setStage('form');
      } catch (e) {
        setErr(heError(e));
        setStage('bad');
      }
    })();
  }, []);

  const save = async () => {
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(heError(error));
    else setStage('done');
  };

  const ok = pw.length >= 6 && pw === pw2;

  return (
    <Screen>
      <View style={{ height: 40 }} />
      <H1 sub="איפוס סיסמה">ערב פוקר</H1>
      <ErrorBar text={err} onClose={() => setErr(null)} />
      {stage === 'loading' && <Txt muted>בודק את הקישור…</Txt>}
      {stage === 'bad' && (
        <Card style={{ gap: 8 }}>
          <Txt weight="bold" size={16}>הקישור לא תקף</Txt>
          <Txt muted size={14}>אולי כבר השתמשו בו או שפג תוקפו. אפשר לבקש קישור חדש ממסך הכניסה.</Txt>
          <Btn small title="למסך הכניסה" onPress={() => router.replace({ pathname: '/login', params: { mode: 'forgot' } })} />
        </Card>
      )}
      {stage === 'form' && (
        <>
          <Field label="סיסמה חדשה (6 תווים לפחות)" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
          <Field label="שוב, לאימות" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" />
          {pw2.length > 0 && pw !== pw2 && <Txt muted size={13} style={{ marginBottom: 8 }}>הסיסמאות לא זהות</Txt>}
          <Btn title="שמירת הסיסמה" onPress={save} disabled={!ok} busy={busy} />
        </>
      )}
      {stage === 'done' && (
        <Card accent style={{ gap: 8 }}>
          <Txt weight="bold" size={16}>הסיסמה עודכנה ✓</Txt>
          <Txt muted size={14}>מהיום נכנסים עם הסיסמה החדשה, גם באפליקציה בטלפון.</Txt>
          <Btn small title="להמשיך לאפליקציה" onPress={() => router.replace('/')} />
        </Card>
      )}
    </Screen>
  );
}
