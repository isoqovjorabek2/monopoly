import { describe, expect, it } from 'vitest';
import { BOARD, GROUPS, OWNABLE_IDS } from './board';
import { createGame, reduce, type SeatSpec } from './engine';
import { botDecide } from './ai';
import { calculateRent, legalActions, netWorth, ownedBy } from './rules';
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
