import { describe, expect, it } from 'vitest';
import { rand } from '../game/rng';
import type { SeatSpec } from '../game/engine';
import { botDecide } from './ai';
import {
  BIG_DEALS, DOODADS, DREAM_IDS, FAST_BOARD, MARKET, PROFESSIONS, RAT_BOARD, SMALL_DEALS,
} from './data';
import { CF_DEFAULTS, createCashflow, reduce } from './engine';
import {
  autopilotAction, currentId, dreamPrice, holdKey, legalActions, maxLoan, monthlyCashflow, passiveIncome,
  totalExpenses, waitingOn,
} from './rules';
import type { CFAction, CFEvent, CFSettings, CFState } from './types';

const seats = (n: number, bots = true): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'camel' as const, color: '#fff', isBot: bots,
  }));

const settings = (seed: number, patch: Partial<CFSettings> = {}): CFSettings =>
  ({ ...CF_DEFAULTS, seed, ...patch });

/** A game past the dream picks, with p0 about to roll. */
function started(seed: number, n = 3, patch: Partial<CFSettings> = {}): CFState {
  let s = createCashflow(settings(seed, patch), seats(n, false));
  s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
  for (const id of s.seats) s = reduce(s, { type: 'CHOOSE_DREAM', playerId: id, spaceId: DREAM_IDS[0] }).state;
  return s;
}

const edit = (s: CFState, fn: (s: CFState) => void): CFState => {
  const c = JSON.parse(JSON.stringify(s)) as CFState;
  fn(c);
  return c;
};

/** Bots play it out. Off-turn seats go first, the same order the store uses,
 *  so a sale into somebody's card is not beaten to the table by END_TURN. */
function playBots(seed: number, n = 4, cap = 40000, patch: Partial<CFSettings> = {}) {
  let s = createCashflow(settings(seed, patch), seats(n));
  s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
  const log: CFAction[] = [];
  const events: CFEvent[] = [];
  let stuck: CFAction | null = null;
  for (let step = 0; step < cap && s.phase !== 'game_over'; step++) {
    const cur = currentId(s);
    const order = [...s.seats.filter((id) => id !== cur), cur];
    let acted = false;
    for (const pid of order) {
      const a = botDecide(s, pid);
      if (!a) continue;
      const r = reduce(s, a);
      if (r.state.version === s.version) { stuck = a; continue; }
      s = r.state;
      log.push(a);
      events.push(...r.events);
      acted = true;
      break;
    }
    if (!acted) break;
  }
  return { s, log, events, stuck };
}

/* ------------------------- the clock and the limit ------------------------- */

describe('the clock', () => {
  it('picks a dream for a player who timed out while the table chose', () => {
    let s = createCashflow(settings(5), seats(3, false));
    s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    s = reduce(s, { type: 'CHOOSE_DREAM', playerId: 'p0', spaceId: DREAM_IDS[0] }).state;
    expect(waitingOn(s)).toEqual(['p1', 'p2']);
    const r = reduce(s, { type: 'TIME_OUT', playerId: 'p1' });
    expect(r.events[0]).toEqual({ type: 'TIMED_OUT', playerId: 'p1' });
    expect(r.state.players.p1.dream).not.toBeNull();
    expect(waitingOn(r.state)).toEqual(['p2']);
  });

  it('plays out a timed-out turn without buying anything, and nobody else\'s', () => {
    const s = started(7);
    expect(reduce(s, { type: 'TIME_OUT', playerId: 'p1' }).state).toBe(s);
    const r = reduce(s, { type: 'TIME_OUT', playerId: 'p0' });
    expect(waitingOn(r.state)).not.toContain('p0');
    const bought = r.events.some((e) => e.type === 'BOUGHT_STOCK' || e.type === 'BOUGHT_HOLDING'
      || e.type === 'CHARITY' || (e.type === 'LOAN' && !e.forced));
    expect(bought).toBe(false);
  });

  it('gives every player the same number of turns under a round limit', () => {
    let s = started(11, 3, { turnLimit: 4 });
    // p0's first turn began as the last dream was chosen.
    const turns: Record<string, number> = { p0: 1, p1: 0, p2: 0 };
    for (let guard = 0; s.phase !== 'game_over' && guard < 2000; guard++) {
      const [pid] = waitingOn(s);
      if (!pid) break;
      const r = reduce(s, autopilotAction(s, pid)!);
      for (const e of r.events) {
        if (e.type === 'TURN_STARTED' || e.type === 'TURN_SKIPPED') turns[e.playerId] += 1;
      }
      s = r.state;
    }
    expect(s.phase).toBe('game_over');
    expect(s.winReason).toBe('limit');
    expect(turns).toEqual({ p0: 4, p1: 4, p2: 4 });
    expect(s.history.map((h) => h.round)).toEqual([1, 2, 3, 4, 5]);
  });
});

