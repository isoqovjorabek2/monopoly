import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, OWNABLE_IDS } from './board';
import { acceptMargin, botDecide, loanRequest, tradeGain } from './ai';
import { loanDebt } from './deals';
import { createGame, reduce, type SeatSpec } from './engine';
import { rand } from './rng';
import { canTrade, legalActions, netWorth, ownedBy } from './rules';
import { CLASSIC } from './settings';
import type { DealTerm, GameAction, GameSettings, GameState, TradeBody } from './types';

/* ------------------------------------------------------------------ *
 * Deal Maker: rent passes, revenue shares and loans.
 * ------------------------------------------------------------------ */

const seats = (n: number, bots = false): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'topper' as const, color: '#fff', isBot: bots,
  }));

const DEALS: Partial<GameSettings> = { dealsEnabled: true };

const game = (over: Partial<GameSettings> = {}, n = 3): GameState => {
  const s = createGame({ ...CLASSIC, ...DEALS, seed: 4321, ...over }, seats(n));
  return reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
};

const apply = (s: GameState, a: GameAction): GameState => {
  const r = reduce(s, a);
  return r.state;
};

const offer = (from: string, to: string, extra: Partial<TradeBody> = {}): TradeBody => ({
  from, to,
  giveCash: 0, giveProperties: [], giveJailCards: 0,
  wantCash: 0, wantProperties: [], wantJailCards: 0,
  ...extra,
});

/** Propose and accept in one go; fails the test if either step is refused. */
function sign(s: GameState, o: TradeBody): GameState {
  const proposed = apply(s, { type: 'PROPOSE_TRADE', playerId: o.from, offer: o });
  const t = proposed.trades.find((x) => x.from === o.from && x.to === o.to);
  if (!t) throw new Error('offer refused');
  const done = apply(proposed, { type: 'ACCEPT_TRADE', playerId: o.to, tradeId: t.id });
  if (done.trades.some((x) => x.id === t.id)) throw new Error('acceptance refused');
  return done;
}

