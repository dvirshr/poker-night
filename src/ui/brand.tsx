import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { C } from '../lib/theme';
import { LOGO_XML, ICONS, type IconName } from './brandXml';
import { Txt, tap } from './kit';

export function Logo({ size = 44 }: { size?: number }) {
  return <SvgXml xml={LOGO_XML} width={size} height={size * 150 / 176} />;
}

export function Icon({ name, size = 22, color = C.acc }: { name: IconName; size?: number; color?: string }) {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
}

/** Square outlined icon button (header actions). */
export function IconBtn({ name, label, onPress }: { name: IconName; label: string; onPress: () => void | Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      disabled={busy}
      onPress={async () => {
        tap();
        setBusy(true);
        try { await onPress(); } finally { setTimeout(() => setBusy(false), 300); }
      }}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
    >
      {busy && name === 'refresh' ? <ActivityIndicator size="small" color={C.acc} /> : <Icon name={name} />}
    </Pressable>
  );
}

/** Logo + "דילר" wordmark, with an optional line under it. */
export function Brand({ sub }: { sub?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Logo size={46} />
      <View>
        <Txt weight="display" size={38} style={{ lineHeight: 42 }}>דילר</Txt>
        {sub ? <Txt muted size={13}>{sub}</Txt> : null}
      </View>
    </View>
  );
}
