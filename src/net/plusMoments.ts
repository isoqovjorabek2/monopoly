import type { CFEvent } from '../cashflow/types';
import type { GameEvent } from '../game/types';
import type { MafiaEvent } from '../mafia/types';
import type { RoomSnapshot } from './protocol';

/* ------------------------------------------------------------------ *
 * Plus moments: the points in a game where a Party Hall Plus player gets
 * a flourish of their own (ui/PlusFx.tsx) - their turn coming round, a
 * purchase, rent coming in, a deal closing, the way out of the Grind, a
 * night survived.
 *
 * Read off the events every tab already receives, so nothing new crosses
 * the wire and nothing is added to any game's state. Which seats hold
 * Plus is the host's word (SeatInfo.plus), as everywhere else.
 * ------------------------------------------------------------------ */

export type PlusMomentKind =
  /** Their turn begins. */
  | 'turn'
  /** Money well spent, or coming in. */
  | 'coins'
  /** Nest Egg: out of the Grind, onto the Free Lane. */
  | 'escape'
  /** Omertà: the doctor pulled them through the night. */
  | 'saved';

export interface PlusMoment { kind: PlusMomentKind; playerId: string }

/** A moment on screen, with a key to animate it by. */
export interface PlusMomentShown extends PlusMoment { id: string }

/** How long each stays up. */
export const MOMENT_MS: Record<PlusMomentKind, number> = { turn: 2400, coins: 1800, escape: 2800, saved: 2800 };

type AnyEvent = GameEvent | CFEvent | MafiaEvent;

function candidates(e: AnyEvent): PlusMoment[] {
  switch (e.type) {
    case 'TURN_STARTED': return [{ kind: 'turn', playerId: e.playerId }];
    case 'BOUGHT':
    case 'AUCTION_WON':
    case 'BOUGHT_HOLDING':
    case 'DEAL_PASSED':
    case 'BUSINESS':
    case 'DREAM_BOUGHT': return [{ kind: 'coins', playerId: e.playerId }];
    case 'RENT_PAID': return [{ kind: 'coins', playerId: e.to }];
    case 'TRADE_ACCEPTED': return [{ kind: 'coins', playerId: e.offer.from }, { kind: 'coins', playerId: e.offer.to }];
    case 'ESCAPED': return [{ kind: 'escape', playerId: e.playerId }];
    case 'DAWN': return e.saved.map((playerId) => ({ kind: 'saved' as const, playerId }));
    default: return [];
  }
}

/** The moments in one batch of events that belong to a Plus player at this
 *  table. Each player gets a given flourish once per batch. */
export function plusMoments(room: RoomSnapshot | null | undefined, events: readonly AnyEvent[]): PlusMoment[] {
  if (!room || events.length === 0) return [];
  const plus = new Set(room.seats.filter((s) => s.plus && !s.isBot).map((s) => s.playerId));
  if (plus.size === 0) return [];
  const seen = new Set<string>();
  const out: PlusMoment[] = [];
  for (const e of events) {
    for (const m of candidates(e)) {
      const key = `${m.kind}:${m.playerId}`;
      if (!plus.has(m.playerId) || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}
