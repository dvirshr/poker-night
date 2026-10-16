// Invite links: https://dvirshr.github.io/poker-night/join/<code>
// The code is kept on the phone until the person is signed in, then used once.
export const APP_URL = 'https://dvirshr.github.io/poker-night';
const KEY = 'poker.pending-invite.v1';

export const inviteLink = (code: string) => `${APP_URL}/join/${code}`;

export function savePendingInvite(code: string) {
  try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
}
export function pendingInvite(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function clearPendingInvite() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function inviteMessage(groupName: string, code: string) {
  return [
    `🃏 הוזמנת לקבוצת הפוקר "${groupName}"`,
    '',
    '1. להיכנס לקישור:',
    inviteLink(code),
    '',
    '2. להירשם עם שם, מייל וסיסמה.',
    '',
    '3. ההצטרפות לקבוצה אוטומטית. אחרי שהמנהל מאשר, רואים הכול.',
    '',
    'להתקנה כאפליקציה:',
    'אנדרואיד: בכרום, תפריט ⋮ ואז "התקנת אפליקציה".',
    'אייפון: בספארי, כפתור השיתוף ואז "הוסף למסך הבית".',
    '',
    'אם ההצטרפות לא קרתה לבד: באפליקציה "הצטרפות עם קוד", והקוד הוא:',
    code,
  ].join('\n');
}
