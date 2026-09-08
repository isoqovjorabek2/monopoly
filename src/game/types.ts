/* ------------------------------------------------------------------ *
 * Core types. Everything here must be JSON-serialisable: no classes,
 * no Map/Set, no functions. The network layer round-trips state
 * through JSON on every action, and engine.test.ts asserts it.
 * ------------------------------------------------------------------ */

export type ColorGroup =
  | 'brown' | 'lightblue' | 'pink' | 'orange'
  | 'red' | 'yellow' | 'green' | 'darkblue';

export type SpaceKind =
  | 'go' | 'property' | 'railroad' | 'utility'
  | 'chance' | 'chest' | 'tax' | 'jail' | 'freeparking' | 'gotojail';

export interface Space {
  id: number;
  name: string;
  short: string;
  kind: SpaceKind;
  group?: ColorGroup;
  price?: number;
  /** [base, 1 house, 2, 3, 4, hotel] - properties only. */
  rent?: readonly number[];
  houseCost?: number;
  mortgage?: number;
  taxAmount?: number;
}

export type CardDeck = 'chance' | 'chest';

export type CardEffect =
  | { kind: 'move'; to: number; passGoPays: boolean }
  | { kind: 'moveRelative'; delta: number }
  | { kind: 'nearest'; target: 'railroad' | 'utility' }
  | { kind: 'money'; amount: number }
  | { kind: 'moneyFromEach'; amount: number }
  | { kind: 'moneyToEach'; amount: number }
  | { kind: 'repairs'; perHouse: number; perHotel: number }
  | { kind: 'jail' }
  | { kind: 'getOutFree' };

export interface Card {
  id: string;
  deck: CardDeck;
  text: string;
  effect: CardEffect;
}

export type TokenId =
  | 'topper' | 'roadster' | 'terrier' | 'thimble'
  | 'boot' | 'battleship' | 'iron' | 'wheelbarrow';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface Player {
  id: string;
  name: string;
  token: TokenId;
  color: string;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  getOutOfJailCards: number;
  bankrupt: boolean;
  isBot: boolean;
  botLevel: BotLevel;
  connected: boolean;
  /** Completed laps - used by the "must pass GO before buying" house rule. */
  lapsCompleted: number;
}

export interface PropertyState {
  owner: string | null;
  /** 0-4 houses; 5 means a hotel. */
  houses: number;
  mortgaged: boolean;
}

export type Phase =
  | 'lobby'
  | 'preroll'
  | 'rolling'
  | 'resolving'
  | 'awaiting_buy'
  | 'auction'
  | 'must_raise'
  | 'jailed_choice'
  | 'turn_end'
  | 'game_over';

export interface Auction {
  spaceId: number;
  currentBid: number;
  highBidder: string | null;
  /** Player ids still able to bid, in seat order. */
  active: string[];
  turn: number;
  origin: 'declined' | 'bankruptcy';
}

export interface Debt {
  from: string;
  /** null = the bank. */
  to: string | null;
  amount: number;
  reason: string;
}

export interface TradeOffer {
  id: string;
  from: string;
  to: string;
  giveCash: number;
  giveProperties: number[];
  giveJailCards: number;
  wantCash: number;
  wantProperties: number[];
  wantJailCards: number;
  createdAt: number;
}

export interface GameSettings {
  /* --- economy --- */
  startingCash: number;
  goSalary: number;
  /** Landing exactly on GO pays double the salary. */
  doubleOnGo: boolean;
  /** Taxes and fees pile up on Free Parking and go to whoever lands there. */
  freeParkingJackpot: boolean;
  freeParkingSeed: number;
  /** Bonus paid for rolling snake eyes. 0 disables. */
  snakeEyesBonus: number;

  /* --- property rules --- */
  /** Declining to buy sends the property to auction (official rule). */
  auctionsEnabled: boolean;
  /** Double rent on an unimproved full colour set (official rule). */
  doubleRentOnMonopoly: boolean;
  /** Bank has a finite 32 houses / 12 hotels (official rule). */
  buildingShortage: boolean;
  /** Must own the whole colour group to build (official rule). */
  requireFullSetToBuild: boolean;
  /** Must complete one lap of the board before buying anything. */
  mustLapBeforeBuying: boolean;
  /** Owners in jail collect no rent. */
  noRentInJail: boolean;
  /** Interest percentage charged when lifting a mortgage. */
  mortgageInterestPct: number;

  /* --- jail --- */
  jailFine: number;
  maxJailTurns: number;
  canBuyInJail: boolean;

  /* --- flow --- */
  maxPlayers: number;
  winCondition: 'last-standing' | 'turn-limit' | 'networth';
  turnLimit: number;
  netWorthTarget: number;
  /** Seconds before the host auto-passes an idle player. 0 = off. */
  turnTimer: number;
  auctionBidSeconds: number;
  /** Board animation speed multiplier. */
  animationSpeed: number;
  allowTrades: boolean;
  fillWithBots: boolean;
  botLevel: BotLevel;
  /** Deterministic seed. Same seed + same actions = same game. */
  seed: number;
}

export interface GameState {
  version: number;
  phase: Phase;
  settings: GameSettings;

