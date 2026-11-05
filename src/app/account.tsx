import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import { supabase, heError, APP_VERSION } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { pending } from '../lib/queue';
import { clearPendingInvite, APP_URL } from '../lib/invite';
import { C } from '../lib/theme';
import { Screen, Txt, Card, Back, Btn, ErrorBar, ConfirmBtn, Field, Seg } from '../ui/kit';

/** The signed-in person's own account: who am I, sign out, privacy, delete account. */
export default function Account() {
  const { session, userId } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mailSent, setMailSent] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [allGroups, setAllGroups] = useState<'all' | 'account'>('all');
  const [renameNote, setRenameNote] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('display_name').eq('id', userId).single()
      .then(({ data }) => setName(data?.display_name ?? ''));
  }, [userId]);

  const unsynced = pending().length;
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    supabase.rpc('is_app_admin').then(({ data }) => setOperator(data === true));
  }, []);

  const changePassword = async () => {
    const email = session?.user.email;
    if (!email) return;
    setErr(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${APP_URL}/reset` });
    if (error) setErr(heError(error));
    else setMailSent(true);
  };

  const saveName = async () => {
    if (editName == null) return;
    setErr(null);
    setBusy(true);
    const { data, error } = await supabase.rpc('rename_everywhere', { p_name: editName, p_all_groups: allGroups === 'all' });
    setBusy(false);
    if (error) return setErr(heError(error));
    const rows = (data ?? []) as { group_name: string; renamed: boolean }[];
    const skipped = rows.filter(r => !r.renamed).map(r => r.group_name);
    setName(editName.trim());
    setEditName(null);
    setRenameNote(allGroups === 'account'
      ? 'השם בחשבון עודכן. בקבוצות הקיימות השם לא השתנה.'
      : skipped.length
        ? `עודכן בחשבון ובקבוצות. ב${skipped.length === 1 ? 'קבוצה' : 'קבוצות'} ${skipped.map(n => `"${n}"`).join(', ')} השם כבר תפוס על ידי חבר אחר, אז שם נשאר הישן.`
        : 'השם עודכן בחשבון ובכל הקבוצות שלך.');
  };

  const remove = async () => {
    setErr(null);
    if (unsynced > 0) { setErr('יש רישומים שעוד לא נשלחו לשרת. קודם להתחבר לרשת ולחכות שיישלחו.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('delete_account');
    if (error) { setBusy(false); setErr(heError(error)); return; }
    clearPendingInvite();
    await supabase.auth.signOut({ scope: 'local' });
    setBusy(false);
    router.replace('/login');
  };

  return (
    <Screen>
      <Back />
      <Txt size={26} weight="black" style={{ marginBottom: 12 }}>החשבון שלי</Txt>
      <ErrorBar text={err} onClose={() => setErr(null)} />
      <Card style={{ gap: 4, marginBottom: 12 }}>
        {editName == null ? (
          <>
            <Txt weight="bold" size={18}>{name || ' '}</Txt>
            <Txt muted size={14}>{session?.user.email ?? ''}</Txt>
            <Btn small kind="ghost" title="✎ שינוי השם / כינוי" style={{ marginTop: 8 }} onPress={() => { setEditName(name); setRenameNote(null); }} />
          </>
        ) : (
          <>
            <Field label="השם או הכינוי שלך" value={editName} onChangeText={setEditName} maxLength={40} placeholder="למשל: הפטיש" />
            <Seg value={allGroups} onChange={setAllGroups} options={[{ v: 'all', t: 'בחשבון ובכל הקבוצות' }, { v: 'account', t: 'רק בחשבון' }]} />
            <Txt muted size={12}>"רק בחשבון": השם ישמש לקבוצות חדשות. בכל קבוצה אפשר גם לשנות בנפרד, בלשונית "שחקנים".</Txt>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Btn small kind="ghost" title="ביטול" style={{ flex: 1 }} onPress={() => setEditName(null)} />
              <Btn small title="שמירה" style={{ flex: 2 }} busy={busy} disabled={!editName.trim() || editName.trim() === name} onPress={() => void saveName()} />
            </View>
          </>
        )}
        {renameNote && <Txt size={13} color={C.pos} style={{ marginTop: 6 }}>{renameNote}</Txt>}
      </Card>
      <View style={{ gap: 10 }}>
        <Btn kind="ghost" title="יציאה מהחשבון" onPress={() => void supabase.auth.signOut()} />
        <Btn kind="ghost" title={mailSent ? 'נשלח קישור למייל ✓' : 'שינוי סיסמה (קישור למייל)'} disabled={mailSent} onPress={() => void changePassword()} />
        <Btn kind="ghost" title="פרטיות ותנאי שימוש" onPress={() => router.push('/privacy')} />
        {operator && <Btn kind="ghost" title="🛠 ניהול מערכת" onPress={() => router.push('/admin')} />}
      </View>
      <Txt muted size={11} center style={{ marginTop: 10 }}>{Platform.OS === 'web' ? 'אתר · תמיד הגרסה האחרונה' : `אנדרואיד · גרסה ${APP_VERSION}`}</Txt>

      <Card style={{ gap: 8, marginTop: 28, borderColor: C.danger }}>
        <Txt weight="bold" size={16} color={C.danger}>מחיקת חשבון</Txt>
        <Txt size={14} style={{ lineHeight: 21 }}>
          פרטי ההתחברות שלך יימחקו לצמיתות. היסטוריית הערבים של הקבוצות נשארת כמו שהיא, תחת השם שלך כאורח, כדי שההתחשבנות של החברים לא תשתנה.
        </Txt>
        <Txt muted size={13}>אם אתה בנקאי של ערב פתוח או המנהל היחיד בקבוצה, קודם להעביר את התפקיד.</Txt>
        <ConfirmBtn
          kind="danger"
          title="מחיקת החשבון"
          confirmTitle="למחוק את החשבון?"
          message="אי אפשר לבטל את זה. כדי לחזור תצטרך להירשם מחדש ולבקש להצטרף לקבוצות."
          okTitle="כן, למחוק"
          busy={busy}
          onConfirm={() => void remove()}
        />
      </Card>
      <View style={{ height: 24 }} />
    </Screen>
  );
}