/* ------------------------------ the tables ---------------------------- */

describe('tables', () => {
  it('gives every profession a positive pay cheque to start', () => {
    expect(PROFESSIONS).toHaveLength(12);
    const s = createCashflow(settings(1), seats(6));
    for (const id of s.seats) expect(monthlyCashflow(s.players[id])).toBeGreaterThan(0);
  });

  it('lays out both tracks', () => {
    expect(RAT_BOARD).toHaveLength(24);
    expect(RAT_BOARD.filter((sp) => sp.kind === 'payday')).toHaveLength(3);
    expect(FAST_BOARD).toHaveLength(40);
    expect(DREAM_IDS).toHaveLength(8);
    expect(FAST_BOARD.filter((sp) => sp.kind === 'cashflowDay')).toHaveLength(4);
  });

  it('keeps Small Deals small and Big Deals big', () => {
    for (const c of SMALL_DEALS) if (c.kind === 'holding') expect(c.down, c.id).toBeLessThanOrEqual(5000);
    for (const c of BIG_DEALS) if (c.kind === 'holding') expect(c.down, c.id).toBeGreaterThanOrEqual(6000);
  });

  it('numbers every card uniquely', () => {
    const ids = [...SMALL_DEALS, ...BIG_DEALS, ...MARKET, ...DOODADS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ------------------------------ the rules ----------------------------- */

describe('starting out', () => {
  it('opens with savings plus one pay cheque, then asks for dreams', () => {
    let s = createCashflow(settings(5), seats(2, false));
    for (const id of s.seats) {
      const p = s.players[id];
      const prof = PROFESSIONS.find((x) => x.id === p.profession)!;
      expect(p.cash).toBe(prof.savings + monthlyCashflow(p));
    }
    s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    expect(s.phase).toBe('dreams');
    s = reduce(s, { type: 'CHOOSE_DREAM', playerId: 'p1', spaceId: DREAM_IDS[3] }).state;
    expect(s.phase).toBe('dreams');
    s = reduce(s, { type: 'CHOOSE_DREAM', playerId: 'p0', spaceId: DREAM_IDS[3] }).state;
    expect(s.phase).toBe('roll');
    expect(currentId(s)).toBe('p0');
  });

  it('refuses a dream that is not a dream square', () => {
    let s = createCashflow(settings(5), seats(2, false));
    s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    expect(reduce(s, { type: 'CHOOSE_DREAM', playerId: 'p0', spaceId: 0 }).state).toBe(s);
  });
});

describe('the Rat Race', () => {
  it('pays the monthly cash flow for passing Pay Check', () => {
    const s = edit(started(9), (c) => { c.players.p0.position = 4; });
    const r = reduce(s, { type: 'ROLL', playerId: 'p0' });
    const pay = r.events.find((e) => e.type === 'PAYDAY');
    expect(pay && pay.type === 'PAYDAY' && pay.amount).toBe(monthlyCashflow(s.players.p0));
  });

  it('lends only against the pay cheque when lending is strict', () => {
    const s = started(9);
    const p = s.players.p0;
    const cap = maxLoan(s, p);
    expect(cap).toBe(Math.floor(monthlyCashflow(p) / 100) * 1000);
    expect(reduce(s, { type: 'TAKE_LOAN', playerId: 'p0', amount: cap }).state.players.p0.bankLoan).toBe(cap);
    expect(reduce(s, { type: 'TAKE_LOAN', playerId: 'p0', amount: cap + 1000 }).state).toBe(s);
    expect(reduce(s, { type: 'TAKE_LOAN', playerId: 'p0', amount: 1500 }).state).toBe(s);
  });

  it('adds a tenth of the loan to expenses, and takes it back off on repayment', () => {
    let s = started(9);
    const before = totalExpenses(s.players.p0);
    s = reduce(s, { type: 'TAKE_LOAN', playerId: 'p0', amount: 2000 }).state;
    expect(totalExpenses(s.players.p0)).toBe(before + 200);
    s = reduce(s, { type: 'REPAY_LOAN', playerId: 'p0', amount: 1000 }).state;
    expect(totalExpenses(s.players.p0)).toBe(before + 100);
  });

  it('borrows the difference when a doodad is more than the cash in hand', () => {
    let hit = false;
    for (let seed = 1; seed < 400 && !hit; seed++) {
      const s = edit(started(seed), (c) => { c.players.p0.cash = 0; c.players.p0.position = 0; });
      const r = reduce(s, { type: 'ROLL', playerId: 'p0' });
      const doodad = r.events.find((e) => e.type === 'DOODAD');
      if (!doodad || doodad.type !== 'DOODAD' || doodad.amount === 0) continue;
      hit = true;
      const p = r.state.players.p0;
      expect(r.events.some((e) => e.type === 'LOAN' && e.forced)).toBe(true);
      expect(p.cash).toBeGreaterThanOrEqual(0);
      expect(p.bankLoan % 1000).toBe(0);
    }
    expect(hit).toBe(true);
  });

  it('takes a player off the Rat Race at a hundred times passive income', () => {
    const s = edit(started(9), (c) => {
      c.players.p0.holdings.push({
        id: 'hx', tag: 'apartment', units: 60, cost: 1_200_000, down: 200_000, mortgage: 1_000_000, cashflow: 20000,
      });
      c.phase = 'turn_end';
      c.seatIndex = c.seats.length - 1;
      c.landed = null;
    });
    const last = s.seats[s.seats.length - 1];
    const r = reduce(s, { type: 'END_TURN', playerId: last });
    const p = r.state.players.p0;
    expect(p.track).toBe('fast');
    expect(p.fastIncome).toBe(passiveIncome(s.players.p0) * 100);
    expect(p.fastGoal).toBe(p.fastIncome + 50000);
    expect(p.cash).toBe(s.players.p0.cash + p.fastIncome);
  });
});

/** p0 about to draw `cardId` off the top of the Small Deals. */
function aboutToDraw(seed: number, cardId: string): CFState {
  return edit(started(seed), (c) => {
    c.phase = 'choose_deal';
    c.decks.small[c.cursors.small % c.decks.small.length] = cardId;
  });
}

describe('share prices', () => {
  const card = (symbol: string, price: number) =>
    SMALL_DEALS.find((c) => c.kind === 'stock' && c.symbol === symbol && c.price === price)!;

  it('quotes a share card at a different price from game to game', () => {
    const twenty = card('MEDX', 20);
    const quotes = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const r = reduce(aboutToDraw(seed, twenty.id), { type: 'DRAW_DEAL', playerId: 'p0', deck: 'small' });
      const q = r.state.card?.price;
      expect(q).toBeDefined();
      expect(q!).toBeGreaterThanOrEqual(10);
      expect(q!).toBeLessThanOrEqual(30);
      quotes.add(q!);
      const drawn = r.events.find((e) => e.type === 'CARD');
      expect(drawn && drawn.type === 'CARD' && drawn.price).toBe(q);
    }
    expect(quotes.size).toBeGreaterThan(10);
  });

  it('moves the $1 card too, and never below $1', () => {
    const one = card('VOLT', 1);
    const quotes = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      quotes.add(reduce(aboutToDraw(seed, one.id), { type: 'DRAW_DEAL', playerId: 'p0', deck: 'small' }).state.card!.price!);
    }
    expect(Math.min(...quotes)).toBe(1);
    expect(quotes.size).toBeGreaterThan(1);
  });

  it('buys and sells at the quote, not the printed price', () => {
    const twenty = card('BYTE', 20);
    let s = reduce(aboutToDraw(4, twenty.id), { type: 'DRAW_DEAL', playerId: 'p0', deck: 'small' }).state;
    const q = s.card!.price!;
    const cash = s.players.p0.cash;
    const most = legalActions(s, 'p0').find((a) => a.type === 'BUY_STOCK');
    expect(most && most.type === 'BUY_STOCK' && most.shares).toBe(Math.floor(cash / q));
    s = reduce(s, { type: 'BUY_STOCK', playerId: 'p0', shares: 10 }).state;
    expect(s.players.p0.cash).toBe(cash - 10 * q);
    expect(s.players.p0.stocks[0]).toMatchObject({ symbol: 'BYTE', shares: 10, cost: q });
    const sold = reduce(s, { type: 'SELL_STOCK', playerId: 'p0', shares: 10 });
    expect(sold.state.players.p0.cash).toBe(cash);
  });

  it('leaves a bond at its one price', () => {
    const cd = SMALL_DEALS.find((c) => c.kind === 'stock' && c.symbol === 'CD')!;
    const r = reduce(aboutToDraw(4, cd.id), { type: 'DRAW_DEAL', playerId: 'p0', deck: 'small' });
    expect(r.state.card?.price).toBe(1000);
  });
});

describe('the Fast Track', () => {
  const onTrack = (patch: (c: CFState) => void) => edit(started(12), (c) => {
    const p = c.players.p0;
    p.track = 'fast';
    p.fastIncome = 100000;
    p.fastGoal = 150000;
    c.phase = 'turn_end';
    patch(c);
  });

  it('doubles a dream for every rival who has landed on it', () => {
    const s = started(12);
    const p = { ...s.players.p0, dream: DREAM_IDS[0], dreamMarks: 0 };
    const base = dreamPrice(p);
    expect(dreamPrice({ ...p, dreamMarks: 1 })).toBe(base * 2);
    expect(dreamPrice({ ...p, dreamMarks: 2 })).toBe(base * 3);
  });

  it('ends the game when a player buys their dream', () => {
    const dream = DREAM_IDS[0];
    const s = onTrack((c) => {
      c.players.p0.position = dream;
      c.players.p0.cash = 10_000_000;
      c.landed = { track: 'fast', space: dream };
    });
    const r = reduce(s, { type: 'BUY_DREAM', playerId: 'p0' });
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winnerId).toBe('p0');
    expect(r.state.winReason).toBe('dream');
  });

  it('ends the game at fifty thousand more a month', () => {
    const biz = FAST_BOARD.find((sp) => sp.kind === 'business' && (sp.cashflow ?? 0) >= 10000)!;
    const s = onTrack((c) => {
      c.players.p0.position = biz.id;
      c.players.p0.cash = 10_000_000;
      c.players.p0.fastIncome = 150000 - (biz.cashflow ?? 0);
      c.landed = { track: 'fast', space: biz.id };
    });
    const r = reduce(s, { type: 'BUY_BUSINESS', playerId: 'p0' });
    expect(r.state.winnerId).toBe('p0');
    expect(r.state.winReason).toBe('cashflow');
  });

  it('will not sell one business twice', () => {
    const biz = FAST_BOARD.find((sp) => sp.kind === 'business')!;
    const s = onTrack((c) => {
      c.players.p0.position = biz.id;
      c.players.p0.cash = 10_000_000;
      c.landed = { track: 'fast', space: biz.id };
      c.fastOwners[biz.id] = 'p1';
    });
    expect(legalActions(s, 'p0').some((a) => a.type === 'BUY_BUSINESS')).toBe(false);
  });
});

/* ---------------------------- hostile input --------------------------- */

describe('a brisk pace', () => {
  it('rolls two dice in the Grind, three with charity', () => {
    const s = started(41, 3, { pace: 'brisk' });
    const rolls = (st: CFState) => legalActions(st, 'p0').filter((a) => a.type === 'ROLL').map((a) => a.type === 'ROLL' && a.dice);
    expect(rolls(s)).toEqual([2]);
    expect(rolls(edit(s, (c) => { c.players.p0.charityTurns = 2; }))).toEqual([2, 3]);
    expect(rolls(started(41))).toEqual([1]);
    const r = reduce(s, { type: 'ROLL', playerId: 'p0' });
    expect(r.state.dice).toHaveLength(2);
  });

  it('pays a good month twice at Pay Check, and a bad one once', () => {
    for (const pace of ['classic', 'brisk'] as const) {
      const s = edit(started(9, 3, { pace }), (c) => { c.players.p0.position = 4; });
      const month = monthlyCashflow(s.players.p0);
      const r = reduce(s, { type: 'ROLL', playerId: 'p0', dice: pace === 'brisk' ? 2 : 1 });
      const paid = r.events.filter((e) => e.type === 'PAYDAY').map((e) => e.type === 'PAYDAY' && e.amount);
      if (paid.length) expect(paid[0]).toBe(pace === 'brisk' ? month * 2 : month);
    }
    const broke = edit(started(9, 3, { pace: 'brisk' }), (c) => {
      c.players.p0.position = 4;
      c.players.p0.other += 5000;
      c.players.p0.cash = 100000;
    });
    const month = monthlyCashflow(broke.players.p0);
    const r = reduce(broke, { type: 'ROLL', playerId: 'p0', dice: 2 });
    for (const e of r.events) if (e.type === 'PAYDAY') expect(e.amount).toBe(month);
  });

  it('still lets bots finish, sooner', () => {
    for (const seed of [3, 17, 99]) {
      const g = playBots(seed, 4, 60000, { pace: 'brisk' });
      expect(g.stuck).toBeNull();
      expect(g.s.phase).toBe('game_over');
    }
  });
});

describe('passing a deal on', () => {
  const house = BIG_DEALS.find((c) => c.kind === 'holding' && c.cashflow > 0)!;
  const down = house.kind === 'holding' ? house.down : 0;
  const cashflow = house.kind === 'holding' ? house.cashflow : 0;
  /** p0 has drawn a paying deal it cannot afford; p1 and p2 are flush. */
  const drawn = (fee?: number) => edit(started(31), (c) => {
    c.phase = 'turn_end';
    c.card = { id: house.id, by: 'p0', used: false, ...(fee === undefined ? {} : { fee }) };
    c.players.p0.cash = 0;
    c.players.p1.cash = 100000;
    c.players.p2.cash = 100000;
  });

  it('lets only the drawer offer it, for a fee no more than the down payment', () => {
    const s = drawn();
    expect(legalActions(s, 'p1').some((a) => a.type === 'TAKE_DEAL')).toBe(false);
    expect(reduce(s, { type: 'OFFER_DEAL', playerId: 'p1', fee: 0 }).state).toBe(s);
    expect(reduce(s, { type: 'OFFER_DEAL', playerId: 'p0', fee: down + 100 }).state).toBe(s);
    expect(reduce(s, { type: 'OFFER_DEAL', playerId: 'p0', fee: 150 }).state).toBe(s);
    expect(reduce(s, { type: 'OFFER_DEAL', playerId: 'p0', fee: -100 }).state).toBe(s);
    const r = reduce(s, { type: 'OFFER_DEAL', playerId: 'p0', fee: 500 });
    expect(r.state.card?.fee).toBe(500);
    expect(r.events).toContainEqual({ type: 'DEAL_OFFERED', playerId: 'p0', tag: house.kind === 'holding' ? house.tag : 'house', fee: 500 });
    // Offered once is offered.
    expect(reduce(r.state, { type: 'OFFER_DEAL', playerId: 'p0', fee: 0 }).state).toBe(r.state);
  });

  it('moves the fee to the drawer and the deal to whoever takes it first', () => {
    const s = drawn(500);
    const r = reduce(s, { type: 'TAKE_DEAL', playerId: 'p2' });
    const p2 = r.state.players.p2;
    expect(p2.cash).toBe(100000 - down - 500);
    expect(r.state.players.p0.cash).toBe(500);
    expect(p2.holdings).toHaveLength(1);
    expect(passiveIncome(p2)).toBe(cashflow);
    expect(r.state.card?.used).toBe(true);
    // Too late for anybody else, and for the drawer too.
    expect(reduce(r.state, { type: 'TAKE_DEAL', playerId: 'p1' }).state).toBe(r.state);
    expect(legalActions(r.state, 'p0').some((a) => a.type === 'BUY_DEAL' || a.type === 'OFFER_DEAL')).toBe(false);
  });

  it('needs the cash in hand, and a seat still in the game', () => {
    const s = edit(drawn(500), (c) => {
      c.players.p1.cash = down + 499;
      c.players.p2.out = true;
    });
    expect(legalActions(s, 'p1').some((a) => a.type === 'TAKE_DEAL')).toBe(false);
    expect(legalActions(s, 'p2').some((a) => a.type === 'TAKE_DEAL')).toBe(false);
    const ok = edit(s, (c) => { c.players.p1.cash = down + 500; });
    expect(reduce(ok, { type: 'TAKE_DEAL', playerId: 'p1' }).state.players.p1.cash).toBe(0);
  });

  it('closes when the drawer ends the turn', () => {
    const s = reduce(drawn(0), { type: 'END_TURN', playerId: 'p0' }).state;
    expect(s.card).toBeNull();
    expect(legalActions(s, 'p2').some((a) => a.type === 'TAKE_DEAL')).toBe(false);
  });

  it('lets the Free Lane take a paying deal, onto its Dividend Day', () => {
    const s = edit(drawn(1000), (c) => {
      c.players.p2.track = 'fast';
      c.players.p2.fastIncome = 20000;
      c.players.p2.fastGoal = 70000;
    });
    const r = reduce(s, { type: 'TAKE_DEAL', playerId: 'p2' });
    const p2 = r.state.players.p2;
    expect(p2.fastIncome).toBe(20000 + cashflow);
    expect(p2.holdings).toHaveLength(0);
    expect(p2.cash).toBe(100000 - down - 1000);
    expect(r.state.players.p0.cash).toBe(1000);
  });

  it('keeps a deal that earns nothing away from the Free Lane', () => {
    const land = SMALL_DEALS.find((c) => c.kind === 'holding' && c.cashflow === 0)!;
    const s = edit(drawn(0), (c) => {
      c.card = { id: land.id, by: 'p0', used: false, fee: 0 };
      c.players.p2.track = 'fast';
      c.players.p2.fastGoal = 70000;
    });
    expect(legalActions(s, 'p2').some((a) => a.type === 'TAKE_DEAL')).toBe(false);
    expect(legalActions(s, 'p1').some((a) => a.type === 'TAKE_DEAL')).toBe(true);
  });

  it('holds End Turn only while a person elsewhere could still act', () => {
    const offered = drawn(0);
    expect(holdKey(offered)).not.toBeNull();
    // Bots answer in a second, and nobody waits on someone who has gone.
    const bots = edit(offered, (c) => { c.players.p1.isBot = true; c.players.p2.isBot = true; });
    expect(holdKey(bots)).toBeNull();
    expect(holdKey(offered, () => true)).toBeNull();
    // Not yet offered: nothing for anyone else to do.
    expect(holdKey(drawn())).toBeNull();
    // Taken: the hold lifts.
    expect(holdKey(reduce(offered, { type: 'TAKE_DEAL', playerId: 'p1' }).state)).toBeNull();
  });

  it('is offered by a bot that passes on a deal, and taken by one that wants it', () => {
    const s = edit(drawn(), (c) => {
      for (const id of c.seats) { c.players[id].isBot = true; c.players[id].botLevel = 'normal'; }
    });
    const offer = botDecide(s, 'p0');
    expect(offer?.type).toBe('OFFER_DEAL');
    const offered = reduce(s, offer!).state;
    expect(botDecide(offered, 'p1')).toEqual({ type: 'TAKE_DEAL', playerId: 'p1' });
  });
});

describe('hostile input', () => {
  it('rejects out-of-turn and malformed actions without throwing', () => {
    const s = started(21);
    const junk: unknown[] = [
      null, {}, { type: 'ROLL' }, { type: 'ROLL', playerId: 'p1' },
      { type: 'ROLL', playerId: 'p0', dice: 2 },
      { type: 'TAKE_LOAN', playerId: 'p0', amount: '1000' },
      { type: 'TAKE_LOAN', playerId: 'p0', amount: -1000 },
      { type: 'TAKE_LOAN', playerId: 'p0', amount: Number.NaN },
      { type: 'REPAY_LOAN', playerId: 'p0', amount: 1000 },
      { type: 'PAY_OFF', playerId: 'p0', debt: 'taxes' },
      { type: 'BUY_STOCK', playerId: 'p0', shares: 1.5 },
      { type: 'SELL_HOLDING', playerId: 'p0', holdingId: 'nope' },
      { type: 'BUY_DREAM', playerId: 'p0' },
      { type: 'END_TURN', playerId: 'ghost' },
      { type: 'NOT_A_THING', playerId: 'p0' },
    ];
    for (const a of junk) {
      expect(() => reduce(s, a as CFAction)).not.toThrow();
      expect(reduce(s, a as CFAction).state, JSON.stringify(a)).toBe(s);
    }
  });

  it('does not let a player sell a rival’s holding into their offer', () => {
    const offer = MARKET.find((c) => c.kind === 'offer' && c.tag === 'house')!;
    const s = edit(started(21), (c) => {
      c.players.p1.holdings.push({ id: 'h9', tag: 'house', units: 1, cost: 50000, down: 5000, mortgage: 45000, cashflow: 100 });
      c.card = { id: offer.id, by: 'p0', used: false };
      c.phase = 'turn_end';
    });
    expect(reduce(s, { type: 'SELL_HOLDING', playerId: 'p0', holdingId: 'h9' }).state).toBe(s);
    const sold = reduce(s, { type: 'SELL_HOLDING', playerId: 'p1', holdingId: 'h9' }).state;
    expect(sold.players.p1.holdings).toHaveLength(0);
  });
});

/* --------------------------- the engine contract ------------------------ */

describe('engine contract', () => {
  it('replays a seed and an action log exactly', () => {
    const a = playBots(77, 4, 3000);
    const b = playBots(77, 4, 3000);
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
  });

  it('never mutates its input, and survives a JSON round trip', () => {
    const { log } = playBots(31, 3, 600);
    let s = createCashflow(settings(31), seats(3));
    for (const a of log) {
      const before = JSON.stringify(s);
      const r1 = reduce(s, a);
      expect(JSON.stringify(s)).toBe(before);
      const r2 = reduce(JSON.parse(before) as CFState, a);
      expect(JSON.stringify(r2.state)).toBe(JSON.stringify(r1.state));
      s = r1.state;
    }
  });
});

/* -------------------------------- fuzz -------------------------------- */

function invariants(s: CFState): string | null {
  for (const id of s.seats) {
    const p = s.players[id];
    if (!Number.isInteger(p.cash) || p.cash < 0) return `${id} cash ${p.cash}`;
    if (p.bankLoan < 0 || p.bankLoan % 1000 !== 0) return `${id} loan ${p.bankLoan}`;
    if (p.children < 0 || p.children > 3) return `${id} children ${p.children}`;
    for (const l of p.stocks) if (!Number.isInteger(l.shares) || l.shares <= 0) return `${id} shares`;
    if (p.track === 'fast' && p.fastGoal <= 0) return `${id} goal`;
  }
  for (const [space, owner] of Object.entries(s.fastOwners)) {
    if (s.players[owner]?.track !== 'fast') return `fast space ${space} owned by ${owner}`;
  }
  if (s.phase !== 'game_over' && s.phase !== 'dreams' && s.players[currentId(s)].out) return 'current seat is out';
  return null;
}

describe('fuzz', () => {
  it('plays 40 random games without breaking an invariant', () => {
    for (let g = 0; g < 40; g++) {
      let s = createCashflow(settings(1000 + g), seats(2 + (g % 4), false));
      s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
      for (let step = 0; step < 1500 && s.phase !== 'game_over'; step++) {
        const all = s.seats.flatMap((id) => legalActions(s, id));
        expect(all.length, `game ${g} step ${step} ${s.phase}`).toBeGreaterThan(0);
        const a = all[Math.floor(rand(g, step) * all.length)];
        const r = reduce(s, a);
        expect(r.state.version, `game ${g}: ${JSON.stringify(a)}`).toBe(s.version + 1);
        s = r.state;
        const broken = invariants(s);
        expect(broken, `game ${g} step ${step}`).toBeNull();
      }
    }
  });
});

/* -------------------------------- bots -------------------------------- */

describe('bots', () => {
  const seeds = [3, 17, 99, 256, 4242, 8080];
  const games = seeds.map((seed) => ({ seed, ...playBots(seed, 4, 60000) }));

  it('only ever send actions the engine takes', () => {
    for (const g of games) expect(g.stuck, `seed ${g.seed}`).toBeNull();
  });

  it('finish their games', () => {
    for (const g of games) expect(g.s.phase, `seed ${g.seed} turn ${g.s.turnNumber}`).toBe('game_over');
  });

  it('get out of the Rat Race and win on the Fast Track', () => {
    const escaped = games.filter((g) => g.events.some((e) => e.type === 'ESCAPED')).length;
    const fastWins = games.filter((g) => g.s.winReason === 'dream' || g.s.winReason === 'cashflow').length;
    expect(escaped).toBe(games.length);
    expect(fastWins).toBeGreaterThanOrEqual(games.length - 1);
  });

  it('actually trade: buy deals, pass them on, and sell into the market', () => {
    const kinds = new Set(games.flatMap((g) => g.events.map((e) => e.type)));
    for (const k of ['BOUGHT_HOLDING', 'BOUGHT_STOCK', 'SOLD_HOLDING', 'PAYDAY', 'DOODAD', 'CASHFLOW_DAY', 'DEAL_OFFERED', 'DEAL_PASSED']) {
      expect(kinds, k).toContain(k);
    }
  });
});
