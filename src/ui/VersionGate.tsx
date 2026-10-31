import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import { supabase, APP_VERSION } from '../lib/supabase';
import { APK_LINK } from '../lib/guide';
import { downloadAndInstall, canSelfUpdate } from '../lib/selfUpdate';
import { C } from '../lib/theme';
import { Screen, Txt, Btn, Card, useOnResume } from './kit';

type Cfg = { min_version: string; enforce: boolean; message: string };

const parts = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
export function versionLt(a: string, b: string) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/**
 * Installed app older than the operator's minimum: a full-screen "update to continue".
 * The server enforces the same rule (check_request), so an app that skips this screen still cannot read or write.
 * The website is always the latest build and is never blocked.
 */
export function VersionGate({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (Platform.OS === 'web') return;
    const { data } = await supabase.from('app_config').select('min_version, enforce, message').maybeSingle();
    if (data) setCfg(data as Cfg);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useOnResume(load);

  const blocked = !!cfg && cfg.enforce && versionLt(APP_VERSION, cfg.min_version);
  if (!blocked) return <>{children}</>;

  const update = async () => {
    setFailed(false);
    if (!canSelfUpdate) { void Linking.openURL(APK_LINK); return; }
    try {
      setProgress(0);
      await downloadAndInstall(APK_LINK, `min-${cfg!.min_version}`, setProgress);
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Screen>
      <View style={{ height: 60 }} />
      <Card accent style={{ gap: 10 }}>
        <Txt size={24} weight="black">צריך לעדכן</Txt>
        <Txt size={15} style={{ lineHeight: 22 }}>{cfg!.message}</Txt>
        <Txt muted size={12}>{`הגרסה שלך ${APP_VERSION} · נדרשת ${cfg!.min_version} ומעלה. הנתונים שלך שמורים בשרת ולא ייפגעו.`}</Txt>
        <Btn title={progress != null ? `מוריד… ${Math.round(progress * 100)}%` : 'עדכון עכשיו'} busy={progress != null} onPress={() => void update()} />
        {failed && <Btn small kind="ghost" title="הורדה דרך הדפדפן" onPress={() => void Linking.openURL(APK_LINK)} />}
        <Txt muted size={12} color={C.muted}>אפשר גם להמשיך מהאתר, בלי התקנה.</Txt>
        <Btn small kind="ghost" title="פתיחת האתר" onPress={() => void Linking.openURL('https://dvirshr.github.io/poker-night')} />
      </Card>
    </Screen>
  );
}
