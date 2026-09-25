import { passiveIncome } from '../cashflow/rules';
import { netWorth } from '../game/rules';
import { tr } from '../i18n';
import type { TableReport } from './directory';
import type { RoomSnapshot } from './protocol';

/* What a table tells the operator's panel about itself (see telemetry.ts,
 * which decides when). A pure read of the room, kept apart from the store
 * so what it sends - and what it never sends, like an Omertà role - is
 * tested on its own. */

export function buildReport(
  id: string, room: RoomSnapshot, role: 'host' | 'local', listed: boolean,
): TableReport {
  const hostIds = new Set(room.seats.filter((s) => s.isHost).map((s) => s.playerId));
  const base = {
    id,
    kind: room.kind,
    mode: role === 'local' ? 'solo' : listed ? 'public' : 'private',
    maxSeats: room.settings.maxPlayers,
    epoch: room.epoch,
    device: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop',
    lang: tr().langName,
  } as const;

  if (room.game) {
    const g = room.game;
    const current = g.players[g.seats[g.seatIndex]];
    return {
      ...base,
      phase: g.phase === 'game_over' ? 'over' : 'playing',
      round: g.round,
      turn: g.phase === 'game_over' ? null : current?.name ?? null,
      winner: g.winnerId ? g.players[g.winnerId]?.name ?? null : null,
      players: g.seats.map((pid) => {
        const p = g.players[pid];
        return {
          id: pid, name: p.name, color: p.color, token: p.token,
          bot: p.isBot, host: hostIds.has(pid), connected: p.isBot || p.connected,
          cash: p.cash, worth: netWorth(g, pid), out: p.bankrupt,
        };
      }),
    };
  }

  if (room.cf) {
    const s = room.cf;
    const current = s.players[s.seats[s.seatIndex]];
    return {
      ...base,
      phase: s.phase === 'game_over' ? 'over' : 'playing',
      round: s.round,
      turn: s.phase === 'game_over' ? null : current?.name ?? null,
      winner: s.winnerId ? s.players[s.winnerId]?.name ?? null : null,
      players: s.seats.map((pid) => {
        const p = s.players[pid];
        return {
          id: pid, name: p.name, color: p.color, token: p.token,
          bot: p.isBot, host: hostIds.has(pid), connected: p.isBot || p.connected,
          // Cashflow's score is passive income against the way out, not a pile.
          cash: p.cash, worth: passiveIncome(p), out: p.out, track: p.track,
        };
      }),
    };
  }

  if (room.mf) {
    // Who is at the table and who is still standing - never a role: the
    // operator sees an Omertà table the way a watcher does.
    const m = room.mf;
    return {
      ...base,
      phase: m.phase === 'game_over' ? 'over' : m.phase === 'lobby' ? 'lobby' : 'playing',
      round: m.round,
      turn: null,
      winner: m.phase === 'game_over' ? m.winner : null,
      players: m.seats.map((pid) => {
        const p = m.players[pid];
        return {
          id: pid, name: p.name, color: p.color, token: p.token,
          bot: p.isBot, host: hostIds.has(pid), connected: p.isBot || p.connected,
          cash: 0, worth: 0, out: !p.alive,
        };
      }),
    };
  }

  return {
    ...base,
    phase: 'lobby',
    round: 0,
    turn: null,
    winner: null,
    players: room.seats.map((s) => ({
      id: s.playerId, name: s.name, color: s.color, token: s.token,
      bot: s.isBot, host: s.isHost, connected: s.isBot || s.connected,
      cash: 0, worth: 0, out: false,
    })),
  };
}

