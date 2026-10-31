import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

/**
 * Which build this is. The Google Play build (extra.variant = 'play', set by the Play workflow)
 * is updated by the store only: no self-update, no direct APK download (Play policy).
 */
export const IS_PLAY = Platform.OS === 'android' && Constants.expoConfig?.extra?.variant === 'play';
export const PACKAGE = 'com.dvirshr.pokernight';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PACKAGE}`;

export async function openStore() {
  try {
    await Linking.openURL(`market://details?id=${PACKAGE}`);
  } catch {
    await Linking.openURL(PLAY_URL);
  }
}
