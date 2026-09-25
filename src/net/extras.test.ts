import { describe, expect, it } from 'vitest';
import type { SeatSpec } from '../game/engine';
import { createGame, reduce as gReduce } from '../game/engine';
import { CLASSIC } from '../game/settings';
import { MAF_DEFAULTS, createMafia, reduce, spendLastWords } from '../mafia/engine';
import type { MafiaState } from '../mafia/types';
import { monopolyTips, mafiaTips } from '../ui/coachTips';
import type { RoomSnapshot, SeatInfo } from './protocol';
import { canReact, isReaction } from './reactions';
import { buildReport } from './tableReport';

const specs = (n: number): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, token: 'camel' as const, color: '#fff', isBot: i > 0 }));

function mafiaRoom(mf: MafiaState): RoomSnapshot {
  const seats = mf.seats.map((id, i) => ({
    playerId: id, name: mf.players[id].name, color: '#fff', token: 'camel', isBot: i > 0, isHost: i === 0, connected: true,
  })) as unknown as SeatInfo[];
  return {
    roomId: 'GOLD-FALCON-42', hostId: 'p0', kind: 'mafia', seats, settings: { ...CLASSIC },
    cfRules: {} as RoomSnapshot['cfRules'], mafRules: {} as RoomSnapshot['mafRules'],
    game: null, cf: null, mf, epoch: 0, rev: 1,
  };
}

const started = (): MafiaState =>
  reduce(createMafia({ ...MAF_DEFAULTS, seed: 5 }, specs(6)), { type: 'START_GAME', playerId: 'p0' }).state;

describe('reactions', () => {
  it('takes only the fixed set', () => {
    expect(isReaction('🔥')).toBe(true);
    expect(isReaction('💩')).toBe(false);
    expect(isReaction('<script>')).toBe(false);
    expect(isReaction(undefined)).toBe(false);
  });

  it('follows the Omertà chat: no faces at night, none from the dead or the silenced', () => {
    let s = started();
    expect(canReact(mafiaRoom(s), 'p0')).toBe(false); // night
    s = { ...s, phase: 'day' };
    expect(canReact(mafiaRoom(s), 'p0')).toBe(true);
    expect(canReact(mafiaRoom({ ...s, silencedToday: ['p0'] }), 'p0')).toBe(false);
    const dead = spendLastWords({ ...s, players: { ...s.players, p0: { ...s.players.p0, alive: false } } }, 'p0');
    expect(canReact(mafiaRoom(dead), 'p0')).toBe(false);
    expect(canReact(mafiaRoom(s), 'nobody')).toBe(false);
  });
});

describe('the Omertà table report', () => {
  it('names who is at the table and who is standing - never a role', () => {
    const s = started();
    const r = buildReport('GOLD-FALCON-42', mafiaRoom(s), 'host', false);
    expect(r.kind).toBe('mafia');
    expect(r.players).toHaveLength(6);
    // The game is called "mafia"; the seats must not say who is.
    const seats = JSON.stringify(r.players);
    for (const role of Object.values(s.secret!.roles)) expect(seats).not.toContain(`"${role}"`);
    expect(r.winner).toBeNull();
  });
});

describe('first-game tips', () => {
  it('asks a new player to roll on their first turn, and to buy when they can', () => {
    let g = createGame({ ...CLASSIC, seed: 7 }, specs(3));
    g = gReduce(g, { type: 'START_GAME', playerId: 'p0' }).state;
    expect(monopolyTips(g, 'p0')).toContain('monoRoll');
    expect(monopolyTips({ ...g, phase: 'awaiting_buy' }, 'p0')[0]).toBe('monoBuy');
    expect(monopolyTips(g, 'nobody')).toEqual([]);
  });

  it('tells the dead how their chat works', () => {
    const s = started();
    const dead = { ...s, players: { ...s.players, p0: { ...s.players.p0, alive: false } } };
    expect(mafiaTips(dead, 'p0', null)).toEqual(['mafDead']);
    expect(mafiaTips({ ...s, phase: 'vote' }, 'p0', null)).toEqual(['mafVote']);
  });
});