/** Roll the current player onto `target` with a non-double throw. */
function landOn(s: GameState, target: number): GameState {
  const pid = s.seats[s.seatIndex];
  for (let c = 0; c < 20000; c += 2) {
    const d1 = 1 + Math.floor(rand(s.settings.seed, c) * 6);
    const d2 = 1 + Math.floor(rand(s.settings.seed, c + 1) * 6);
    if (d1 === d2) continue;
    const next = structuredClone(s);
    next.rngCursor = c;
    next.phase = 'preroll';
    next.players[pid].position = ((target - d1 - d2) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
    // Never start the throw on a square that passes GO: keeps the sums clean.
    if (next.players[pid].position + d1 + d2 >= BOARD_SIZE) continue;
    return apply(next, { type: 'ROLL', playerId: pid });
  }
  throw new Error('no throw found');
}

/** A hotel on Boardwalk and Park Place, owned by p1. Boardwalk rent: $2000. */
function hotelRow(s: GameState): GameState {
  const n = structuredClone(s);
  for (const id of [37, 39]) {
    n.properties[id].owner = 'p1';
    n.properties[id].houses = 5;
  }
  n.hotelsRemaining -= 2;
  return n;
}

const endTurn = (s: GameState): GameState => {
  let n = s;
  for (let guard = 0; guard < 10 && n.phase !== 'turn_end'; guard++) {
    const pid = n.seats[n.seatIndex];
    const card = legalActions(n, pid).find((a) => a.type === 'DISMISS_CARD');
    if (!card) break;
    n = apply(n, card);
  }
  return apply(n, { type: 'END_TURN', playerId: n.seats[n.seatIndex] });
};

/* ------------------------------ passes ------------------------------ */

describe('rent passes', () => {
  it('lets the holder stay free, and uses itself up', () => {
    let s = hotelRow(game());
    const pass: DealTerm = { kind: 'pass', grantor: 'to', spaces: [39], discountPct: 100, uses: 1 };
    s = sign(s, offer('p0', 'p1', { giveCash: 300, terms: [pass] }));
    expect(s.contracts).toHaveLength(1);
    const cash0 = s.players.p0.cash;
    const cash1 = s.players.p1.cash;
    s = landOn(s, 39);
    expect(s.players.p0.position).toBe(39);
    expect(s.players.p0.cash).toBe(cash0);
    expect(s.players.p1.cash).toBe(cash1);
    expect(s.contracts).toHaveLength(0);
  });

  it('charges the discounted rent for a partial pass', () => {
    let s = hotelRow(game());
    s = sign(s, offer('p0', 'p1', {
      terms: [{ kind: 'pass', grantor: 'to', spaces: [39], discountPct: 75, uses: 3 }],
      giveCash: 100,
    }));
    const cash1 = s.players.p1.cash;
    s = landOn(s, 39);
    expect(s.players.p1.cash).toBe(cash1 + 500);
    const c = s.contracts[0];
    expect(c.kind === 'pass' && c.usesLeft).toBe(2);
  });

  it('does nothing for anyone but its holder', () => {
    let s = hotelRow(game());
    s = sign(s, offer('p2', 'p1', {
      giveCash: 100,
      terms: [{ kind: 'pass', grantor: 'to', spaces: [39], discountPct: 100, uses: 1 }],
    }));
    s.players.p0.cash = 5000;
    const cash1 = s.players.p1.cash;
    s = landOn(s, 39); // p0 lands, not p2
    expect(s.players.p1.cash).toBe(cash1 + 2000);
    expect(s.contracts).toHaveLength(1);
  });
});

/* ------------------------------ shares ------------------------------ */

describe('revenue shares', () => {
  it('splits each rent between the owner and the shareholder', () => {
    let s = hotelRow(game());
    s = sign(s, offer('p2', 'p1', {
      giveCash: 500,
      terms: [{ kind: 'share', grantor: 'to', spaces: [37, 39], pct: 25, rounds: 0 }],
    }));
    s.players.p0.cash = 5000;
    const [c0, c1, c2] = ['p0', 'p1', 'p2'].map((id) => s.players[id].cash);
    s = landOn(s, 39);
    expect(s.players.p0.cash).toBe(c0 - 2000);
    expect(s.players.p1.cash).toBe(c1 + 1500);
    expect(s.players.p2.cash).toBe(c2 + 500);
  });

  it('splits a rent that had to be raised first exactly the same way', () => {
    let s = hotelRow(game());
    s = sign(s, offer('p2', 'p1', {
      giveCash: 100,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 50, rounds: 0 }],
    }));
    s.players.p0.cash = 1800;
    for (const id of [21, 23]) s.properties[id].owner = 'p0'; // $110 mortgage each
    const [c1, c2] = [s.players.p1.cash, s.players.p2.cash];
    s = landOn(s, 39);
    expect(s.phase).toBe('must_raise');
    expect(s.debt?.cuts).toEqual([{ to: 'p2', amount: 1000, spaceId: 39 }]);
    s = apply(s, { type: 'MORTGAGE', playerId: 'p0', spaceId: 21 });
    expect(s.phase).toBe('must_raise');
    s = apply(s, { type: 'MORTGAGE', playerId: 'p0', spaceId: 23 });
    expect(s.debt).toBeNull();
    expect(s.players.p1.cash).toBe(c1 + 1000);
    expect(s.players.p2.cash).toBe(c2 + 1000);
  });

  it('rides with the deed when it changes hands', () => {
    let s = game({}, 4);
    s.properties[39].owner = 'p1';
    s = sign(s, offer('p2', 'p1', {
      giveCash: 50,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 40, rounds: 0 }],
    }));
    // Selling the deed on does not shake the shareholder off it.
    s = sign(s, offer('p1', 'p3', { giveProperties: [39], wantCash: 200 }));
    expect(s.properties[39].owner).toBe('p3');
    const [c2, c3] = [s.players.p2.cash, s.players.p3.cash];
    s = landOn(s, 39); // Boardwalk alone rents for $50
    expect(s.players.p3.cash).toBe(c3 + 30);
    expect(s.players.p2.cash).toBe(c2 + 20);
  });

  it('pays nobody a cut of rent they collect themselves', () => {
    let s = game();
    s.properties[39].owner = 'p1';
    s = sign(s, offer('p2', 'p1', {
      giveCash: 50,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 40, rounds: 0 }],
    }));
    s = sign(s, offer('p1', 'p2', { giveProperties: [39], wantCash: 200 }));
    const c2 = s.players.p2.cash;
    s = landOn(s, 39);
    expect(s.players.p2.cash).toBe(c2 + 50);
  });

  it('lets a seller keep a cut of the deed they sell', () => {
    let s = hotelRow(game());
    // p1 sells Boardwalk to p2 and keeps 30% of its rent for five rounds.
    const deal = offer('p1', 'p2', {
      giveProperties: [39],
      wantCash: 400,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 30, rounds: 5 }],
    });
    // Built sets cannot move, so clear the buildings first.
    for (const id of [37, 39]) s.properties[id].houses = 0;
    s.hotelsRemaining += 2;
    expect(canTrade(s, deal)).toBe(true);
    s = sign(s, deal);
    expect(s.properties[39].owner).toBe('p2');
    const c = s.contracts[0];
    expect(c.kind === 'share' && c.holder).toBe('p1');
  });

  it('refuses to promise away more than all of a square’s rent', () => {
    let s = game();
    s.properties[39].owner = 'p1';
    s = sign(s, offer('p2', 'p1', {
      giveCash: 10,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 80, rounds: 0 }],
    }));
    const greedy = offer('p0', 'p1', {
      giveCash: 10,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 25, rounds: 0 }],
    });
    expect(canTrade(s, greedy)).toBe(false);
  });

  it('lapses when its rounds are up', () => {
    let s = game();
    s.properties[39].owner = 'p1';
    s = sign(s, offer('p2', 'p1', {
      giveCash: 10,
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 20, rounds: 2 }],
    }));
    const start = s.round;
    for (let i = 0; i < 12 && s.round < start + 2; i++) {
      s = { ...s, phase: 'turn_end' };
      s = endTurn(s);
      if (s.round < start + 2) expect(s.contracts).toHaveLength(1);
    }
    expect(s.round).toBe(start + 2);
    expect(s.contracts).toHaveLength(0);
  });
});

