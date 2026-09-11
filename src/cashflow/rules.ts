import {
  DEBT_KEYS, DREAM_IDS, FAST_BOARD, LOAN_UNIT, RAT_BOARD, RENTAL_TAGS, cfCard,
} from './data';
import type {
  CFAction, CFCard, CFHolding, CFPlayer, CFState, MarketCard,
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

/* --------------------------- the card on the table ---------------------- */

export type OfferCard = Extract<MarketCard, { kind: 'offer' }>;

export const tableCard = (s: CFState): CFCard | undefined =>
  (s.card ? cfCard(s.card.id) : undefined);

export const offerValue = (c: OfferCard, h: CFHolding): number =>
  (c.perUnit ? c.price * h.units : c.price);

/** What the seller walks away with: sale price less the mortgage. */
export const settlement = (c: OfferCard, h: CFHolding): number => offerValue(c, h) - h.mortgage;

/* ------------------------------- dice ---------------------------------- */

export function diceOptions(p: CFPlayer): number[] {
  if (p.track === 'rat') return p.charityTurns > 0 ? [1, 2] : [1];
  return p.fastCharity ? [1, 2, 3] : [2];
}

export const defaultDice = (p: CFPlayer): number => (p.track === 'rat' ? 1 : 2);

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
      && isCurrent && s.card?.by === pid && !s.card.used && me.cash >= card.down) {
      out.push({ type: 'BUY_DEAL', playerId: pid });
    }
  }

  if (!isCurrent) return out;

  switch (s.phase) {
    case 'roll':
      for (const n of diceOptions(me)) out.push({ type: 'ROLL', playerId: pid, dice: n });
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
      const n = a.dice ?? defaultDice(me);
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
