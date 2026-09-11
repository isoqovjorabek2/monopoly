import { describe, expect, it } from 'vitest';
import { createGame, reduce } from './engine';
import { canBuildHouse } from './rules';
import { GROUPS } from './board';
import { CLASSIC } from './settings';
import type { GameState, TradeBody } from './types';

const start = (): GameState => {
  const seats = ['p0', 'p1'].map((id) => ({
    id, name: id, token: 'topper' as const, color: '#fff', isBot: false,
  }));
  const s = reduce(createGame({ ...CLASSIC, seed: 5 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
  s.properties[39].owner = 'p1'; // the victim holds Boardwalk
  return s;
};

describe('forged trades are refused', () => {
  it('a player cannot propose an offer that comes from someone else', () => {
    const s = start();
    const forged: TradeBody = {
      from: 'p1', to: 'p0',
      giveCash: 1500, giveProperties: [39], giveJailCards: 0,
      wantCash: 0, wantProperties: [], wantJailCards: 0,
    };
    const after = reduce(s, { type: 'PROPOSE_TRADE', playerId: 'p0', offer: forged });
    // Rejected outright: no version bump, no trade recorded.
    expect(after.state.version).toBe(s.version);
    expect(after.state.trades).toHaveLength(0);
    expect(after.state.properties[39].owner).toBe('p1');
  });

  it('an honest offer from the proposer still goes through', () => {
    const s = start();
    const honest: TradeBody = {
      from: 'p0', to: 'p1',
      giveCash: 100, giveProperties: [], giveJailCards: 0,
      wantCash: 0, wantProperties: [39], wantJailCards: 0,
    };
    const proposed = reduce(s, { type: 'PROPOSE_TRADE', playerId: 'p0', offer: honest }).state;
    expect(proposed.trades).toHaveLength(1);
    const done = reduce(proposed, { type: 'ACCEPT_TRADE', playerId: 'p1', tradeId: proposed.trades[0].id }).state;
    expect(done.properties[39].owner).toBe('p0');
  });

  it('rejects a non-integer jail-card count', () => {
    const s = start();
    s.players.p0.getOutOfJailCards = 1;
    const offer: TradeBody = {
      from: 'p0', to: 'p1',
      giveCash: 0, giveProperties: [], giveJailCards: 0.5,
      wantCash: 0, wantProperties: [], wantJailCards: 0,
    };
    const after = reduce(s, { type: 'PROPOSE_TRADE', playerId: 'p0', offer });
    expect(after.state.trades).toHaveLength(0);
  });
});

describe('a set is buildable only when no deed in it is mortgaged', () => {
  it('blocks while mortgaged, allows once lifted', () => {
    const s = start();
    for (const id of GROUPS.orange) s.properties[id].owner = 'p0';
    s.properties[GROUPS.orange[0]].mortgaged = true;
    s.players.p0.cash = 5000;
    s.phase = 'turn_end';
    expect(canBuildHouse(s, 'p0', GROUPS.orange[1]).ok).toBe(false);
    const lifted = reduce(s, { type: 'UNMORTGAGE', playerId: 'p0', spaceId: GROUPS.orange[0] }).state;
    expect(canBuildHouse(lifted, 'p0', GROUPS.orange[1]).ok).toBe(true);
  });
});
