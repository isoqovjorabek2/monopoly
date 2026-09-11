import type {
  CFCard, CFDeck, DealCard, DebtKey, DoodadCard, FastSpace, HoldingTag,
  MarketCard, Profession, RatKind, RatSpace,
} from './types';

/* ------------------------------------------------------------------ *
 * The tables. Every number the game can charge or pay is here.
 *
 * The shape follows the published game - twelve professions, a 24-space
 * Rat Race, four decks, a 40-space Fast Track - but the figures and the
 * cards are this project's own, written and balanced for it. Names are
 * keys: the words live in the dictionaries so every language prints them.
 * ------------------------------------------------------------------ */

/* ----------------------------- professions ---------------------------- */

type D = [payment: number, balance: number];

const prof = (
  id: string, salary: number, taxes: number, other: number, perChild: number, savings: number,
  home: D, school: D, car: D, card: D, retail: D,
): Profession => {
  const d = (x: D) => ({ payment: x[0], balance: x[1] });
  return {
    id, salary, taxes, other, perChild, savings,
    debts: { home: d(home), school: d(school), car: d(car), card: d(card), retail: d(retail) },
  };
};

/** A high salary comes with high expenses. The janitor is often the first
 *  one out, which is the lesson the whole game is built around. */
export const PROFESSIONS: readonly Profession[] = [
  prof('janitor', 1650, 290, 310, 80, 600, [210, 21000], [0, 0], [60, 4000], [60, 2000], [50, 1000]),
  prof('mechanic', 2050, 370, 460, 110, 650, [310, 31000], [0, 0], [70, 3500], [60, 2000], [50, 1000]),
  prof('secretary', 2500, 460, 560, 140, 700, [400, 38000], [0, 0], [80, 4000], [60, 2000], [50, 1000]),
  prof('trucker', 2600, 480, 600, 140, 750, [400, 40000], [0, 0], [90, 4500], [60, 2000], [50, 1000]),
  prof('police', 3000, 580, 690, 160, 520, [400, 46000], [0, 0], [100, 5000], [60, 2000], [50, 1000]),
  prof('nurse', 3100, 600, 700, 170, 480, [400, 47000], [30, 6000], [100, 5000], [90, 3000], [50, 1000]),
  prof('teacher', 3300, 630, 760, 180, 400, [500, 50000], [60, 12000], [100, 5000], [90, 3000], [50, 1000]),
  prof('manager', 4600, 910, 1000, 240, 400, [700, 75000], [60, 12000], [120, 6000], [90, 3000], [50, 1000]),
  prof('engineer', 4900, 1050, 1090, 250, 400, [700, 75000], [90, 18000], [140, 7000], [120, 4000], [50, 1000]),
  prof('lawyer', 7500, 1830, 1650, 380, 400, [1100, 115000], [390, 78000], [220, 11000], [180, 6000], [50, 1000]),
  prof('pilot', 9500, 2350, 2210, 480, 400, [1330, 143000], [0, 0], [300, 15000], [660, 22000], [50, 1000]),
  prof('doctor', 13200, 3420, 2880, 640, 400, [1900, 202000], [750, 150000], [380, 19000], [270, 9000], [50, 1000]),
];

export const professionById = (id: string): Profession =>
  PROFESSIONS.find((p) => p.id === id) ?? PROFESSIONS[0];

export const DEBT_KEYS: readonly DebtKey[] = ['home', 'school', 'car', 'card', 'retail'];

export const MAX_CHILDREN = 3;

/** Bank loans: multiples of this, at 10% a month. */
export const LOAN_UNIT = 1000;
export const LOAN_RATE = 0.1;

/** CASHFLOW Day income on leaving the Rat Race: this times passive income. */
export const BUYOUT_MULTIPLE = 100;

/* ----------------------------- the Rat Race --------------------------- */

const RAT_LAYOUT: RatKind[] = [
  'opportunity', 'doodad', 'opportunity', 'charity', 'opportunity', 'payday',
  'opportunity', 'market', 'opportunity', 'doodad', 'opportunity', 'downsized',
  'opportunity', 'payday', 'opportunity', 'market', 'opportunity', 'doodad',
  'opportunity', 'baby', 'opportunity', 'payday', 'opportunity', 'market',
];

