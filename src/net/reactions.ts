import { chatBlock } from '../mafia/chat';
import type { RoomSnapshot } from './protocol';

/* ------------------------------------------------------------------ *
 * Reactions: one tap, an emoji floats up over the table with your name.
 * Something to do while it is someone else's turn, that costs nobody a
 * second of theirs. Never part of the game state: the host checks each
 * one and passes it on, and nobody keeps them.
 *
 * A fixed set, not free text - nothing to moderate, nothing to spell
 * out in emoji. At an Omertà table a reaction is a way of speaking, so
 * it follows the chat's rules: nobody reacts at night, and the dead and
 * the silenced keep their faces still.
 *
 * A second set belongs to Party Hall Plus: eight showpieces that take the
 * whole table for a moment (ui/PlusFx.tsx) instead of floating up it. The
 * host only passes one on from a seat whose pass it verified, the same
 * way it decides everything else about Plus.
 * ------------------------------------------------------------------ */

export const REACTIONS = ['😂', '😱', '🔥', '👏', '😡', '🤝', '💸', '🎉'] as const;
export const PLUS_REACTIONS = ['👑', '💎', '🚀', '🏆', '⚡', '🎆', '🌹', '🥂'] as const;
export type PlusReaction = (typeof PLUS_REACTIONS)[number];
export type Reaction = (typeof REACTIONS)[number] | PlusReaction;

export const isPlusReaction = (x: unknown): x is PlusReaction =>
  typeof x === 'string' && (PLUS_REACTIONS as readonly string[]).includes(x);

export const isReaction = (x: unknown): x is Reaction =>
  typeof x === 'string' && ((REACTIONS as readonly string[]).includes(x) || isPlusReaction(x));

/** One reaction per player this often, at most; the host enforces it. */
export const REACT_GAP_MS = 1200;
/** A showpiece covers the table, so one player gets one this often. */
export const PLUS_REACT_GAP_MS = 4000;

/** How long a reaction stays on screen; a showpiece plays for longer. */
export const reactionTtl = (emoji: Reaction): number => (isPlusReaction(emoji) ? 3600 : 2600);

/** Whether this seat is a person holding Plus. Bots never do. */
export const seatHasPlus = (room: RoomSnapshot | null, seat: string | null): boolean =>
  Boolean(room?.seats.some((s) => s.playerId === seat && s.plus && !s.isBot));

/** Whether this seat may react right now. */
export function canReact(room: RoomSnapshot | null, seat: string | null): boolean {
  if (!room || !seat || !room.seats.some((s) => s.playerId === seat)) return false;
  const mf = room.mf;
  if (!mf || mf.phase === 'lobby' || mf.phase === 'game_over') return true;
  if (mf.phase === 'night') return false;
  if (!mf.players[seat]?.alive) return false;
  return chatBlock(mf, seat) === null;
}

/** Whether this seat may send this one: a showpiece takes a Plus seat. */
export const canReactWith = (room: RoomSnapshot | null, seat: string | null, emoji: Reaction): boolean =>
  canReact(room, seat) && (!isPlusReaction(emoji) || seatHasPlus(room, seat));

/** A reaction on screen: who, what, and a key to animate it by. */
export interface ReactionShown {
  id: string;
  from: string;
  emoji: Reaction;
  at: number;
}
