import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Rubik_400Regular, Rubik_500Medium, Rubik_700Bold, Rubik_800ExtraBold } from '@expo-google-fonts/rubik';
import { SecularOne_400Regular } from '@expo-google-fonts/secular-one';
import { AuthProvider, useAuth } from '../lib/auth';
import { C } from '../lib/theme';
import { flush } from '../lib/queue';
import { Loading, Screen, Txt, Btn } from '../ui/kit';
import type { ErrorBoundaryProps } from 'expo-router';
import { captureInviteFromUrl } from '../lib/invite';
import { useAlertTaps } from '../lib/alerts';
import { VersionGate } from '../ui/VersionGate';
import { Splash } from '../ui/Splash';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';

void SplashScreen.preventAutoHideAsync().catch(() => {}); // keep the native splash until the animated one is drawn

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'he';
  document.body.style.backgroundColor = C.bg;
  captureInviteFromUrl();
}

function Gate() {
  const { session, ready } = useAuth();
  const seg = useSegments();
  useAlertTaps(); // tapping a blind alert opens the tournament clock
  useEffect(() => {
    if (!ready) return;
    const inLogin = seg[0] === 'login';
    const isPublic = inLogin || seg[0] === 'join' || seg[0] === 'help' || seg[0] === 'reset' || seg[0] === 'privacy' || seg[0] === 'delete-account';
    if (!session && !isPublic) router.replace('/login');
    if (session && inLogin) router.replace('/');
    if (session) void flush(); // send anything left on the phone from last time
  }, [session, ready, seg]);

  if (!ready) return <Loading />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_left' }} />;
}

export default function Root() {
  const [fonts, fontError] = useFonts({ Rubik_400Regular, Rubik_500Medium, Rubik_700Bold, Rubik_800ExtraBold, SecularOne_400Regular });
  // never block the app on fonts: after 4 s (or on a load error) carry on with the system font
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const ready = fonts || !!fontError || gaveUp;
  const [intro, setIntro] = useState(true);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <AuthProvider>{ready ? <VersionGate><Gate /></VersionGate> : null}</AuthProvider>
        {intro && <Splash ready={ready} onDone={() => setIntro(false)} />}
      </View>
    </SafeAreaProvider>
  );
}

/** Never a black screen: if a screen crashes, say so and offer a way out. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <Screen>
      <Txt size={24} weight="black" style={{ marginTop: 40, marginBottom: 8 }}>משהו השתבש במסך הזה</Txt>
      <Txt muted style={{ marginBottom: 20 }}>הנתונים שמורים בשרת. נסו שוב, ואם זה חוזר, רענון מלא.</Txt>
      <Btn title="לנסות שוב" onPress={() => void retry()} />
      <Btn
        title="רענון מלא"
        kind="ghost"
        style={{ marginTop: 10 }}
        onPress={() => {
          if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
          else void retry();
        }}
      />
      <Txt muted size={11} style={{ marginTop: 20 }}>{String(error?.message ?? error)}</Txt>
    </Screen>
  );
}
