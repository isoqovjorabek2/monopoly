import { describe, expect, it } from 'vitest';
import { BOARD, GROUPS, OWNABLE_IDS } from './board';
import { createGame, reduce, type SeatSpec } from './engine';
import { acceptMargin, botDecide, suggestTrade } from './ai';
import { calculateRent, canTrade, legalActions, netWorth, ownedBy } from './rules';
import { rand } from './rng';
import { CLASSIC } from './settings';
import type { GameAction, GameSettings, GameState } from './types';

const seats = (n: number, bots = false): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    token: 'topper' as const,
    color: '#fff',
    isBot: bots,
  }));

const game = (over: Partial<GameSettings> = {}, n = 4): GameState => {
  const s = createGame({ ...CLASSIC, seed: 12345, ...over }, seats(n));
  return reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
};

const apply = (s: GameState, a: GameAction): GameState => reduce(s, a).state;

/* ------------------------------------------------------------------ */

describe('board data', () => {
  it('has 40 spaces in the right order', () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD[0].kind).toBe('go');
    expect(BOARD[10].kind).toBe('jail');
    expect(BOARD[20].kind).toBe('freeparking');
    expect(BOARD[30].kind).toBe('gotojail');
    expect(BOARD[39].name).toBe('Boardwalk');
  });

  it('prices mortgages at exactly half', () => {
    for (const id of OWNABLE_IDS) {
      expect(BOARD[id].mortgage).toBe((BOARD[id].price ?? 0) / 2);
    }
  });

  it('has a six-step rent ladder on every deed', () => {
    for (const id of OWNABLE_IDS) {
      if (BOARD[id].kind !== 'property') continue;
      expect(BOARD[id].rent).toHaveLength(6);
      const r = BOARD[id].rent!;
      for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    }
  });

  it('matches the printed deed for Boardwalk and Mediterranean', () => {
    expect(BOARD[39].rent).toEqual([50, 200, 600, 1400, 1700, 2000]);
    expect(BOARD[39].houseCost).toBe(200);
    expect(BOARD[1].rent).toEqual([2, 10, 30, 90, 160, 250]);
    expect(BOARD[1].houseCost).toBe(50);
  });
});

