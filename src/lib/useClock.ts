import { useCallback, useEffect, useState } from 'react';
import { supabase, heError } from './supabase';
import type { Game } from './useGame';
import { clockAt, anchorForLevel, resumedAnchor, upcomingLevels, type Level } from '../core/clock';
import { alertsSupported, askAlerts, syncBlindAlerts, clearBlindAlerts } from './alerts';

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());

/** Live clock picture, re-rendered every second while running. */
export function useClock(game: Game | null, levels: Level[]) {
  const [now, setNow] = useState(Date.now());
  const running = !!game?.clock_anchor && !game?.clock_paused_at && game?.status !== 'closed' && game?.status !== 'cancelled';
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, game?.clock_anchor, game?.clock_paused_at]);
  const state = clockAt(levels, ms(game?.clock_anchor ?? null), ms(game?.clock_paused_at ?? null), now);
  const sorted = [...levels].sort((a, b) => a.level_no - b.level_no);
  return { ...state, level: sorted[state.idx] ?? null, next: sorted[state.idx + 1] ?? null, levels: sorted };
}

/** Banker controls. Each one only moves the two timestamps; every phone follows. */
export function clockActions(game: Game, levels: Level[], onError: (m: string) => void, done: () => void) {
  const write = async (anchor: number | null, paused: number | null) => {
    const { error } = await supabase.from('games').update({ clock_anchor: iso(anchor), clock_paused_at: iso(paused) }).eq('id', game.id);
    if (error) onError(heError(error));
    done();
  };
  const anchor = ms(game.clock_anchor);
  const paused = ms(game.clock_paused_at);
  const cur = clockAt(levels, anchor, paused, Date.now()).idx;
  return {
    start: () => write(Date.now(), null),
    pause: () => anchor != null && write(anchor, Date.now()),
    resume: () => anchor != null && paused != null && write(resumedAnchor(anchor, paused, Date.now()), null),
    goto: (idx: number) => write(anchorForLevel(levels, idx, Date.now(), paused), paused),
    next: () => write(anchorForLevel(levels, cur + 1, Date.now(), paused), paused),
    prev: () => write(anchorForLevel(levels, cur - 1, Date.now(), paused), paused),
    /** +1 minute left = anchor later by a minute */
    addMinutes: (m: number) => anchor != null && write(anchor + m * 60_000, paused),
    reset: () => write(null, null),
  };
}

const PREF = 'poker.blindAlerts.v1';
const readPref = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(PREF) ?? '{}'); } catch { return {}; }
};

/** Per phone: do I want alerts for this game? Default on for the banker. */
export function useAlertPref(gameId: string, isBanker: boolean) {
  const [pref, setPref] = useState<boolean | undefined>(() => readPref()[gameId]);
  const on = alertsSupported && (pref ?? isBanker);
  // default-on for the banker: ask the system permission once
  useEffect(() => {
    if (on && pref === undefined) void askAlerts().catch(() => false);
  }, [on, pref]);
  const set = useCallback(async (v: boolean) => {
    if (v && !(await askAlerts())) return false;
    try { localStorage.setItem(PREF, JSON.stringify({ ...readPref(), [gameId]: v })); } catch { /* ignore */ }
    setPref(v);
    return true;
  }, [gameId]);
  return { on, set, supported: alertsSupported };
}

/** Keeps the phone's scheduled alerts in line with the clock (pause, skip, structure change, close). */
export function useBlindAlertsSync(game: Game | null, levels: Level[], on: boolean) {
  const anchor = game?.clock_anchor ?? null;
  const paused = game?.clock_paused_at ?? null;
  const closed = game?.status === 'closed' || game?.status === 'cancelled';
  const sig = levels.map(l => `${l.level_no}:${l.small_blind}:${l.big_blind}:${l.duration_min}`).join(',');
  useEffect(() => {
    if (!game || game.game_type !== 'tournament') return;
    if (!on || closed) {
      void clearBlindAlerts(game.id).catch(() => {});
      return;
    }
    void syncBlindAlerts(game.id, game.name, upcomingLevels(levels, ms(anchor), ms(paused), Date.now())).catch(() => {});
  }, [game?.id, game?.game_type, game?.name, anchor, paused, closed, on, sig]); // eslint-disable-line react-hooks/exhaustive-deps
}
