import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Rubik_400Regular, Rubik_500Medium, Rubik_700Bold, Rubik_800ExtraBold } from '@expo-google-fonts/rubik';
import { AuthProvider, useAuth } from '../lib/auth';
import { C } from '../lib/theme';
import { flush } from '../lib/queue';
import { Loading } from '../ui/kit';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'he';
  document.body.style.backgroundColor = C.bg;
}

function Gate() {
  const { session, ready } = useAuth();
  const seg = useSegments();
  useEffect(() => {
    if (!ready) return;
    const inLogin = seg[0] === 'login';
    if (!session && !inLogin) router.replace('/login');
    if (session && inLogin) router.replace('/');
    if (session) void flush(); // send anything left on the phone from last time
  }, [session, ready, seg]);

  if (!ready) return <Loading />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_left' }} />;
}

export default function Root() {
  const [fonts] = useFonts({ Rubik_400Regular, Rubik_500Medium, Rubik_700Bold, Rubik_800ExtraBold });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>{fonts ? <Gate /> : <Loading />}</AuthProvider>
    </SafeAreaProvider>
  );
}
