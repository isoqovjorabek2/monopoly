import type { BotLevel, TokenId } from '../game/types';

/* ------------------------------------------------------------------ *
 * Cashflow: the second game at the table.
 *
 * Same contract as the Monopoly engine next door: everything here is
 * plain JSON, the reducer is pure, dice come from a seeded counter kept
 * in the state, and legalActions() is the only definition of what may
 * happen next. The network layer round-trips this through JSON on every
 * action, exactly as it does the other game.
 * ------------------------------------------------------------------ */

export type CFTrack = 'rat' | 'fast';

export type RatKind =
  | 'opportunity' | 'payday' | 'market' | 'doodad'
  | 'charity' | 'baby' | 'downsized';

export type FastKind =
  | 'cashflowDay' | 'business' | 'venture' | 'dream'
  | 'charity' | 'audit' | 'lawsuit' | 'divorce';

export interface RatSpace { id: number; kind: RatKind }

export interface FastSpace {
  id: number;
  kind: FastKind;
  /** Name key for businesses, ventures and dreams. */
  key?: string;
  /** Business down payment, venture stake, or a dream's price. */
  cost?: number;
  /** Business: monthly cash flow added to CASHFLOW Day income. */
  cashflow?: number;
  /** Venture: the die faces that succeed. */
  win?: number[];
  /** Venture: cash paid out on success. */
  payout?: number;
  /** Venture: CASHFLOW Day income gained on success. */
  cfPayout?: number;
}

/** The five debts a profession starts with. Taxes, other expenses and
 *  children are expenses too, but they cannot be paid off. */
export type DebtKey = 'home' | 'school' | 'car' | 'card' | 'retail';

export interface Debt { balance: number; payment: number }

export interface Profession {
  id: string;
  salary: number;
  taxes: number;
  other: number;
  perChild: number;
  savings: number;
  debts: Record<DebtKey, Debt>;
}

/** What a piece of real estate or a business *is*, which is what a Market
 *  card asks about when it looks for a buyer. */
export type HoldingTag =
  | 'house' | 'condo' | 'duplex' | 'plex4' | 'plex8' | 'apartment'
  | 'land' | 'widget' | 'software' | 'laundromat' | 'carwash' | 'bnb'
  | 'pizza' | 'mall' | 'partnership' | 'coin' | 'gold';

export type DealDeck = 'small' | 'big';
export type CFDeck = DealDeck | 'market' | 'doodad';

export type DealCard =
  | {
    id: string; deck: DealDeck; kind: 'stock';
    symbol: string;
    /** Today's price, per share. */
    price: number;
    /** Monthly dividend per share. 0 for the speculative ones. */
    dividend: number;
    range: [number, number];
  }
  | {
    id: string; deck: DealDeck; kind: 'split';
    symbol: string;
    /** 2 doubles every holder's shares; 0.5 halves them. */
    factor: 2 | 0.5;
  }
  | {
    id: string; deck: DealDeck; kind: 'holding';
    tag: HoldingTag;
    /** Doors, acres or coins - what a per-unit Market offer multiplies. */
    units: number;
    cost: number;
    down: number;
    /** Monthly, after the mortgage is paid. Can be negative. */
    cashflow: number;
  };

export type MarketCard =
  | {
    id: string; deck: 'market'; kind: 'offer';
    tag: HoldingTag;
    price: number;
    /** Price is per unit (door, acre, coin) rather than for the whole. */
    perUnit: boolean;
  }
  | { id: string; deck: 'market'; kind: 'boost'; tag: HoldingTag; delta: number }
  | { id: string; deck: 'market'; kind: 'repair'; cost: number }
  | { id: string; deck: 'market'; kind: 'foreclose'; tag: HoldingTag };

export interface DoodadCard {
  id: string;
  deck: 'doodad';
  amount: number;
  /** Only charged to a player who has children. */
  child?: boolean;
}

export type CFCard = DealCard | MarketCard | DoodadCard;

export interface CFStockLot {
  symbol: string;
  shares: number;
  /** Average price paid per share. */
  cost: number;
  /** Monthly dividend per share. */
  dividend: number;
}

