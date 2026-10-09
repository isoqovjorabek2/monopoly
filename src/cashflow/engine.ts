import { randInt, shuffle } from '../game/rng';
import type { SeatSpec } from '../game/engine';
import {
  BRISK_PAY, BUYOUT_MULTIPLE, DEBT_KEYS, DECK_CARDS, DIVORCE_CUT, ECONOMY, ECONOMY_SPAN, FAST_BOARD,
  FAST_SIZE, LOAN_UNIT, MAX_CHILDREN, PROFESSIONS, RAT_BOARD, RAT_SIZE, UPKEEP_SHARE, cfCard,
  professionById,
} from './data';
import {
  autopilotAction, canEscape, charityCost, currentId, currentPlayer, dayIncome, defaultDice, dreamPrice,
  economyOf, holdingCard, isBrisk, isLegal, modeOf, monthlyCashflow, ownsRental, passiveIncome, progress,
  rivalOwner, settlement, spaceCost, stockQuote, tableCard, takeoverPrice, tollOf, totalExpenses,
  upkeepOf, waitingOn, type HoldingCard,
} from './rules';
import type {
  CFAction, CFDeck, CFEconomy, CFEvent, CFPlayer, CFReduction, CFSettings, CFState, DebtKey,
} from './types';

/* ------------------------------------------------------------------ *
 * The reducer. Pure: no Date.now(), no Math.random(), no mutation of
 * the argument. reduce(state, action) -> { state, events }.
 * ------------------------------------------------------------------ */

export const CF_DEFAULTS: Omit<CFSettings, 'seed'> = {
  maxPlayers: 6,
  botLevel: 'normal',
  fillWithBots: false,
  strictLoans: true,
  turnLimit: 0,
  fastGoal: 50000,
  turnTimer: 0,
  pace: 'classic',
  mode: 'classic',
};