/* ------------------------------- loans ------------------------------ */

describe('loans', () => {
  const loan = (principal: number, repay: number, rounds: number): DealTerm =>
    ({ kind: 'loan', lender: 'to', principal, repay, rounds });

  it('moves the principal on signing and collects at the borrower’s turn', () => {
    let s = game();
    s = sign(s, offer('p0', 'p1', { terms: [loan(400, 480, 1)] }));
    expect(s.players.p0.cash).toBe(1900);
    expect(s.players.p1.cash).toBe(1100);
    expect(loanDebt(s, 'p0')).toBe(480);
    // Net worth counts the debt, so borrowing is not wealth.
    expect(netWorth(s, 'p0')).toBe(1500 - 80);

    // Round the table once: p1, p2, then p0's turn in round 2.
    for (let i = 0; i < 3; i++) s = endTurn({ ...s, phase: 'turn_end' });
    expect(s.seats[s.seatIndex]).toBe('p0');
    expect(s.players.p0.cash).toBe(1900 - 480);
    expect(s.players.p1.cash).toBe(1100 + 480);
    expect(s.contracts).toHaveLength(0);
    expect(s.phase).toBe('preroll');
  });

  it('makes a short borrower raise it, then gives them their turn', () => {
    let s = game();
    s = sign(s, offer('p0', 'p1', { terms: [loan(400, 600, 1)] }));
    s.players.p0.cash = 250;
    s.properties[39].owner = 'p0';
    s.properties[37].owner = 'p0';
    const lender = s.players.p1.cash;
    for (let i = 0; i < 3; i++) s = endTurn({ ...s, phase: 'turn_end' });
    expect(s.phase).toBe('must_raise');
    expect(s.debt?.resume).toBe('turn');
    s = apply(s, { type: 'MORTGAGE', playerId: 'p0', spaceId: 39 }); // +200
    expect(s.phase).toBe('must_raise');
    s = apply(s, { type: 'MORTGAGE', playerId: 'p0', spaceId: 37 }); // +175
    expect(s.debt).toBeNull();
    expect(s.phase).toBe('preroll');
    expect(s.players.p0.cash).toBe(250 + 200 + 175 - 600);
    expect(s.players.p1.cash).toBe(lender + 600);
  });

  it('hands a folding borrower’s estate to the lender', () => {
    let s = game();
    s = sign(s, offer('p0', 'p1', { terms: [loan(400, 1200, 1)] }));
    s.players.p0.cash = 50;
    s.properties[1].owner = 'p0';
    for (let i = 0; i < 3; i++) s = endTurn({ ...s, phase: 'turn_end' });
    expect(s.phase).toBe('must_raise');
    s = apply(s, { type: 'DECLARE_BANKRUPTCY', playerId: 'p0' });
    expect(s.players.p0.bankrupt).toBe(true);
    expect(s.properties[1].owner).toBe('p1');
    expect(s.contracts).toHaveLength(0);
  });

  it('passes a bankrupt lender’s loan to their creditor', () => {
    let s = game();
    s = sign(s, offer('p0', 'p1', { terms: [loan(300, 360, 5)] }));
    s = hotelRow({ ...s });
    // p1 owns the hotels; make p2 the creditor p0... instead bankrupt the
    // lender p1 to p2 directly.
    s.properties[37].owner = 'p2';
    s.properties[39].owner = 'p2';
    s.players.p1.cash = 0;
    s.seatIndex = 1;
    s.phase = 'preroll';
    s = landOn(s, 39);
    expect(s.phase).toBe('must_raise');
    s = apply(s, { type: 'DECLARE_BANKRUPTCY', playerId: 'p1' });
    const c = s.contracts.find((x) => x.kind === 'loan');
    expect(c && c.kind === 'loan' && c.lender).toBe('p2');
  });

  it('can be paid off early, and only by the borrower', () => {
    let s = game();
    s = sign(s, offer('p0', 'p1', { terms: [loan(200, 260, 8)] }));
    const id = s.contracts[0].id;
    s.phase = 'preroll';
    expect(apply(s, { type: 'REPAY_LOAN', playerId: 'p1', contractId: id }).version).toBe(s.version);
    s = apply(s, { type: 'REPAY_LOAN', playerId: 'p0', contractId: id });
    expect(s.contracts).toHaveLength(0);
    expect(s.players.p1.cash).toBe(1500 - 200 + 260);
  });
});