export interface CFHolding {
  id: string;
  tag: HoldingTag;
  units: number;
  cost: number;
  down: number;
  mortgage: number;
  cashflow: number;
}

export interface CFPlayer {
  id: string;
  name: string;
  token: TokenId;
  color: string;
  isBot: boolean;
  botLevel: BotLevel;
  connected: boolean;

  profession: string;
  cash: number;

  /* --- the income statement --- */
  salary: number;
  taxes: number;
  other: number;
  perChild: number;
  children: number;
  debts: Record<DebtKey, Debt>;
  /** Bank loan balance. The payment is always 10% of it, monthly. */
  bankLoan: number;

  /* --- the balance sheet --- */
  stocks: CFStockLot[];
  holdings: CFHolding[];

  track: CFTrack;
  position: number;
  /** Turns left on which a second die may be rolled (Rat Race charity). */
  charityTurns: number;
  /** Turns still to sit out (downsized, bankruptcy). */
  skipTurns: number;
  /** Out of the game for good. */
  out: boolean;

  /* --- the Fast Track --- */
  /** Paid every time CASHFLOW Day is passed or landed on. */
  fastIncome: number;
  /** Fast Track win: CASHFLOW Day income at or above this. */
  fastGoal: number;
  /** The dream space this player is playing for. */
  dream: number | null;
  /** Opponents who have landed on this player's dream, each adding 100%
   *  of the original price. */
  dreamMarks: number;
  /** Charity on the Fast Track: choose 1, 2 or 3 dice from then on. */
  fastCharity: boolean;
}

export type CFPhase =
  | 'lobby'
  | 'dreams'
  | 'roll'
  | 'choose_deal'
  | 'turn_end'
  | 'game_over';

export interface CFSettings {
  seed: number;
  maxPlayers: number;
  botLevel: BotLevel;
  fillWithBots: boolean;
  /** The bank lends only while the loan keeps monthly cash flow at or
   *  above zero. Loans forced by a bill are made regardless. */
  strictLoans: boolean;
  /** 0 = off. Past it, the most progressed player wins. */
  turnLimit: number;
  /** Added to a player's beginning CASHFLOW Day income to set their goal. */
  fastGoal: number;
  /** Seconds a player has for each decision before the host plays it for
   *  them. 0 = no clock; a player who has dropped off is covered either way. */
  turnTimer: number;
}

/** Where everyone stood at the start of a round, for the closing chart. */
export interface CFHistoryPoint {
  round: number;
  /** progress() per player: 0..1 through the Rat Race, above 1 beyond it. */
  progress: Record<string, number>;
}

/** The part of the settings the lobby shows as Cashflow's own rules. */
export type CFRules = Pick<CFSettings, 'strictLoans' | 'turnLimit' | 'fastGoal'>;

export interface CFTableCard {
  id: string;
  /** Whoever drew it. */
  by: string;
  /** A deal that has been bought, so it cannot be bought twice. */
  used: boolean;
}

export interface CFState {
  kind: 'cashflow';
  version: number;
  phase: CFPhase;
  settings: CFSettings;

  players: Record<string, CFPlayer>;
  seats: string[];
  seatIndex: number;

  rngCursor: number;
  decks: Record<CFDeck, string[]>;
  cursors: Record<CFDeck, number>;

  /** The card on the table. Opportunities expire when the turn passes. */
  card: CFTableCard | null;
  dice: number[] | null;
  /** Where the current player landed this turn, for decisions that stay
   *  open until they end it (charity, a Fast Track business). */
  landed: { track: CFTrack; space: number } | null;
  /** The landing decision has been taken. */
  decided: boolean;

  /** Fast Track business -> owner; venture -> whoever cracked it. */
  fastOwners: Record<number, string>;

  turnNumber: number;
  /** Times round the table, from 1. A turn limit counts these, so every
   *  player gets the same number of turns however many drop out. */
  round: number;
  history: CFHistoryPoint[];
  winnerId: string | null;
  winReason: 'dream' | 'cashflow' | 'last' | 'limit' | 'none' | null;
  /** Counter for holding ids. */
  nextId: number;
}

