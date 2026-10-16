// Banker's write-ahead queue for ledger entries.
// Every entry is saved on the phone FIRST (survives screen-off, lock, app kill),
// then sent to the server in order. The id is created here, so a retry after a
// dropped connection can never insert the same entry twice.
import { supabase } from './supabase';

export type PendingEntry = {
  id: string;
  game_id: string;
  player_id: string;
  type: 'buy_in' | 'rebuy' | 'cash_out' | 'reversal' | 'adjustment';
  amount_ils: number;
  chips_count?: number | null;
  reverses_entry_id?: string | null;
  note?: string | null;
  queued_at: string;
};

const KEY = 'poker.pending-ledger.v1';
type Listener = () => void;
const listeners = new Set<Listener>();
let lastError: { id: string; message: string } | null = null;
let flushing = false;

const read = (): PendingEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
};
const write = (rows: PendingEntry[]) => {
  localStorage.setItem(KEY, JSON.stringify(rows));
  listeners.forEach(l => l());
};

export const pending = (gameId?: string) => read().filter(r => !gameId || r.game_id === gameId);
export const takeError = () => {
  const e = lastError;
  lastError = null;
  return e;
};
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function enqueue(e: Omit<PendingEntry, 'id' | 'queued_at'> & { id?: string }): string {
  const row: PendingEntry = { ...e, id: e.id ?? uuid(), queued_at: new Date().toISOString() };
  write([...read(), row]);
  void flush();
  return row.id;
}

const isNetwork = (m: string) => /fetch|network|timeout|Failed to|ECONN|503|502|504/i.test(m);

/** Send queued entries in order. Business-rule rejections are dropped and reported; network errors wait for retry. */
export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const [head] = read();
      if (!head) return;
      const { queued_at: _q, ...row } = head;
      const { error } = await supabase.from('ledger_entries').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      if (error && isNetwork(error.message)) return; // keep it, try again later
      if (error) lastError = { id: head.id, message: error.message };
      write(read().filter(r => r.id !== head.id));
    }
  } catch {
    // offline: keep everything queued
  } finally {
    flushing = false;
  }
}

setInterval(() => {
  if (read().length) void flush();
}, 5000);
