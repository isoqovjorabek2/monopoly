/* ------------------------------------------------------------------ *
 * Generated art, and which version of it is showing.
 *
 * Three surfaces in this game were flat colour because there was nothing
 * to put there: the felt the plaques are set into, the medallion printed
 * on it, and the wall behind the home screen. Each now has four candidate
 * images in public/art, and this module decides which one loads.
 *
 * Everything degrades: if an image never arrives the caller keeps its
 * original procedural drawing, so a missing file costs polish, not a
 * board. See useArtTexture and the .home rule in app.css.
 * ------------------------------------------------------------------ */

import type { BoardTheme } from '../game/types';
import type { MafiaRole } from '../mafia/types';

export type ArtSlot = 'felt' | 'medal' | 'hero';
export type ArtVariant = 1 | 2 | 3 | 4;

export const ART_SLOTS: ArtSlot[] = ['felt', 'medal', 'hero'];
export const ART_VARIANTS: ArtVariant[] = [1, 2, 3, 4];

/** Shown when nothing overrides them. Change these to lock in a choice. */
const DEFAULTS: Record<ArtSlot, ArtVariant> = {
  felt: 2,
  medal: 2,
  hero: 2,
};

const KEY = 'mply.art';

function toVariant(raw: string | null): ArtVariant | null {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

/**
 * Reads overrides from the URL, which is what makes comparing versions
 * possible without a rebuild: ?art=3 moves every surface at once, and
 * ?felt=1&medal=4 overrides individual ones on top of that. A choice made
 * in the URL sticks in localStorage so a reload holds it.
 *
 * Both query string and hash are searched: the app already routes on the
 * hash (#/join/CODE), so ?art=3 can legitimately arrive on either side.
 */
function readOverrides(): Partial<Record<ArtSlot, ArtVariant>> {
  const out: Partial<Record<ArtSlot, ArtVariant>> = {};
  try {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    const params = [
      new URLSearchParams(window.location.search),
      new URLSearchParams(hashQuery),
    ];

    for (const p of params) {
      const all = toVariant(p.get('art'));
      if (all) for (const slot of ART_SLOTS) out[slot] = all;
      for (const slot of ART_SLOTS) {
        const one = toVariant(p.get(slot));
        if (one) out[slot] = one;
      }
    }
  } catch { /* no window, or an exotic URL - fall through to defaults */ }
  return out;
}

function readSaved(): Partial<Record<ArtSlot, ArtVariant>> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<ArtSlot, ArtVariant>> = {};
    for (const slot of ART_SLOTS) {
      const v = toVariant(String(parsed[slot] ?? ''));
      if (v) out[slot] = v;
    }
    return out;
  } catch { return {}; }
}

function resolve(): Record<ArtSlot, ArtVariant> {
  const overrides = readOverrides();
  const saved = readSaved();
  const chosen = { ...DEFAULTS, ...saved, ...overrides };

  // Only a URL choice is worth remembering; the saved value it came from
  // is already in the object, so this is a no-op on an ordinary load.
  if (Object.keys(overrides).length) {
    try { localStorage.setItem(KEY, JSON.stringify(chosen)); } catch { /* private mode */ }
  }
  return chosen;
}

/** Which version of each surface this session is showing. */
export const ART_VARIANT: Record<ArtSlot, ArtVariant> = resolve();

/** Path to any variant, whether or not it is the one in use. */
export function artUrl(slot: ArtSlot, variant: ArtVariant): string {
  return `${import.meta.env.BASE_URL}art/${slot}-${variant}.jpg`;
}

/** Paths to the versions actually in use. */
export const ART: Record<ArtSlot, string> = {
  felt: artUrl('felt', ART_VARIANT.felt),
  medal: artUrl('medal', ART_VARIANT.medal),
  hero: artUrl('hero', ART_VARIANT.hero),
};

/* ------------------------------------------------------------------ *
 * The rest of the generated set. Unlike the three above there is one
 * of each, so these are plain paths rather than variants.
 * ------------------------------------------------------------------ */

const base = (path: string): string => `${import.meta.env.BASE_URL}art/${path}`;

/** Ivory card stock, under the deed and the drawn card. */
export const PAPER = base('paper.jpg');

/** Walnut, for the table the board sits on. */
export const TABLE = base('table.jpg');