export type CFAction =
  | { type: 'START_GAME'; playerId: string }
  | { type: 'CHOOSE_DREAM'; playerId: string; spaceId: number }
  | { type: 'ROLL'; playerId: string; dice?: number }
  | { type: 'DRAW_DEAL'; playerId: string; deck: DealDeck }
  | { type: 'BUY_STOCK'; playerId: string; shares: number }
  | { type: 'SELL_STOCK'; playerId: string; shares: number }
  | { type: 'BUY_DEAL'; playerId: string }
  | { type: 'SELL_HOLDING'; playerId: string; holdingId: string }
  | { type: 'DONATE'; playerId: string }
  | { type: 'TAKE_LOAN'; playerId: string; amount: number }
  | { type: 'REPAY_LOAN'; playerId: string; amount: number }
  | { type: 'PAY_OFF'; playerId: string; debt: DebtKey }
  | { type: 'BUY_BUSINESS'; playerId: string }
  | { type: 'TRY_VENTURE'; playerId: string }
  | { type: 'BUY_DREAM'; playerId: string }
  | { type: 'END_TURN'; playerId: string }
  /** Sent by the host when a player's clock runs out or they have left the
   *  table: the engine makes their pending decision for them. */
  | { type: 'TIME_OUT'; playerId: string };

export type CFEvent =
  | { type: 'GAME_STARTED' }
  | { type: 'DREAMS_OPEN' }
  | { type: 'DREAM_CHOSEN'; playerId: string; spaceId: number }
  | { type: 'TURN_STARTED'; playerId: string; turnNumber: number }
  | { type: 'TURN_SKIPPED'; playerId: string; left: number }
  | { type: 'ROLLED'; playerId: string; dice: number[] }
  | { type: 'MOVED'; playerId: string; track: CFTrack; from: number; to: number; steps: number }
  | { type: 'PAYDAY'; playerId: string; amount: number }
  | { type: 'CASHFLOW_DAY'; playerId: string; amount: number }
  | { type: 'CARD'; playerId: string; cardId: string }
  | { type: 'BOUGHT_STOCK'; playerId: string; symbol: string; shares: number; price: number }
  | { type: 'SOLD_STOCK'; playerId: string; symbol: string; shares: number; price: number }
  | { type: 'SPLIT'; symbol: string; factor: number }
  | { type: 'BOUGHT_HOLDING'; playerId: string; tag: HoldingTag; down: number; cashflow: number }
  | { type: 'SOLD_HOLDING'; playerId: string; tag: HoldingTag; price: number; settlement: number }
  | { type: 'BOOST'; tag: HoldingTag; delta: number; count: number }
  | { type: 'REPAIR'; playerId: string; cost: number }
  | { type: 'FORECLOSED'; playerId: string; tag: HoldingTag; count: number }
  | { type: 'DOODAD'; playerId: string; cardId: string; amount: number }
  | { type: 'LOAN'; playerId: string; amount: number; forced: boolean }
  | { type: 'REPAID'; playerId: string; amount: number }
  | { type: 'PAID_OFF'; playerId: string; debt: DebtKey; amount: number }
  | { type: 'CHARITY'; playerId: string; amount: number }
  | { type: 'BABY'; playerId: string; children: number }
  | { type: 'DOWNSIZED'; playerId: string; amount: number }
  | { type: 'BANKRUPT'; playerId: string; out: boolean }
  | { type: 'ESCAPED'; playerId: string; income: number }
  | { type: 'BUSINESS'; playerId: string; spaceId: number; cost: number; cashflow: number }
  | { type: 'VENTURE'; playerId: string; spaceId: number; roll: number; won: boolean }
  | { type: 'DREAM_MARKED'; playerId: string; owner: string; spaceId: number }
  | { type: 'LOSS'; playerId: string; kind: 'audit' | 'lawsuit' | 'divorce'; amount: number }
  | { type: 'DREAM_BOUGHT'; playerId: string; spaceId: number; cost: number }
  | { type: 'TIMED_OUT'; playerId: string }
  | { type: 'GAME_OVER'; winnerId: string | null; reason: NonNullable<CFState['winReason']> };

export interface CFReduction {
  state: CFState;
  events: CFEvent[];
}
