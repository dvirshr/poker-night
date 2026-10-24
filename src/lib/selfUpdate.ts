// Web: the site updates by itself; nothing to install.
export const canSelfUpdate = false;
export async function downloadAndInstall(_url: string, _version: string, _onProgress: (p: number) => void): Promise<void> {}
