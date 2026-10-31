import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { supabase, heError } from '../../../lib/supabase';
import { useGame } from '../../../lib/useGame';
import { useClock, clockActions, useAlertPref, useBlindAlertsSync } from '../../../lib/useClock';
import { mmss, type Level } from '../../../core/clock';
import { C, blinds } from '../../../lib/theme';
import { Screen, Txt, Num, Btn, Card, ErrorBar, LivePill, Row, Back, Loading } from '../../../ui/kit';
import { BlindEditor, levelsValid } from '../../../ui/tournament';
import { useKeyboardInset } from '../../../lib/useKeyboardInset';

/** Short beep + vibration at level change while this screen is open (web has no lock-screen alerts). */
function cue() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  if (Platform.OS !== 'web') return;
  try {
    navigator.vibrate?.([400, 200, 400]);
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach(t => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
  } catch { /* no audio */ }
}

export default function Clock() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const g = useGame(id);
  const c = useClock(g.game, g.levels);
  const alerts = useAlertPref(id, g.isBanker);
  useBlindAlertsSync(g.game, g.levels, alerts.on);
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // level changed while watching: beep (not on first render)
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!g.loaded) return;
    if (!c.started || c.paused) { prev.current = c.idx; return; }
    if (prev.current != null && prev.current !== c.idx) cue();
    prev.current = c.idx;
  }, [c.idx, c.started, c.paused, g.loaded]);

  if (!g.loaded || !g.game) return <Loading />;
  const game = g.game;
  const closed = game.status === 'closed' || game.status === 'cancelled';
  const act = clockActions(game, g.levels, m => g.setError(m), () => void g.reload());
  const pct = c.levelMs ? 1 - c.remainingMs / c.levelMs : 0;
  const warn = c.started && !c.paused && c.remainingMs <= 60_000 && !c.over;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Back label="לשולחן" to={`/game/${id}`} />
        <LivePill live={g.live} onRefresh={g.reload} />
      </Row>
      <ErrorBar text={g.error ? heError({ message: g.error }) : null} onClose={() => g.setError(null)} />
      {!g.levels.length ? (
        <Card><Txt>אין מבנה בליינדים לטורניר הזה</Txt></Card>
      ) : (
        <>
          <Txt center muted size={15}>{`${game.name} · רמה ${c.idx + 1} מתוך ${g.levels.length}`}</Txt>
          <View style={{ alignItems: 'center', marginTop: 10, gap: 4 }}>
            <Txt muted size={13} center>סמול / ביג</Txt>
            <Num weight="black" size={58} center color={C.text}>{c.level ? blinds(c.level.small_blind, c.level.big_blind) : ''}</Num>
          </View>
          <View style={{ alignItems: 'center', marginVertical: 8 }}>
            <Num weight="black" size={88} center color={c.paused || !c.started ? C.muted : warn ? C.neg : C.acc}>{c.over ? 'סוף' : mmss(c.remainingMs)}</Num>
            <Txt muted center>{closed ? 'הטורניר הסתיים' : !c.started ? 'השעון עוד לא הופעל' : c.paused ? '⏸ בהפסקה' : c.over ? 'נגמרו הרמות · נשארים ברמה האחרונה' : 'עד עליית הבליינדים'}</Txt>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.surf, overflow: 'hidden', marginBottom: 14 }}>
            <View style={{ width: `${Math.round(pct * 100)}%`, height: 8, backgroundColor: warn ? C.neg : C.acc, alignSelf: 'flex-start' }} />
          </View>
          {c.next && (
            <Card style={{ alignItems: 'center', marginBottom: 14 }}>
              <Txt muted size={13} center>הרמה הבאה</Txt>
              <Num weight="bold" size={24} center>{`${blinds(c.next.small_blind, c.next.big_blind)} · ${c.next.duration_min} דק׳`}</Num>
            </Card>
          )}

          {g.isBanker && !closed && (
            <View style={{ gap: 10, marginBottom: 14 }}>
              {!c.started ? (
                <Btn title="▶ הפעלת השעון" onPress={act.start} />
              ) : c.paused ? (
                <Btn title="▶ המשך" onPress={act.resume} />
              ) : (
                <Btn title="⏸ הפסקה" onPress={act.pause} />
              )}
              {c.started && (
                <>
                  <Row>
                    <Btn small kind="ghost" title="→ רמה קודמת" style={{ flex: 1 }} disabled={c.idx === 0} onPress={act.prev} />
                    <Btn small kind="ghost" title="רמה הבאה ←" style={{ flex: 1 }} disabled={!c.next} onPress={act.next} />
                  </Row>
                  <Row>
                    <Btn small kind="ghost" title="−1 דק׳" style={{ flex: 1 }} disabled={c.remainingMs <= 60_000} onPress={() => act.addMinutes(-1)} />
                    <Btn small kind="ghost" title="+1 דק׳" style={{ flex: 1 }} onPress={() => act.addMinutes(1)} />
                  </Row>
                </>
              )}
              <Row>
                <Btn small kind="ghost" title="✎ עריכת הבליינדים" style={{ flex: 1 }} onPress={() => setEditing(true)} />
                {c.started && (
                  <Btn small kind="danger" title={confirmReset ? 'לאפס? הקשה שוב' : 'איפוס שעון'} style={{ flex: 1 }}
                    onPress={() => { if (confirmReset) { setConfirmReset(false); void act.reset(); } else { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); } }} />
                )}
              </Row>
            </View>
          )}

          {!closed && (
            <Card style={{ gap: 6, marginBottom: 14 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt weight="bold">🔔 התראה בטלפון הזה</Txt>
                {alerts.supported ? (
                  <Switch value={alerts.on} onValueChange={v => void alerts.set(v)} trackColor={{ true: C.acc, false: C.line }} thumbColor={C.text} />
                ) : null}
              </Row>
              <Txt muted size={12}>
                {alerts.supported
                  ? 'צלצול ורטט בכל עליית בליינדים, גם כשהמסך כבוי, הטלפון נעול או האפליקציה סגורה. אם הבנקאי עוצר או מקפיץ רמה, ההתראות כאן מתעדכנות ברגע שהאפליקציה פתוחה או ברקע.'
                  : 'בדפדפן אין התראה כשהמסך נעול. כל עוד המסך הזה פתוח: צפצוף ורטט בכל עליית בליינדים, והמסך לא נכבה. התראה גם במסך נעול: באפליקציית האנדרואיד.'}
              </Txt>
            </Card>
          )}

          <Txt weight="bold" size={16} style={{ marginBottom: 8 }}>כל הרמות</Txt>
          <View style={{ gap: 4 }}>
            {c.levels.map((l, i) => (
              <Pressable key={l.level_no} disabled={!g.isBanker || !c.started || closed} onPress={() => act.goto(i)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: i === c.idx ? C.raised : 'transparent', borderWidth: i === c.idx ? 1.5 : 0, borderColor: C.acc, opacity: i < c.idx ? 0.5 : 1 }}>
                <Txt weight={i === c.idx ? 'black' : 'regular'}>{`רמה ${i + 1}`}</Txt>
                <Num weight="bold">{blinds(l.small_blind, l.big_blind)}</Num>
                <Txt muted>{`${l.duration_min} דק׳`}</Txt>
              </Pressable>
            ))}
          </View>
          {g.isBanker && c.started && !closed && <Txt muted size={12} style={{ marginTop: 6 }}>הקשה על רמה: מעבר אליה</Txt>}
        </>
      )}
      <EditLevels open={editing} onClose={() => setEditing(false)} levels={c.levels} onSave={async l => {
        const del = await supabase.from('blind_levels').delete().eq('game_id', id);
        if (del.error) return g.setError(heError(del.error));
        const ins = await supabase.from('blind_levels').insert(l.map((x, i) => ({ game_id: id, level_no: i + 1, small_blind: x.small_blind, big_blind: x.big_blind, duration_min: x.duration_min })));
        if (ins.error) return g.setError(heError(ins.error));
        await supabase.from('games').update({ blinds_rev: (game.blinds_rev ?? 0) + 1 }).eq('id', id); // tells every phone to reload
        setEditing(false);
        void g.reload();
      }} />
    </Screen>
  );
}

function EditLevels({ open, onClose, levels, onSave }: { open: boolean; onClose: () => void; levels: Level[]; onSave: (l: Level[]) => void }) {
  const [draft, setDraft] = useState<Level[]>(levels);
  useEffect(() => { if (open) setDraft(levels); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const kb = useKeyboardInset();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#000a' }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 12, maxHeight: kb ? '96%' : '88%', width: '100%', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderColor: C.line, marginBottom: kb }}>
        <Txt size={22} weight="black">עריכת הבליינדים</Txt>
        <Txt muted size={12}>השעון ממשיך לרוץ. שינוי ברמה הנוכחית חל מיד.</Txt>
        <ScrollView keyboardShouldPersistTaps="handled">
          <BlindEditor levels={draft} onChange={setDraft} />
        </ScrollView>
        <Row>
          <Btn small kind="ghost" title="ביטול" style={{ flex: 1 }} onPress={onClose} />
          <Btn small title="שמירה" style={{ flex: 2 }} disabled={!levelsValid(draft)} onPress={() => onSave(draft)} />
        </Row>
      </View>
    </Modal>
  );
}
