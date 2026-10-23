import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { C, F, ils, medal, blinds, ltr } from '../lib/theme';
import { makeStructure, mmss, PAYOUT_PRESETS, type Level } from '../core/clock';
import { tournamentPrizes } from '../core/settle';
import { Txt, Num, Btn, Card, Row, tap } from './kit';
import { useClock } from '../lib/useClock';
import type { Game } from '../lib/useGame';

const digits = (t: string) => t.replace(/\D/g, '').slice(0, 7);

function Cell({ value, onChange, width = 72, label }: { value: number; onChange: (n: number) => void; width?: number; label: string }) {
  const [txt, setTxt] = useState(String(value || ''));
  const shown = parseInt(txt, 10) === value || (txt === '' && !value) ? txt : String(value);
  return (
    <TextInput
      accessibilityLabel={label}
      value={shown}
      onChangeText={t => { const d = digits(t); setTxt(d); onChange(parseInt(d, 10) || 0); }}
      keyboardType="number-pad"
      style={{ width, height: 42, borderRadius: 10, backgroundColor: C.surf, borderWidth: 1, borderColor: C.line, color: C.text, fontFamily: F.bold, fontSize: 15, textAlign: 'center' }}
    />
  );
}

/** Blind structure: generate from a starting small blind, then edit any level. */
export function BlindEditor({ levels, onChange }: { levels: Level[]; onChange: (l: Level[]) => void }) {
  const [sb, setSb] = useState(String(levels[0]?.small_blind ?? 25));
  const [min, setMin] = useState(String(levels[0]?.duration_min ?? 15));
  const [count, setCount] = useState(String(levels.length || 12));
  const renumber = (l: Level[]) => l.map((x, i) => ({ ...x, level_no: i + 1 }));
  const set = (i: number, patch: Partial<Level>) => onChange(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const bad = (l: Level) => l.small_blind <= 0 || l.big_blind < l.small_blind || l.duration_min <= 0;
  return (
    <View style={{ gap: 10 }}>
      <Card style={{ gap: 10, borderWidth: 1, borderColor: C.line }}>
        <Txt weight="bold">יצירת מבנה מהיר</Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ gap: 4, alignItems: 'center' }}>
            <Txt muted size={12}>סמול פתיחה</Txt>
            <Cell label="סמול פתיחה" value={parseInt(sb, 10) || 0} onChange={n => setSb(String(n))} />
          </View>
          <View style={{ gap: 4, alignItems: 'center' }}>
            <Txt muted size={12}>דקות לרמה</Txt>
            <Cell label="דקות לרמה" value={parseInt(min, 10) || 0} onChange={n => setMin(String(n))} />
          </View>
          <View style={{ gap: 4, alignItems: 'center' }}>
            <Txt muted size={12}>מספר רמות</Txt>
            <Cell label="מספר רמות" value={parseInt(count, 10) || 0} onChange={n => setCount(String(Math.min(n, 23)))} />
          </View>
        </Row>
        <Btn small kind="ghost" title="↻ יצירת מבנה (ביג = פי 2)" disabled={!(parseInt(sb, 10) > 0 && parseInt(min, 10) > 0 && parseInt(count, 10) > 0)}
          onPress={() => onChange(makeStructure(parseInt(sb, 10), parseInt(min, 10), parseInt(count, 10)))} />
      </Card>

      <Row style={{ paddingHorizontal: 4 }}>
        <Txt muted size={12} style={{ width: 44 }}>רמה</Txt>
        <Txt muted size={12} style={{ width: 80, textAlign: 'center' }}>סמול</Txt>
        <Txt muted size={12} style={{ width: 80, textAlign: 'center' }}>ביג</Txt>
        <Txt muted size={12} style={{ width: 60, textAlign: 'center' }}>דקות</Txt>
      </Row>
      {levels.map((l, i) => (
        <Row key={i} style={{ paddingHorizontal: 4 }}>
          <Num weight="bold" style={{ width: 44 }} color={bad(l) ? C.neg : C.text}>{String(i + 1)}</Num>
          <Cell label={`סמול רמה ${i + 1}`} width={80} value={l.small_blind} onChange={n => set(i, { small_blind: n, big_blind: n * 2 })} />
          <Cell label={`ביג רמה ${i + 1}`} width={80} value={l.big_blind} onChange={n => set(i, { big_blind: n })} />
          <Cell label={`דקות רמה ${i + 1}`} width={60} value={l.duration_min} onChange={n => set(i, { duration_min: n })} />
          <Pressable hitSlop={8} accessibilityLabel={`מחיקת רמה ${i + 1}`} disabled={levels.length <= 1}
            onPress={() => { tap(); onChange(renumber(levels.filter((_, j) => j !== i))); }}>
            <Txt color={levels.length <= 1 ? C.line : C.danger} weight="bold" size={18}>✕</Txt>
          </Pressable>
        </Row>
      ))}
      <Btn small kind="ghost" title="+ רמה" onPress={() => {
        const lastL = levels[levels.length - 1];
        const nsb = lastL ? Math.max(lastL.small_blind + 5, Math.round((lastL.small_blind * 1.5) / 25) * 25) : 25;
        onChange(renumber([...levels, { level_no: 0, small_blind: nsb, big_blind: nsb * 2, duration_min: lastL?.duration_min ?? 15 }]));
      }} />
      {levels.some(bad) && <Txt color={C.neg} size={13}>בכל רמה: סמול גדול מ־0, ביג לפחות כמו הסמול, ודקות גדולות מ־0</Txt>}
    </View>
  );
}
export const levelsValid = (l: Level[]) => l.length > 0 && l.every(x => x.small_blind > 0 && x.big_blind >= x.small_blind && x.duration_min > 0);

