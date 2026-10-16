import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Rubik_400Regular, Rubik_500Medium, Rubik_700Bold, Rubik_800ExtraBold } from '@expo-google-fonts/rubik';
import { AuthProvider, useAuth } from '../lib/auth';
import { C } from '../lib/theme';
import { flush } from '../lib/queue';
import { Loading } from '../ui/kit';
import { captureInviteFromUrl } from '../lib/invite';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'he';
  document.body.style.backgroundColor = C.bg;
  captureInviteFromUrl();
}

function Gate() {
  const { session, ready } = useAuth();
  const seg = useSegments();
  useEffect(() => {
    if (!ready) return;
    const inLogin = seg[0] === 'login';
    const isPublic = inLogin || seg[0] === 'join';
    if (!session && !isPublic) router.replace('/login');
    if (session && inLogin) router.replace('/');
    if (session) void flush(); // send anything left on the phone from last time
  }, [session, ready, seg]);

  if (!ready) return <Loading />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_left' }} />;
}

export default function Root() {
  const [fonts, fontError] = useFonts({ Rubik_400Regular, Rubik_500Medium, Rubik_700Bold, Rubik_800ExtraBold });
  // never block the app on fonts: after 4 s (or on a load error) carry on with the system font
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const ready = fonts || !!fontError || gaveUp;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>{ready ? <Gate /> : <Loading />}</AuthProvider>
    </SafeAreaProvider>
  );
}
