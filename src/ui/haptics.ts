import type { CFEvent } from '../cashflow/types';
import type { GameEvent } from '../game/types';

/* ------------------------------------------------------------------ *
 * Haptics. A phone in the hand can *feel* the table: your turn arriving,
 * an offer landing, the dice you just threw.
 *
 * One short pattern per event, and only for events that involve the
 * player holding the phone - a buzz for every rent paid between two bots
 * is a reason to switch the whole thing off. iOS Safari has no Vibration
 * API, so every call is a no-op there by construction.
 * ------------------------------------------------------------------ */

export type Buzz = number | number[];

const KEY = 'mply.haptics';

export const readHaptics = (): boolean => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
};

/** A pulse, if the player has them on and the hardware offers them. */
export const buzz = (on: boolean, pattern: Buzz): void => {
  if (!on) return;
  try { navigator.vibrate?.(pattern); } catch { /* no motor, no problem */ }
};

/** What an event feels like in this player's hand, if anything. */
export const buzzFor = (e: GameEvent, myId: string): Buzz | null => {
  switch (e.type) {
    // Your turn arriving is the one worth two taps - it ends a wait.
    case 'TURN_STARTED': return e.playerId === myId ? [35, 80, 35] : null;
    case 'TRADE_PROPOSED': return e.offer.to === myId ? [30, 60] : null;
    case 'RENT_PAID': return e.from === myId || e.to === myId ? 25 : null;
    case 'JAILED': return e.playerId === myId ? [70, 50, 70] : null;
    // Your own throw is a tick, not a rumble.
    case 'DICE_ROLLED': return e.playerId === myId ? 12 : null;
    case 'GAME_OVER': return [90, 90, 180];
    default: return null;
  }
};

/** The same for Nest Egg's events. */
export const cfBuzzFor = (e: CFEvent, myId: string): Buzz | null => {
  const mine = 'playerId' in e && e.playerId === myId;
  switch (e.type) {
    case 'TURN_STARTED': return mine ? [35, 80, 35] : null;
    case 'ROLLED': return mine ? 12 : null;
    case 'BANKRUPT': return mine ? [70, 50, 70] : null;
    case 'GAME_OVER': return [90, 90, 180];
    default: return null;
  }
};