export const RAT_BOARD: readonly RatSpace[] = RAT_LAYOUT.map((kind, id) => ({ id, kind }));
export const RAT_SIZE = RAT_BOARD.length;

/* ----------------------------- the Fast Track ------------------------- */

const biz = (key: string, cost: number, cashflow: number): Omit<FastSpace, 'id'> =>
  ({ kind: 'business', key, cost, cashflow });
const venture = (
  key: string, cost: number, win: number[], payout: { cash?: number; cf?: number },
): Omit<FastSpace, 'id'> =>
  ({ kind: 'venture', key, cost, win, payout: payout.cash, cfPayout: payout.cf });
const dream = (key: string, cost: number): Omit<FastSpace, 'id'> => ({ kind: 'dream', key, cost });
const day: Omit<FastSpace, 'id'> = { kind: 'cashflowDay' };

const FAST_LAYOUT: Omit<FastSpace, 'id'>[] = [
  day,
  biz('coffee', 120000, 4000),
  dream('yacht', 200000),
  biz('laundry', 150000, 5000),
  venture('biotech', 50000, [6], { cash: 500000 }),
  biz('dental', 200000, 7000),
  dream('cruise', 150000),
  { kind: 'audit' },
  biz('bakery', 100000, 3000),
  venture('oil', 75000, [5, 6], { cash: 300000 }),

  day,
  biz('gym', 180000, 6000),
  dream('cabin', 100000),
  biz('burger', 300000, 10000),
  { kind: 'charity' },
  biz('pizza', 350000, 12000),
  dream('school', 200000),
  { kind: 'lawsuit' },
  biz('dealer', 400000, 15000),
  venture('film', 100000, [4, 5, 6], { cash: 250000 }),

  day,
  biz('hotel', 500000, 20000),
  dream('vineyard', 250000),
  biz('radio', 250000, 9000),
  venture('goldmine', 150000, [6], { cf: 20000 }),
  biz('software', 280000, 11000),
  dream('space', 300000),
  { kind: 'divorce' },
  biz('marina', 220000, 8000),
  venture('startup', 25000, [6], { cash: 250000 }),

  day,
  biz('mall', 450000, 17000),
  dream('museum', 150000),
  biz('solar', 400000, 16000),
  venture('patent', 60000, [5, 6], { cf: 8000 }),
  biz('bowling', 160000, 5000),
  dream('island', 300000),
  biz('cinema', 240000, 8000),
  biz('print', 110000, 4000),
  biz('golf', 500000, 19000),
];

export const FAST_BOARD: readonly FastSpace[] = FAST_LAYOUT.map((sp, id) => ({ ...sp, id }));
export const FAST_SIZE = FAST_BOARD.length;

export const DREAM_IDS: readonly number[] =
  FAST_BOARD.filter((sp) => sp.kind === 'dream').map((sp) => sp.id);

/* -------------------------------- decks ------------------------------- */

/** Omit that keeps a union a union - plain Omit collapses it to the keys
 *  every member shares, which loses `tag` and `cost` off the Market cards. */
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;

const number = <T extends { id: string }>(prefix: string, cards: NoId<T>[]): T[] =>
  cards.map((c, i) => ({ ...c, id: `${prefix}${String(i + 1).padStart(2, '0')}` }) as unknown as T);

const stock = (deck: 'small' | 'big', symbol: string, price: number, dividend = 0,
  range: [number, number] = [5, 30]): NoId<DealCard> =>
  ({ deck, kind: 'stock', symbol, price, dividend, range });
const split = (symbol: string, factor: 2 | 0.5): NoId<DealCard> =>
  ({ deck: 'small', kind: 'split', symbol, factor });
const hold = (deck: 'small' | 'big', tag: HoldingTag, units: number,
  cost: number, down: number, cashflow: number): NoId<DealCard> =>
  ({ deck, kind: 'holding', tag, units, cost, down, cashflow });

