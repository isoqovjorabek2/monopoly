import { DECK_CARDS } from '../cashflow/data';
import type { CFAction, CFRules, CFState } from '../cashflow/types';
import { CHANCE, CHEST } from '../game/cards';
import { shuffle } from '../game/rng';
import type { BotLevel, GameAction, GameEvent, GameSettings, GameState, TokenId, SkinId } from '../game/types';
import type { MafiaAction, MafiaPrivate, MafiaRules, MafiaState } from '../mafia/types';

/** 2: a room carries which game it plays. A tab still on 1 cannot read a
 *  Cashflow table, so it is refused at the envelope rather than half-drawn.
 *  3: rounds, time-outs, estate auctions and host hand-over reshaped both
 *  games' state; an older tab would misread it.
 *  4: Omertà joined the table - a third kind, its own state slot, and
 *  private host -> guest messages an older tab has no idea what to do with.
 *  5: Omertà took the Mafia app's rules - timed phases, new night moves,
 *  chat channels - and a 4 tab would misread every part of it. */
export const PROTOCOL_VERSION = 5;

/** PeerJS ids are shared across every app on the public broker, so we
 *  namespace ours. Players only ever see the readable half. */
export const ROOM_PREFIX = 'mply-v1-';

/** The three games this table can play. */
export type GameKind = 'monopoly' | 'cashflow' | 'mafia';

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
  /** The player holds Party Hall Plus. Set by the host only, from a pass it
   *  verified - never from anything a guest says about itself. */
  plus?: boolean;
  /** That player's finish, set by the host only on a Plus seat. */
  skin?: SkinId;
  /** A signed-in player's Google picture, set by the host only on a seat
   *  whose pass it verified. */
  photo?: string;
}

/** Everything a client needs to render the room, game or no game. */
export interface RoomSnapshot {
  roomId: string;
  /** The current host's seat: follows host hand-overs. */
  hostId: string;
  /** The seat that opened the room: never changes. Absent in saves from
   *  before co-owners existed; fall back to hostId. */
  ownerId?: string;
  /** Chosen on the front door when the room is opened, and fixed after. */
  kind: GameKind;
  seats: SeatInfo[];
  /** The table's shared settings. Cashflow reads its seat count, bot level
   *  and bot fill from here too, so the lobby has one set of those. */
  settings: GameSettings;
  /** Cashflow's own rules. */
  cfRules: CFRules;
  /** Omertà's own rules. */
  mafRules: MafiaRules;
  game: GameState | null;
  cf: CFState | null;
  mf: MafiaState | null;
  /** Which host generation is running the table. 0 is the host who opened
   *  it; each hand-over adds one, and moves the peer id with it. */
  epoch: number;
  /** Bumped on every host-side change; clients drop stale snapshots. */
  rev: number;
  /** Seat id -> the account that plays it, where that is not the seat's own
   *  id: a bot seat a signed-in player took over mid-game. Travels with the
   *  table, so a host hand-over still knows whose seat is whose. */
  owners?: Record<string, string>;
  /** Signed-in players watching a game in progress, who may take over a
   *  bot's seat. */
  watchers?: { uid: string; name: string; photo?: string }[];
  /** Seat id -> SHA-256 of the secret a guest first claimed it with. Only a
   *  hash, so it is safe for every tab to hold - and every tab has to hold
   *  it, because any of them may become the host and need to check a guest
   *  coming back. Without it a new host knew no secrets at all, and anyone
   *  who had seen a seat id could sit down in that seat. */
  seatKeys?: Record<string, string>;
  /** Watchers asking to take over a bot, waiting on the host. In the room
   *  rather than in the host's tab, so a host hand-over does not lose them. */
  seatRequests?: SeatRequest[];
  /** Seats the table elected to moderate while the owner is away. See
   *  net/moderation.ts. */
  coowners?: string[];
  /** Player ids the owner or a co-owner removed; they stay out for good. */
  kicked?: string[];
  /** Co-owner endorsements: voter seat id -> candidate seat id. */
  coownerVotes?: Record<string, string>;
  /** When the owner's seat last lost its connection; null while they are
   *  here. In the room so a host hand-over does not restart the clock. */
  ownerAwayAt?: number | null;
  /** The host watched a rewarded video in the lobby: the Plus boards are
   *  open for this table's next game, as if a Plus player sat at it. Cleared
   *  by a rematch, so one video buys one game. */
  themeTrial?: boolean;
}

export interface SeatRequest { uid: string; name: string; target: string }

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  color: string;
  text: string;
  at: number;
  /** Omertà's private channels: the family's night talk, a dead player's
   *  last word, a whisper between two. Absent for the whole table. */
  channel?: 'family' | 'last' | 'whisper';
  /** A whisper's other end. */
  to?: string;
  toName?: string;
}

