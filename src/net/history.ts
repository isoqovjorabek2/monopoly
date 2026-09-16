import { useStore } from '../store/store';
import { currentAccount } from './account';
import { buildResult, type GameResult } from './result';
import { signedFetch } from './saves';

/* ------------------------------------------------------------------ *
 * Game history (Party Hall Plus).
 *
 * When a table finishes, every signed-in player's own browser reports its
 * own line to the server - signed by that browser's key, so nobody can file
 * a result for anyone else. The totals come back to everyone; the list of
 * games only to Plus players, and it is kept either way, so it is all there
 * the day somebody upgrades.
 * ------------------------------------------------------------------ */

export interface GameRecord extends GameResult {
  score: number;
  at: number;
}

export interface KindTotals { played: number; wins: number; best: number }

export interface History {
  totals: { played: number; wins: number; byKind: Record<'monopoly' | 'cashflow', KindTotals> };
  games: GameRecord[];
  plus: boolean;
}

const SENT_KEY = 'mply.reportedGames';
const inFlight = new Set<string>();

function sentBefore(id: string): boolean {
  try {
    const list = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? '[]') as unknown;
    return Array.isArray(list) && list.includes(id);
  } catch {
    return false;
  }
}

function markSent(id: string): void {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? '[]') as unknown;
    const list = Array.isArray(raw) ? raw : [];
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...list, id].slice(-50)));
  } catch { /* private mode: the server ignores a repeat anyway */ }
}

/** Report this tab's result from a finished table, once. */
export async function reportResult(room: Parameters<typeof buildResult>[0], myId: string): Promise<boolean> {
  const account = currentAccount();
  if (!account) return false;
  const result = buildResult(room, account.uid, myId);
  if (!result || inFlight.has(result.id) || sentBefore(result.id)) return false;
  inFlight.add(result.id);
  const res = await signedFetch('POST', '/history', JSON.stringify(result));
  inFlight.delete(result.id);
  if (res?.ok) markSent(result.id);
  return Boolean(res?.ok);
}

/** Report a result the moment any table this tab is at reaches the end. */
export function startHistoryReports(): void {
  let lastPhase: string | undefined;
  useStore.subscribe((s) => {
    const phase = s.room?.game?.phase ?? s.room?.cf?.phase;
    if (s.room && phase === 'game_over' && lastPhase !== 'game_over') void reportResult(s.room, s.me.playerId);
    lastPhase = phase;
  });
}

export async function fetchHistory(): Promise<History | null> {
  const res = await signedFetch('GET', '/history');
  if (!res?.ok) return null;
  try {
    return await res.json() as History;
  } catch {
    return null;
  }
}