/** Small Deals: nothing here needs more than $5,000 down. Mostly shares,
 *  which swing from $1 to $40 and pay nothing - the money is in buying low
 *  and waiting for a card that lets you sell high. */
export const SMALL_DEALS: readonly DealCard[] = number<DealCard>('s', [
  ...[1, 5, 10, 20, 30, 40].map((p) => stock('small', 'MEDX', p)),
  ...[1, 5, 10, 20, 30, 40].map((p) => stock('small', 'VOLT', p)),
  ...[1, 5, 10, 20, 30, 40].map((p) => stock('small', 'BYTE', p)),
  ...[10, 20, 30].map((p) => stock('small', 'ALLX', p, 0, [10, 30])),
  split('MEDX', 2),
  split('VOLT', 0.5),
  split('BYTE', 2),
  stock('small', 'PWRP', 1200, 10, [1200, 1200]),
  stock('small', 'CD', 1000, 5, [1000, 1000]),
  stock('small', 'CD', 1000, 5, [1000, 1000]),
  hold('small', 'condo', 1, 40000, 4000, 140),
  hold('small', 'condo', 1, 45000, 3000, 100),
  hold('small', 'condo', 1, 50000, 5000, 220),
  hold('small', 'house', 1, 55000, 5000, 160),
  hold('small', 'house', 1, 60000, 4000, 120),
  hold('small', 'house', 1, 50000, 2000, 80),
  hold('small', 'house', 1, 35000, 3500, 250),
  hold('small', 'land', 10, 5000, 5000, 0),
  hold('small', 'widget', 1, 5000, 5000, 0),
  hold('small', 'software', 1, 5000, 5000, 0),
  hold('small', 'coin', 1, 500, 500, 0),
  hold('small', 'gold', 1, 3000, 3000, 0),
]);

/** Big Deals: $6,000 down and up. A few of them lose money every month -
 *  reading the cash flow line is the skill. */
export const BIG_DEALS: readonly DealCard[] = number<DealCard>('b', [
  hold('big', 'house', 1, 65000, 6000, 200),
  hold('big', 'house', 1, 75000, 8000, 300),
  hold('big', 'duplex', 2, 60000, 6000, 190),
  hold('big', 'duplex', 2, 70000, 7000, 280),
  hold('big', 'duplex', 2, 80000, 8000, 320),
  hold('big', 'duplex', 2, 90000, 9000, -100),
  hold('big', 'plex4', 4, 100000, 10000, 400),
  hold('big', 'plex4', 4, 120000, 15000, 600),
  hold('big', 'plex4', 4, 140000, 20000, 700),
  hold('big', 'plex8', 8, 220000, 32000, 1700),
  hold('big', 'plex8', 8, 240000, 40000, 1900),
  hold('big', 'apartment', 12, 350000, 50000, 2400),
  hold('big', 'apartment', 24, 575000, 75000, 3400),
  hold('big', 'apartment', 60, 1200000, 200000, 11000),
  hold('big', 'laundromat', 1, 125000, 25000, 1800),
  hold('big', 'laundromat', 1, 150000, 30000, 2000),
  hold('big', 'carwash', 1, 350000, 50000, 3000),
  hold('big', 'bnb', 1, 200000, 30000, 1800),
  hold('big', 'pizza', 1, 500000, 100000, 4800),
  hold('big', 'partnership', 1, 30000, 30000, 500),
  hold('big', 'partnership', 1, 20000, 20000, 350),
  hold('big', 'land', 20, 20000, 20000, 0),
  hold('big', 'mall', 1, 220000, 50000, 1000),
  hold('big', 'condo', 1, 90000, 9000, -100),
]);

const offer = (tag: HoldingTag, price: number, perUnit = false): NoId<MarketCard> =>
  ({ deck: 'market', kind: 'offer', tag, price, perUnit });

