import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase, heError } from '../lib/supabase';
import type { Draw, Seat } from '../lib/useGame';
import { C } from '../lib/theme';
import { Txt, Btn, Card, Row } from './kit';

const time = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/**
 * Dealer draw on the table screen. The server picks (cryptographic random, uniform);
 * every phone with the table open gets the reveal at the same moment.
 */
export function DealerDraw({ gameId, draws, seats, isBanker, open, onError, onDrawn }: {
  gameId: string; draws: Draw[]; seats: Seat[]; isBanker: boolean; open: boolean; onError: (m: string) => void; onDrawn: () => void;
}) {
  const nameOf = (pid: string) => seats.find(s => s.player_id === pid)?.display_name ?? '';
  const last = draws[draws.length - 1] ?? null;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reveal, setReveal] = useState<Draw | null>(null);

  // a draw newer than what this screen already knew: show it to everyone
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const max = last?.draw_no ?? 0;
    if (seen.current == null) { seen.current = max; return; }
    if (max > seen.current) { seen.current = max; setReveal(last); }
  }, [last]);

  const draw = async () => {
    setConfirm(false);
    setBusy(true);
    const { error } = await supabase.rpc('draw_dealer', { p_game: gameId });
    setBusy(false);
    if (error) onError(heError(error));
    else onDrawn(); // shows the result even if the live connection is down
  };

  return (
    <>
      {(last || (isBanker && open)) && (
        <Card style={{ marginBottom: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            {last ? (
              <>
                <Txt><Txt>{'🎲 דילר ראשון: '}</Txt><Txt weight="black" color={C.acc}>{nameOf(last.player_id)}</Txt></Txt>
                <Txt muted size={12}>{`${last.draw_no > 1 ? `הגרלה ${last.draw_no} (הוגרל שוב)` : 'הגרלה 1'} · מתוך ${last.pool} שחקנים · ${time(last.drawn_at)}`}</Txt>
              </>
            ) : (
              <Txt muted size={13}>מי מחלק ראשון? הגרלה הוגנת שכולם רואים</Txt>
            )}
          </View>
          {isBanker && open && (
            confirm ? (
              <Row style={{ gap: 6 }}>
                <Btn small kind="ghost" title="ביטול" style={{ height: 38, paddingHorizontal: 10 }} onPress={() => setConfirm(false)} />
                <Btn small title={`הגרלה ${(last?.draw_no ?? 0) + 1}`} style={{ height: 38, paddingHorizontal: 12 }} onPress={draw} busy={busy} />
              </Row>
            ) : (
              <Btn small kind={last ? 'ghost' : 'primary'} title={last ? 'הגרלה חוזרת' : '🎲 הגרלת דילר'} style={{ height: 38, paddingHorizontal: 12 }} busy={busy}
                onPress={() => (last ? setConfirm(true) : void draw())} />
            )
          )}
        </Card>
      )}
      {confirm && <Txt muted size={12} style={{ marginTop: -4, marginBottom: 8 }}>{'כולם יראו שזו הגרלה חוזרת. ההגרלה הקודמת נשארת ביומן.'}</Txt>}
      <Reveal draw={reveal} names={seats.map(s => s.display_name)} winner={reveal ? nameOf(reveal.player_id) : ''} onClose={() => setReveal(null)} />
    </>
  );
}

/** Names spin, slow down, land on the winner. Purely visual: the result is already fixed by the server. */
function Reveal({ draw, names, winner, onClose }: { draw: Draw | null; names: string[]; winner: string; onClose: () => void }) {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!draw) return;
    setDone(false);
    let i = 0;
    let delay = 60;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      i += 1;
      setShown(names[i % names.length] ?? '');
      Haptics.selectionAsync().catch(() => {});
      delay *= 1.12;
      if (delay < 420) t = setTimeout(step, delay);
      else {
        setShown(winner);
        setDone(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    };
    t = setTimeout(step, delay);
    return () => clearTimeout(t);
  }, [draw?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal visible={!!draw} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={done ? onClose : undefined} style={{ flex: 1, backgroundColor: '#000c', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 420, backgroundColor: C.surf, borderRadius: 24, borderWidth: 2, borderColor: done ? C.acc : C.line, padding: 28, alignItems: 'center', gap: 14 }}>
          <Txt size={44} center>🎲</Txt>
          <Txt muted center>{draw && draw.draw_no > 1 ? `הגרלה חוזרת (${draw.draw_no})` : 'הגרלת דילר'}</Txt>
          <Txt size={40} weight="black" center color={done ? C.acc : C.text}>{shown}</Txt>
          <Txt muted size={13} center>{done ? 'מחלק ראשון · הקשה לסגירה' : '…'}</Txt>
        </View>
      </Pressable>
    </Modal>
  );
}
