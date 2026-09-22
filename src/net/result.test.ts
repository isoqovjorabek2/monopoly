import { describe, expect, it } from 'vitest';
import { createGame } from '../game/engine';
import { CLASSIC } from '../game/settings';
import type { SeatSpec } from '../game/engine';
import type { RoomSnapshot } from './protocol';
import { buildResult } from './result';

/* ------------------------------------------------------------------ *
 * The line a finished table puts in each player's game history.
 * ------------------------------------------------------------------ */

const seats: SeatSpec[] = [
  { id: 'u_asil', name: 'Asil', token: 'camel', color: '#fff', isBot: false, botLevel: 'normal' },
  { id: 'bot_ada', name: 'Ada', token: 'lamp', color: '#fff', isBot: true, botLevel: 'normal' },
];

function finished(winner: string | null, extra: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const game = createGame({ ...CLASSIC, seed: 7 }, seats);
  game.phase = 'game_over';
  game.winnerId = winner;
  game.round = 12;
  return {
    roomId: 'GOLD-FALCON-42', hostId: 'u_asil', kind: 'monopoly', seats: [],
    settings: { ...CLASSIC, seed: 7 }, cfRules: {} as RoomSnapshot['cfRules'], mafRules: {} as RoomSnapshot['mafRules'], mf: null,
    game, cf: null, epoch: 0, rev: 0, ...extra,
  };
}

describe('a finished table in game history', () => {
  it('reports a win in first place, with everyone at the table', () => {
    const r = buildResult(finished('u_asil'), 'u_asil', 'u_asil');
    expect(r).toMatchObject({ id: 'GOLD-FALCON-42:7:12', kind: 'monopoly', won: true, place: 1, rounds: 12, theme: 'silk' });
    expect(r?.players.filter((p) => p.you)).toHaveLength(1);
    expect(r?.players.map((p) => p.name)).toEqual(['Asil', 'Ada']);
  });

  it('reports a loss below the winner', () => {
    const r = buildResult(finished('bot_ada'), 'u_asil', 'u_asil');
    expect(r).toMatchObject({ won: false, place: 2 });
    expect(r?.players[0].name).toBe('Ada');
  });

  it('counts a bot seat the account took over as its own game', () => {
    const r = buildResult(finished('bot_ada', { owners: { bot_ada: 'u_bruno' } }), 'u_bruno', 'bot_ada');
    expect(r).toMatchObject({ won: true, place: 1 });
    expect(r?.players.find((p) => p.you)?.name).toBe('Ada');
  });

  it('reports nothing for a game still running, or for someone who was not playing', () => {
    const running = finished('u_asil');
    running.game!.phase = 'preroll';
    expect(buildResult(running, 'u_asil', 'u_asil')).toBeNull();
    expect(buildResult(finished('u_asil'), 'u_stranger', 'u_stranger')).toBeNull();
  });
});
