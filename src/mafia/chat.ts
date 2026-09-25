import { isFamily } from './rules';
import type { MafiaState } from './types';

/* ------------------------------------------------------------------ *
 * Who may say what, to whom, at an Omertà table. The host routes every
 * message through here; the UI asks the same question to explain a
 * closed chat box. One definition, so they cannot disagree.
 *
 *   night  - only the family talks, and only the family hears.
 *   day    - everyone alive, except the silenced.
 *   vote   - everyone alive.
 *   dead   - one last word, heard by all; after it, the dead talk among
 *            themselves, heard by the dead alone (not even watchers, who
 *            could carry it back to the living).
 *   @name  - by day or vote, a whisper heard by two.
 * ------------------------------------------------------------------ */

export type ChatBlock = 'night' | 'silenced';

/** Why this seat cannot speak right now, or null when it can. Watchers,
 *  who hold no seat, keep quiet only at night. */
export function chatBlock(s: MafiaState, seat: string | null): ChatBlock | null {
  if (s.phase === 'lobby' || s.phase === 'game_over') return null;
  const p = seat ? s.players[seat] : undefined;
  if (!p) return s.phase === 'night' ? 'night' : null;
  if (!p.alive) return null;
  if (s.phase === 'night' && !(s.secret && isFamily(s.secret.roles[seat!]))) return 'night';
  if (s.phase === 'day' && s.silencedToday.includes(seat!)) return 'silenced';
  return null;
}

export interface MafChatRoute {
  channel: 'family' | 'last' | 'whisper' | 'dead' | null;
  text: string;
  /** Seat ids that hear it, or null for everyone at the table. */
  to: string[] | null;
  whisperTo?: { id: string; name: string };
  /** This was the dead player's one last word. */
  lastWords: boolean;
}

/**
 * Route one message. Host-side only: it reads the family from the night
 * ledger, which a guest copy does not have. Null means it is not said.
 */
export function routeMafChat(s: MafiaState, seat: string | null, text: string): MafChatRoute | null {
  if (s.phase === 'lobby' || s.phase === 'game_over') return { channel: null, text, to: null, lastWords: false };
  if (chatBlock(s, seat)) return null;
  const p = seat ? s.players[seat] : undefined;

  if (p && !p.alive) {
    if (!s.lastWords.includes(seat!)) return { channel: 'last', text, to: null, lastWords: true };
    return { channel: 'dead', text, to: s.seats.filter((id) => !s.players[id]?.alive), lastWords: false };
  }

  if (s.phase === 'night') {
    const sec = s.secret;
    if (!sec) return null;
    return { channel: 'family', text, to: s.seats.filter((id) => isFamily(sec.roles[id])), lastWords: false };
  }

  // "@Name the rest" whispers to one living player, by day or vote.
  const m = /^@(\S+)\s+([\s\S]+)$/.exec(text);
  if (m && p) {
    const wanted = m[1].toLowerCase();
    const target = s.seats.find((id) => id !== seat && s.players[id].alive
      && s.players[id].name.replace(/\s+/g, '').toLowerCase() === wanted);
    if (target) {
      return {
        channel: 'whisper',
        text: m[2].trim(),
        to: [seat!, target],
        whisperTo: { id: target, name: s.players[target].name },
        lastWords: false,
      };
    }
  }
  return { channel: null, text, to: null, lastWords: false };
}

/** The handle a whisper uses for a player: their name without spaces. */
export const whisperHandle = (name: string): string => name.replace(/\s+/g, '');
