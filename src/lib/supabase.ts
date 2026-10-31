import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

/** This build's version: the APK is 0.1.<build number>; the website is always the latest build. */
export const APP_VERSION = Constants.expoConfig?.version ?? '0';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local');

const appHeaders: Record<string, string> = Platform.OS === 'web' ? {} : { 'x-app-version': APP_VERSION, 'x-app-platform': Platform.OS };

export const supabase = createClient(url, key, {
  // the server may refuse versions the operator no longer supports (see app_config / check_request)
  // the website sends nothing extra (a custom header would need CORS); browsers are recognised by their Origin
  global: { headers: appHeaders },
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
    [/APP_VERSION|no longer supported/i, 'הגרסה הזו כבר לא נתמכת. צריך לעדכן את האפליקציה'],
    [/operators only/i, 'המסך הזה רק למפעילי האפליקציה'],
    [/Invalid login credentials/i, 'מייל או סיסמה שגויים'],
    [/User already registered/i, 'המייל כבר רשום. אפשר להתחבר'],
    [/Password should be at least/i, 'סיסמה של 6 תווים לפחות'],
    [/invite code is invalid or expired/i, 'קוד ההזמנה לא תקין או שפג תוקפו'],
    [/rebuy limit reached/i, 'השחקן הגיע למקסימום הריבאיים'],
    [/rebuy window has closed/i, 'זמן הריבאי הסתיים'],
    [/rebuys are not allowed/i, 'במשחק הזה אין כניסות חוזרות'],
    [/no buy-ins once counting/i, 'אי אפשר להוסיף כניסות אחרי שהספירה התחילה'],
    [/game is cancelled/i, 'הערב בוטל ולא ניתן לשינוי'],
    [/only the banker or a group admin can cancel/i, 'רק הבנקאי או מנהל הקבוצה יכולים לבטל ערב'],
    [/game is closed/i, 'הערב סגור ולא ניתן לשינוי'],
    [/pot is not balanced/i, 'הקופה לא מאוזנת'],
    [/every player must be counted/i, 'צריך לספור את כל השחקנים'],
    [/only the banker can draw/i, 'רק הבנקאי יכול להגריל'],
    [/at least 2 players at the table to draw/i, 'צריך לפחות 2 שחקנים בשולחן להגרלה'],
    [/only the banker or a group admin/i, 'רק הבנקאי או מנהל הקבוצה יכולים להעביר את התפקיד'],
    [/only the banker/i, 'רק הבנקאי יכול לעשות את זה'],
    [/only a group admin/i, 'רק מנהל הקבוצה יכול לעשות את זה'],
    [/banker must be an active member/i, 'הבנקאי חייב להיות חבר בקבוצה עם חשבון'],
    [/duplicate key.*display_name|players_active_name_unique/i, 'כבר יש שחקן בשם הזה בקבוצה'],
    [/name taken by another member/i, 'השם הזה כבר תפוס בקבוצה. בחר שם אחר'],
    [/name already in use/i, 'השם כבר בשימוש בקבוצה: לחבר להיסטוריה של האורח, או לבחור שם אחר'],
    [/guest cannot be an admin/i, 'אורח בלי חשבון לא יכול להיות מנהל'],
    [/at least one admin/i, 'בקבוצה חייב להישאר לפחות מנהל אחד'],
    [/cannot unlink yourself/i, 'אי אפשר לנתק את החשבון שלך'],
    [/account is the banker of an open game/i, 'אתה הבנקאי של ערב פתוח. קודם להעביר את התפקיד או לסגור את הערב'],
    [/account is the only admin of a group/i, 'אתה המנהל היחיד בקבוצה שיש בה עוד חברים. קודם למנות מנהל נוסף בהגדרות הקבוצה'],
    [/banker of an open game/i, 'השחקן הוא הבנקאי של ערב פתוח. קודם להעביר את התפקיד'],
    [/Email not confirmed/i, 'צריך לאשר את המייל דרך הקישור שנשלח'],
    [/For security purposes, you can only request this after|rate limit/i, 'נשלחו יותר מדי בקשות. לנסות שוב בעוד דקה'],
    [/New password should be different/i, 'הסיסמה החדשה חייבת להיות שונה מהקודמת'],
    [/Auth session missing|JWT expired|invalid.*token/i, 'הקישור לא תקף או שפג תוקפו. לבקש קישור חדש'],
    [/row-level security/i, 'אין הרשאה לפעולה הזו'],
    [/Failed to fetch|Network request failed/i, 'אין חיבור לשרת'],
  ];
  for (const [re, he] of map) if (re.test(m)) return he;
  return m;
}
