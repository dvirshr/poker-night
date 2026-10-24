// Blind-level alerts on Android: local notifications scheduled with the system alarm clock,
// so they ring on time with the screen off, the phone locked, or the app closed.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as N from 'expo-notifications';
import type { Level } from '../core/clock';

export const alertsSupported = true;

N.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let channel: Promise<unknown> | null = null;
const ensureChannel = () =>
  (channel ??= Platform.OS === 'android'
    ? N.setNotificationChannelAsync('blinds', {
        name: 'עליית בליינדים',
        importance: N.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 500, 250, 500, 250, 500],
        lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
      })
    : Promise.resolve());

/** Asks for notification permission (Android 13+ shows a system prompt). */
export async function askAlerts(): Promise<boolean> {
  const cur = await N.getPermissionsAsync();
  if (cur.granted) return true;
  const r = await N.requestPermissionsAsync();
  return r.granted;
}

const last = new Map<string, string>();

/** Replaces this game's scheduled alerts with the given future level changes. Idempotent. */
export async function syncBlindAlerts(gameId: string, gameName: string, upcoming: { at: number; level: Level }[]) {
  const sig = upcoming.map(u => `${u.at}:${u.level.small_blind}/${u.level.big_blind}`).join('|');
  if (last.get(gameId) === sig) return;
  last.set(gameId, sig);
  await ensureChannel();
  const all = await N.getAllScheduledNotificationsAsync();
  await Promise.all(all.filter(n => n.identifier.startsWith(`blind-${gameId}-`)).map(n => N.cancelScheduledNotificationAsync(n.identifier)));
  for (const u of upcoming.slice(0, 40)) {
    await N.scheduleNotificationAsync({
      identifier: `blind-${gameId}-${u.level.level_no}`,
      content: {
        title: `⏫ עולים בליינדים · רמה ${u.level.level_no}`,
        body: `\u2066${u.level.small_blind.toLocaleString('he-IL')} / ${u.level.big_blind.toLocaleString('he-IL')}\u2069 · ${gameName}`,
        sound: 'default',
        priority: N.AndroidNotificationPriority.MAX,
        data: { url: `/game/${gameId}/clock` },
      },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: u.at, channelId: 'blinds', delivery: 'alarmClock' },
    });
  }
}

export const clearBlindAlerts = (gameId: string) => syncBlindAlerts(gameId, '', []);

/** Tapping an alert opens the clock. */
export function useAlertTaps() {
  useEffect(() => {
    const sub = N.addNotificationResponseReceivedListener(r => {
      const url = r.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    });
    return () => sub.remove();
  }, []);
}
