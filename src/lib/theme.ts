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
  display: 'SecularOne_400Regular', // headings, titles, buttons
};

export const medal = (place: number) => (place === 1 ? C.gold : place === 2 ? C.silver : place === 3 ? C.bronze : C.raised);

export const ils = (n: number, signed = false) => {
  const s = Math.abs(n).toLocaleString('he-IL');
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : n < 0 ? '−' : '';
  // a signed amount is isolated left-to-right so "+160 ₪" never renders as "₪ 160+" inside Hebrew text
  return sign ? `\u2066${sign}${s} ₪\u2069` : `${s} ₪`;
};

export type ThemeKey = 'graphite' | 'green' | 'vegas' | 'ocean';
export type TableTheme = {
  name: string;
  felt: string;   // cloth colour
  rail: string;   // padded rail colour (wood gets a grain gradient)
  wood?: boolean;
  stitch: string; // dashed stitching on the rail
  carpet: string; // SVG <pattern> body for the floor, 40×40 tile
};
export const THEMES: Record<ThemeKey, TableTheme> = {
  graphite: {
    name: 'עור שחור', felt: '#1F232B', rail: '#121317', stitch: '#F5A524',
    carpet: '<rect width="40" height="40" fill="#15161A"/><path d="M20 3 L37 20 L20 37 L3 20Z" fill="none" stroke="#2A2C33" stroke-width="2"/><path d="M20 12 L28 20 L20 28 L12 20Z" fill="#F5A524" fill-opacity=".18"/>',
  },
  green: {
    name: 'קזינו קלאסי', felt: '#1E5A43', rail: '#6A4426', wood: true, stitch: '#E3B66B',
    carpet: '<rect width="40" height="40" fill="#3B0F17"/><path d="M20 4 L36 20 L20 36 L4 20Z" fill="none" stroke="#7A2230" stroke-width="2"/><circle cx="20" cy="20" r="4" fill="#C9962B" fill-opacity=".55"/><circle cx="0" cy="0" r="3" fill="#C9962B" fill-opacity=".35"/><circle cx="40" cy="0" r="3" fill="#C9962B" fill-opacity=".35"/><circle cx="0" cy="40" r="3" fill="#C9962B" fill-opacity=".35"/><circle cx="40" cy="40" r="3" fill="#C9962B" fill-opacity=".35"/>',
  },
  vegas: {
    name: 'וגאס', felt: '#6E1F2A', rail: '#0E0E10', stitch: '#F2C14E',
    carpet: '<rect width="40" height="40" fill="#0C0C0E"/><path d="M20 6 L23 17 L34 20 L23 23 L20 34 L17 23 L6 20 L17 17Z" fill="#F2C14E" fill-opacity=".22"/><circle cx="0" cy="0" r="2.5" fill="#B23A48" fill-opacity=".6"/><circle cx="40" cy="0" r="2.5" fill="#B23A48" fill-opacity=".6"/><circle cx="0" cy="40" r="2.5" fill="#B23A48" fill-opacity=".6"/><circle cx="40" cy="40" r="2.5" fill="#B23A48" fill-opacity=".6"/>',
  },
  ocean: {
    name: 'ים', felt: '#17435E', rail: '#5C1622', stitch: '#D9A93A',
    carpet: '<rect width="40" height="40" fill="#0F1A33"/><path d="M0 20 Q10 7 20 20 T40 20" fill="none" stroke="#2C4A86" stroke-width="2"/><path d="M0 40 Q10 27 20 40 T40 40" fill="none" stroke="#2C4A86" stroke-width="2"/><circle cx="10" cy="10" r="3" fill="#D9A93A" fill-opacity=".6"/><circle cx="30" cy="31" r="2.5" fill="#B23A48" fill-opacity=".7"/>',
  },
};

/** Emblems a group admin can print in the middle of the felt. */
export const EMBLEMS = ['♠️', '♥️', '♦️', '♣️', '🦈', '🐺', '🦁', '🐍', '🔥', '👑', '💰', '🎲', '🍀', '🍺', '🥃', '🎯'] as const;

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
