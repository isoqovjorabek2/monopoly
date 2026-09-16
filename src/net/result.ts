import { passiveIncome } from '../cashflow/rules';
import { netWorth } from '../game/rules';
import { roomTheme } from './plus';
import type { RoomSnapshot } from './protocol';

/* ------------------------------------------------------------------ *
 * One player's result from a finished table, as their game history keeps
 * it (Party Hall Plus). Pure, so it can be tested without a store: every
 * player's own browser works out its own line from the same final state.
 * ------------------------------------------------------------------ */

export interface ResultRow {
  name: string;
  /** Net worth in Bazaar Barons; passive income in Nest Egg. */
  score: number;
  bot: boolean;
  you: boolean;
}

export interface GameResult {
  /** Stable for one finished game, so a second report of it is ignored. */
  id: string;
  kind: 'monopoly' | 'cashflow';
  won: boolean;
  place: number;
  rounds: number;
  theme: string;
  players: ResultRow[];
}

/**
 * This account's result, or null when the table has not finished or they
 * were not playing at it. `myId` is the seat this tab plays; a bot seat the
 * account took over counts as theirs through `room.owners`.
 */
export function buildResult(room: RoomSnapshot, uid: string, myId: string): GameResult | null {
  const g = room.game;
  const cf = room.cf;
  const state = g ?? cf;
  if (!state || state.phase !== 'game_over') return null;

  const seats: string[] = state.seats;
  const mine = seats.find((pid) => pid === myId || pid === uid || room.owners?.[pid] === uid);
  if (!mine) return null;

  const rows = seats.map((pid) => {
    if (g) {
      const p = g.players[pid];
      return { pid, name: p.name, score: netWorth(g, pid), bot: p.isBot, out: p.bankrupt };
    }
    const p = cf!.players[pid];
    return { pid, name: p.name, score: passiveIncome(p), bot: p.isBot, out: p.out };
  });

  // The winner first, then everyone still in, then by score.
  const winner = state.winnerId ?? null;
  const ranked = [...rows].sort((a, b) =>
    Number(b.pid === winner) - Number(a.pid === winner)
    || Number(a.out) - Number(b.out)
    || b.score - a.score);

  return {
    id: `${room.roomId}:${room.settings.seed}:${state.round}`.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 64),
    kind: room.kind,
    won: winner === mine,
    place: ranked.findIndex((r) => r.pid === mine) + 1,
    rounds: state.round,
    theme: roomTheme(room),
    players: ranked.slice(0, 8).map((r) => ({
      name: r.name, score: Math.round(r.score), bot: r.bot, you: r.pid === mine,
    })),
  };
}
