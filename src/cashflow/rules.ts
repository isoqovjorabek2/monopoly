import {
  DEBT_KEYS, DREAM_IDS, FAST_BOARD, FEE_STEP, LOAN_UNIT, RAT_BOARD, RENTAL_TAGS, cfCard,
} from './data';
import type {
  CFAction, CFCard, CFHolding, CFPlayer, CFState, DealCard, MarketCard,
} from './types';

/* ------------------------------------------------------------------ *
 * Pure queries. The reducer, the UI and the bots all read the numbers
 * and the legal moves from here, so there is one definition of each.
 * ------------------------------------------------------------------ */

export const currentId = (s: CFState): string => s.seats[s.seatIndex];
export const currentPlayer = (s: CFState): CFPlayer => s.players[currentId(s)];

/* ------------------------- the income statement ----------------------- */

export const dividendIncome = (p: CFPlayer): number =>
  p.stocks.reduce((n, l) => n + l.shares * l.dividend, 0);

export const holdingIncome = (p: CFPlayer): number =>
  p.holdings.reduce((n, h) => n + h.cashflow, 0);

/** Money that arrives without the player going to work. */
export const passiveIncome = (p: CFPlayer): number => dividendIncome(p) + holdingIncome(p);

/** 10% a month. Loans are whole thousands, so this is always an integer. */
export const loanPayment = (p: CFPlayer): number => Math.round(p.bankLoan / 10);

export const childExpenses = (p: CFPlayer): number => p.children * p.perChild;

export const debtPayments = (p: CFPlayer): number =>
  DEBT_KEYS.reduce((n, k) => n + p.debts[k].payment, 0);

export const totalExpenses = (p: CFPlayer): number =>
  p.taxes + p.other + debtPayments(p) + childExpenses(p) + loanPayment(p);

export const totalIncome = (p: CFPlayer): number => p.salary + passiveIncome(p);

/** The pay cheque. Negative is possible, and is how bankruptcy happens. */
export const monthlyCashflow = (p: CFPlayer): number => totalIncome(p) - totalExpenses(p);

/** The whole point of the Rat Race: passive income above every expense. */
export const canEscape = (p: CFPlayer): boolean =>
  p.track === 'rat' && !p.out && passiveIncome(p) > totalExpenses(p);

/** A dream costs 100% more for every opponent who has landed on it. */
export function dreamPrice(p: CFPlayer): number {
  if (p.dream == null) return 0;
  return (FAST_BOARD[p.dream].cost ?? 0) * (1 + p.dreamMarks);
}

/** 10% of total income in the Rat Race, of CASHFLOW Day income outside it. */
export const charityCost = (p: CFPlayer): number =>
  Math.round((p.track === 'rat' ? totalIncome(p) : p.fastIncome) * 0.1);

/**
 * The largest loan the bank will make right now. Strict lending keeps the
 * pay cheque at or above zero after the new payment - without it a player
 * can borrow their way into any deal and the Rat Race stops being one.
 */
export function maxLoan(s: CFState, p: CFPlayer): number {
  if (p.track !== 'rat' || p.out) return 0;
  // Unrestricted still needs an end, if only so a slider has one.
  if (!s.settings.strictLoans) return 1_000_000;
  const units = Math.floor(monthlyCashflow(p) / (LOAN_UNIT / 10));
  return Math.max(0, units) * LOAN_UNIT;
}

export const ownsRental = (p: CFPlayer): boolean =>
  p.holdings.some((h) => RENTAL_TAGS.includes(h.tag));

/** How far along a player is: 0..1 through the Rat Race, above 1 once out
 *  of it. Used for standings and for the turn limit. */
export function progress(s: CFState, p: CFPlayer): number {
  if (p.out) return -1;
  if (p.track === 'fast') {
    const start = p.fastGoal - s.settings.fastGoal;
    return 1 + (p.fastIncome - start) / Math.max(s.settings.fastGoal, 1);
  }
  return Math.min(0.999, passiveIncome(p) / Math.max(totalExpenses(p), 1));
}

export interface DealImpact {
  payBefore: number; payAfter: number;
  passiveBefore: number; passiveAfter: number;
  expensesBefore: number; expensesAfter: number;
  /** Passive income would beat expenses: the deal is the way out. */
  frees: boolean;
}

/** A deal's effect on a player's statement, with any loan it takes to
 *  reach it. What the deal card cannot say, because it depends on you. */
