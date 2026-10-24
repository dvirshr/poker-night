import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { APK_LINK } from '../lib/guide';
import { C } from '../lib/theme';
import { Txt, Btn, Card, Row, useOnResume } from './kit';

const LATEST = 'https://api.github.com/repos/dvirshr/poker-night/releases/latest';
const DISMISSED = 'poker.updateDismissed.v1';
const IMPORTANT = '[חשוב]';

const parts = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
/** true when a is newer than b ("0.1.20" > "0.1.9") */
export function newer(a: string, b: string) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
const readDismissed = () => { try { return localStorage.getItem(DISMISSED) ?? ''; } catch { return ''; } };

/** Android only: tells the player a newer APK is out, what it brings, and where to get it. The website updates by itself. */
export function UpdateBanner() {
  const mine = Constants.expoConfig?.version ?? '0';
  const [latest, setLatest] = useState<{ version: string; notes: string; important: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [checkedAt, setCheckedAt] = useState(0);

  const check = useCallback(async () => {
    if (Platform.OS === 'web' || Date.now() - checkedAt < 30 * 60_000) return;
    setCheckedAt(Date.now());
    try {
      const r = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const j = (await r.json()) as { tag_name?: string; body?: string | null };
      if (!j.tag_name) return;
      const body = (j.body ?? '').trim();
      setLatest({ version: j.tag_name.replace(/^v/, ''), notes: body.replace(IMPORTANT, '').trim(), important: body.includes(IMPORTANT) });
    } catch { /* offline: try again later */ }
  }, [checkedAt]);

  useEffect(() => { void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useOnResume(check);

  if (!latest || !newer(latest.version, mine)) return null;
  if (!latest.important && dismissed === latest.version) return null;
  return (
    <Card accent style={{ marginBottom: 14, gap: 8 }}>
      <Txt weight="black" size={17}>{`${latest.important ? '⚠️ עדכון חשוב' : '🆕 גרסה חדשה'} · ${latest.version}`}</Txt>
      <Txt muted size={12}>{`מותקנת אצלך ${mine}`}</Txt>
      {!!latest.notes && (
        <View style={{ gap: 2 }}>
          {latest.notes.split('\n').filter(l => l.trim()).slice(0, 8).map((l, i) => <Txt key={i} size={14}>{l.trim()}</Txt>)}
        </View>
      )}
      <Txt muted size={12}>בסוף ההורדה: "פתח" ואז "עדכן". נשארים מחוברים, שום דבר לא נמחק.</Txt>
      <Row>
        {!latest.important && (
          <Btn small kind="ghost" title="אחר כך" style={{ flex: 1 }} onPress={() => {
            try { localStorage.setItem(DISMISSED, latest.version); } catch { /* ignore */ }
            setDismissed(latest.version);
          }} />
        )}
        <Btn small title="הורדה והתקנה" style={{ flex: 2 }} onPress={() => void Linking.openURL(APK_LINK)} />
      </Row>
    </Card>
  );
}
