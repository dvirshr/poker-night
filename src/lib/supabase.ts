import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local');

export const supabase = createClient(url, key, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Turn a Postgres / PostgREST error into a Hebrew message for the user. */
export function heError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  const map: [RegExp, string][] = [
    [/Invalid login credentials/i, 'מייל או סיסמה שגויים'],
    [/User already registered/i, 'המייל כבר רשום. אפשר להתחבר'],
    [/Password should be at least/i, 'סיסמה של 6 תווים לפחות'],
    [/invite code is invalid or expired/i, 'קוד ההזמנה לא תקין או שפג תוקפו'],
    [/rebuy limit reached/i, 'השחקן הגיע למקסימום הריבאיים'],
    [/rebuy window has closed/i, 'זמן הריבאי הסתיים'],
    [/rebuys are not allowed/i, 'במשחק הזה אין כניסות חוזרות'],
    [/no buy-ins once counting/i, 'אי אפשר להוסיף כניסות אחרי שהספירה התחילה'],
    [/game is closed/i, 'הערב סגור ולא ניתן לשינוי'],
    [/pot is not balanced/i, 'הקופה לא מאוזנת'],
    [/every player must be counted/i, 'צריך לספור את כל השחקנים'],
    [/only the banker or a group admin/i, 'רק הבנקאי או מנהל הקבוצה יכולים להעביר את התפקיד'],
    [/only the banker/i, 'רק הבנקאי יכול לעשות את זה'],
    [/only a group admin/i, 'רק מנהל הקבוצה יכול לעשות את זה'],
    [/banker must be an active member/i, 'הבנקאי חייב להיות חבר בקבוצה עם חשבון'],
    [/duplicate key.*display_name/i, 'כבר יש שחקן בשם הזה בקבוצה'],
    [/row-level security/i, 'אין הרשאה לפעולה הזו'],
    [/Failed to fetch|Network request failed/i, 'אין חיבור לשרת'],
  ];
  for (const [re, he] of map) if (re.test(m)) return he;
  return m;
}