export function dealImpact(p: CFPlayer, cashflow: number, loan = 0): DealImpact {
  const passiveBefore = passiveIncome(p);
  const expensesBefore = totalExpenses(p);
  const passiveAfter = passiveBefore + cashflow;
  const expensesAfter = expensesBefore + Math.round(loan / 10);
  return {
    payBefore: monthlyCashflow(p),
    payAfter: monthlyCashflow(p) + cashflow - Math.round(loan / 10),
    passiveBefore, passiveAfter, expensesBefore, expensesAfter,
    frees: p.track === 'rat' && passiveBefore <= expensesBefore && passiveAfter > expensesAfter,
  };
}

/* --------------------------- the card on the table ---------------------- */

export type OfferCard = Extract<MarketCard, { kind: 'offer' }>;

export const tableCard = (s: CFState): CFCard | undefined =>
  (s.card ? cfCard(s.card.id) : undefined);

export const offerValue = (c: OfferCard, h: CFHolding): number =>
  (c.perUnit ? c.price * h.units : c.price);

/** What the seller walks away with: sale price less the mortgage. */
export const settlement = (c: OfferCard, h: CFHolding): number => offerValue(c, h) - h.mortgage;

/* ------------------------------- dice ---------------------------------- */

export const isBrisk = (s: CFState): boolean => s.settings.pace === 'brisk';

/** Dice in the Grind: one, or two at a brisk pace. Charity adds one more. */
const ratDice = (s: CFState): number => (isBrisk(s) ? 2 : 1);

export function diceOptions(s: CFState, p: CFPlayer): number[] {
  if (p.track === 'rat') {
    const n = ratDice(s);
    return p.charityTurns > 0 ? [n, n + 1] : [n];
  }
  return p.fastCharity ? [1, 2, 3] : [2];
}

export const defaultDice = (s: CFState, p: CFPlayer): number => (p.track === 'rat' ? ratDice(s) : 2);

/* ---------------------------- legal actions ---------------------------- *
 * The one authority. Amounts that can vary (shares, loans) appear here once
 * with a representative value; isLegal() accepts any other valid amount.
 * ---------------------------------------------------------------------- */

export function legalActions(s: CFState, pid: string): CFAction[] {
  const out: CFAction[] = [];
  const me = s.players[pid];
  if (!me || me.out) return out;
  if (s.phase === 'lobby' || s.phase === 'game_over') return out;

  if (s.phase === 'dreams') {
    if (me.dream == null) {
      for (const id of DREAM_IDS) out.push({ type: 'CHOOSE_DREAM', playerId: pid, spaceId: id });
    }
    return out;
  }

  const isCurrent = currentId(s) === pid;
  const card = tableCard(s);

  /* --- a card on the table: anyone holding the asset may sell into it --- */
  if (card && me.track === 'rat') {
    if (card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'stock') {
      const lot = me.stocks.find((l) => l.symbol === card.symbol);
      if (lot && lot.shares > 0) out.push({ type: 'SELL_STOCK', playerId: pid, shares: lot.shares });
      // Only the player who drew it may buy.
      if (isCurrent && s.card?.by === pid) {
        const n = Math.floor(me.cash / card.price);
        if (n > 0) out.push({ type: 'BUY_STOCK', playerId: pid, shares: n });
      }
    }
    if (card.deck === 'market' && card.kind === 'offer') {
      for (const h of me.holdings) {
        if (h.tag === card.tag && me.cash + settlement(card, h) >= 0) {
          out.push({ type: 'SELL_HOLDING', playerId: pid, holdingId: h.id });
        }
      }
    }
    if (card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'holding'
      && s.card && !s.card.used) {
      const mine = isCurrent && s.card.by === pid;
      if (mine && me.cash >= card.down) out.push({ type: 'BUY_DEAL', playerId: pid });
      if (mine && s.card.fee === undefined && hasTaker(s, pid, card)) {
        out.push({ type: 'OFFER_DEAL', playerId: pid, fee: 0 });
      }
    }
  }

  /* --- a deal passed across the table: open to the Grind and the Free Lane --- */
  if (card && s.card && canTake(s, me, card)) out.push({ type: 'TAKE_DEAL', playerId: pid });

  if (!isCurrent) return out;

  switch (s.phase) {
    case 'roll':
      for (const n of diceOptions(s, me)) out.push({ type: 'ROLL', playerId: pid, dice: n });
      pushMoneyActions(s, me, out);
      break;

    case 'choose_deal':
      out.push({ type: 'DRAW_DEAL', playerId: pid, deck: 'small' });
      out.push({ type: 'DRAW_DEAL', playerId: pid, deck: 'big' });
      pushMoneyActions(s, me, out);
      break;

    case 'turn_end':
      pushLandingActions(s, me, out);
      out.push({ type: 'END_TURN', playerId: pid });
      pushMoneyActions(s, me, out);
      break;

    default:
      break;
  }
  return out;
}

