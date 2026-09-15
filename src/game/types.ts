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

export type TakeoverPolicy = 'ask' | 'anyone' | 'off';

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
  /** One debt owed to several players in equal shares ("pay each player").
   *  `to` is null when this is set. */
  split?: string[];
  /** What the turn still owes once this is paid: the third-turn jail fine
   *  comes before the move of the roll that brought it, and a loan that fell
   *  due as a turn began comes before that turn's roll. */
  resume?: 'move' | 'turn';
  /** Deal Maker: slices of a rent debt that go to shareholders instead of
   *  the owner. They come out of `amount`, never on top of it. */
  cuts?: RentCut[];
}

/** Part of a rent payment diverted to whoever holds a revenue share. */
export interface RentCut {
  to: string;
  amount: number;
  spaceId: number;
}

/* ------------------------------------------------------------------ *
 * Deal Maker contracts.
 *
 * A term is what a trade promises; a contract is what the table holds
 * once the trade is accepted. Terms name their parties by side of the
 * offer ('from' / 'to') so a proposer can compose one before anyone has
 * agreed to anything; contracts name real player ids.
 *
 * Passes and shares run with the deed, like a lease: whoever owns the
 * square when the rent is due honours them. That is what stops a player
 * selling a share and then trading the deed to a friend to void it.
 * ------------------------------------------------------------------ */

export type TradeSide = 'from' | 'to';

export type DealTerm =
  /** The other side pays `discountPct`% less rent (100 = free) on these
   *  squares, for the next `uses` times they owe it. */
  | { kind: 'pass'; grantor: TradeSide; spaces: number[]; discountPct: number; uses: number }
  /** The other side takes `pct`% of every rent paid on these squares, for
   *  `rounds` rounds - 0 for the rest of the game. */
  | { kind: 'share'; grantor: TradeSide; spaces: number[]; pct: number; rounds: number }
  /** `lender` hands over `principal` now and is repaid `repay` when the
   *  borrower's turn comes round `rounds` rounds from now. */
  | { kind: 'loan'; lender: TradeSide; principal: number; repay: number; rounds: number };

export type Contract =
  | { id: string; kind: 'pass'; grantor: string; holder: string; spaces: number[]; discountPct: number; usesLeft: number }
  | { id: string; kind: 'share'; grantor: string; holder: string; spaces: number[]; pct: number; endsRound: number | null }
  | { id: string; kind: 'loan'; lender: string; borrower: string; principal: number; repay: number; dueRound: number };

export type ContractEnd = 'used' | 'expired' | 'released' | 'void';

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
  /** Deal Maker contracts that come with the swap. Absent in classic play. */
  terms?: DealTerm[];
  /** The offer this one answers. Sending it withdraws that offer. */
  counterTo?: string;
  createdAt: number;
}

/** An offer before the engine has stamped it: what a proposer actually
 *  composes. The UI, the bots and the reducer all speak this shape. */
export type TradeBody = Omit<TradeOffer, 'id' | 'createdAt'>;

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
  /** Rounds, not turns: every player gets this many before it ends. */
  turnLimit: number;
  netWorthTarget: number;
  /** Seconds before the host auto-passes an idle player. 0 = off. */
  turnTimer: number;
  auctionBidSeconds: number;
  /** Board animation speed multiplier. */
  animationSpeed: number;
  allowTrades: boolean;
  /** Deal Maker: trades may carry rent passes, revenue shares and loans. */
  dealsEnabled: boolean;
  fillWithBots: boolean;
  botLevel: BotLevel;
  /** Who may take over a bot's seat once the game has started: the host
   *  decides each time, any signed-in player, or nobody. */
  takeovers: TakeoverPolicy;
  /** Deterministic seed. Same seed + same actions = same game. */
  seed: number;
}

/** One point on the closing chart. */
export interface HistoryPoint {
  round: number;
  worth: Record<string, number>;
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
  /** Deeds the bank took from a bankrupt estate, still to be auctioned. */
  auctionQueue: number[];
  debt: Debt | null;
  trades: TradeOffer[];
  /** `"from>to"` -> the turn on which that pair's last offer was refused or
   *  timed out. Bots read it, so a deal you turned down is not put back in
   *  front of you on the next tick. */
  tradeCooldowns: Record<string, number>;
  /** Deal Maker contracts in force. Always empty in classic play. */
  contracts: Contract[];

  /** Card currently on screen, for the presentation layer. */
  activeCard: Card | null;

  turnNumber: number;
  /** Times round the table. Starts at 1; a turn limit counts these. */
  round: number;
  /** Everyone's net worth at the start of each round, and at the end. */
  history: HistoryPoint[];
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
  | { type: 'PROPOSE_TRADE'; playerId: string; offer: TradeBody }
  | { type: 'ACCEPT_TRADE'; playerId: string; tradeId: string }
  | { type: 'DECLINE_TRADE'; playerId: string; tradeId: string }
  | { type: 'END_TURN'; playerId: string }
  | { type: 'DISMISS_CARD'; playerId: string }
  /** Deal Maker: pay a loan off before it falls due. */
  | { type: 'REPAY_LOAN'; playerId: string; contractId: string }
  /** Deal Maker: the side a contract favours tears it up. */
  | { type: 'RELEASE_CONTRACT'; playerId: string; contractId: string }
  /** Sent by the host when a player's clock runs out or they have left the
   *  table: the engine makes their pending decisions for them. */
  | { type: 'TIME_OUT'; playerId: string };

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
  /** `counter` answers `offer`, which is withdrawn in its favour. */
  | { type: 'TRADE_COUNTERED'; offer: TradeOffer; counter: TradeOffer }
  | { type: 'TRADE_EXPIRED'; offer: TradeOffer }
  | { type: 'TURN_STARTED'; playerId: string; turnNumber: number }
  | { type: 'FREE_PARKING'; playerId: string; amount: number }
  | { type: 'TIMED_OUT'; playerId: string }
  /** A signed-in player took over a bot's seat mid-game. */
  | { type: 'SEAT_TAKEN'; playerId: string; name: string; previous: string }
  | { type: 'CONTRACT_SIGNED'; contract: Contract }
  | { type: 'PASS_USED'; playerId: string; ownerId: string; spaceId: number; saved: number; usesLeft: number }
  | { type: 'SHARE_PAID'; from: string; to: string; amount: number; spaceId: number }
  | { type: 'LOAN_REPAID'; borrower: string; lender: string; amount: number; early: boolean }
  | { type: 'CONTRACT_ENDED'; contract: Contract; reason: ContractEnd }
  | { type: 'GAME_OVER'; winnerId: string | null };

export interface Reduction {
  state: GameState;
  events: GameEvent[];
}