  players: Record<string, Player>;
  /** Seat order - the turn cycle. */
  seats: string[];
  seatIndex: number;

  properties: Record<number, PropertyState>;

  /** PRNG cursor. Advanced only inside the reducer. */
  rngCursor: number;
  chanceOrder: string[];
  chestOrder: string[];
  chanceCursor: number;
  chestCursor: number;

  dice: [number, number] | null;
  doublesCount: number;
  /** Jailed this turn - cancels the doubles re-roll. */
  jailedThisTurn: boolean;
  /** Forces a utility rent multiplier (the Chance "nearest utility" card). */
  pendingUtilityMultiplier: number | null;
  /** True once the current player has resolved their landing square. */
  resolved: boolean;

  housesRemaining: number;
  hotelsRemaining: number;
  freeParkingPot: number;

  auction: Auction | null;
  debt: Debt | null;
  trades: TradeOffer[];

  /** Card currently on screen, for the presentation layer. */
  activeCard: Card | null;

  turnNumber: number;
  winnerId: string | null;
  startedAt: number;
}

/* ------------------------------------------------------------------ *
 * Actions - the complete intent vocabulary. Guests send these; the
 * host validates and reduces them. Nothing else mutates state.
 * ------------------------------------------------------------------ */
export type GameAction =
  | { type: 'START_GAME'; playerId: string }
  | { type: 'ROLL'; playerId: string }
  | { type: 'BUY_PROPERTY'; playerId: string }
  | { type: 'DECLINE_PROPERTY'; playerId: string }
  | { type: 'BID'; playerId: string; amount: number }
  | { type: 'PASS_BID'; playerId: string }
  | { type: 'BUILD_HOUSE'; playerId: string; spaceId: number }
  | { type: 'SELL_HOUSE'; playerId: string; spaceId: number }
  | { type: 'MORTGAGE'; playerId: string; spaceId: number }
  | { type: 'UNMORTGAGE'; playerId: string; spaceId: number }
  | { type: 'PAY_JAIL_FINE'; playerId: string }
  | { type: 'USE_JAIL_CARD'; playerId: string }
  | { type: 'DECLARE_BANKRUPTCY'; playerId: string }
  | { type: 'PROPOSE_TRADE'; playerId: string; offer: Omit<TradeOffer, 'id' | 'createdAt'> }
  | { type: 'ACCEPT_TRADE'; playerId: string; tradeId: string }
  | { type: 'DECLINE_TRADE'; playerId: string; tradeId: string }
  | { type: 'END_TURN'; playerId: string }
  | { type: 'DISMISS_CARD'; playerId: string };

/* ------------------------------------------------------------------ *
 * Events - what happened, for the presentation layer to animate and
 * log. The engine never talks to the UI any other way.
 * ------------------------------------------------------------------ */
export type GameEvent =
  | { type: 'GAME_STARTED' }
  | { type: 'DICE_ROLLED'; playerId: string; dice: [number, number]; isDouble: boolean }
  | { type: 'MOVED'; playerId: string; from: number; to: number; steps: number; direct: boolean }
  | { type: 'PASSED_GO'; playerId: string; amount: number }
  | { type: 'BOUGHT'; playerId: string; spaceId: number; price: number }
  | { type: 'RENT_PAID'; from: string; to: string; amount: number; spaceId: number }
  | { type: 'TAX_PAID'; playerId: string; amount: number; label: string }
  | { type: 'CARD_DRAWN'; playerId: string; card: Card }
  | { type: 'JAILED'; playerId: string; reason: string }
  | { type: 'LEFT_JAIL'; playerId: string; how: string }
  | { type: 'BUILT'; playerId: string; spaceId: number; houses: number }
  | { type: 'SOLD_BUILDING'; playerId: string; spaceId: number; houses: number }
  | { type: 'MORTGAGED'; playerId: string; spaceId: number; amount: number }
  | { type: 'UNMORTGAGED'; playerId: string; spaceId: number; amount: number }
  | { type: 'AUCTION_STARTED'; spaceId: number }
  | { type: 'AUCTION_BID'; playerId: string; amount: number }
  | { type: 'AUCTION_PASSED'; playerId: string }
  | { type: 'AUCTION_WON'; playerId: string; spaceId: number; amount: number }
  | { type: 'AUCTION_NOBODY'; spaceId: number }
  | { type: 'MONEY'; playerId: string; delta: number; reason: string }
  | { type: 'DEBT_INCURRED'; playerId: string; amount: number; reason: string }
  | { type: 'BANKRUPT'; playerId: string; creditorId: string | null }
  | { type: 'TRADE_PROPOSED'; offer: TradeOffer }
  | { type: 'TRADE_ACCEPTED'; offer: TradeOffer }
  | { type: 'TRADE_DECLINED'; offer: TradeOffer }
  | { type: 'TURN_STARTED'; playerId: string; turnNumber: number }
  | { type: 'FREE_PARKING'; playerId: string; amount: number }
  | { type: 'GAME_OVER'; winnerId: string | null };

export interface Reduction {
  state: GameState;
  events: GameEvent[];
}
