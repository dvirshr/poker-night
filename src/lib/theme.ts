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