/**
 * The four corner emblems on the flat board. The 3D board draws its
 * corners into a canvas texture; the flat board had four small SVG icons
 * doing the same job at a size where they read as clip art.
 *
 * Engraved on pure black and composited with `screen`, which is why they
 * are JPEGs with no alpha: the ground drops out against the felt, and the
 * black point is graded to true zero so it drops out completely rather
 * than laying a haze over the tile.
 */
export type CornerEmblem = 'go' | 'jail' | 'parking' | 'gotojail';

export const CORNER_EMBLEM: Record<number, CornerEmblem> = {
  0: 'go',
  10: 'jail',
  20: 'parking',
  30: 'gotojail',
};

export const cornerArt = (name: CornerEmblem): string => base(`corners/${name}.jpg`);

/**
 * One engraved motif per colour group, plus one for the railroads and one
 * for the utilities: twelve squares of the board share a picture rather
 * than each having their own, which is what keeps this ten files instead
 * of twenty-eight and what makes a set read as a set at a glance.
 *
 * Same contract as the corners - engraved on black, composited with
 * `screen`, no alpha - and kept faint, because unlike a corner these sit
 * behind a name and a price that have to stay readable.
 */
export type GroupMotif =
  | 'brown' | 'lightblue' | 'pink' | 'orange'
  | 'red' | 'yellow' | 'green' | 'darkblue'
  | 'railroad' | 'utility';

export const groupArt = (name: GroupMotif): string => base(`groups/${name}.jpg`);

/**
 * One engraved vignette per card, keyed by card id, so a player who draws
 * "Speeding fine" and one who draws "Go to Jail" do not get the same
 * picture. Fetched only when that card is actually drawn.
 */
export const cardArt = (cardId: string): string => base(`cards/${cardId}.jpg`);

/** The two deck backs, shown on the reverse while a card flips over. */
export const deckBack = (deck: 'chance' | 'chest'): string =>
  base(`cards/back-${deck === 'chance' ? 'chance' : 'chest'}.jpg`);

/* ------------------------------------------------------------------ *
 * Themed boards (Party Hall Plus).
 *
 * A theme changes what the board *says* (i18n/themes.ts) and what it
 * *wears*: its own felt, medallion, corner emblems, group motifs and card
 * backs, under art/themes/<theme>/ with the same names the base set uses.
 * Same contract throughout - the engravings are linework on pure black,
 * composited with `screen`, so they sit on any felt with no alpha channel.
 *
 * The Silk Road is the base set itself, so these resolvers take the theme
 * and hand back the base path for it: a caller never branches on 'silk'.
 * A themed file that fails to load costs the ornament, never the board -
 * the same degradation every other generated surface already has.
 * ------------------------------------------------------------------ */

/** The cloth under everything: flat board's CSS, the 3D board's blocks. */
export const themedFelt = (theme: BoardTheme): string =>
  theme === 'silk' ? ART.felt : base(`themes/${theme}/felt.jpg`);

/** The centre emblem under the wordmark. */
export const themedMedal = (theme: BoardTheme): string =>
  theme === 'silk' ? ART.medal : base(`themes/${theme}/medal.jpg`);

export const themedCorner = (theme: BoardTheme, name: CornerEmblem): string =>
  theme === 'silk' ? cornerArt(name) : base(`themes/${theme}/corners/${name}.jpg`);

export const themedGroup = (theme: BoardTheme, name: GroupMotif): string =>
  theme === 'silk' ? groupArt(name) : base(`themes/${theme}/groups/${name}.jpg`);

export const themedDeckBack = (theme: BoardTheme, deck: 'chance' | 'chest'): string =>
  theme === 'silk' ? deckBack(deck) : base(`themes/${theme}/cards/back-${deck}.jpg`);

/** Polished ebony, for a Plus table playing the Silk Road. */
export const PLUS_TABLE = base('table-plus.jpg');

/**
 * The wood the 3D board stands on. A themed board brings its own table; a
 * Plus table on the Silk Road upgrades to ebony; anything else keeps the
 * house walnut.
 */
export const themedTable = (theme: BoardTheme, plus: boolean): string =>
  theme !== 'silk' ? base(`themes/${theme}/table.jpg`) : plus ? PLUS_TABLE : TABLE;