export function createCashflow(settings: CFSettings, seats: SeatSpec[]): CFState {
  // Professions are dealt, not chosen - the table lives with what it gets.
  const deal = shuffle(PROFESSIONS.map((p) => p.id), settings.seed, 3000);

  const players: Record<string, CFPlayer> = {};
  seats.forEach((seat, i) => {
    const prof = professionById(deal[i % deal.length]);
    const p: CFPlayer = {
      id: seat.id,
      name: seat.name,
      token: seat.token,
      color: seat.color,
      isBot: seat.isBot,
      botLevel: seat.botLevel ?? settings.botLevel,
      connected: true,
      profession: prof.id,
      cash: 0,
      salary: prof.salary,
      taxes: prof.taxes,
      other: prof.other,
      perChild: prof.perChild,
      children: 0,
      debts: JSON.parse(JSON.stringify(prof.debts)) as CFPlayer['debts'],
      bankLoan: 0,
      stocks: [],
      holdings: [],
      track: 'rat',
      position: 0,
      charityTurns: 0,
      skipTurns: 0,
      out: false,
      fastIncome: 0,
      fastGoal: 0,
      dream: null,
      dreamMarks: 0,
      fastCharity: false,
      upkeep: 0,
    };
    // The bank opens with savings plus one pay cheque.
    p.cash = prof.savings + monthlyCashflow(p);
    players[seat.id] = p;
  });

  const deck = (d: CFDeck, at: number) => shuffle(DECK_CARDS[d].map((c) => c.id), settings.seed, at);

  return {
    kind: 'cashflow',
    version: 0,
    phase: 'lobby',
    settings,
    players,
    seats: seats.map((s) => s.id),
    seatIndex: 0,
    rngCursor: 0,
    decks: { small: deck('small', 4000), big: deck('big', 5000), market: deck('market', 6000), doodad: deck('doodad', 7000) },
    cursors: { small: 0, big: 0, market: 0, doodad: 0 },
    card: null,
    dice: null,
    landed: null,
    decided: false,
    fastOwners: {},
    turnNumber: 0,
    round: 0,
    history: [],
    winnerId: null,
    winReason: null,
    nextId: 1,
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function reduce(prev: CFState, action: CFAction): CFReduction {
  const events: CFEvent[] = [];
  if (prev.phase === 'game_over') return { state: prev, events };
  if (action?.type === 'TIME_OUT') return timeOut(prev, action.playerId);
  if (!isLegal(prev, action)) return { state: prev, events };

  const s = clone(prev);
  s.version = prev.version + 1;
  const me = s.players[action.playerId];

  switch (action.type) {
    case 'START_GAME':
      s.phase = 'dreams';
      events.push({ type: 'GAME_STARTED' }, { type: 'DREAMS_OPEN' });
      break;
    case 'CHOOSE_DREAM': chooseDream(s, events, me, action.spaceId); break;
    case 'ROLL': doRoll(s, events, me, action.dice); break;
    case 'DRAW_DEAL': drawDeal(s, events, me, action.deck); break;
    case 'BUY_STOCK': buyStock(s, events, me, action.shares); break;
    case 'SELL_STOCK': sellStock(s, events, me, action.shares); break;
    case 'BUY_DEAL': buyDeal(s, events, me); break;
    case 'OFFER_DEAL': offerDeal(s, events, me, action.fee); break;
    case 'TAKE_DEAL': takeDeal(s, events, me); break;
    case 'SELL_HOLDING': sellHolding(s, events, me, action.holdingId); break;
    case 'DONATE': donate(s, events, me); break;
    case 'TAKE_LOAN': borrow(events, me, action.amount, false); break;
    case 'REPAY_LOAN': repay(events, me, action.amount); break;
    case 'PAY_OFF': payOff(events, me, action.debt); break;
    case 'BUY_BUSINESS': buyBusiness(s, events, me); break;
    case 'TRY_VENTURE': tryVenture(s, events, me); break;
    case 'BUY_DREAM': buyDream(s, events, me); break;
    case 'TAKEOVER': takeover(s, events, me); break;
    case 'END_TURN': endTurn(s, events); break;
  }

  checkWin(s, events);
  return { state: s, events };
}

/* ------------------------------- flow ------------------------------ */

function chooseDream(s: CFState, events: CFEvent[], me: CFPlayer, spaceId: number): void {
  me.dream = spaceId;
  events.push({ type: 'DREAM_CHOSEN', playerId: me.id, spaceId });
  const waiting = s.seats.some((id) => !s.players[id].out && s.players[id].dream == null);
  if (waiting) return;
  s.turnNumber = 1;
  s.seatIndex = 0;
  s.round = 1;
  if (modeOf(s) === 'boom') s.economy = { phase: 'steady', until: 1 + ECONOMY_SPAN[0] };
  recordHistory(s);
  beginTurn(s, events);
}

function advanceSeat(s: CFState): void {
  s.seatIndex = (s.seatIndex + 1) % s.seats.length;
  // Back at the first seat is a new round - the unit a turn limit counts in.
  if (s.seatIndex === 0) {
    s.round += 1;
    recordHistory(s);
  }
}

const limitReached = (s: CFState): boolean =>
  s.settings.turnLimit > 0 && s.round > s.settings.turnLimit;

/** One point on the closing chart. A second point for the same round (the
 *  game ending part-way through one) replaces the first. */
function recordHistory(s: CFState): void {
  const progressNow: Record<string, number> = {};
  for (const id of s.seats) progressNow[id] = Math.round(progress(s, s.players[id]) * 1000) / 1000;
  const last = s.history[s.history.length - 1];
  if (last && last.round === s.round) s.history.pop();
  s.history.push({ round: s.round, progress: progressNow });
}

/**
 * A player whose clock ran out, or who has left the table, has their
 * pending decision made for them - the least committal legal move - until
 * the table stops waiting on them. The host says when; the engine decides
 * what that means, so every client logs the same thing.
 */
function timeOut(prev: CFState, pid: string): CFReduction {
  if (!waitingOn(prev).includes(pid)) return { state: prev, events: [] };
  let state = prev;
  const events: CFEvent[] = [{ type: 'TIMED_OUT', playerId: pid }];
  for (let guard = 0; guard < 20 && waitingOn(state).includes(pid); guard++) {
    const a = autopilotAction(state, pid);
    if (!a) break;
    const r = reduce(state, a);
    if (r.state.version === state.version) break;
    state = r.state;
    events.push(...r.events);
  }
  if (state === prev) return { state: prev, events: [] };
  return { state, events };
}

/** Settle whose turn it is, skipping anyone out or sitting turns out, and
 *  lift a player onto the Fast Track the moment they qualify. */
function beginTurn(s: CFState, events: CFEvent[]): void {
  s.card = null;
  s.dice = null;
  s.landed = null;
  s.decided = false;

  if (s.seats.every((id) => s.players[id].out)) return;
  turnEconomy(s, events);

  // Every pass either finds a player who can move or takes one skipped
  // turn off somebody, so this always ends; the guard is belt and braces.
  for (let guard = 0; guard < s.seats.length * 8; guard++) {
    // Past the turn limit nobody starts another turn; checkWin ends the game.
    if (limitReached(s)) return;
    const p = currentPlayer(s);
    if (p.out) { advanceSeat(s); continue; }
    if (p.skipTurns > 0) {
      p.skipTurns -= 1;
      events.push({ type: 'TURN_SKIPPED', playerId: p.id, left: p.skipTurns });
      advanceSeat(s);
      s.turnNumber += 1;
      continue;
    }
    break;
  }

  const p = currentPlayer(s);
  if (canEscape(p)) escape(s, events, p);
  s.phase = 'roll';
  events.push({ type: 'TURN_STARTED', playerId: p.id, turnNumber: s.turnNumber });
}

function endTurn(s: CFState, events: CFEvent[]): void {
  advanceSeat(s);
  s.turnNumber += 1;
  beginTurn(s, events);
}

/** Out of the Rat Race: a hundred times passive income, every CASHFLOW Day -
 *  and, outside classic, a share of a hundred times the expenses as upkeep. */
function escape(s: CFState, events: CFEvent[], p: CFPlayer): void {
  const income = passiveIncome(p) * BUYOUT_MULTIPLE;
  p.track = 'fast';
  p.position = 0;
  p.fastIncome = income;
  p.fastGoal = income + s.settings.fastGoal;
  p.upkeep = Math.round(totalExpenses(p) * BUYOUT_MULTIPLE * UPKEEP_SHARE[modeOf(s)]);
  p.charityTurns = 0;
  // The buyout is paid on the way out, before the first Fast Track roll.
  p.cash += income;
  events.push({ type: 'ESCAPED', playerId: p.id, income });
}

/** Boom & Bust: at the start of the round it is due, the economy turns to
 *  one of the other two phases and holds for a few rounds. */
function turnEconomy(s: CFState, events: CFEvent[]): void {
  if (modeOf(s) !== 'boom' || !s.economy || s.round < s.economy.until) return;
  const now = s.economy.phase;
  const others = (['boom', 'steady', 'bust'] as CFEconomy[]).filter((e) => e !== now);
  const phase = others[randInt(s.settings.seed, s.rngCursor, 0, others.length - 1)];
  const rounds = randInt(s.settings.seed, s.rngCursor + 1, ECONOMY_SPAN[0], ECONOMY_SPAN[1]);
  s.rngCursor += 2;
  s.economy = { phase, until: s.round + rounds };
  events.push({ type: 'ECONOMY', phase, rounds });
}

/**
 * A Free Lane bill that could not be paid. Every Free Lane business goes,
 * and creditors take the best-earning Grind assets until passive income no
 * longer beats expenses - so the way back out has to be earned again.
 */
function fall(s: CFState, events: CFEvent[], me: CFPlayer): void {
  for (const [space, owner] of Object.entries(s.fastOwners)) {
    if (owner === me.id) delete s.fastOwners[Number(space)];
  }
  let seized = 0;
  for (const h of [...me.holdings].sort((a, b) => b.cashflow - a.cashflow)) {
    if (passiveIncome(me) <= totalExpenses(me) || h.cashflow <= 0) break;
    me.holdings = me.holdings.filter((x) => x.id !== h.id);
    seized += 1;
  }
  for (const l of [...me.stocks].sort((a, b) => b.shares * b.dividend - a.shares * a.dividend)) {
    if (passiveIncome(me) <= totalExpenses(me) || l.dividend <= 0) break;
    me.stocks = me.stocks.filter((x) => x.symbol !== l.symbol);
    seized += 1;
  }
  me.track = 'rat';
  me.position = 0;
  me.fastIncome = 0;
  me.fastGoal = 0;
  me.upkeep = 0;
  me.fastCharity = false;
  me.charityTurns = 0;
  s.landed = null;
  s.phase = 'turn_end';
  events.push({ type: 'FELL', playerId: me.id, seized });
}

/** A Free Lane bill: paid in full, or with everything left and a fall.
 *  Whatever was paid goes to `to`, when somebody is owed it. */
function payFast(s: CFState, events: CFEvent[], me: CFPlayer, amount: number, to?: CFPlayer): boolean {
  const paid = Math.min(me.cash, amount);
  me.cash -= paid;
  if (to) to.cash += paid;
  if (paid >= amount) return true;
  fall(s, events, me);
  return false;
}

/* ----------------------------- movement ---------------------------- */

function doRoll(s: CFState, events: CFEvent[], me: CFPlayer, requested: number | undefined): void {
  const n = requested ?? defaultDice(s, me);
  const dice: number[] = [];
  for (let i = 0; i < n; i++) dice.push(randInt(s.settings.seed, s.rngCursor + i, 1, 6));
  s.rngCursor += n;
  s.dice = dice;
  events.push({ type: 'ROLLED', playerId: me.id, dice });
  if (me.track === 'rat' && me.charityTurns > 0) me.charityTurns -= 1;

  const steps = dice.reduce((a, b) => a + b, 0);
  if (me.track === 'rat') moveRat(s, events, me, steps);
  else moveFast(s, events, me, steps);
}

function moveRat(s: CFState, events: CFEvent[], me: CFPlayer, steps: number): void {
  const from = me.position;
  const to = (from + steps) % RAT_SIZE;
  me.position = to;
  events.push({ type: 'MOVED', playerId: me.id, track: 'rat', from, to, steps });

  // Pay Check is collected for passing as well as landing.
  for (let i = 1; i <= steps; i++) {
    if (RAT_BOARD[(from + i) % RAT_SIZE].kind === 'payday') payday(s, events, me);
    if (me.out) break;
  }
  if (me.out) { endTurn(s, events); return; }

  s.landed = { track: 'rat', space: to };
  s.phase = 'turn_end';

  switch (RAT_BOARD[to].kind) {
    case 'opportunity':
      s.phase = 'choose_deal';
      return;
    case 'market':
      drawMarket(s, events, me);
      return;
    case 'doodad':
      drawDoodad(s, events, me);
      return;
    case 'baby':
      if (me.children < MAX_CHILDREN) {
        me.children += 1;
        events.push({ type: 'BABY', playerId: me.id, children: me.children });
      }
      return;
    case 'downsized': {
      const amount = totalExpenses(me);
      charge(events, me, amount);
      me.skipTurns = 2;
      me.charityTurns = 0;
      events.push({ type: 'DOWNSIZED', playerId: me.id, amount });
      return;
    }
    default:
      return;
  }
}

function moveFast(s: CFState, events: CFEvent[], me: CFPlayer, steps: number): void {
  const from = me.position;
  const to = (from + steps) % FAST_SIZE;
  me.position = to;
  events.push({ type: 'MOVED', playerId: me.id, track: 'fast', from, to, steps });

  for (let i = 1; i <= steps; i++) {
    if (FAST_BOARD[(from + i) % FAST_SIZE].kind === 'cashflowDay') {
      const amount = dayIncome(s, me);
      const upkeep = upkeepOf(me);
      me.cash += amount;
      events.push({ type: 'CASHFLOW_DAY', playerId: me.id, amount, ...(upkeep > 0 ? { upkeep } : {}) });
      if (!payFast(s, events, me, upkeep)) return;
    }
  }

  s.landed = { track: 'fast', space: to };
  s.phase = 'turn_end';
  const sp = FAST_BOARD[to];

  switch (sp.kind) {
    case 'business': {
      const owner = rivalOwner(s, me, to);
      if (!owner) return;
      events.push({ type: 'TOLL', playerId: me.id, owner: owner.id, spaceId: to, amount: Math.min(tollOf(sp), me.cash) });
      payFast(s, events, me, tollOf(sp), owner);
      return;
    }
    case 'dream':
      // Landing on somebody else's dream makes it dearer for them.
      for (const id of s.seats) {
        const q = s.players[id];
        if (q.id !== me.id && !q.out && q.dream === to) {
          q.dreamMarks += 1;
          events.push({ type: 'DREAM_MARKED', playerId: me.id, owner: q.id, spaceId: to });
        }
      }
      return;
    case 'audit':
    case 'lawsuit': {
      // Lifestyle: a lawsuit goes after a business first, cash only if none.
      if (sp.kind === 'lawsuit' && modeOf(s) === 'lifestyle' && loseBusiness(s, events, me)) return;
      const amount = Math.floor(me.cash / 2);
      me.cash -= amount;
      events.push({ type: 'LOSS', playerId: me.id, kind: sp.kind, amount });
      return;
    }
    case 'divorce': {
      const amount = me.cash;
      me.cash = 0;
      events.push({ type: 'LOSS', playerId: me.id, kind: 'divorce', amount });
      if (modeOf(s) === 'lifestyle') {
        const cut = Math.round((me.fastIncome * DIVORCE_CUT) / 100) * 100;
        me.fastIncome -= cut;
        events.push({ type: 'INCOME_CUT', playerId: me.id, amount: cut });
      }
      return;
    }
    default:
      return;
  }
}

/** Lifestyle: a lawsuit takes the business that earns the most. */
function loseBusiness(s: CFState, events: CFEvent[], me: CFPlayer): boolean {
  const best = Object.entries(s.fastOwners)
    .filter(([space, owner]) => owner === me.id && FAST_BOARD[Number(space)].kind === 'business')
    .map(([space]) => FAST_BOARD[Number(space)])
    .sort((a, b) => (b.cashflow ?? 0) - (a.cashflow ?? 0))[0];
  if (!best) return false;
  delete s.fastOwners[best.id];
  me.fastIncome -= best.cashflow ?? 0;
  events.push({ type: 'BUSINESS_LOST', playerId: me.id, spaceId: best.id, cashflow: best.cashflow ?? 0 });
  return true;
}

/* ------------------------------- money ------------------------------ */

function payday(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const month = monthlyCashflow(me);
  // A brisk game pays a good month twice over; a bad one is charged once.
  const cf = month > 0 && isBrisk(s) ? month * BRISK_PAY : month;
  if (cf >= 0 || me.cash >= -cf) {
    me.cash += cf;
    events.push({ type: 'PAYDAY', playerId: me.id, amount: cf });
    return;
  }
  bankrupt(s, events, me);
}

/** A bill that has to be paid. Short of cash, the bank lends the rest in
 *  whole thousands - a doodad is never optional. */
function charge(events: CFEvent[], me: CFPlayer, amount: number): void {
  if (amount <= 0) return;
  if (me.cash < amount) {
    const loan = Math.ceil((amount - me.cash) / LOAN_UNIT) * LOAN_UNIT;
    borrow(events, me, loan, true);
  }
  me.cash -= amount;
}

function borrow(events: CFEvent[], me: CFPlayer, amount: number, forced: boolean): void {
  me.bankLoan += amount;
  me.cash += amount;
  events.push({ type: 'LOAN', playerId: me.id, amount, forced });
}

function repay(events: CFEvent[], me: CFPlayer, amount: number): void {
  me.bankLoan -= amount;
  me.cash -= amount;
  events.push({ type: 'REPAID', playerId: me.id, amount });
}

function payOff(events: CFEvent[], me: CFPlayer, debt: DebtKey): void {
  const amount = me.debts[debt].balance;
  me.cash -= amount;
  me.debts[debt] = { balance: 0, payment: 0 };
  events.push({ type: 'PAID_OFF', playerId: me.id, debt, amount });
}

/**
 * A pay cheque that cannot be met. The printed procedure, made
 * deterministic so it can run without anyone choosing:
 *
 *  1. Sell every asset that earns nothing, for half what went into it.
 *  2. Put the cash into the debts that cost the most per dollar owed -
 *     the bank loan at 10% a month first - until the pay cheque is positive.
 *  3. Still short: half of the car, card and retail debt is written off.
 *  4. Still short: out of the game. Otherwise, sit out three turns.
 *
 * The missed pay cheque itself is written off either way.
 */
function bankrupt(_s: CFState, events: CFEvent[], me: CFPlayer): void {
  const keepHoldings = [];
  for (const h of me.holdings) {
    if (h.cashflow <= 0) me.cash += Math.floor(h.down / 2);
    else keepHoldings.push(h);
  }
  me.holdings = keepHoldings;
  const keepStocks = [];
  for (const l of me.stocks) {
    if (l.dividend <= 0) me.cash += Math.floor((l.shares * l.cost) / 2);
    else keepStocks.push(l);
  }
  me.stocks = keepStocks;

  while (monthlyCashflow(me) < 0 && me.bankLoan >= LOAN_UNIT && me.cash >= LOAN_UNIT) {
    me.bankLoan -= LOAN_UNIT;
    me.cash -= LOAN_UNIT;
  }
  const byCost = [...DEBT_KEYS]
    .filter((k) => me.debts[k].balance > 0)
    .sort((a, b) => me.debts[b].payment / me.debts[b].balance - me.debts[a].payment / me.debts[a].balance);
  for (const k of byCost) {
    if (monthlyCashflow(me) >= 0) break;
    if (me.cash >= me.debts[k].balance) {
      me.cash -= me.debts[k].balance;
      me.debts[k] = { balance: 0, payment: 0 };
    }
  }
  if (monthlyCashflow(me) < 0) {
    for (const k of ['car', 'card', 'retail'] as const) {
      me.debts[k] = {
        balance: Math.floor(me.debts[k].balance / 2),
        payment: Math.floor(me.debts[k].payment / 2),
      };
    }
  }

  const out = monthlyCashflow(me) < 0;
  if (out) {
    me.out = true;
    me.stocks = [];
    me.holdings = [];
  } else {
    me.skipTurns = 3;
  }
  me.charityTurns = 0;
  events.push({ type: 'BANKRUPT', playerId: me.id, out });
}

/* -------------------------------- cards ------------------------------ */

function draw(s: CFState, deck: CFDeck): string | null {
  const order = s.decks[deck];
  if (order.length === 0) return null;
  const id = order[s.cursors[deck] % order.length];
  s.cursors[deck] += 1;
  return id;
}

function drawDeal(s: CFState, events: CFEvent[], me: CFPlayer, deck: 'small' | 'big'): void {
  const id = draw(s, deck);
  s.phase = 'turn_end';
  if (!id) return;
  const card = cfCard(id);
  s.card = { id, by: me.id, used: false };
  if (card && card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'stock') {
    s.card.price = stockQuote(card, s.settings.seed, s.rngCursor, ECONOMY[economyOf(s)].shares);
    s.rngCursor += 1;
  }
  events.push({ type: 'CARD', playerId: me.id, cardId: id, price: s.card.price });

  if (card && card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'split') {
    // A split happens to everyone who holds the stock, the moment it is read.
    for (const pid of s.seats) {
      const p = s.players[pid];
      p.stocks = p.stocks
        .map((l) => (l.symbol !== card.symbol ? l : card.factor === 2
          ? { ...l, shares: l.shares * 2, cost: l.cost / 2 }
          : { ...l, shares: Math.floor(l.shares / 2), cost: l.cost * 2 }))
        .filter((l) => l.shares > 0);
    }
    events.push({ type: 'SPLIT', symbol: card.symbol, factor: card.factor });
  }
}

function drawMarket(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const id = draw(s, 'market');
  if (!id) return;
  const card = cfCard(id);
  s.card = { id, by: me.id, used: false };
  // A boom brings buyers who pay more; a bust, buyers who pay less.
  const factor = ECONOMY[economyOf(s)].market;
  if (card && card.deck === 'market' && card.kind === 'offer' && factor !== 1) {
    const moved = card.price * factor;
    s.card.price = moved >= 1000 ? Math.round(moved / 100) * 100 : Math.round(moved);
  }
  events.push({ type: 'CARD', playerId: me.id, cardId: id, price: s.card.price });
  if (!card || card.deck !== 'market') return;

  switch (card.kind) {
    case 'offer':
      // Nothing happens until somebody sells into it.
      return;
    case 'boost': {
      let count = 0;
      for (const pid of s.seats) {
        for (const h of s.players[pid].holdings) {
          if (h.tag === card.tag) { h.cashflow += card.delta; count += 1; }
        }
      }
      events.push({ type: 'BOOST', tag: card.tag, delta: card.delta, count });
      return;
    }
    case 'repair':
      if (ownsRental(me)) {
        charge(events, me, card.cost);
        events.push({ type: 'REPAIR', playerId: me.id, cost: card.cost });
      }
      return;
    case 'foreclose':
      for (const pid of s.seats) {
        const p = s.players[pid];
        const lost = p.holdings.filter((h) => h.tag === card.tag).length;
        if (lost === 0) continue;
        p.holdings = p.holdings.filter((h) => h.tag !== card.tag);
        events.push({ type: 'FORECLOSED', playerId: pid, tag: card.tag, count: lost });
      }
      return;
  }
}

function drawDoodad(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const id = draw(s, 'doodad');
  if (!id) return;
  s.card = { id, by: me.id, used: false };
  events.push({ type: 'CARD', playerId: me.id, cardId: id });
  const card = cfCard(id);
  if (!card || card.deck !== 'doodad') return;
  const amount = card.child && me.children === 0 ? 0 : card.amount;
  charge(events, me, amount);
  events.push({ type: 'DOODAD', playerId: me.id, cardId: id, amount });
}

/* ---------------------------- transactions --------------------------- */

function buyStock(s: CFState, events: CFEvent[], me: CFPlayer, shares: number): void {
  const card = tableCard(s);
  if (!card || card.deck === 'market' || card.deck === 'doodad' || card.kind !== 'stock') return;
  me.cash -= shares * card.price;
  const lot = me.stocks.find((l) => l.symbol === card.symbol);
  if (lot) {
    lot.cost = (lot.cost * lot.shares + card.price * shares) / (lot.shares + shares);
    lot.shares += shares;
  } else {
    me.stocks.push({ symbol: card.symbol, shares, cost: card.price, dividend: card.dividend });
  }
  events.push({ type: 'BOUGHT_STOCK', playerId: me.id, symbol: card.symbol, shares, price: card.price });
}

function sellStock(s: CFState, events: CFEvent[], me: CFPlayer, shares: number): void {
  const card = tableCard(s);
  if (!card || card.deck === 'market' || card.deck === 'doodad' || card.kind !== 'stock') return;
  const lot = me.stocks.find((l) => l.symbol === card.symbol);
  if (!lot) return;
  lot.shares -= shares;
  me.cash += shares * card.price;
  me.stocks = me.stocks.filter((l) => l.shares > 0);
  events.push({ type: 'SOLD_STOCK', playerId: me.id, symbol: card.symbol, shares, price: card.price });
}

function buyDeal(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const card = holdingCard(s);
  if (!card || !s.card) return;
  me.cash -= card.down;
  addHolding(s, me, card);
  s.card.used = true;
  events.push({ type: 'BOUGHT_HOLDING', playerId: me.id, tag: card.tag, down: card.down, cashflow: card.cashflow });
}

function addHolding(s: CFState, me: CFPlayer, card: HoldingCard): void {
  me.holdings.push({
    id: `h${s.nextId++}`,
    tag: card.tag,
    units: card.units,
    cost: card.cost,
    down: card.down,
    mortgage: card.cost - card.down,
    cashflow: card.cashflow,
  });
}

/**
 * A deal the drawer cannot use or does not want goes up for grabs. The
 * drawer names a finder's fee; it stays open to the rest of the Grind
 * until the drawer ends the turn - or buys it after all.
 */
function offerDeal(s: CFState, events: CFEvent[], me: CFPlayer, fee: number): void {
  const card = holdingCard(s);
  if (!card || !s.card) return;
  s.card.fee = fee;
  events.push({ type: 'DEAL_OFFERED', playerId: me.id, tag: card.tag, fee });
}

/** First to take it has it: the fee to the drawer, the down payment to the seller. */
function takeDeal(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const card = holdingCard(s);
  if (!card || !s.card || s.card.fee === undefined) return;
  const fee = s.card.fee;
  const drawer = s.players[s.card.by];
  me.cash -= card.down + fee;
  if (drawer) drawer.cash += fee;
  // On the Free Lane there is no statement to put it on: what it earns a
  // month is paid every Dividend Day instead.
  if (me.track === 'fast') me.fastIncome += card.cashflow;
  else addHolding(s, me, card);
  s.card.used = true;
  events.push({
    type: 'DEAL_PASSED', playerId: me.id, from: s.card.by, tag: card.tag, fee, down: card.down, cashflow: card.cashflow,
  });
}

function sellHolding(s: CFState, events: CFEvent[], me: CFPlayer, holdingId: string): void {
  const card = tableCard(s);
  if (!card || card.deck !== 'market' || card.kind !== 'offer') return;
  const h = me.holdings.find((x) => x.id === holdingId);
  if (!h) return;
  const price = card.perUnit ? card.price * h.units : card.price;
  const net = settlement(card, h);
  me.cash += net;
  me.holdings = me.holdings.filter((x) => x.id !== holdingId);
  events.push({ type: 'SOLD_HOLDING', playerId: me.id, tag: h.tag, price, settlement: net });
}

function donate(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const amount = charityCost(me);
  me.cash -= amount;
  if (me.track === 'rat') me.charityTurns = 3;
  else me.fastCharity = true;
  s.decided = true;
  events.push({ type: 'CHARITY', playerId: me.id, amount });
}

/* ---------------------------- the Fast Track -------------------------- */

function buyBusiness(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const sp = FAST_BOARD[me.position];
  const cost = spaceCost(s, sp);
  me.cash -= cost;
  me.fastIncome += sp.cashflow ?? 0;
  s.fastOwners[sp.id] = me.id;
  s.decided = true;
  events.push({ type: 'BUSINESS', playerId: me.id, spaceId: sp.id, cost, cashflow: sp.cashflow ?? 0 });
}

function tryVenture(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const sp = FAST_BOARD[me.position];
  me.cash -= spaceCost(s, sp);
  const roll = randInt(s.settings.seed, s.rngCursor, 1, 6);
  s.rngCursor += 1;
  const won = (sp.win ?? []).includes(roll);
  if (won) {
    // Once somebody succeeds, the opportunity is gone for everyone.
    s.fastOwners[sp.id] = me.id;
    me.cash += sp.payout ?? 0;
    me.fastIncome += sp.cfPayout ?? 0;
  }
  s.decided = true;
  events.push({ type: 'VENTURE', playerId: me.id, spaceId: sp.id, roll, won });
}

/** Sharks: the business changes hands, and what it earns goes with it. */
function takeover(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const sp = FAST_BOARD[me.position];
  const owner = rivalOwner(s, me, sp.id);
  if (!owner) return;
  const price = takeoverPrice(s, sp);
  const cashflow = sp.cashflow ?? 0;
  me.cash -= price;
  owner.cash += price;
  owner.fastIncome -= cashflow;
  me.fastIncome += cashflow;
  s.fastOwners[sp.id] = me.id;
  s.decided = true;
  events.push({ type: 'TAKEOVER', playerId: me.id, from: owner.id, spaceId: sp.id, price, cashflow });
}

function buyDream(s: CFState, events: CFEvent[], me: CFPlayer): void {
  const cost = dreamPrice(me);
  me.cash -= cost;
  s.decided = true;
  events.push({ type: 'DREAM_BOUGHT', playerId: me.id, spaceId: me.position, cost });
  finish(s, events, me.id, 'dream');
}

/* ---------------------------- win condition -------------------------- */

function finish(
  s: CFState, events: CFEvent[], winnerId: string | null, reason: NonNullable<CFState['winReason']>,
): void {
  s.winnerId = winnerId;
  s.winReason = reason;
  recordHistory(s);
  s.phase = 'game_over';
  s.card = null;
  events.push({ type: 'GAME_OVER', winnerId, reason });
}

function checkWin(s: CFState, events: CFEvent[]): void {
  if (s.phase === 'lobby' || s.phase === 'dreams' || s.phase === 'game_over') return;
  const alive = s.seats.filter((id) => !s.players[id].out);

  if (alive.length === 0) { finish(s, events, null, 'none'); return; }
  if (alive.length === 1 && s.seats.length > 1) { finish(s, events, alive[0], 'last'); return; }

  const rich = alive.find((id) => {
    const p = s.players[id];
    return p.track === 'fast' && p.fastIncome >= p.fastGoal;
  });
  if (rich) { finish(s, events, rich, 'cashflow'); return; }

  if (limitReached(s)) {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const id of alive) {
      const score = progress(s, s.players[id]);
      if (score > bestScore) { bestScore = score; best = id; }
    }
    finish(s, events, best, 'limit');
  }
}

/**
 * A signed-in player takes over a bot's seat in a game in progress. Not a
 * CFAction, for the same reason as Monopoly's: the host applies it after the
 * player's pass has checked out, and the reducer never can.
 */
export function handOverSeat(prev: CFState, playerId: string, name: string): CFReduction {
  const p = prev.players[playerId];
  if (!p || !p.isBot || prev.phase === 'game_over' || prev.phase === 'lobby') {
    return { state: prev, events: [] };
  }
  const s = clone(prev);
  s.version = prev.version + 1;
  const seat = s.players[playerId];
  seat.isBot = false;
  seat.connected = true;
  seat.name = name;
  return { state: s, events: [{ type: 'SEAT_TAKEN', playerId, name, previous: p.name }] };
}

/** The reverse of a hand-over: a removed player's seat plays on as a bot.
 *  Host-side only, like the hand-over. */
export function botifySeat(prev: CFState, playerId: string): CFReduction {
  const p = prev.players[playerId];
  if (!p || p.isBot || prev.phase === 'game_over' || prev.phase === 'lobby') {
    return { state: prev, events: [] };
  }
  const s = clone(prev);
  s.version = prev.version + 1;
  s.players[playerId].isBot = true;
  s.players[playerId].connected = false;
  return { state: s, events: [] };
}

export { currentId };
