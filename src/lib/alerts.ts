// Web: a browser cannot ring on a locked phone, so there are no scheduled alerts here.
// The clock screen still beeps and vibrates at level change while it is open.
import type { Level } from '../core/clock';

export const alertsSupported = false;
export async function askAlerts(): Promise<boolean> {
  return false;
}
export async function syncBlindAlerts(_gameId: string, _gameName: string, _upcoming: { at: number; level: Level }[]) {}
export async function clearBlindAlerts(_gameId: string) {}
export function useAlertTaps() {}
