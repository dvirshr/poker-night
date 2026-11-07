import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';

const ND = Platform.OS !== 'web'; // native driver on the phone; the web runs the same animation in JS
import * as SplashScreen from 'expo-splash-screen';
import { C } from '../lib/theme';
import { Logo } from './brand';
import { pickGreeting, rememberedName } from '../lib/greetings';

/**
 * Animated opening screen (about 1.6 s, no sound). Starts exactly where the native splash leaves off
 * (the logo, centred, on graphite), then: the logo settles, "דילר" rises in, and the whole screen fades
 * away to reveal the app. Shown once per launch.
 */
export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const logo = useRef(new Animated.Value(0)).current;  // 0 → 1: settle up
  const word = useRef(new Animated.Value(0)).current;  // 0 → 1: wordmark in
  const out = useRef(new Animated.Value(1)).current;   // 1 → 0: fade away
  const intro = useRef(false);
  const line = useRef({ name: rememberedName(), text: pickGreeting() }).current;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    // the JS screen is drawn: hand over from the native splash without a jump
    void SplashScreen.hideAsync().catch(() => {});
    Animated.sequence([
      Animated.timing(logo, { toValue: 1, duration: 520, easing: Easing.out(Easing.back(1.6)), useNativeDriver: ND }),
      Animated.timing(word, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: ND }),
      Animated.delay(950), // half a second longer, to read the greeting
    ]).start(() => { intro.current = true; if (readyRef.current) leave(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ready && intro.current) leave(); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  type AV = Animated.AnimatedInterpolation<number | string>;
  const logoY: AV = logo.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
  const logoS: AV = logo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const logoR: AV = logo.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '-6deg', '0deg'] });
  const wordY: AV = word.interpolate({ inputRange: [0, 1], outputRange: [18, -10] });
  const tagY: AV = word.interpolate({ inputRange: [0, 1], outputRange: [12, -8] });
  const logoStyle = { transform: [{ translateY: logoY }, { scale: logoS }, { rotate: logoR }] } as object;
  const wordStyle = { fontFamily: 'SecularOne_400Regular', fontSize: 48, color: C.text, marginTop: 4, opacity: word, transform: [{ translateY: wordY }] } as object;
  const tagStyle = { fontFamily: 'Rubik_500Medium', fontSize: 17, color: C.acc, textAlign: 'center', paddingHorizontal: 28, marginTop: 6, opacity: word, transform: [{ translateY: tagY }] } as object;
  const left = useRef(false);
  function leave() {
    if (left.current) return;
    left.current = true;
    Animated.timing(out, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: ND }).start(onDone);
  }

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', opacity: out }]}>
      <Animated.View style={logoStyle}>
        <Logo size={112} />
      </Animated.View>
      <Animated.Text maxFontSizeMultiplier={1.2} style={wordStyle}>
        דילר
      </Animated.Text>
      <Animated.Text maxFontSizeMultiplier={1.2} style={tagStyle}>
        {line.name ? `${line.name}, ${line.text}` : line.text}
      </Animated.Text>
    </Animated.View>
  );
}