/* ---------------------------- release & forgery ---------------------------- */

describe('the ledger is only moved by the rules', () => {
  it('lets only the favoured side release a contract', () => {
    let s = game();
    s.properties[39].owner = 'p1';
    s = sign(s, offer('p0', 'p1', {
      giveCash: 10,
      terms: [{ kind: 'pass', grantor: 'to', spaces: [39], discountPct: 100, uses: 3 }],
    }));
    const id = s.contracts[0].id;
    expect(apply(s, { type: 'RELEASE_CONTRACT', playerId: 'p1', contractId: id }).contracts).toHaveLength(1);
    expect(apply(s, { type: 'RELEASE_CONTRACT', playerId: 'p0', contractId: id }).contracts).toHaveLength(0);
  });

  it('refuses terms outside Deal Maker', () => {
    const s = game({ dealsEnabled: false });
    s.properties[39].owner = 'p1';
    const o = offer('p0', 'p1', {
      giveCash: 10,
      terms: [{ kind: 'pass', grantor: 'to', spaces: [39], discountPct: 100, uses: 3 }],
    });
    expect(canTrade(s, o)).toBe(false);
  });

  it('refuses a pass on deeds the granting side does not hold', () => {
    const s = game();
    s.properties[39].owner = 'p2';
    expect(canTrade(s, offer('p0', 'p1', {
      giveCash: 10,
      terms: [{ kind: 'pass', grantor: 'to', spaces: [39], discountPct: 100, uses: 3 }],
    }))).toBe(false);
  });

  it('refuses malformed and out-of-range terms', () => {
    const s = game();
    s.properties[39].owner = 'p1';
    const bad: unknown[] = [
      { kind: 'pass', grantor: 'to', spaces: [39], discountPct: 100, uses: 0.5 },
      { kind: 'pass', grantor: 'to', spaces: [39, 39], discountPct: 100, uses: 1 },
      { kind: 'pass', grantor: 'nobody', spaces: [39], discountPct: 100, uses: 1 },
      { kind: 'share', grantor: 'to', spaces: [39], pct: 150, rounds: 0 },
      { kind: 'share', grantor: 'to', spaces: [], pct: 10, rounds: 0 },
      { kind: 'loan', lender: 'to', principal: 100, repay: 50, rounds: 3 },
      { kind: 'loan', lender: 'to', principal: 100, repay: 1000, rounds: 3 },
      { kind: 'loan', lender: 'to', principal: 99999, repay: 99999, rounds: 3 },
      { kind: 'mint', amount: 1e9 },
      null,
    ];
    for (const term of bad) {
      expect(canTrade(s, offer('p0', 'p1', { terms: [term as DealTerm] })), JSON.stringify(term)).toBe(false);
    }
    expect(canTrade(s, offer('p0', 'p1', { terms: 'loan' as unknown as DealTerm[] }))).toBe(false);
  });

  it('keeps nothing but the fields it reads', () => {
    let s = game();
    const term = { kind: 'loan', lender: 'to', principal: 100, repay: 120, rounds: 3, junk: 'x'.repeat(50) };
    s = apply(s, { type: 'PROPOSE_TRADE', playerId: 'p0', offer: offer('p0', 'p1', { terms: [term as DealTerm] }) });
    expect(JSON.stringify(s.trades)).not.toContain('xxxx');
  });
});

