import { CLASSIC, PRESETS } from '../game/settings';
import type { GameSettings } from '../game/types';

/* ------------------------------------------------------------------ *
 * The public lobby directory, from the client's side.
 *
 * This is the only part of the game that talks to a server, and it is
 * deliberately the least important part: it publishes "a room called
 * GOLD-FALCON-42 exists and has three seats free" and reads back other
 * people's equivalents. No game state goes near it, nobody's moves pass
 * through it, and it is not consulted to play.
 *
 * So every call here fails silently and returns nothing. A directory that
 * is down means the browse list is empty; it must never mean the game is
 * broken, because a private room code still works with this service in
 * ashes - and that is the property the whole architecture is built on.
 * ------------------------------------------------------------------ */

const BASE = (import.meta.env.VITE_LOBBY_URL ?? 'https://aytingchi.uz/lobbies')
  .replace(/\/$/, '');

/** Off entirely when built without a directory, which keeps a fully
 *  serverless build possible. */
export const hasDirectory = BASE.length > 0;

export interface PublicRoom {
  id: string;
  host: string;
  seats: number;
  maxSeats: number;
  preset: string;
  deviations: number;
  age: number;
}

/** Which preset a room is playing, and how far it has drifted from it. */
export function describeRules(s: GameSettings): { preset: string; deviations: number } {
  const KEYS: (keyof GameSettings)[] = [
    'startingCash', 'goSalary', 'doubleOnGo', 'freeParkingJackpot', 'snakeEyesBonus',
    'auctionsEnabled', 'doubleRentOnMonopoly', 'buildingShortage', 'requireFullSetToBuild',
    'mustLapBeforeBuying', 'noRentInJail', 'mortgageInterestPct', 'jailFine', 'canBuyInJail',
  ];
  for (const p of PRESETS) {
    const target = { ...CLASSIC, ...p.patch };
    const matches = KEYS.every((k) => s[k] === target[k]) && s.winCondition === target.winCondition;
    if (matches) return { preset: p.id, deviations: 0 };
  }
  return {
    preset: 'custom',
    deviations: KEYS.filter((k) => s[k] !== CLASSIC[k]).length,
  };
}

async function post(path: string, body: unknown): Promise<boolean> {
  if (!hasDirectory) return false;
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Never let a slow directory hold anything up.
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Say this room exists, and keep saying it. Also the heartbeat. */
export function announce(room: {
  id: string; host: string; seats: number; maxSeats: number; settings: GameSettings;
}): Promise<boolean> {
  const { preset, deviations } = describeRules(room.settings);
  return post('announce', {
    id: room.id,
    host: room.host,
    seats: room.seats,
    maxSeats: room.maxSeats,
    preset,
    deviations,
  });
}

/** Take it off the list. Best effort - the 45s expiry is the real cleanup. */
export function close(id: string): Promise<boolean> {
  return post('close', { id });
}

export async function listRooms(): Promise<PublicRoom[]> {
  if (!hasDirectory) return [];
  try {
    const res = await fetch(`${BASE}/rooms`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.rooms) ? (data.rooms as PublicRoom[]) : [];
  } catch {
    return [];
  }
}
