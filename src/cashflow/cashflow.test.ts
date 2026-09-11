import { describe, expect, it } from 'vitest';
import { rand } from '../game/rng';
import type { SeatSpec } from '../game/engine';
import { botDecide } from './ai';
import {
  BIG_DEALS, DOODADS, DREAM_IDS, FAST_BOARD, MARKET, PROFESSIONS, RAT_BOARD, SMALL_DEALS,
} from './data';
import { CF_DEFAULTS, createCashflow, reduce } from './engine';
import {
  currentId, dreamPrice, legalActions, maxLoan, monthlyCashflow, passiveIncome, totalExpenses,
} from './rules';
import type { CFAction, CFEvent, CFSettings, CFState } from './types';

const seats = (n: number, bots = true): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'topper' as const, color: '#fff', isBot: bots,
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

  it('actually trade: buy deals, and sell into the market', () => {
    const kinds = new Set(games.flatMap((g) => g.events.map((e) => e.type)));
    for (const k of ['BOUGHT_HOLDING', 'BOUGHT_STOCK', 'SOLD_HOLDING', 'PAYDAY', 'DOODAD', 'CASHFLOW_DAY']) {
      expect(kinds, k).toContain(k);
    }
  });
});
