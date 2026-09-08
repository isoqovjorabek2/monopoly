import type { GameSettings, TokenId } from './types';
import { randomSeed } from './rng';

/** Official Hasbro rules, as printed. This is the baseline every preset
 *  deviates from, and every deviation is visible in the lobby. */
export const CLASSIC: GameSettings = {
  startingCash: 1500,
  goSalary: 200,
  doubleOnGo: false,
  freeParkingJackpot: false,
  freeParkingSeed: 0,
  snakeEyesBonus: 0,

  auctionsEnabled: true,
  doubleRentOnMonopoly: true,
  buildingShortage: true,
  requireFullSetToBuild: true,
  mustLapBeforeBuying: false,
  noRentInJail: false,
  mortgageInterestPct: 10,

  jailFine: 50,
  maxJailTurns: 3,
  canBuyInJail: false,

  maxPlayers: 6,
  winCondition: 'last-standing',
  turnLimit: 60,
  netWorthTarget: 5000,
  turnTimer: 0,
  auctionBidSeconds: 20,
  animationSpeed: 1,
  allowTrades: true,
  fillWithBots: false,
  botLevel: 'normal',
  seed: 0,
};

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  minutes: string;
  patch: Partial<GameSettings>;
}

export const PRESETS: Preset[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The rules exactly as Hasbro prints them, auctions and all. Plays until one player is left.',
    minutes: '90-180 min',
    patch: {},
  },
  {
    id: 'speed',
    name: 'Speed Run',
    blurb: 'Double salary, richer start, and a hard 30-turn limit. Highest net worth takes it.',
    minutes: '25-40 min',
    patch: {
      startingCash: 2500,
      goSalary: 400,
      winCondition: 'turn-limit',
      turnLimit: 30,
      turnTimer: 45,
      animationSpeed: 1.6,
      buildingShortage: false,
    },
  },
  {
    id: 'friendly',
    name: 'House Rules',
    blurb: 'The way most people actually play: Free Parking jackpot, no auctions, no building shortage.',
    minutes: '60-120 min',
    patch: {
      freeParkingJackpot: true,
      freeParkingSeed: 500,
      auctionsEnabled: false,
      buildingShortage: false,
      snakeEyesBonus: 100,
      doubleOnGo: true,
    },
  },
  {
    id: 'tycoon',
    name: 'Tycoon',
    blurb: 'Cash-rich and cutthroat. First to $10,000 net worth wins; timers keep it moving.',
    minutes: '45-70 min',
    patch: {
      startingCash: 3000,
      goSalary: 300,
      winCondition: 'networth',
      netWorthTarget: 10000,
      turnTimer: 40,
      auctionBidSeconds: 15,
      animationSpeed: 1.4,
    },
  },
];

export function applyPreset(base: GameSettings, presetId: string): GameSettings {
  const p = PRESETS.find((x) => x.id === presetId);
  return { ...base, ...CLASSIC, ...(p?.patch ?? {}), seed: base.seed || randomSeed() };
}

export function defaultSettings(): GameSettings {
  return { ...CLASSIC, seed: randomSeed() };
}

/* ---------------------------------------------------------------- *
 * Players: tokens and palette. Colours are picked to stay legible
 * against the dark felt and to remain distinguishable for the most
 * common forms of colour blindness (they differ in lightness too,
 * not only in hue).
 * ---------------------------------------------------------------- */

export const TOKENS: { id: TokenId; label: string; glyph: string }[] = [
  { id: 'topper', label: 'Top Hat', glyph: 'TH' },
  { id: 'roadster', label: 'Roadster', glyph: 'RD' },
  { id: 'terrier', label: 'Terrier', glyph: 'TR' },
  { id: 'thimble', label: 'Thimble', glyph: 'TB' },
  { id: 'boot', label: 'Boot', glyph: 'BT' },
  { id: 'battleship', label: 'Battleship', glyph: 'BS' },
  { id: 'iron', label: 'Iron', glyph: 'IR' },
  { id: 'wheelbarrow', label: 'Wheelbarrow', glyph: 'WB' },
];

export const PLAYER_COLORS = [
  '#e8b448', // champagne gold
  '#4ea3f2', // sky
  '#e2557b', // rose
  '#5ecfa0', // mint
  '#b98bf0', // violet
  '#f08a45', // amber
  '#7fd4e8', // ice
  '#c9d16b', // olive
];

export const BOT_NAMES = [
  'Ada', 'Bruno', 'Cleo', 'Dmitri', 'Esme', 'Farid', 'Greta', 'Hugo',
];
