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
 * ------------------------------------------------------------------ */

export const REACTIONS = ['😂', '😱', '🔥', '👏', '😡', '🤝', '💸', '🎉'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const isReaction = (x: unknown): x is Reaction =>
  typeof x === 'string' && (REACTIONS as readonly string[]).includes(x);

/** One reaction per player this often, at most; the host enforces it. */
export const REACT_GAP_MS = 1200;

/** Whether this seat may react right now. */
export function canReact(room: RoomSnapshot | null, seat: string | null): boolean {
  if (!room || !seat || !room.seats.some((s) => s.playerId === seat)) return false;
  const mf = room.mf;
  if (!mf || mf.phase === 'lobby' || mf.phase === 'game_over') return true;
  if (mf.phase === 'night') return false;
  if (!mf.players[seat]?.alive) return false;
  return chatBlock(mf, seat) === null;
}

/** A reaction on screen: who, what, and a key to animate it by. */
export interface ReactionShown {
  id: string;
  from: string;
  emoji: Reaction;
  at: number;
}
