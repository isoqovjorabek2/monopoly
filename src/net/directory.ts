import { CLASSIC, PRESETS } from '../game/settings';
import type { GameSettings } from '../game/types';
import { currentAccount } from './account';
import { signProof } from './deviceKey';

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

const BASE = (import.meta.env.VITE_LOBBY_URL ?? 'https://partyhall.io/lobbies')
  .replace(/\/$/, '');

/** Off entirely when built without a directory, which keeps a fully
 *  serverless build possible. */
export const hasDirectory = BASE.length > 0;

/** The games a public table can be. */
export type ListedKind = 'monopoly' | 'cashflow' | 'mafia';

export interface PublicRoom {
  id: string;
  /** Missing from a directory that predates the other games: Monopoly. */
  kind?: ListedKind;
  host: string;
  seats: number;
  maxSeats: number;
  preset: string;
  deviations: number;
  age: number;
  /** Already started, with `openSeats` bots a signed-in player could take. */
  inProgress?: boolean;
  openSeats?: number;
  round?: number;
}

/** Which preset a room is playing, and how far it has drifted from it. */
export function describeRules(s: GameSettings): { preset: string; deviations: number } {
  const KEYS: (keyof GameSettings)[] = [
    'startingCash', 'goSalary', 'doubleOnGo', 'freeParkingJackpot', 'snakeEyesBonus',
    'auctionsEnabled', 'doubleRentOnMonopoly', 'buildingShortage', 'requireFullSetToBuild',
    'mustLapBeforeBuying', 'noRentInJail', 'mortgageInterestPct', 'jailFine', 'canBuyInJail',
    'dealsEnabled',
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

async function postJson(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  if (!hasDirectory) return null;
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Never let a slow directory hold anything up.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<boolean> {
  return (await postJson(path, body)) !== null;
}

/** What a host signs to list a table: bound to the room and the minute, so
 *  a proof seen once is no use for any other room or any later hour. */
export const listProofMessage = (id: string, ts: string): string => `mply-list|${id}|${ts}`;

/** Say this room exists, and keep saying it. Also the heartbeat. The answer
 *  can carry `expired`: the room has been open longer than the directory
 *  keeps them, and beating further only re-asks a settled question. And it
 *  can carry the operator's word: `closed` (this code is off the list for a
 *  day) or `banned` (this host may not host publicly at all). Opening a
 *  public table is a Party Hall Plus feature, so the host's pass and a
 *  proof it holds that pass's key go along; `plus` comes back when the
 *  directory would not take it (no pass, no Plus, or a bad proof). */
export async function announce(room: {
  id: string; kind: ListedKind; host: string; seats: number; maxSeats: number; settings: GameSettings;
  live?: { openSeats: number; round: number };
}): Promise<{ expired: boolean; banned: boolean; closed: boolean; plus: boolean }> {
  // Only Monopoly's rules have presets worth naming; the others are listed plain.
  const { preset, deviations } = room.kind === 'monopoly'
    ? describeRules(room.settings)
    : { preset: 'classic', deviations: 0 };
  const account = currentAccount();
  const ts = String(Math.floor(Date.now() / 1000));
  const proof = account ? await signProof(listProofMessage(room.id, ts)) : null;
  const res = await postJson('announce', {
    id: room.id,
    kind: room.kind,
    host: room.host,
    seats: room.seats,
    maxSeats: room.maxSeats,
    preset,
    deviations,
    ...(account && proof ? { pass: account.pass, proof, ts } : {}),
    ...(room.live ? { inProgress: true, openSeats: room.live.openSeats, round: room.live.round } : {}),
  });
  return {
    expired: res?.expired === true,
    banned: res?.banned === true,
    closed: res?.closed === true,
    plus: res?.plus === true,
  };
}

/** Take it off the list. Best effort - the expiry is the real cleanup. */
export function close(id: string): Promise<boolean> {
  return post('close', { id });
}

/** Close from a page that is itself going away: timers are already dead, so
 *  this goes as a beacon. text/plain keeps it a simple request with no
 *  preflight; the server reads the JSON body regardless of its label. */
export function closeOnUnload(id: string): void {
  if (!hasDirectory || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  navigator.sendBeacon(`${BASE}/close`, new Blob([JSON.stringify({ id })], { type: 'text/plain' }));
}

/** One seat at a table, as the operator's panel sees it. */
export interface TableSeatReport {
  id: string;
  name: string;
  color: string;
  token: string;
  bot: boolean;
  host: boolean;
  connected: boolean;
  cash: number;
  /** Net worth in Monopoly; passive income in Cashflow. */
  worth: number;
  out: boolean;
  track?: string;
}

/** Everything the panel is told about a table. Rooms both public and
 *  private report, and solo games too - see telemetry.ts. */
export interface TableReport {
  id: string;
  kind: 'monopoly' | 'cashflow' | 'mafia';
  mode: 'public' | 'private' | 'solo';
  phase: 'lobby' | 'playing' | 'over';
  round: number;
  turn: string | null;
  winner: string | null;
  maxSeats: number;
  epoch: number;
  device: 'mobile' | 'desktop';
  lang: string;
  players: TableSeatReport[];
}

/** What the directory answers to a report. Alongside `ok` it can carry the
 *  operator's moderation: `bannedSeats` (accounts seated here that may not
 *  play - the host's client removes them), `banned` (this table's own host
 *  is banned), `close` (the room code was closed). */
export interface ReportAck {
  ok: boolean;
  banned?: boolean;
  bannedSeats?: string[];
  close?: boolean;
}

export function reportTable(report: TableReport): Promise<ReportAck | null> {
  return postJson('report', report) as Promise<ReportAck | null>;
}

/** The table was left on purpose. A table that just stops reporting is
 *  treated the same way a minute and a half later. */
export function closeTable(id: string): Promise<boolean> {
  return post('report/close', { id });
}

/** The public tables, and how many people are playing anywhere right now
 *  (null from a directory too old to say, or one that did not answer). */
export async function listRooms(): Promise<{ rooms: PublicRoom[]; playing: number | null }> {
  if (!hasDirectory) return { rooms: [], playing: null };
  try {
    const res = await fetch(`${BASE}/rooms`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { rooms: [], playing: null };
    const data = await res.json();
    return {
      rooms: Array.isArray(data?.rooms) ? (data.rooms as PublicRoom[]) : [],
      playing: typeof data?.playing === 'number' && Number.isFinite(data.playing) ? Math.max(0, Math.floor(data.playing)) : null,
    };
  } catch {
    return { rooms: [], playing: null };
  }
}