/** Who an offered deal could go to: anyone else still in the Grind, and
 *  anyone on the Free Lane - for whom it only makes sense if it pays, since
 *  its monthly cash flow is added to their Dividend Day income. */
const couldTake = (p: CFPlayer, c: CFCard): boolean =>
  !p.out && c.deck !== 'market' && c.deck !== 'doodad' && c.kind === 'holding'
  && (p.track === 'rat' || c.cashflow > 0);

const hasTaker = (s: CFState, pid: string, c: CFCard): boolean =>
  s.seats.some((id) => id !== pid && couldTake(s.players[id], c));

/** An offered deal this player may take right now, cash in hand. */
function canTake(s: CFState, me: CFPlayer, c: CFCard): boolean {
  if (!s.card || s.card.used || s.card.fee === undefined || s.card.by === me.id) return false;
  if (c.deck === 'market' || c.deck === 'doodad' || c.kind !== 'holding') return false;
  return couldTake(me, c) && me.cash >= c.down + s.card.fee;
}

export type HoldingCard = Extract<DealCard, { kind: 'holding' }>;

/** The deal on the table, when it is real estate or a business. */
export function holdingCard(s: CFState): HoldingCard | null {
  const c = tableCard(s);
  return c && c.deck !== 'market' && c.deck !== 'doodad' && c.kind === 'holding' ? c : null;
}

/** The largest finder's fee the drawer may ask: the deal's down payment. */
export const maxFee = (c: HoldingCard): number => Math.floor(c.down / FEE_STEP) * FEE_STEP;

/** Decisions that stay open until the turn is ended. */
function pushLandingActions(s: CFState, me: CFPlayer, out: CFAction[]): void {
  const at = s.landed;
  if (!at || s.decided) return;
  const pid = me.id;

  if (at.track === 'rat' && me.track === 'rat') {
    if (RAT_BOARD[at.space].kind === 'charity' && me.cash >= charityCost(me)) {
      out.push({ type: 'DONATE', playerId: pid });
    }
    return;
  }
  if (at.track !== 'fast' || me.track !== 'fast') return;

  const sp = FAST_BOARD[at.space];
  const taken = s.fastOwners[sp.id] !== undefined;
  const cost = sp.cost ?? 0;
  switch (sp.kind) {
    case 'business':
      if (!taken && me.cash >= cost) out.push({ type: 'BUY_BUSINESS', playerId: pid });
      break;
    case 'venture':
      if (!taken && me.cash >= cost) out.push({ type: 'TRY_VENTURE', playerId: pid });
      break;
    case 'dream':
      if (me.dream === sp.id && me.cash >= dreamPrice(me)) out.push({ type: 'BUY_DREAM', playerId: pid });
      break;
    case 'charity':
      if (!me.fastCharity && me.cash >= charityCost(me)) out.push({ type: 'DONATE', playerId: pid });
      break;
    default:
      break;
  }
}

/** Borrowing and paying down, on your own turn in the Rat Race. */
function pushMoneyActions(s: CFState, me: CFPlayer, out: CFAction[]): void {
  if (me.track !== 'rat') return;
  const pid = me.id;
  if (maxLoan(s, me) >= LOAN_UNIT) out.push({ type: 'TAKE_LOAN', playerId: pid, amount: LOAN_UNIT });
  if (me.bankLoan >= LOAN_UNIT && me.cash >= LOAN_UNIT) {
    out.push({ type: 'REPAY_LOAN', playerId: pid, amount: LOAN_UNIT });
  }
  for (const k of DEBT_KEYS) {
    const d = me.debts[k];
    if (d.balance > 0 && me.cash >= d.balance) out.push({ type: 'PAY_OFF', playerId: pid, debt: k });
  }
}

const isWholeThousand = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n % LOAN_UNIT === 0;

/**
 * Cheap validation of hostile input. A guest's intent arrives as parsed
 * JSON and is trusted for nothing: not its shape, not its numbers.
 */