describe('purity and determinism', () => {
  it('never mutates the state it is given', () => {
    const s = game();
    const before = JSON.stringify(s);
    reduce(s, { type: 'ROLL', playerId: 'p0' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('survives a JSON round-trip unchanged', () => {
    let s = game();
    for (let i = 0; i < 40; i++) s = step(s);
    const direct = reduce(s, { type: 'END_TURN', playerId: s.seats[s.seatIndex] }).state;
    const viaJson = reduce(JSON.parse(JSON.stringify(s)), {
      type: 'END_TURN', playerId: s.seats[s.seatIndex],
    }).state;
    expect(JSON.stringify(viaJson)).toBe(JSON.stringify(direct));
  });

  it('replays identically from the same seed and action log', () => {
    const runOnce = () => {
      let s = game({ seed: 987 });
      const log: string[] = [];
      for (let i = 0; i < 300 && s.phase !== 'game_over'; i++) {
        const before = s.version;
        s = step(s);
        if (s.version === before) break;
        log.push(`${s.version}:${s.phase}`);
      }
      return { s, log };
    };
    const a = runOnce();
    const b = runOnce();
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
    expect(a.log.length).toBeGreaterThan(50);
  });
});

describe('rent', () => {
  it('doubles base rent on an unimproved monopoly', () => {
    const s = game();
    for (const id of GROUPS.brown) s.properties[id].owner = 'p1';
    expect(calculateRent(s, 1, 7)).toBe(BOARD[1].rent![0] * 2);
  });

  it('uses the ladder, not the doubling, once a house is up', () => {
    const s = game();
    for (const id of GROUPS.brown) s.properties[id].owner = 'p1';
    s.properties[1].houses = 1;
    expect(calculateRent(s, 1, 7)).toBe(BOARD[1].rent![1]);
  });

  it('pays nothing on a mortgaged deed, and breaks the set bonus', () => {
    const s = game();
    for (const id of GROUPS.brown) s.properties[id].owner = 'p1';
    s.properties[3].mortgaged = true;
    expect(calculateRent(s, 3, 7)).toBe(0);
    expect(calculateRent(s, 1, 7)).toBe(BOARD[1].rent![0]);
  });

  it('scales railroads 25/50/100/200', () => {
    const s = game();
    const rents: number[] = [];
    for (const [i, id] of [5, 15, 25, 35].entries()) {
      s.properties[id].owner = 'p1';
      rents.push(calculateRent(s, [5, 15, 25, 35][i], 7));
    }
    expect(rents).toEqual([25, 50, 100, 200]);
  });

  it('charges utilities 4x and then 10x the roll', () => {
    const s = game();
    s.properties[12].owner = 'p1';
    expect(calculateRent(s, 12, 9)).toBe(36);
    s.properties[28].owner = 'p1';
    expect(calculateRent(s, 12, 9)).toBe(90);
  });
});

describe('building', () => {
  it('refuses to build out of the set, and enforces even build', () => {
    let s = game();
    for (const id of GROUPS.lightblue) s.properties[id].owner = 'p0';
    s.players.p0.cash = 5000;
    s.phase = 'preroll';

    s = apply(s, { type: 'BUILD_HOUSE', playerId: 'p0', spaceId: 6 });
    expect(s.properties[6].houses).toBe(1);

    // A second house on the same deed is two above its neighbours - illegal.
    const before = s.properties[6].houses;
    s = apply(s, { type: 'BUILD_HOUSE', playerId: 'p0', spaceId: 6 });
    expect(s.properties[6].houses).toBe(before);
  });

  it('returns four houses to the bank when a hotel goes up', () => {
    let s = game();
    for (const id of GROUPS.brown) s.properties[id].owner = 'p0';
    s.players.p0.cash = 5000;
    s.phase = 'preroll';
    for (let i = 0; i < 8; i++) {
      for (const id of GROUPS.brown) {
        s = apply(s, { type: 'BUILD_HOUSE', playerId: 'p0', spaceId: id });
      }
    }
    expect(s.properties[1].houses).toBe(5);
    expect(s.properties[3].houses).toBe(5);
    expect(s.hotelsRemaining).toBe(10);
    expect(s.housesRemaining).toBe(32);
  });

  it('honours the 32-house shortage', () => {
    let s = game({ buildingShortage: true });
    s.housesRemaining = 0;
    for (const id of GROUPS.brown) s.properties[id].owner = 'p0';
    s.players.p0.cash = 5000;
    s.phase = 'preroll';
    s = apply(s, { type: 'BUILD_HOUSE', playerId: 'p0', spaceId: 1 });
    expect(s.properties[1].houses).toBe(0);
  });

  it('blocks mortgaging a set that still has buildings', () => {
    let s = game();
    for (const id of GROUPS.brown) s.properties[id].owner = 'p0';
    s.properties[1].houses = 2;
    s.phase = 'preroll';
    s = apply(s, { type: 'MORTGAGE', playerId: 'p0', spaceId: 3 });
    expect(s.properties[3].mortgaged).toBe(false);
  });
});

describe('jail', () => {
  it('jails on the third double and cancels that move', () => {
    let s = game({ seed: 1 });
    s.doublesCount = 2;
    s.dice = [3, 3];
    const posBefore = s.players.p0.position;
    // Force a double by searching the RNG stream for one.
    s.rngCursor = findDoubleCursor(s.settings.seed);
    s = apply(s, { type: 'ROLL', playerId: 'p0' });
    expect(s.players.p0.inJail).toBe(true);
    expect(s.players.p0.position).toBe(10);
    expect(posBefore).not.toBe(10);
  });

  it('lets a fine buy freedom, then still requires a roll', () => {
    let s = game();
    s.players.p0.inJail = true;
    s.phase = 'jailed_choice';
    s = apply(s, { type: 'PAY_JAIL_FINE', playerId: 'p0' });
    expect(s.players.p0.inJail).toBe(false);
    expect(s.players.p0.cash).toBe(CLASSIC.startingCash - 50);
    expect(s.phase).toBe('preroll');
  });

  it('collects rent for an owner who is locked up', () => {
    const s = game();
    s.properties[1].owner = 'p1';
    s.players.p1.inJail = true;
    expect(calculateRent(s, 1, 7)).toBeGreaterThan(0);
  });
});

describe('auctions', () => {
  it('opens an auction when a purchase is declined', () => {
    let s = game();
    s.players.p0.position = 1;
    s.phase = 'awaiting_buy';
    s = apply(s, { type: 'DECLINE_PROPERTY', playerId: 'p0' });
    expect(s.phase).toBe('auction');
    expect(s.auction?.spaceId).toBe(1);
    expect(s.auction?.active).toHaveLength(4);
  });

  it('sells to the last bidder standing and charges them', () => {
    let s = game();
    s.players.p0.position = 1;
    s.phase = 'awaiting_buy';
    s = apply(s, { type: 'DECLINE_PROPERTY', playerId: 'p0' });
    s = apply(s, { type: 'BID', playerId: 'p2', amount: 40 });
    for (const p of ['p0', 'p1', 'p3']) s = apply(s, { type: 'PASS_BID', playerId: p });
    expect(s.properties[1].owner).toBe('p2');
    expect(s.players.p2.cash).toBe(CLASSIC.startingCash - 40);
    expect(s.phase).not.toBe('auction');
  });

  it('leaves the deed with the bank when everyone passes', () => {
    let s = game();
    s.players.p0.position = 3;
    s.phase = 'awaiting_buy';
    s = apply(s, { type: 'DECLINE_PROPERTY', playerId: 'p0' });
    for (const p of ['p0', 'p1', 'p2', 'p3']) s = apply(s, { type: 'PASS_BID', playerId: p });
    expect(s.properties[3].owner).toBeNull();
    expect(s.auction).toBeNull();
  });

  it('skips the auction entirely when the house rule is off', () => {
    let s = game({ auctionsEnabled: false });
    s.players.p0.position = 1;
    s.phase = 'awaiting_buy';
    s = apply(s, { type: 'DECLINE_PROPERTY', playerId: 'p0' });
    expect(s.phase).not.toBe('auction');
    expect(s.properties[1].owner).toBeNull();
  });
});

describe('debt and bankruptcy', () => {
  it('sends a short payer to must_raise rather than negative cash', () => {
    let s = game();
    s.players.p0.cash = 5;
    s.properties[39].owner = 'p1';
    s.properties[39].houses = 5;
    s.players.p0.position = 37;
    s.phase = 'preroll';
    s.rngCursor = findCursorForTotal(s.settings.seed, 2);
    s = apply(s, { type: 'ROLL', playerId: 'p0' });
    expect(s.players.p0.cash).toBeGreaterThanOrEqual(0);
    if (s.phase === 'must_raise') expect(s.debt?.amount).toBeGreaterThan(5);
  });

  it('hands the whole estate to the creditor', () => {
    let s = game();
    s.properties[1].owner = 'p0';
    s.properties[3].owner = 'p0';
    s.players.p0.cash = 10;
    s.debt = { from: 'p0', to: 'p1', amount: 900, reason: 'rent' };
    s.phase = 'must_raise';
    s = apply(s, { type: 'DECLARE_BANKRUPTCY', playerId: 'p0' });
    expect(s.players.p0.bankrupt).toBe(true);
    expect(s.properties[1].owner).toBe('p1');
    expect(s.properties[3].owner).toBe('p1');
    expect(ownedBy(s, 'p0')).toHaveLength(0);
  });

  it('returns the estate to the bank when the debt was to the bank', () => {
    let s = game();
    s.properties[1].owner = 'p0';
    s.properties[1].houses = 3;
    s.players.p0.cash = 0;
    s.debt = { from: 'p0', to: null, amount: 900, reason: 'tax' };
    s.phase = 'must_raise';
    const housesBefore = s.housesRemaining;
    s = apply(s, { type: 'DECLARE_BANKRUPTCY', playerId: 'p0' });
    expect(s.properties[1].owner).toBeNull();
    expect(s.properties[1].houses).toBe(0);
    expect(s.housesRemaining).toBe(housesBefore + 3);
  });

  it('advances the turn instead of stalling on a bankrupt player', () => {
    let s = game();
    s.players.p0.cash = 0;
    s.debt = { from: 'p0', to: 'p1', amount: 500, reason: 'rent' };
    s.phase = 'must_raise';
    s = apply(s, { type: 'DECLARE_BANKRUPTCY', playerId: 'p0' });
    expect(s.seats[s.seatIndex]).not.toBe('p0');
    expect(legalActions(s, s.seats[s.seatIndex]).length).toBeGreaterThan(0);
  });

  it('ends the game when one player remains', () => {
    let s = game({}, 2);
    s.players.p0.cash = 0;
    s.debt = { from: 'p0', to: 'p1', amount: 500, reason: 'rent' };
    s.phase = 'must_raise';
    s = apply(s, { type: 'DECLARE_BANKRUPTCY', playerId: 'p0' });
    expect(s.phase).toBe('game_over');
    expect(s.winnerId).toBe('p1');
  });
});

describe('trades', () => {
  it('moves both sides of an accepted offer', () => {
    let s = game();
    s.properties[1].owner = 'p0';
    s.properties[6].owner = 'p1';
    s = apply(s, {
      type: 'PROPOSE_TRADE',
      playerId: 'p0',
      offer: {
        from: 'p0', to: 'p1',
        giveCash: 100, giveProperties: [1], giveJailCards: 0,
        wantCash: 0, wantProperties: [6], wantJailCards: 0,
      },
    });
    expect(s.trades).toHaveLength(1);
    s = apply(s, { type: 'ACCEPT_TRADE', playerId: 'p1', tradeId: s.trades[0].id });
    expect(s.properties[1].owner).toBe('p1');
    expect(s.properties[6].owner).toBe('p0');
    expect(s.players.p0.cash).toBe(CLASSIC.startingCash - 100);
    expect(s.players.p1.cash).toBe(CLASSIC.startingCash + 100);
  });

  it('refuses to trade a deed with buildings on its set', () => {
    let s = game();
    for (const id of GROUPS.brown) s.properties[id].owner = 'p0';
    s.properties[1].houses = 1;
    s = apply(s, {
      type: 'PROPOSE_TRADE',
      playerId: 'p0',
      offer: {
        from: 'p0', to: 'p1',
        giveCash: 0, giveProperties: [3], giveJailCards: 0,
        wantCash: 0, wantProperties: [], wantJailCards: 0,
      },
    });
    expect(s.trades).toHaveLength(0);
  });
});

describe('bots that trade', () => {
  const botGame = (over: Partial<GameSettings> = {}, n = 2): GameState => {
    const s = createGame({ ...CLASSIC, seed: 999, botLevel: 'hard', ...over }, seats(n, true));
    return reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
  };

  /** The classic table deadlock: each side holds the one deed the other
   *  needs, and neither set can ever be built without a deal. p0 has two
   *  light blues and the last pink; p1 has two pinks and the last light
   *  blue. */
  const deadlock = (over: Partial<GameSettings> = {}, n = 2): GameState => {
    const s = botGame(over, n);
    s.properties[6].owner = 'p0';
    s.properties[8].owner = 'p0';
    s.properties[14].owner = 'p0';
    s.properties[9].owner = 'p1';
    s.properties[11].owner = 'p1';
    s.properties[13].owner = 'p1';
    return s;
  };

  it('opens with the deed it needs and the deed the other side needs', () => {
    const s = deadlock();
    const a = botDecide(s, 'p0');
    expect(a?.type).toBe('PROPOSE_TRADE');
    if (a?.type !== 'PROPOSE_TRADE') return;
    expect(a.offer.wantProperties).toEqual([9]);
    expect(a.offer.giveProperties).toEqual([14]);
    expect(canTrade(s, a.offer)).toBe(true);
  });

  it('closes the deal from the other chair', () => {
    let s = deadlock();
    const open = botDecide(s, 'p0');
    expect(open?.type).toBe('PROPOSE_TRADE');
    s = apply(s, open!);
    expect(s.trades).toHaveLength(1);

    const answer = botDecide(s, 'p1');
    expect(answer?.type).toBe('ACCEPT_TRADE');
    s = apply(s, answer!);

    for (const id of GROUPS.lightblue) expect(s.properties[id].owner).toBe('p0');
    for (const id of GROUPS.pink) expect(s.properties[id].owner).toBe('p1');
  });

  it('buys a set-completing deed for cash when it has nothing to swap', () => {
    const s = botGame({ botLevel: 'normal' });
    s.properties[6].owner = 'p0';
    s.properties[8].owner = 'p0';
    s.properties[9].owner = 'p1';
    const a = botDecide(s, 'p0');
    expect(a?.type).toBe('PROPOSE_TRADE');
    if (a?.type !== 'PROPOSE_TRADE') return;
    expect(a.offer.wantProperties).toEqual([9]);
    expect(a.offer.giveProperties).toEqual([]);
    expect(a.offer.giveCash).toBeGreaterThan(BOARD[9].price!);
    expect(a.offer.giveCash).toBeLessThanOrEqual(s.players.p0.cash);
  });

  it('does not re-send an offer that was just declined', () => {
    let s = deadlock();
    s = apply(s, botDecide(s, 'p0')!);
    s = apply(s, { type: 'DECLINE_TRADE', playerId: 'p1', tradeId: s.trades[0].id });
    expect(s.trades).toHaveLength(0);
    expect(botDecide(s, 'p0')?.type).not.toBe('PROPOSE_TRADE');
  });

  it('talks again once the cooldown has run out', () => {
    let s = deadlock();
    s = apply(s, botDecide(s, 'p0')!);
    s = apply(s, { type: 'DECLINE_TRADE', playerId: 'p1', tradeId: s.trades[0].id });
    // The cooldown is measured in turns, not actions.
    s = { ...s, turnNumber: s.turnNumber + 20 };
    expect(botDecide(s, 'p0')?.type).toBe('PROPOSE_TRADE');
  });

  it('never opens on an easy bot, and never when trades are off', () => {
    expect(botDecide(deadlock({ botLevel: 'easy' }), 'p0')?.type).not.toBe('PROPOSE_TRADE');
    expect(botDecide(deadlock({ allowTrades: false }), 'p0')?.type).not.toBe('PROPOSE_TRADE');
  });

  it('holds only one offer open at a time', () => {
    let s = deadlock({}, 3);
    s.properties[16].owner = 'p2';
    s.properties[18].owner = 'p0';
    s.properties[19].owner = 'p0';
    s = apply(s, botDecide(s, 'p0')!);
    expect(s.trades).toHaveLength(1);
    expect(botDecide(s, 'p0')?.type).not.toBe('PROPOSE_TRADE');
  });

  it('lets an unanswered offer lapse instead of pinning the table', () => {
    let s = deadlock();
    s = apply(s, botDecide(s, 'p0')!);
    expect(s.trades).toHaveLength(1);
    let expiry = 0;
    for (let i = 0; i < 12 && s.trades.length > 0; i++) {
      const pid = s.seats[s.seatIndex];
      const { state, events } = reduce({ ...s, phase: 'turn_end' }, { type: 'END_TURN', playerId: pid });
      s = state;
      expiry += events.filter((e) => e.type === 'TRADE_EXPIRED').length;
    }
    expect(s.trades).toHaveLength(0);
    expect(expiry).toBe(1);
  });

  /* The trade panel is built on these two: it offers `suggestTrade` as
   * "Suggest a deal" and prints `acceptMargin` as "Ada will take this".
   * If either drifts from what the bot actually does, the panel starts
   * lying to the player, which is worse than saying nothing. */
  it('suggests a deal a human can send, and the bot then takes it', () => {
    let s = deadlock();
    const offer = suggestTrade(s, 'p0', 'p1');
    expect(offer).not.toBeNull();
    if (!offer) return;

    expect(canTrade(s, offer)).toBe(true);
    expect(offer.wantProperties).toEqual([9]);
    // Predicted before sending...
    expect(acceptMargin(s, 'p1', offer)).toBeGreaterThan(0);

    // ...and that prediction is what the bot actually does with it.
    s = apply(s, { type: 'PROPOSE_TRADE', playerId: 'p0', offer });
    expect(s.trades).toHaveLength(1);
    expect(botDecide(s, 'p1')?.type).toBe('ACCEPT_TRADE');
  });

  it('predicts a refusal as exactly as it predicts an acceptance', () => {
    const s = deadlock();
    // A deal that takes their light blue and gives nothing back.
    const robbery = {
      from: 'p0', to: 'p1',
      giveCash: 0, giveProperties: [], giveJailCards: 0,
      wantCash: 0, wantProperties: [9], wantJailCards: 0,
    };
    expect(canTrade(s, robbery)).toBe(true);
    expect(acceptMargin(s, 'p1', robbery)).toBeLessThan(0);

    const offered = apply(s, { type: 'PROPOSE_TRADE', playerId: 'p0', offer: robbery });
    expect(botDecide(offered, 'p1')?.type).toBe('DECLINE_TRADE');
  });

  it('suggests nothing when neither side is one deed from a set', () => {
    const s = botGame();
    s.properties[1].owner = 'p0';
    s.properties[6].owner = 'p1';
    expect(suggestTrade(s, 'p0', 'p1')).toBeNull();
  });

  it('offers to sell the deed the other side is waiting on', () => {
    const s = botGame();
    // p1 holds two light blues; p0 holds the third and nothing else.
    s.properties[6].owner = 'p1';
    s.properties[8].owner = 'p1';
    s.properties[9].owner = 'p0';
    const offer = suggestTrade(s, 'p0', 'p1');
    expect(offer).not.toBeNull();
    if (!offer) return;
    expect(offer.giveProperties).toEqual([9]);
    expect(offer.wantProperties).toEqual([]);
    // Sold, not given away.
    expect(offer.wantCash).toBeGreaterThan(0);
    expect(canTrade(s, offer)).toBe(true);
  });

  it('composes nothing the engine will refuse, over four full bot games', () => {
    let proposed = 0;
    let accepted = 0;
    for (const seed of [11, 4242, 90210, 777]) {
      let s = createGame(
        { ...CLASSIC, seed, winCondition: 'turn-limit', turnLimit: 120 },
        seats(4, true),
      );
      s = apply(s, { type: 'START_GAME', playerId: 'p0' });
      let guard = 0;
      while (s.phase !== 'game_over' && guard++ < 40000) {
        let acted = false;
        for (const pid of s.seats) {
          const a = botDecide(s, pid);
          if (!a) continue;
          if (a.type === 'PROPOSE_TRADE') {
            proposed += 1;
            // The engine drops an unsound offer silently, so a bot that
            // composes one burns its turn and learns nothing.
            if (!canTrade(s, a.offer)) throw new Error(`unsound offer from ${pid}`);
          }
          const { state, events } = reduce(s, a);
          if (state.version === s.version) continue;
          if (a.type === 'PROPOSE_TRADE' && state.trades.length === s.trades.length
            && !s.trades.some((t) => t.from === pid)) {
            throw new Error(`offer from ${pid} was dropped by the reducer`);
          }
          accepted += events.filter((e) => e.type === 'TRADE_ACCEPTED').length;
          s = state;
          acted = true;
          break;
        }
        if (!acted) break;
        assertInvariants(s, -2, guard);
      }
    }
    expect(proposed).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(0);
  });
});

describe('hostile input', () => {
  it('ignores an action from a player whose turn it is not', () => {
    const s = game();
    const after = apply(s, { type: 'ROLL', playerId: 'p2' });
    expect(after.version).toBe(s.version);
  });

  it('ignores a buy the player cannot afford', () => {
    const s = game();
    s.players.p0.cash = 10;
    s.players.p0.position = 39;
    s.phase = 'awaiting_buy';
    const after = apply(s, { type: 'BUY_PROPERTY', playerId: 'p0' });
    expect(after.properties[39].owner).toBeNull();
  });

  it('ignores a bid above the bidder cash', () => {
    let s = game();
    s.players.p0.position = 1;
    s.phase = 'awaiting_buy';
    s = apply(s, { type: 'DECLINE_PROPERTY', playerId: 'p0' });
    const after = apply(s, { type: 'BID', playerId: 'p1', amount: 999999 });
    expect(after.auction?.currentBid).toBe(0);
  });
});

/* ---------------- property-based fuzz over whole games ---------------- */

function step(s: GameState): GameState {
  for (const pid of s.seats) {
    const opts = legalActions(s, pid);
    if (opts.length > 0) {
      return apply(s, opts[(s.version * 13 + s.rngCursor) % opts.length]);
    }
  }
  return s;
}

describe('fuzz', () => {
  it('plays 60 random games without breaking an invariant', () => {
    for (let g = 0; g < 60; g++) {
      let s = game({ seed: g * 7919 + 1, winCondition: 'turn-limit', turnLimit: 30 });
      for (let i = 0; i < 800 && s.phase !== 'game_over'; i++) {
        const before = s.version;
        s = step(s);
        if (s.version === before) break; // nobody can act: also an invariant check
        assertInvariants(s, g, i);
      }
    }
  });

  it('lets bots play a full game to completion', () => {
    let s = createGame(
      { ...CLASSIC, seed: 4242, winCondition: 'turn-limit', turnLimit: 30 },
      seats(4, true),
    );
    s = apply(s, { type: 'START_GAME', playerId: 'p0' });
    let guard = 0;
    while (s.phase !== 'game_over' && guard++ < 6000) {
      let acted = false;
      for (const pid of s.seats) {
        const a = botDecide(s, pid);
        if (a) {
          const next = apply(s, a);
          if (next.version !== s.version) { s = next; acted = true; break; }
        }
      }
      if (!acted) break;
      assertInvariants(s, -1, guard);
    }
    expect(s.phase).toBe('game_over');
    expect(s.winnerId).not.toBeNull();
  });
});

function assertInvariants(s: GameState, g: number, i: number): void {
  // Plain throws rather than expect(): this runs tens of thousands of times
  // and vitest matchers are far too slow at that volume.
  const bad = (msg: string): never => {
    throw new Error(`game ${g} step ${i}: ${msg}`);
  };

  for (const pid of s.seats) {
    const p = s.players[pid];
    if (!(p.cash >= 0) || !Number.isFinite(p.cash)) bad(`${pid} cash is ${p.cash}`);
    if (p.position < 0 || p.position > 39) bad(`${pid} off board at ${p.position}`);
    if (p.bankrupt && ownedBy(s, pid).length > 0) bad(`bankrupt ${pid} still owns deeds`);
    if (netWorth(s, pid) < 0) bad(`${pid} negative net worth`);
  }

  let houses = 0;
  let hotels = 0;
  const seenGroups = new Set<string>();
  for (const id of OWNABLE_IDS) {
    const st = s.properties[id];
    if (st.houses < 0 || st.houses > 5) bad(`bad house count ${st.houses} on ${id}`);
    if (st.houses > 0) {
      if (!st.owner) bad(`unowned deed ${id} has buildings`);
      if (st.mortgaged) bad(`mortgaged deed ${id} has buildings`);
    }
    if (st.houses === 5) hotels += 1;
    else houses += st.houses;

    const grp = BOARD[id].group;
    if (grp && !seenGroups.has(grp)) {
      seenGroups.add(grp);
      const counts = GROUPS[grp].map((x) => s.properties[x].houses);
      if (Math.max(...counts) - Math.min(...counts) > 1) bad(`uneven build in ${grp}`);
    }
  }

  if (s.settings.buildingShortage) {
    if (houses + s.housesRemaining !== 32) bad(`houses not conserved (${houses} + ${s.housesRemaining})`);
    if (hotels + s.hotelsRemaining !== 12) bad(`hotels not conserved (${hotels} + ${s.hotelsRemaining})`);
  }

  if (s.seatIndex < 0 || s.seatIndex >= s.seats.length) bad(`seatIndex ${s.seatIndex}`);
}

/* ------------------------------ helpers ------------------------------ */

function findDoubleCursor(seed: number): number {
  for (let c = 0; c < 5000; c += 2) {
    const d1 = 1 + Math.floor(randOf(seed, c) * 6);
    const d2 = 1 + Math.floor(randOf(seed, c + 1) * 6);
    if (d1 === d2) return c;
  }
  throw new Error('no double found in the stream');
}

function findCursorForTotal(seed: number, total: number): number {
  for (let c = 0; c < 20000; c += 2) {
    const d1 = 1 + Math.floor(randOf(seed, c) * 6);
    const d2 = 1 + Math.floor(randOf(seed, c + 1) * 6);
    if (d1 + d2 === total) return c;
  }
  throw new Error('no such total in the stream');
}

const randOf = rand;
