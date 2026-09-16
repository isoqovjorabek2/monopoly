import { AUTH_BASE, currentAccount, isAccountId } from './account';
import { signProof } from './deviceKey';
import { redactForGuests, type GameKind, type RoomSnapshot } from './protocol';

/* ------------------------------------------------------------------ *
 * Saved tables, on aytingchi.uz.
 *
 * A table lives in its host's browser, so until now a game ended the moment
 * its last tab closed. Signed-in players' tables are copied to the server
 * every round; any of them can pick the game back up from "Your games",
 * from any device, even if nobody else is still there.
 *
 * What is uploaded is the redacted copy every guest already holds - no dice
 * seed, no card order - and a resumed table deals fresh ones. So a save is
 * never a way to see the future, whoever reads it.
 *
 * Every request carries the player's pass and a signature over the request
 * from the browser key that pass was issued to, so a pass a host has seen
 * cannot be used to read or overwrite anyone's games.
 * ------------------------------------------------------------------ */

export interface SavedTable {
  code: string;
  epoch: number;
  updatedAt: number;
  kind: GameKind;
  round: number;
  names: string[];
}

async function sha256hex(body: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A request to the account server carrying the pass and a signature from
 *  this browser's key - saves, and game history (net/history.ts). */
export async function signedFetch(
  method: 'GET' | 'PUT' | 'DELETE' | 'POST', path: string, body = '',
): Promise<Response | null> {
  const account = currentAccount();
  if (!account) return null;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await signProof(`mply-save|${method}|${path}|${ts}|${await sha256hex(body)}`);
  if (!sig) return null;
  try {
    return await fetch(`${AUTH_BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'X-Pass': account.pass,
        'X-Proof': sig,
        'X-Proof-Time': ts,
      },
      body: body || undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return null;
  }
}

/** The signed-in players at a table: whoever may resume it. */
export function membersOf(room: RoomSnapshot): string[] {
  const ids = new Set<string>();
  for (const seat of room.seats) {
    if (isAccountId(seat.playerId)) ids.add(seat.playerId);
    const owner = room.owners?.[seat.playerId];
    if (owner) ids.add(owner);
  }
  return [...ids];
}

export async function uploadTable(room: RoomSnapshot): Promise<boolean> {
  const members = membersOf(room);
  if (members.length === 0) return false;
  const round = room.game?.round ?? room.cf?.round ?? 0;
  const body = JSON.stringify({
    room: redactForGuests(room),
    members,
    summary: { kind: room.kind, round, names: room.seats.map((s) => s.name) },
  });
  const res = await signedFetch('PUT', `/saves/${room.roomId}`, body);
  return Boolean(res?.ok);
}

export async function listTables(): Promise<SavedTable[]> {
  const res = await signedFetch('GET', '/saves');
  if (!res?.ok) return [];
  try {
    const data = await res.json() as { saves?: SavedTable[] };
    return Array.isArray(data.saves) ? data.saves : [];
  } catch {
    return [];
  }
}

export async function fetchTable(code: string): Promise<{ room: RoomSnapshot; epoch: number } | null> {
  const res = await signedFetch('GET', `/saves/${code}`);
  if (!res?.ok) return null;
  try {
    const data = await res.json() as { room?: RoomSnapshot; epoch?: number };
    return data.room ? { room: data.room, epoch: data.epoch ?? 0 } : null;
  } catch {
    return null;
  }
}

export async function forgetTable(code: string): Promise<void> {
  await signedFetch('DELETE', `/saves/${code}`);
}