export function isLegal(s: CFState, a: CFAction): boolean {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || typeof a.playerId !== 'string') return false;
  if (a.type === 'START_GAME') return s.phase === 'lobby' && s.seats.includes(a.playerId);

  const me = s.players[a.playerId];
  if (!me || me.out) return false;
  const same = legalActions(s, a.playerId).filter((x) => x.type === a.type);
  if (same.length === 0) return false;

  switch (a.type) {
    case 'CHOOSE_DREAM':
      return same.some((x) => x.type === 'CHOOSE_DREAM' && x.spaceId === a.spaceId);
    case 'ROLL': {
      const n = a.dice ?? defaultDice(s, me);
      return same.some((x) => x.type === 'ROLL' && x.dice === n);
    }
    case 'DRAW_DEAL':
      return same.some((x) => x.type === 'DRAW_DEAL' && x.deck === a.deck);
    case 'BUY_STOCK': {
      const card = tableCard(s);
      if (!card || card.deck === 'market' || card.deck === 'doodad' || card.kind !== 'stock') return false;
      return Number.isInteger(a.shares) && a.shares > 0 && a.shares * card.price <= me.cash;
    }
    case 'SELL_STOCK': {
      const card = tableCard(s);
      if (!card || card.deck === 'market' || card.deck === 'doodad' || card.kind !== 'stock') return false;
      const lot = me.stocks.find((l) => l.symbol === card.symbol);
      return Number.isInteger(a.shares) && a.shares > 0 && !!lot && a.shares <= lot.shares;
    }
    case 'OFFER_DEAL': {
      const c = holdingCard(s);
      return !!c && Number.isInteger(a.fee) && a.fee >= 0 && a.fee % FEE_STEP === 0 && a.fee <= maxFee(c);
    }
    case 'SELL_HOLDING':
      return same.some((x) => x.type === 'SELL_HOLDING' && x.holdingId === a.holdingId);
    case 'TAKE_LOAN':
      return isWholeThousand(a.amount) && a.amount <= maxLoan(s, me);
    case 'REPAY_LOAN':
      return isWholeThousand(a.amount) && a.amount <= me.bankLoan && a.amount <= me.cash;
    case 'PAY_OFF':
      return same.some((x) => x.type === 'PAY_OFF' && x.debt === a.debt);
    default:
      return true;
  }
}

/* ------------------------------ the clock ------------------------------ */

/** Who the table is waiting on right now - the only players a timer or a
 *  dropped connection can hold the game up for. Selling into someone
 *  else's card is optional, so it never makes anyone wait. */
export function waitingOn(s: CFState): string[] {
  const live = (id: string): boolean => Boolean(s.players[id]) && !s.players[id].out;
  if (s.phase === 'dreams') return s.seats.filter((id) => live(id) && s.players[id].dream == null);
  if (s.phase === 'roll' || s.phase === 'choose_deal' || s.phase === 'turn_end') {
    const id = currentId(s);
    return live(id) ? [id] : [];
  }
  return [];
}

/**
 * The choice made for a player who ran out of time or left the table: the
 * least committal legal move. It never buys, borrows, sells or donates -
 * it picks a dream, rolls the usual dice, takes a small deal, ends the turn.
 */
export function autopilotAction(s: CFState, pid: string): CFAction | null {
  const me = s.players[pid];
  if (!me) return null;
  const legal = legalActions(s, pid);
  switch (s.phase) {
    case 'dreams':
      return legal.find((a) => a.type === 'CHOOSE_DREAM') ?? null;
    case 'roll':
      return legal.find((a) => a.type === 'ROLL' && a.dice === defaultDice(s, me))
        ?? legal.find((a) => a.type === 'ROLL') ?? null;
    case 'choose_deal':
      return legal.find((a) => a.type === 'DRAW_DEAL' && a.deck === 'small') ?? null;
    case 'turn_end':
      return legal.find((a) => a.type === 'END_TURN') ?? null;
    default:
      return null;
  }
}

/**
 * What End Turn is being held for, if anything: a card on the table that a
 * person at another seat - not a bot, which answers in a second, and not a
 * dropped connection, which cannot answer - could still act on. The key
 * changes with the card and with an offer, so each restarts the hold; it
 * goes null the moment nobody is left who could act, which lifts it early.
 */
export function holdKey(s: CFState, away: (id: string) => boolean = () => false): string | null {
  if (s.phase !== 'turn_end' || !s.card) return null;
  const cur = currentId(s);
  const card = s.card;
  const someone = s.seats.some((id) => {
    const p = s.players[id];
    if (id === cur || p.out || p.isBot || !p.connected || away(id)) return false;
    return legalActions(s, id).some((a) => a.type === 'SELL_STOCK' || a.type === 'SELL_HOLDING' || a.type === 'TAKE_DEAL');
  });
  return someone ? `${s.turnNumber}|${card.id}|${card.fee ?? '-'}` : null;
}

/** What the clock is timing. The host's timeout and every player's
 *  on-screen countdown restart together whenever this changes. */
export const clockKey = (s: CFState): string => `${s.phase}|${s.turnNumber}|${s.seatIndex}`;

/** Seconds on the clock for the decision in front of the table. 0 = none. */
export const clockSeconds = (s: CFState): number => s.settings.turnTimer ?? 0;
