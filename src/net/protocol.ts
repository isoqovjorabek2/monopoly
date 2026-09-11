import type { CFAction, CFRules, CFState } from '../cashflow/types';
import type { BotLevel, GameAction, GameEvent, GameSettings, GameState, TokenId } from '../game/types';

/** 2: a room carries which game it plays. A tab still on 1 cannot read a
 *  Cashflow table, so it is refused at the envelope rather than half-drawn. */
export const PROTOCOL_VERSION = 2;

/** PeerJS ids are shared across every app on the public broker, so we
 *  namespace ours. Players only ever see the readable half. */
export const ROOM_PREFIX = 'mply-v1-';

/** The two games this table can play. */
export type GameKind = 'monopoly' | 'cashflow';

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
  /** Chosen on the front door when the room is opened, and fixed after. */
  kind: GameKind;
  seats: SeatInfo[];
  /** The table's shared settings. Cashflow reads its seat count, bot level
   *  and bot fill from here too, so the lobby has one set of those. */
  settings: GameSettings;
  /** Cashflow's own rules. */
  cfRules: CFRules;
  game: GameState | null;
  cf: CFState | null;
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
  | { t: 'HELLO'; playerId: string; name: string; token: TokenId; secret: string }
  | { t: 'PROFILE'; playerId: string; name: string; token: TokenId }
  | { t: 'SETTINGS'; playerId: string; settings: GameSettings; cfRules?: CFRules }
  | { t: 'ADD_BOT'; playerId: string }
  | { t: 'REMOVE_SEAT'; playerId: string; target: string }
  | { t: 'INTENT'; playerId: string; action: GameAction | CFAction }
  | { t: 'CHAT'; playerId: string; text: string }
  | { t: 'PONG'; playerId: string; seq: number };

/* ----------------------------- host -> guest ----------------------------- */
export type Down =
  | { t: 'WELCOME'; you: string; snapshot: RoomSnapshot }
  | { t: 'ROOM'; snapshot: RoomSnapshot }
  | { t: 'EVENTS'; rev: number; events: GameEvent[] }
  | { t: 'CF_EVENTS'; rev: number; events: import('../cashflow/types').CFEvent[] }
  | { t: 'CHAT'; message: ChatMessage }
  | { t: 'REJECT'; reason: string }
  | { t: 'PING'; seq: number }
  | { t: 'BYE'; reason: 'host_left' | 'kicked' | 'room_full' | 'in_progress' | 'seat_taken' };

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

/**
 * A private key that proves, on a reconnect, that you are the same person who
 * first took this seat. The playerId travels in every snapshot and so is
 * public; this never leaves the tab that owns the seat except in the HELLO it
 * authenticates, so another player who knows your id still cannot take it.
 */
export function localSecret(): string {
  try {
    const existing = sessionStorage.getItem('mply.secret');
    if (existing) return existing;
    const s = `s_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('mply.secret', s);
    return s;
  } catch {
    return `s_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * The copy of a room a guest is allowed to see. A started game's state carries
 * the RNG seed and the shuffled, undrawn card decks - everything needed to
 * predict every future roll and card. Guests never run the engine, so they
 * never need any of it; stripping it is what stops a guest from reading the
 * future out of the snapshot they receive. The host keeps the full copy.
 * Both games keep their future in the same two places, and lose it the same way.
 */
export function redactForGuests(snapshot: RoomSnapshot): RoomSnapshot {
  if (!snapshot.game && !snapshot.cf) return snapshot;
  return {
    ...snapshot,
    settings: { ...snapshot.settings, seed: 0 },
    game: snapshot.game && {
      ...snapshot.game,
      settings: { ...snapshot.game.settings, seed: 0 },
      chanceOrder: [],
      chestOrder: [],
    },
    cf: snapshot.cf && {
      ...snapshot.cf,
      settings: { ...snapshot.cf.settings, seed: 0 },
      decks: { small: [], big: [], market: [], doodad: [] },
    },
  };
}

/** Peer-supplied strings are untrusted: cap them before they reach layout. */
export const cleanText = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
