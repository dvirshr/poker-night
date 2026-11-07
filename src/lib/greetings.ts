// Opening-screen greeting: a different line every launch, with the player's name.

export const GREETINGS = [
  'שלא תהיה הכבש הערב 🐑',
  'שתיקח עם 7-2 אוף סוט 😏',
  'שיהיה לך אחלה של ערב',
  'בהצלחה הערב, תן בראש 💪',
  'שהריבר יהיה בצד שלך הערב 🌊',
  'שהאסים יגיעו בזוגות ♠️♥️',
  'פוקר פייס מוכן? 😐',
  'הערב אתה הכריש, לא הדג 🦈',
  'שהפלופ יאהב אותך',
  'אול-אין רק כשבטוח... או שלא 😅',
  'תשאיר מקום לריבאי, ליתר ביטחון',
  'הקופה לא שוכחת 😉',
  'בלאף אחד טוב שווה עשרה קלפים',
  'שלא תצטרך לספור עודף הערב',
  'היום זה הערב שלך. אולי.',
  'שתגיע לשולחן הגמר 🏆',
] as const;

const NAME_KEY = 'dealer.myName';
const LAST_KEY = 'dealer.lastGreeting';

/** Remembered on this phone when the home screen loads the player's name, so the opening screen can greet him. */
export function rememberName(name: string) {
  try { if (name) localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}
export function rememberedName(): string | null {
  try { return localStorage.getItem(NAME_KEY); } catch { return null; }
}
export function forgetName() {
  try { localStorage.removeItem(NAME_KEY); } catch { /* ignore */ }
}

/** A random line, never the same as last time. */
export function pickGreeting(): string {
  let last = -1;
  try { last = Number(localStorage.getItem(LAST_KEY) ?? -1); } catch { /* ignore */ }
  let i = Math.floor(Math.random() * GREETINGS.length);
  if (i === last) i = (i + 1) % GREETINGS.length;
  try { localStorage.setItem(LAST_KEY, String(i)); } catch { /* ignore */ }
  return GREETINGS[i];
}