/** Prize split by place: presets or free percentages. Shows the amounts when the pot is known. */
export function PayoutEditor({ value, onChange, players, pot }: { value: number[]; onChange: (v: number[]) => void; players: number; pot?: number }) {
  const sum = value.reduce((s, x) => s + x, 0);
  const presets = PAYOUT_PRESETS.filter(p => p.length <= Math.max(players, 1));
  const key = value.join('/');
  const prizes = pot != null && sum === 100 && value.every(x => x > 0) && value.length <= players
    ? [...tournamentPrizes(pot, value, value.map((_, i) => String(i))).values()]
    : null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {presets.map(p => {
          const on = p.join('/') === key;
          return (
            <Pressable key={p.join('/')} onPress={() => { tap(); onChange(p); }}
              style={{ height: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? C.acc : C.line, backgroundColor: on ? C.acc : 'transparent', justifyContent: 'center' }}>
              <Txt weight="bold" size={14} color={on ? C.accInk : C.text}>{p.length === 1 ? 'הכל לראשון' : ltr(p.join(' / '))}</Txt>
            </Pressable>
          );
        })}
      </View>
      {value.map((pct, i) => (
        <Row key={i} style={{ justifyContent: 'space-between' }}>
          <Row>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: medal(i + 1), alignItems: 'center', justifyContent: 'center' }}>
              <Txt weight="black" size={14} color={i < 3 ? C.accInk : C.text} center>{String(i + 1)}</Txt>
            </View>
            <Txt weight="bold">{`מקום ${i + 1}`}</Txt>
          </Row>
          <Row>
            {prizes && <Num weight="black" color={C.acc}>{ils(prizes[i])}</Num>}
            <Cell label={`אחוז למקום ${i + 1}`} width={64} value={pct} onChange={n => onChange(value.map((x, j) => (j === i ? Math.min(n, 100) : x)))} />
            <Txt muted>%</Txt>
          </Row>
        </Row>
      ))}
      <Row>
        <Btn small kind="ghost" title="+ מקום" style={{ flex: 1 }} disabled={value.length >= players} onPress={() => onChange([...value, 0])} />
        <Btn small kind="ghost" title="− מקום" style={{ flex: 1 }} disabled={value.length <= 1} onPress={() => onChange(value.slice(0, -1))} />
      </Row>
      <Txt size={13} color={sum === 100 ? C.pos : C.neg}>{sum === 100 ? '✓ סה״כ 100%' : `סה״כ ${sum}% · צריך 100%`}</Txt>
      {value.length > players && <Txt size={13} color={C.neg}>יותר מקומות משולמים משחקנים</Txt>}
    </View>
  );
}
export const payoutValid = (v: number[], players: number) =>
  v.length >= 1 && v.length <= players && v.every(x => x > 0) && v.reduce((s, x) => s + x, 0) === 100;

/** Compact clock on the table screen; tap opens the big clock. */
export function ClockBar({ game, levels }: { game: Game; levels: Level[] }) {
  const c = useClock(game, levels);
  if (!levels.length) return null;
  return (
    <Card onPress={() => router.push(`/game/${game.id}/clock`)} style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: c.started && !c.paused ? C.acc : C.line }}>
      <View style={{ gap: 2 }}>
        <Txt muted size={12}>{`⏱ רמה ${c.idx + 1} מתוך ${levels.length}${c.paused ? ' · בהפסקה' : !c.started ? ' · לא התחיל' : ''}`}</Txt>
        <Num weight="black" size={22}>{c.level ? blinds(c.level.small_blind, c.level.big_blind) : ''}</Num>
        {c.next && <Txt muted size={12}>{`הבא: ${blinds(c.next.small_blind, c.next.big_blind)}`}</Txt>}
      </View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Num weight="black" size={30} color={c.paused ? C.muted : C.acc}>{c.over ? 'סוף' : mmss(c.remainingMs)}</Num>
        <Txt muted size={11}>לשעון המלא ←</Txt>
      </View>
    </Card>
  );
}