/* ----------------------------- guest -> host ----------------------------- */
export type Up =
  | {
    t: 'HELLO'; playerId: string; name: string; token: TokenId; secret: string;
    /** The finish this player picked; the host keeps it only for a Plus seat. */
    skin?: SkinId;
    /** A signed-in player's pass (see net/account.ts). */
    auth?: string;
    /** That player's Google picture; the host keeps it only with the pass. */
    photo?: string;
    /** Set by the host's own transport once the pass has checked out, and
     *  stripped from anything a peer sends. Never trusted off the wire. */
    verified?: string;
    /** Likewise: the Plus paid-until date from that verified pass. */
    verifiedPlus?: number;
  }
  | { t: 'PROFILE'; playerId: string; name: string; token: TokenId; skin?: SkinId }
  | { t: 'SETTINGS'; playerId: string; settings: GameSettings; cfRules?: CFRules; mafRules?: MafiaRules }
  | { t: 'ADD_BOT'; playerId: string }
  | { t: 'REMOVE_SEAT'; playerId: string; target: string }
  /** An endorsement for co-owner while the owner is away (net/moderation.ts). */
  | { t: 'ELECT'; playerId: string; candidate: string }
  | { t: 'INTENT'; playerId: string; action: GameAction | CFAction | MafiaAction }
  | { t: 'CHAT'; playerId: string; text: string }
  | { t: 'PONG'; playerId: string; seq: number }
  /** A signed-in watcher takes over a bot's seat in a game in progress. */
  | { t: 'TAKE_SEAT'; playerId: string; target: string }
  /** The answer to a CHALLENGE: the host's nonce, signed with the key the
   *  player's pass was issued to. */
  | { t: 'PROOF'; playerId: string; sig: string };

/* ----------------------------- host -> guest ----------------------------- */
export type Down =
  | { t: 'WELCOME'; you: string; snapshot: RoomSnapshot }
  | { t: 'ROOM'; snapshot: RoomSnapshot }
  | { t: 'EVENTS'; rev: number; events: GameEvent[] }
  | { t: 'CF_EVENTS'; rev: number; events: import('../cashflow/types').CFEvent[] }
  | { t: 'MF_EVENTS'; rev: number; events: import('../mafia/types').MafiaEvent[] }
  /** One player's private slice of an Omertà table - their role, their
   *  results. Sent to that connection only, never broadcast. */
  | { t: 'MF_PRIVATE'; private: MafiaPrivate }
  | { t: 'CHAT'; message: ChatMessage }
  | { t: 'REJECT'; reason: string }
  | { t: 'PING'; seq: number }
  /** Prove the pass you just showed is yours: sign this for this room. */
  | { t: 'CHALLENGE'; nonce: string }
  | { t: 'BYE'; reason: ByeReason };

export type ByeReason =
  | 'host_left' | 'kicked' | 'room_full' | 'in_progress' | 'seat_taken'
  /** The same account connected from somewhere else and took the seat with it. */
  | 'elsewhere'
  /** A game in progress takes only signed-in players. */
  | 'sign_in_to_join'
  /** A pass that did not check out: expired, or not ours. */
  | 'auth_invalid';

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

/** The code a given host generation answers on. Players only ever see the
 *  room code itself; the generation moves the peer id when the table is
 *  handed over, so an invite link keeps working. */
export const epochCode = (code: string, epoch: number): string =>
  (epoch > 0 ? `${code}-${epoch}` : code);

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
  if (!snapshot.game && !snapshot.cf && !snapshot.mf) return snapshot;
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
    /* Omertà's future is its night ledger: roles, pending night moves and
     *  detective results. Guests get none of it in the snapshot - each is
     *  pushed only their own slice over MF_PRIVATE. */
    mf: snapshot.mf && {
      ...snapshot.mf,
      settings: { ...snapshot.mf.settings, seed: 0 },
      secret: null,
    },
  };
}

/**
 * The other direction, for a guest taking over a table whose host has gone.
 *
 * What redaction removed cannot be recovered - the shuffled order only ever
 * existed in the host's tab - so the new host deals fresh decks from a new
 * seed. Nobody at the table loses anything by it: that order was never
 * knowledge any of them had. Cards already drawn stay drawn, because they
 * are in the state; the two Royal Pardon cards are the only ones a
 * player can be holding, so a held one is kept out of the new shuffle.
 *
 * Omertà passes through untouched: roles were knowledge the players had,
 * so they cannot be re-dealt, and the new host's copy has no night ledger
 * to run the game with. The store closes such a match out honestly.
 */
export function rehydrateForHost(snapshot: RoomSnapshot, seed: number): RoomSnapshot {
  const held = snapshot.game
    ? Object.values(snapshot.game.players).reduce((n, p) => n + p.getOutOfJailCards, 0)
    : 0;
  const chance = CHANCE.map((c) => c.id).filter((id) => id !== 'ch08' || held < 1);
  const chest = CHEST.map((c) => c.id).filter((id) => id !== 'cc05' || held < 2);
  const deck = (d: keyof typeof DECK_CARDS, at: number): string[] =>
    shuffle(DECK_CARDS[d].map((c) => c.id), seed, at);

  return {
    ...snapshot,
    settings: { ...snapshot.settings, seed },
    game: snapshot.game && {
      ...snapshot.game,
      settings: { ...snapshot.game.settings, seed },
      chanceOrder: shuffle(chance, seed, 1000),
      chestOrder: shuffle(chest, seed, 2000),
      chanceCursor: 0,
      chestCursor: 0,
    },
    cf: snapshot.cf && {
      ...snapshot.cf,
      settings: { ...snapshot.cf.settings, seed },
      decks: { small: deck('small', 4000), big: deck('big', 5000), market: deck('market', 6000), doodad: deck('doodad', 7000) },
      cursors: { small: 0, big: 0, market: 0, doodad: 0 },
    },
  };
}

/** Peer-supplied strings are untrusted: cap them before they reach layout. */
export const cleanText = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
