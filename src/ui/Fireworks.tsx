import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { C } from '../lib/theme';

/** One-shot celebration over the winner: three bursts + a success buzz. Static if the phone asks for reduced motion. */
export function Fireworks({ play }: { play: boolean }) {
  const bursts = [
    { x: '50%', y: 4, size: 110, delay: 0, colors: [C.gold, C.text] },
    { x: '18%', y: 30, size: 74, delay: 350, colors: [C.pos, C.gold] },
    { x: '82%', y: 22, size: 80, delay: 650, colors: [C.text, C.pos] },
  ] as const;
  const vals = useRef(bursts.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!play) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then(reduce => {
        if (cancelled) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (reduce) return vals.forEach(v => v.setValue(0.6));
        Animated.stagger(
          300,
          vals.map(v => Animated.timing(v, { toValue: 1, duration: 1500, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
        ).start();
      });
    return () => {
      cancelled = true;
    };
  }, [play, vals]);

  if (!play) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: -40, height: 140 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bursts.map((b, i) => {
        const v = vals[i];
        const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.1] });
        const opacity = v.interpolate({ inputRange: [0, 0.12, 0.65, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{ position: 'absolute', left: b.x, top: b.y, width: b.size, height: b.size, marginLeft: -b.size / 2, opacity, transform: [{ scale }] }}
          >
            {Array.from({ length: 12 }, (_, k) => (
              <View
                key={k}
                style={{
                  position: 'absolute', left: b.size / 2 - 1.5, top: b.size / 2 - b.size * 0.11, width: 3, height: b.size * 0.22, borderRadius: 2,
                  backgroundColor: b.colors[k % 2],
                  transform: [{ rotate: `${k * 30}deg` }, { translateY: -b.size * 0.3 }],
                }}
              />
            ))}
          </Animated.View>
        );
      })}
    </View>
  );
}
