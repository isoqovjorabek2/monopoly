import type { BotLevel, GameAction, GameEvent, GameSettings, GameState, TokenId } from '../game/types';

export const PROTOCOL_VERSION = 1;

/** PeerJS ids are shared across every app on the public broker, so we
 *  namespace ours. Players only ever see the readable half. */
export const ROOM_PREFIX = 'mply-v1-';

export interface SeatInfo {
  playerId: string;
  name: string;
  token: TokenId;
  color: string;
  isBot: boolean;
  botLevel: BotLevel;
  isHost: boolean;
  connected: boolean;
  /** Round-trip time in ms, host-measured. */
  ping: number;
}

/** Everything a client needs to render the room, game or no game. */
export interface RoomSnapshot {
  roomId: string;
  hostId: string;
  seats: SeatInfo[];
  settings: GameSettings;
  game: GameState | null;
  /** Bumped on every host-side change; clients drop stale snapshots. */
  rev: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  color: string;
  text: string;
  at: number;
}

/* ----------------------------- guest -> host ----------------------------- */
export type Up =
  | { t: 'HELLO'; playerId: string; name: string; token: TokenId }
  | { t: 'PROFILE'; playerId: string; name: string; token: TokenId }
  | { t: 'SETTINGS'; playerId: string; settings: GameSettings }
  | { t: 'ADD_BOT'; playerId: string }
  | { t: 'REMOVE_SEAT'; playerId: string; target: string }
  | { t: 'INTENT'; playerId: string; action: GameAction }
  | { t: 'CHAT'; playerId: string; text: string }
  | { t: 'PONG'; playerId: string; seq: number };

/* ----------------------------- host -> guest ----------------------------- */
export type Down =
  | { t: 'WELCOME'; you: string; snapshot: RoomSnapshot }
  | { t: 'ROOM'; snapshot: RoomSnapshot }
  | { t: 'EVENTS'; rev: number; events: GameEvent[] }
  | { t: 'CHAT'; message: ChatMessage }
  | { t: 'REJECT'; reason: string }
  | { t: 'PING'; seq: number }
  | { t: 'BYE'; reason: 'host_left' | 'kicked' | 'room_full' | 'in_progress' };

export interface Envelope<T> {
  v: number;
  body: T;
}

export const wrap = <T>(body: T): Envelope<T> => ({ v: PROTOCOL_VERSION, body });

/** Parse hostile input. Never throws, never trusts a shape. */
export function unwrap<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'object') return null;
  const env = raw as Envelope<T>;
  if (env.v !== PROTOCOL_VERSION) return null;
  if (!env.body || typeof env.body !== 'object') return null;
  if (typeof (env.body as { t?: unknown }).t !== 'string') return null;
  return env.body;
}

/* ------------------------------ room codes ------------------------------- */

const ADJECTIVES = [
  'AMBER', 'BOLD', 'BRASS', 'CRIMSON', 'DAPPER', 'EMERALD', 'GILDED', 'GOLDEN',
  'IVORY', 'JADE', 'LUCKY', 'NOBLE', 'ONYX', 'PLUSH', 'REGAL', 'SILVER',
  'SWIFT', 'VELVET', 'WILD', 'ZESTY',
];
const NOUNS = [
  'ANCHOR', 'BARON', 'CROWN', 'DERBY', 'FALCON', 'HARBOR', 'IRON', 'JOKER',
  'KETTLE', 'LANTERN', 'MARBLE', 'NICKEL', 'ORCHID', 'PARLOR', 'QUARRY',
  'RIVET', 'SATCHEL', 'TOPHAT', 'VAULT', 'WAGON',
];

/** Human-sayable so people can read it down a phone. ~72k combinations. */
export function generateRoomCode(): string {
  const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
  const n = 10 + Math.floor(Math.random() * 90);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}

export const toPeerId = (code: string): string =>
  ROOM_PREFIX + code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

export const normaliseCode = (code: string): string =>
  code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

export function roomLink(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/join/${code}`;
}

/** A stable identity that survives reconnects but keeps two tabs distinct. */
export function localPlayerId(): string {
  try {
    const existing = sessionStorage.getItem('mply.pid');
    if (existing) return existing;
    const id = `p_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('mply.pid', id);
    return id;
  } catch {
    return `p_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Peer-supplied strings are untrusted: cap them before they reach layout. */
export const cleanText = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