/* ------------------------------ stickers ------------------------------ */

export interface Sticker {
  id: string;
  label: string;
}

/**
 * Sent through chat as `:sticker:<id>:`, which needs no protocol change and
 * degrades to visible text if an id is ever unknown. Order is the order they
 * appear in the picker: the ones you reach for mid-game come first.
 */
export const STICKERS: readonly Sticker[] = [
  { id: 'money', label: 'Cha-ching' },
  { id: 'dice', label: 'Rolling' },
  { id: 'crown', label: 'Winner' },
  { id: 'deed', label: 'Bought it' },
  { id: 'house', label: 'Building' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'jail', label: 'Busted' },
  { id: 'bust', label: 'Bankrupt' },
  { id: 'tophat', label: 'Good game' },
  { id: 'train', label: 'All aboard' },
  { id: 'bolt', label: 'Shocking' },
  { id: 'luck', label: 'Lucky' },
];

const STICKER_BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

/** What a screen reader says in place of the picture. */
export const stickerLabel = (id: string): string => STICKER_BY_ID.get(id)?.label ?? 'Sticker';

export const stickerUrl = (id: string): string => base(`stickers/${id}.webp`);

export const stickerToken = (id: string): string => `:sticker:${id}:`;

/** The id if this message is nothing but a sticker, otherwise null. */
export function parseSticker(text: string): string | null {
  const m = /^:sticker:([a-z]+):$/.exec(text.trim());
  return m && STICKER_BY_ID.has(m[1]) ? m[1] : null;
}

/* ----------------------------- effects ----------------------------- */

export type FxName = 'coins' | 'victory' | 'ash';

/**
 * Sixteen frames of a generated clip laid out in one row. CSS steps()
 * walks the strip, so these animate without a video element and without
 * an alpha channel - they are composited with `screen`, which drops the
 * black they were rendered against.
 */
export const FX_FRAMES = 16;
export const fxStrip = (name: FxName): string => base(`fx/${name}.jpg`);

/* ----------------------------- the picker ----------------------------- */

/** One photograph per game for the front door, lit and dressed as a pair
 *  so the choice reads as two tables in the same room. */
export const GAME_COVER = {
  monopoly: base('cover-monopoly.jpg'),
  cashflow: base('cashflow/cover.jpg'),
  mafia: base('mafia/cover.jpg'),
} as const;

/* ------------------------------- Omertà ------------------------------- */

/**
 * Omertà's set is 1920s noir: champagne-gold engraving on pure black,
 * composited with `screen`, the ground dropping out exactly like the
 * Monopoly corners. The night sky is a full-bleed texture instead.
 */
export const MAF_ART = {
  hero: base('mafia/hero.jpg'),
  night: base('mafia/night.jpg'),
  moon: base('mafia/moon.jpg'),
  sun: base('mafia/sun.jpg'),
} as const;

/** One engraved emblem per role, for the reveal and the night table. */
export const mafRoleArt = (role: MafiaRole): string => base(`mafia/roles/${role}.jpg`);

/** The painted role card - title and portrait - from the Mafia app's deck,
 *  for the reveal, the seat of the dead and the final roll call. */
export const mafRoleCard = (role: MafiaRole): string => base(`mafia/cards/${role}.jpg`);

/* ------------------------------ Cashflow ------------------------------ */

/**
 * Cashflow's set is banknote engraving rather than deco brass: mint and
 * champagne linework on pure black, composited with `screen` exactly like
 * the Monopoly corners, so the ground drops out and no alpha is needed.
 */
export type CFSpaceArt =
  | 'payday' | 'small' | 'big' | 'market' | 'doodad' | 'charity' | 'baby'
  | 'downsized' | 'cashflowDay' | 'business' | 'venture' | 'dream'
  | 'audit' | 'lawsuit' | 'divorce';

export const cfSpaceArt = (name: CFSpaceArt): string => base(`cashflow/space/${name}.jpg`);

/** Eight dreams, keyed like the Fast Track squares they sit on. */
export const cfDreamArt = (key: string): string => base(`cashflow/dream/${key}.jpg`);

/** One engraved portrait per profession, for the player's statement. */
export const cfJobArt = (id: string): string => base(`cashflow/job/${id}.jpg`);