/** The Market: buyers for what you hold, and weather for everyone. */
export const MARKET: readonly MarketCard[] = number<MarketCard>('m', [
  offer('house', 65000),
  offer('house', 80000),
  offer('house', 100000),
  offer('condo', 55000),
  offer('condo', 65000),
  offer('duplex', 90000),
  offer('duplex', 110000),
  offer('plex4', 30000, true),
  offer('plex4', 40000, true),
  offer('plex8', 35000, true),
  offer('plex8', 45000, true),
  offer('apartment', 30000, true),
  offer('apartment', 40000, true),
  offer('land', 3000, true),
  offer('land', 6000, true),
  offer('laundromat', 150000),
  offer('carwash', 500000),
  offer('bnb', 300000),
  offer('pizza', 800000),
  offer('mall', 400000),
  offer('partnership', 60000),
  offer('coin', 4000, true),
  offer('gold', 6000, true),
  offer('software', 100000),
  { deck: 'market', kind: 'boost', tag: 'widget', delta: 400 },
  { deck: 'market', kind: 'boost', tag: 'software', delta: 250 },
  { deck: 'market', kind: 'repair', cost: 1000 },
  { deck: 'market', kind: 'repair', cost: 2000 },
  { deck: 'market', kind: 'foreclose', tag: 'house' },
]);

/** Doodads: the money that leaves without a reason good enough. */
export const DOODADS: readonly DoodadCard[] = number<DoodadCard>('d', [
  { deck: 'doodad', amount: 800 },          // new phone
  { deck: 'doodad', amount: 260 },          // golf clubs
  { deck: 'doodad', amount: 80 },           // dinner out
  { deck: 'doodad', amount: 200 },          // concert tickets
  { deck: 'doodad', amount: 1200 },         // big television
  { deck: 'doodad', amount: 1500 },         // weekend away
  { deck: 'doodad', amount: 300 },          // birthday party
  { deck: 'doodad', amount: 150 },          // gym membership
  { deck: 'doodad', amount: 150 },          // shoes
  { deck: 'doodad', amount: 400 },          // watch
  { deck: 'doodad', amount: 60 },           // sunglasses
  { deck: 'doodad', amount: 3000 },         // jet ski
  { deck: 'doodad', amount: 700 },          // car repair
  { deck: 'doodad', amount: 350 },          // dentist
  { deck: 'doodad', amount: 1000 },         // laptop
  { deck: 'doodad', amount: 500 },          // game console
  { deck: 'doodad', amount: 250 },          // wedding gift
  { deck: 'doodad', amount: 1500, child: true }, // braces
  { deck: 'doodad', amount: 300, child: true },  // school trip
  { deck: 'doodad', amount: 150, child: true },  // toys
  { deck: 'doodad', amount: 400 },          // espresso machine
  { deck: 'doodad', amount: 2000 },         // new sofa
  { deck: 'doodad', amount: 250 },          // spa day
  { deck: 'doodad', amount: 900 },          // designer bag
  { deck: 'doodad', amount: 3000 },         // holiday abroad
]);

const ALL_CARDS: readonly CFCard[] = [...SMALL_DEALS, ...BIG_DEALS, ...MARKET, ...DOODADS];
const CARD_BY_ID = new Map<string, CFCard>(ALL_CARDS.map((c) => [c.id, c]));

export const cfCard = (id: string): CFCard | undefined => CARD_BY_ID.get(id);

export const DECK_CARDS: Record<CFDeck, readonly CFCard[]> = {
  small: SMALL_DEALS,
  big: BIG_DEALS,
  market: MARKET,
  doodad: DOODADS,
};

/** Real estate a tenant can damage. */
export const RENTAL_TAGS: readonly HoldingTag[] =
  ['house', 'condo', 'duplex', 'plex4', 'plex8', 'apartment'];

export const HOLDING_TAGS: readonly HoldingTag[] = [
  'house', 'condo', 'duplex', 'plex4', 'plex8', 'apartment', 'land', 'widget', 'software',
  'laundromat', 'carwash', 'bnb', 'pizza', 'mall', 'partnership', 'coin', 'gold',
];

export const STOCK_SYMBOLS = ['MEDX', 'VOLT', 'BYTE', 'ALLX', 'PWRP', 'CD'] as const;
