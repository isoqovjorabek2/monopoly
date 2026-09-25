import { describe, expect, it } from 'vitest';
import { botDecide } from './ai';
import { botifySeat, createGame, reduce, type SeatSpec } from './engine';
import { END_VOTE_FROM_ROUND, legalActions, netWorth } from './rules';
import { CLASSIC } from './settings';
import type { GameAction, GameState } from './types';

const seats = (n: number, bots: number[] = []): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'camel' as const, color: '#fff', isBot: bots.includes(i),
  }));

/** A game under way, far enough in to be called, with p1 the richest. */
function midGame(bots: number[] = []): GameState {
  let s = createGame({ ...CLASSIC, seed: 4242 }, seats(4, bots));
  s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
  const c = JSON.parse(JSON.stringify(s)) as GameState;
  c.round = END_VOTE_FROM_ROUND;
  c.players.p1.cash = 9000;
  return c;
}

const vote = (s: GameState, id: string, on = true): GameState =>
  reduce(s, { type: 'VOTE_END', playerId: id, on }).state;

describe('calling the game', () => {
  it('ends only when every human still playing agrees, and the richest wins', () => {
    let s = midGame();
    s = vote(s, 'p0');
    s = vote(s, 'p1');
    s = vote(s, 'p2');
    expect(s.phase).not.toBe('game_over');
    const r = reduce(s, { type: 'VOTE_END', playerId: 'p3', on: true });
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winnerId).toBe('p1');
    expect(r.events).toContainEqual({ type: 'GAME_OVER', winnerId: 'p1', called: true });
  });

  it('is not open before the round it opens in', () => {
    const early = { ...midGame(), round: END_VOTE_FROM_ROUND - 1 };
    expect(vote(early, 'p0')).toBe(early);
  });

  it('lets a vote be taken back, and refuses one cast twice', () => {
    let s = midGame();
    s = vote(s, 'p0');
    expect(vote(s, 'p0')).toBe(s);
    s = vote(s, 'p0', false);
    expect(s.endVotes).toEqual([]);
    for (const id of ['p1', 'p2', 'p3']) s = vote(s, id);
    expect(s.phase).not.toBe('game_over');
  });

  it('never counts, or offers, a bot', () => {
    let s = midGame([2, 3]);
    expect(vote(s, 'p2')).toBe(s);
    // Bots pick from legalActions: the vote must never be in it.
    for (const id of s.seats) expect(legalActions(s, id).some((a) => a.type === 'VOTE_END')).toBe(false);
    s = vote(s, 'p0');
    s = vote(s, 'p1');
    expect(s.phase).toBe('game_over');
  });

  it('does not let the bankrupt vote, or hold the table up', () => {
    let s = midGame();
    s = JSON.parse(JSON.stringify(s)) as GameState;
    s.players.p3.bankrupt = true;
    expect(vote(s, 'p3')).toBe(s);
    for (const id of ['p0', 'p1', 'p2']) s = vote(s, id);
    expect(s.phase).toBe('game_over');
  });

  it('ends it when the last holdout leaves the table', () => {
    let s = midGame();
    for (const id of ['p0', 'p1', 'p2']) s = vote(s, id);
    const r = botifySeat(s, 'p3');
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winnerId).toBe('p1');
  });

  it('leaves no trace in a bot-only game', () => {
    // Four bots play on to the end as before: nothing in the vote moves them.
    let s = createGame({ ...CLASSIC, seed: 99, winCondition: 'turn-limit', turnLimit: 12 }, seats(4, [0, 1, 2, 3]));
    s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    for (let i = 0; i < 20000 && s.phase !== 'game_over'; i++) {
      const a = s.seats.map((id) => botDecide(s, id)).find(Boolean) as GameAction | undefined;
      s = reduce(s, a ?? { type: 'TIME_OUT', playerId: s.seats[s.seatIndex] }).state;
    }
    expect(s.phase).toBe('game_over');
    expect(s.endVotes ?? []).toEqual([]);
    expect(netWorth(s, s.winnerId!)).toBeGreaterThan(0);
  });
});
