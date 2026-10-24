// Android: download the new APK inside the app and hand it to the system installer.
// Android always shows its own "Update?" confirm (no app may install silently), and the
// first time it sends the player to "allow from this app" in settings.
import * as FS from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

export const canSelfUpdate = true;

export async function downloadAndInstall(url: string, version: string, onProgress: (p: number) => void): Promise<void> {
  const target = `${FS.cacheDirectory}poker-night-${version}.apk`;
  const info = await FS.getInfoAsync(target);
  if (!info.exists) {
    const tmp = `${target}.part`;
    await FS.deleteAsync(tmp, { idempotent: true });
    const dl = FS.createDownloadResumable(url, tmp, {}, p => {
      if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    });
    const res = await dl.downloadAsync();
    if (!res || res.status !== 200) throw new Error(`download failed (${res?.status ?? 'no response'})`);
    await FS.moveAsync({ from: tmp, to: target });
  }
  onProgress(1);
  const contentUri = await FS.getContentUriAsync(target);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: the installer may read our file
  });
}