/* ------------------------------- bots ------------------------------- */

describe('bots and contracts', () => {
  it('a bot lends when the price is right, and not when it is not', () => {
    const s = createGame({ ...CLASSIC, ...DEALS, seed: 9, botLevel: 'normal' }, seats(3, true));
    const started = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    const fair: TradeBody = offer('p0', 'p1', {
      terms: [{ kind: 'loan', lender: 'to', principal: 300, repay: 400, rounds: 5 }],
    });
    const insulting: TradeBody = offer('p0', 'p1', {
      terms: [{ kind: 'loan', lender: 'to', principal: 1000, repay: 1000, rounds: 20 }],
    });
    expect(acceptMargin(started, 'p1', fair)).toBeGreaterThan(0);
    expect(acceptMargin(started, 'p1', insulting)).toBeLessThan(0);
  });

  it('values a share on hotels as real money', () => {
    const s = hotelRow(game());
    const o = offer('p2', 'p1', {
      terms: [{ kind: 'share', grantor: 'to', spaces: [39], pct: 50, rounds: 10 }],
    });
    expect(tradeGain(s, 'p2', o)).toBeGreaterThan(300);
    expect(tradeGain(s, 'p1', o)).toBeLessThan(-300);
  });

  it('asks the table for a loan when it is running dry, soundly', () => {
    const s = createGame({ ...CLASSIC, ...DEALS, seed: 9 }, seats(3, true));
    const started = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    started.players.p0.cash = 20;
    for (const id of [21, 23, 24]) started.properties[id].owner = 'p0';
    const req = loanRequest(started, 'p0', 'normal');
    expect(req).not.toBeNull();
    expect(canTrade(started, req!)).toBe(true);
    expect(botDecide(started, 'p0')?.type).toBe('PROPOSE_TRADE');
  });
});

/* ------------------------------- fuzz ------------------------------- */

