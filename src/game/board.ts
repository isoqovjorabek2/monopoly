import type { ColorGroup, Space } from './types';

/* Bazaar Barons: twenty-two Silk Road cities in eight regional sets, four
 * rail lines and two utilities. Mortgage is always price / 2; unmortgaging
 * costs mortgage + interest. */

const prop = (
  id: number, name: string, short: string, group: ColorGroup,
  price: number, rent: readonly number[], houseCost: number,
): Space => ({
  id, name, short, kind: 'property', group, price, rent, houseCost, mortgage: price / 2,
});

const rail = (id: number, name: string, short: string): Space =>
  ({ id, name, short, kind: 'railroad', price: 200, mortgage: 100 });

const util = (id: number, name: string, short: string): Space =>
  ({ id, name, short, kind: 'utility', price: 150, mortgage: 75 });

export const BOARD: readonly Space[] = [
  { id: 0, name: 'Start', short: 'Start', kind: 'go' },
  prop(1, 'Nukus', 'Nukus', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { id: 2, name: 'Bazaar', short: 'Bazaar', kind: 'chest' },
  prop(3, 'Termez', 'Termez', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { id: 4, name: 'Customs Duty', short: 'Customs', kind: 'tax', taxAmount: 200 },
  rail(5, 'Northern Line', 'North Line'),
  prop(6, 'Andijan', 'Andijan', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  { id: 7, name: 'Fortune', short: 'Fortune', kind: 'chance' },
  prop(8, 'Namangan', 'Namangan', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  prop(9, 'Fergana', 'Fergana', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 50),
  { id: 10, name: 'Zindan / Passing Through', short: 'Zindan', kind: 'jail' },
  prop(11, 'Osh', 'Osh', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  util(12, 'Power Grid', 'Power Grid'),
  prop(13, 'Bishkek', 'Bishkek', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  prop(14, 'Almaty', 'Almaty', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail(15, 'Western Line', 'West Line'),
  prop(16, 'Merv', 'Merv', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { id: 17, name: 'Bazaar', short: 'Bazaar', kind: 'chest' },
  prop(18, 'Khiva', 'Khiva', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  prop(19, 'Bukhara', 'Bukhara', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { id: 20, name: 'Caravanserai', short: 'Caravanserai', kind: 'freeparking' },
  prop(21, 'Herat', 'Herat', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { id: 22, name: 'Fortune', short: 'Fortune', kind: 'chance' },
  prop(23, 'Mashhad', 'Mashhad', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  prop(24, 'Isfahan', 'Isfahan', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail(25, 'Southern Line', 'South Line'),
  prop(26, 'Tabriz', 'Tabriz', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  prop(27, 'Baku', 'Baku', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  util(28, 'Canal Works', 'Canal Works'),
  prop(29, 'Tbilisi', 'Tbilisi', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { id: 30, name: 'Off to the Zindan', short: 'To Zindan', kind: 'gotojail' },
  prop(31, 'Kashgar', 'Kashgar', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  prop(32, 'Dunhuang', 'Dunhuang', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { id: 33, name: 'Bazaar', short: 'Bazaar', kind: 'chest' },
  prop(34, 'Xi’an', 'Xi’an', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail(35, 'Eastern Line', 'East Line'),
  { id: 36, name: 'Fortune', short: 'Fortune', kind: 'chance' },
  prop(37, 'Samarkand', 'Samarkand', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { id: 38, name: 'Luxury Levy', short: 'Luxury Levy', kind: 'tax', taxAmount: 100 },
  prop(39, 'Tashkent', 'Tashkent', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
] as const;

export const BOARD_SIZE = 40;
export const JAIL_POSITION = 10;
export const GO_TO_JAIL_POSITION = 30;

export const RAILROAD_IDS = [5, 15, 25, 35] as const;
export const UTILITY_IDS = [12, 28] as const;
export const RAILROAD_RENT = [0, 25, 50, 100, 200] as const;

/** Every deed id, grouped by colour. Order matters for even-build checks. */
export const GROUPS: Record<ColorGroup, number[]> = {
  brown: [1, 3],
  lightblue: [6, 8, 9],
  pink: [11, 13, 14],
  orange: [16, 18, 19],
  red: [21, 23, 24],
  yellow: [26, 27, 29],
  green: [31, 32, 34],
  darkblue: [37, 39],
};

export const GROUP_ORDER: ColorGroup[] = [
  'brown', 'lightblue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkblue',
];

export const GROUP_LABEL: Record<ColorGroup, string> = {
  brown: 'Brown',
  lightblue: 'Light Blue',
  pink: 'Pink',
  orange: 'Orange',
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  darkblue: 'Dark Blue',
};

/** Board-accurate swatches, warmed slightly so they sit on the dark felt. */
export const GROUP_COLOR: Record<ColorGroup, string> = {
  brown: '#8d5524',
  lightblue: '#8fd3f4',
  pink: '#d9418c',
  orange: '#f08a24',
  red: '#e0242c',
  yellow: '#f2ca27',
  green: '#189e4a',
  darkblue: '#2b52c4',
};

export const isOwnable = (id: number): boolean => {
  const k = BOARD[id].kind;
  return k === 'property' || k === 'railroad' || k === 'utility';
};

export const OWNABLE_IDS: number[] = BOARD.filter((s) => isOwnable(s.id)).map((s) => s.id);

export const spaceAt = (id: number): Space => BOARD[((id % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE];

/* --- geometry: which of the four edges a space sits on, for the renderer --- */
export type Edge = 'bottom' | 'left' | 'top' | 'right';

export function edgeOf(id: number): Edge {
  if (id <= 10) return 'bottom';
  if (id <= 20) return 'left';
  if (id <= 30) return 'top';
  return 'right';
}

export const isCorner = (id: number): boolean => id % 10 === 0;
