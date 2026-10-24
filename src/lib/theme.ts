// Direction B: graphite & amber. Win = blue, loss = orange (distinguishable for colour-blind players).
export const C = {
  bg: '#111215',
  surf: '#1B1D22',
  raised: '#262931',
  line: '#33363F',
  text: '#F4F4F5',
  muted: '#A3A7B1',
  acc: '#F5A524',
  accInk: '#1A1203',
  pos: '#7CC8FF',
  neg: '#FF9A5C',
  felt: '#1F232B',
  rail: '#3A3E48',
  gold: '#F2C14E',
  silver: '#C7CCD4',
  bronze: '#C98B55',
  danger: '#FF6B6B',
};

export const F = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  bold: 'Rubik_700Bold',
  black: 'Rubik_800ExtraBold',
};

export const medal = (place: number) => (place === 1 ? C.gold : place === 2 ? C.silver : place === 3 ? C.bronze : C.raised);

export const ils = (n: number, signed = false) => {
  const s = Math.abs(n).toLocaleString('he-IL');
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : n < 0 ? '−' : '';
  // a signed amount is isolated left-to-right so "+160 ₪" never renders as "₪ 160+" inside Hebrew text
  return sign ? `\u2066${sign}${s} ₪\u2069` : `${s} ₪`;
};

export type ThemeKey = 'graphite' | 'green' | 'vegas' | 'ocean';
export const THEMES: Record<ThemeKey, { name: string; felt: string; rail: string }> = {
  graphite: { name: 'גרפיט', felt: '#1F232B', rail: '#3A3E48' },
  green: { name: 'לבד ירוק', felt: '#1E5A43', rail: '#5A3A22' },
  vegas: { name: 'וגאס', felt: '#6E1F2A', rail: '#2B1A12' },
  ocean: { name: 'ים', felt: '#17435E', rail: '#2E3B47' },
};

/** Keeps "50 / 100" in reading order inside Hebrew text (otherwise it shows as "100 / 50"). */
export const ltr = (t: string) => `\u2066${t}\u2069`;
export const blinds = (sb: number, bb: number) => ltr(`${sb.toLocaleString('he-IL')} / ${bb.toLocaleString('he-IL')}`);

/** Personal table look on this phone; null = the group's choice. */
const MY_THEME = 'poker.myTheme.v1';
export function getMyTheme(): ThemeKey | null {
  try { const v = localStorage.getItem(MY_THEME); return v && v in THEMES ? (v as ThemeKey) : null; } catch { return null; }
}
export function setMyTheme(v: ThemeKey | null) {
  try { if (v) localStorage.setItem(MY_THEME, v); else localStorage.removeItem(MY_THEME); } catch { /* ignore */ }
}
