import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { C, F } from '../lib/theme';
import type { Live } from '../lib/useGame';

export const tap = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

export function Screen({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[s.pad, { flex: 1 }]}>{children}</View>
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

type TxtProps = { children: ReactNode; style?: TextStyle | TextStyle[]; muted?: boolean; size?: number; weight?: keyof typeof F; color?: string; center?: boolean };
export function Txt({ children, style, muted, size = 15, weight = 'regular', color, center }: TxtProps) {
  return (
    <Text
      style={[
        { fontFamily: F[weight], fontSize: size, color: color ?? (muted ? C.muted : C.text), textAlign: center ? 'center' : 'right', writingDirection: 'rtl' },
        style as TextStyle,
      ]}
    >
      {children}
    </Text>
  );
}

export const Num = (p: TxtProps) => <Txt {...p} style={[{ fontVariant: ['tabular-nums'] }, ...(Array.isArray(p.style) ? p.style : p.style ? [p.style] : [])]} />;

export function H1({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ gap: 6, marginBottom: 16 }}>
      <Txt size={26} weight="black">{children}</Txt>
      {sub ? <Txt muted size={13}>{sub}</Txt> : null}
    </View>
  );
}

type BtnProps = { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean; style?: ViewStyle; small?: boolean };
export function Btn({ title, onPress, kind = 'primary', disabled, busy, style, small }: BtnProps) {
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        s.btn,
        small && { height: 44 },
        primary ? { backgroundColor: C.acc } : { borderWidth: 1.5, borderColor: kind === 'danger' ? C.danger : C.line },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? C.accInk : C.text} />
      ) : (
        <Txt center weight={primary ? 'black' : 'bold'} size={small ? 15 : 17} color={primary ? C.accInk : kind === 'danger' ? C.danger : C.text}>
          {title}
        </Txt>
      )}
    </Pressable>
  );
}

export function Card({ children, style, onPress, accent }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accent?: boolean }) {
  const body = <View style={[s.card, accent && { borderWidth: 2, borderColor: C.acc, backgroundColor: C.raised }, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {body}
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6, marginBottom: 14 }}>
      <Txt muted size={13}>{label}</Txt>
      <TextInput placeholderTextColor={C.muted} {...p} style={[s.input, p.style]} />
    </View>
  );
}

export function Seg<T extends string | number>({ label, value, options, onChange }: { label?: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: 6, marginBottom: 14 }}>
      {label ? <Txt muted size={13}>{label}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => {
          const on = o.v === value;
          return (
            <Pressable
              key={String(o.v)}
              onPress={() => { tap(); onChange(o.v); }}
              style={[s.seg, on && { backgroundColor: C.acc, borderColor: C.acc }]}
            >
              <Txt weight="bold" size={14} color={on ? C.accInk : C.text}>{o.t}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function LivePill({ live, unsynced = 0, onRefresh }: { live: Live; unsynced?: number; onRefresh?: () => void }) {
  const ok = live === 'live' && unsynced === 0;
  const color = ok ? C.pos : C.neg;
  const label = live === 'live' ? (unsynced ? `שומר… (${unsynced})` : 'מעודכן') : 'מתחבר מחדש…';
  return (
    <Row style={{ gap: 8 }}>
      <View style={[s.pill, { borderColor: ok ? C.line : C.neg }]} accessibilityLiveRegion="polite">
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Txt size={12} color={ok ? C.muted : C.neg}>{label}</Txt>
      </View>
      {onRefresh ? <RefreshBtn onPress={onRefresh} /> : null}
    </Row>
  );
}

/** Round "refresh" button: reloads the screen's data from the server. */
export function RefreshBtn({ onPress }: { onPress: () => void | Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="רענון"
      hitSlop={8}
      disabled={busy}
      onPress={async () => {
        tap();
        setBusy(true);
        try { await onPress(); } finally { setTimeout(() => setBusy(false), 400); }
      }}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
    >
      {busy ? <ActivityIndicator size="small" color={C.acc} /> : <Txt size={20} weight="bold" color={C.acc} center>⟳</Txt>}
    </Pressable>
  );
}

/** Calls fn whenever the app comes back to the front (phone unlocked, tab re-opened). */
export function useOnResume(fn: () => void) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active') fn(); });
    const onVis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') fn(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      sub.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [fn]);
}

export const Badge = ({ text, solid }: { text: string; solid?: boolean }) => (
  <View style={[s.badge, solid ? { backgroundColor: C.acc } : { borderWidth: 1, borderColor: C.line }]}>
    <Txt size={11} weight="bold" color={solid ? C.accInk : C.muted}>{text}</Txt>
  </View>
);

export function ErrorBar({ text, onClose }: { text: string | null; onClose: () => void }) {
  if (!text) return null;
  return (
    <Pressable onPress={onClose} style={s.err}>
      <Txt size={14} color={C.text}>{text}</Txt>
      <Txt size={12} muted>הקשה לסגירה</Txt>
    </Pressable>
  );
}

export const Row = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, style]}>{children}</View>
);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 520, alignSelf: 'center' },
  footer: { padding: 16, paddingTop: 8, gap: 10, width: '100%', maxWidth: 520, alignSelf: 'center' },
  btn: { height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  card: { backgroundColor: C.surf, borderRadius: 16, padding: 16, gap: 6 },
  input: { height: 52, borderRadius: 12, backgroundColor: C.surf, borderWidth: 1, borderColor: C.line, color: C.text, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 16, textAlign: 'right' },
  seg: { height: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  err: { backgroundColor: '#3A1F1F', borderColor: C.danger, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, gap: 2 },
});

export const Loading = () => (
  <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator color={C.acc} size="large" />
  </View>
);

export function Back({ label = 'חזרה', to }: { label?: string; to?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={12}
      onPress={() => (to ? router.replace(to as never) : router.canGoBack() ? router.back() : router.replace('/'))}
      style={{ alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Txt color={C.acc} size={16} weight="bold">→</Txt>
        <Txt color={C.acc} size={14} weight="medium">{label}</Txt>
      </View>
    </Pressable>
  );
}