describe('Deal Maker fuzz', () => {
  it('plays bot games with random contracts without breaking an invariant', () => {
    const seen = new Set<string>();
    let botLoans = 0;
    for (let g = 0; g < 16; g++) {
      let s = createGame(
        { ...CLASSIC, ...DEALS, seed: 1000 + g * 31, winCondition: 'turn-limit', turnLimit: 25 },
        seats(4, true),
      );
      s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
      let signed = 0;
      for (let step = 0; step < 6000 && s.phase !== 'game_over'; step++) {
        // Every so often, somebody offers somebody a random contract.
        if (step % 37 === 0) {
          const o = randomDeal(s, step);
          if (o && canTrade(s, o)) {
            const p = reduce(s, { type: 'PROPOSE_TRADE', playerId: o.from, offer: o }).state;
            const t = p.trades.find((x) => x.from === o.from && x.to === o.to);
            if (t) {
              const a = reduce(p, { type: 'ACCEPT_TRADE', playerId: o.to, tradeId: t.id });
              for (const e of a.events) seen.add(e.type);
              s = a.state;
              if (a.events.some((e) => e.type === 'CONTRACT_SIGNED')) signed += 1;
              check(s, g, step);
            }
          }
        }
        let acted = false;
        for (const pid of s.seats) {
          const a = botDecide(s, pid);
          if (!a) continue;
          const r = reduce(s, a);
          if (r.state.version === s.version) continue;
          for (const e of r.events) {
            seen.add(e.type === 'CONTRACT_ENDED' ? `ENDED_${e.reason}` : e.type);
            if (e.type === 'TRADE_ACCEPTED' && e.offer.terms?.some((x) => x.kind === 'loan') && s.players[e.offer.from].isBot) botLoans += 1;
          }
          if (r.events.some((e) => e.type === 'BANKRUPT') && s.contracts.length > 0) seen.add('BANKRUPT_WITH_CONTRACTS');
          const json = JSON.stringify(r.state);
          if (json !== JSON.stringify(JSON.parse(json))) throw new Error('state is not plain JSON');
          s = r.state;
          acted = true;
          break;
        }
        if (!acted) break;
        check(s, g, step);
      }
      expect(s.phase, `game ${g}`).toBe('game_over');
      expect(signed, `game ${g} signed nothing`).toBeGreaterThan(0);
    }
    for (const k of ['PASS_USED', 'SHARE_PAID', 'LOAN_REPAID', 'ENDED_used', 'ENDED_expired', 'BANKRUPT_WITH_CONTRACTS']) {
      expect(seen, k).toContain(k);
    }
    expect(botLoans).toBeGreaterThan(0);
  });

  it('replays byte for byte', () => {
    const play = () => {
      let s = createGame({ ...CLASSIC, ...DEALS, seed: 77, winCondition: 'turn-limit', turnLimit: 12 }, seats(3, true));
      s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
      for (let step = 0; step < 3000 && s.phase !== 'game_over'; step++) {
        if (step % 23 === 0) {
          const o = randomDeal(s, step);
          if (o && canTrade(s, o)) {
            const p = reduce(s, { type: 'PROPOSE_TRADE', playerId: o.from, offer: o }).state;
            const t = p.trades.find((x) => x.from === o.from && x.to === o.to);
            if (t) s = reduce(p, { type: 'ACCEPT_TRADE', playerId: o.to, tradeId: t.id }).state;
          }
        }
        const pid = s.seats.find((id) => botDecide(s, id));
        if (!pid) break;
        s = reduce(s, botDecide(s, pid)!).state;
      }
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });
});

function randomDeal(s: GameState, salt: number): TradeBody | null {
  const alive = s.seats.filter((id) => !s.players[id].bankrupt);
  if (alive.length < 2) return null;
  const r = (k: number) => rand(s.settings.seed + salt, s.version * 7 + k);
  const from = alive[Math.floor(r(1) * alive.length)];
  const others = alive.filter((id) => id !== from);
  const to = others[Math.floor(r(2) * others.length)];
  const kind = Math.floor(r(3) * 3);
  if (kind === 2) {
    const principal = 10 * (5 + Math.floor(r(4) * 40));
    return offer(from, to, {
      terms: [{ kind: 'loan', lender: r(5) < 0.5 ? 'from' : 'to', principal, repay: principal + 10 * Math.floor(r(6) * 20), rounds: 1 + Math.floor(r(7) * 6) }],
    });
  }
  const grantorSide = r(8) < 0.5 ? 'from' : 'to';
  const grantor = grantorSide === 'from' ? from : to;
  const deeds = ownedBy(s, grantor);
  if (deeds.length === 0) return null;
  const spaces = [deeds[Math.floor(r(9) * deeds.length)]];
  const term: DealTerm = kind === 0
    ? { kind: 'pass', grantor: grantorSide, spaces, discountPct: [25, 50, 100][Math.floor(r(10) * 3)], uses: 1 + Math.floor(r(11) * 3) }
    : { kind: 'share', grantor: grantorSide, spaces, pct: 5 * (1 + Math.floor(r(12) * 8)), rounds: [0, 2, 5][Math.floor(r(13) * 3)] };
  return offer(from, to, { terms: [term] });
}

function check(s: GameState, g: number, i: number): void {
  const bad = (msg: string): never => { throw new Error(`deals game ${g} step ${i}: ${msg}`); };
  for (const pid of s.seats) {
    const p = s.players[pid];
    if (!(p.cash >= 0) || !Number.isInteger(p.cash)) bad(`${pid} cash is ${p.cash}`);
    if (p.bankrupt && ownedBy(s, pid).length > 0) bad(`bankrupt ${pid} still owns deeds`);
  }
  if (s.debt && s.phase !== 'must_raise') bad(`debt left standing in ${s.phase}`);
  if (s.phase !== 'auction' && s.phase !== 'game_over' && s.auctionQueue.length > 0) {
    bad(`estate auctions left queued in ${s.phase}`);
  }
  const pct: Record<number, number> = {};
  for (const c of s.contracts) {
    const parties = c.kind === 'loan' ? [c.lender, c.borrower] : [c.grantor, c.holder];
    for (const id of parties) if (s.players[id]?.bankrupt) bad(`contract ${c.id} binds bankrupt ${id}`);
    if (c.kind === 'pass' && c.usesLeft <= 0) bad(`spent pass ${c.id} left standing`);
    if (c.kind === 'share') {
      if (c.endsRound !== null && s.round >= c.endsRound) bad(`expired share ${c.id}`);
      for (const id of c.spaces) pct[id] = (pct[id] ?? 0) + c.pct;
    }
    if (c.kind !== 'loan') {
      for (const id of c.spaces) if (!OWNABLE_IDS.includes(id)) bad(`contract on ${id}`);
    }
  }
  for (const [id, n] of Object.entries(pct)) if (n > 100) bad(`square ${id} shares ${n}%`);
}
