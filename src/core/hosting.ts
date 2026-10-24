// Hosting rotation: fixed order set by the admin ("after X comes Y").

export interface HostedNight { gameId: string; playedOn: string; createdAt: string; hostId: string | null }

const byDate = (a: HostedNight, b: HostedNight) => a.playedOn.localeCompare(b.playedOn) || a.createdAt.localeCompare(b.createdAt);

/** Who hosts next: the one after the last host in the order. Nobody hosted yet (or the last host left the order) → the first. */
export function nextHost(rotation: string[], nights: HostedNight[]): string | null {
  if (!rotation.length) return null;
  const hosted = nights.filter(n => n.hostId && rotation.includes(n.hostId)).sort(byDate);
  const last = hosted[hosted.length - 1];
  if (!last) return rotation[0];
  return rotation[(rotation.indexOf(last.hostId!) + 1) % rotation.length];
}

export interface HostRow { playerId: string; times: number; last: string | null; isNext: boolean }

/** The rotation table: everyone in turn order, how many times they hosted and when last. */
export function hostTable(rotation: string[], nights: HostedNight[]): HostRow[] {
  const next = nextHost(rotation, nights);
  return rotation.map(pid => {
    const mine = nights.filter(n => n.hostId === pid).sort(byDate);
    return { playerId: pid, times: mine.length, last: mine.length ? mine[mine.length - 1].playedOn : null, isNext: pid === next };
  });
}
