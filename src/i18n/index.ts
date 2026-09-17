import { create } from 'zustand';
import { BOARD } from '../game/board';
import type { BoardTheme } from '../game/types';
import { CHANCE, CHEST } from '../game/cards';
import { en, type Dict } from './en';
import { ru } from './ru';
import { uz } from './uz';
import { themeCards, themeSpaces, BOARD_THEMES } from './themes';

/* ------------------------------------------------------------------ *
 * Which language this player reads the game in.
 *
 * Per browser, never per room: every player at a table can read it in a
 * different language, because nothing that crosses the wire is text. The
 * engine keeps speaking English internally - its reasons and labels are
 * data the host broadcasts - and each client turns them into its own
 * language at the moment it draws them.
 * ------------------------------------------------------------------ */

export type Lang = 'en' | 'ru' | 'uz';

export const LANGS: readonly { id: Lang; short: string }[] = [
  { id: 'en', short: 'EN' },
  { id: 'ru', short: 'RU' },
  { id: 'uz', short: 'UZ' },
];

const DICTS: Record<Lang, Dict> = { en, ru, uz };
const KEY = 'mply.lang';

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru' || v === 'uz';

/** A saved choice wins; otherwise the first browser language we speak. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch { /* private mode */ }
  try {
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const pref of prefs) {
      const code = pref.toLowerCase().slice(0, 2);
      if (isLang(code)) return code;
    }
  } catch { /* no navigator */ }
  return 'en';
}

function stampDocument(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

const useLangStore = create<{ lang: Lang; setLang: (lang: Lang) => void }>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
    stampDocument(lang);
    set({ lang });
  },
}));

stampDocument(useLangStore.getState().lang);

export const useLang = (): Lang => useLangStore((s) => s.lang);
export const useSetLang = (): ((lang: Lang) => void) => useLangStore((s) => s.setLang);

/* A board theme (Party Hall Plus) is words, like a language: the squares a
 * table plays on are renamed in the dictionary itself. So everything that
 * already reads a name through the dictionary - tiles, deeds, the log, the
 * cards, the reasons - follows the table's board without knowing boards
 * exist. The store sets it from the room (see net/plus.ts, roomTheme). */

/** Preview override: ?board=tashkent dresses the board in a theme without a
 *  Plus seat at the table. Read once, from query or hash, the way the art
 *  variants are in art/art.ts. */
function readThemeOverride(): BoardTheme | null {
  try {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    for (const p of [new URLSearchParams(window.location.search), new URLSearchParams(hashQuery)]) {
      const v = p.get('board');
      if (v && (BOARD_THEMES as readonly string[]).includes(v)) return v as BoardTheme;
    }
  } catch { /* no window, or an exotic URL */ }
  return null;
}

const THEME_OVERRIDE = readThemeOverride();

const useThemeStore = create<{ theme: BoardTheme }>(() => ({ theme: THEME_OVERRIDE ?? 'silk' }));

export const setBoardTheme = (theme: BoardTheme): void => {
  const next = THEME_OVERRIDE ?? theme;
  if (useThemeStore.getState().theme !== next) useThemeStore.setState({ theme: next });
};
export const useBoardTheme = (): BoardTheme => useThemeStore((s) => s.theme);

/** The same, outside React: canvas tile faces, which never see a hook. */
export const boardTheme = (): BoardTheme => useThemeStore.getState().theme;

const themed = new Map<string, Dict>();

/** One dictionary object per language and board, so memoised components see
 *  a new object exactly when what they print has changed. */
function dictWith(lang: Lang, theme: BoardTheme): Dict {
  const base = DICTS[lang];
  if (theme === 'silk') return base;
  const key = `${lang}:${theme}`;
  const known = themed.get(key);
  if (known) return known;
  const over = themeSpaces(theme, lang);
  const spaces = base.spaces.map((pair, id) => over[id] ?? pair) as Dict['spaces'];
  const nameOf = (id: number): string => spaces[id]?.[0] ?? BOARD[id].name;
  const dict: Dict = { ...base, spaces, cards: { ...base.cards, ...themeCards(theme, lang, nameOf) } };
  themed.set(key, dict);
  return dict;
}

/** The dictionary for the current language and board. Re-renders on a switch. */
export const useT = (): Dict => {
  const lang = useLangStore((s) => s.lang);
  const theme = useThemeStore((s) => s.theme);
  return dictWith(lang, theme);
};

/** The same, outside React: network errors, the store, canvas faces. */
export const tr = (): Dict => dictWith(useLangStore.getState().lang, useThemeStore.getState().theme);

export const dictFor = (lang: Lang): Dict => DICTS[lang];

export const spaceName = (t: Dict, id: number): string => t.spaces[id]?.[0] ?? BOARD[id].name;
export const spaceShort = (t: Dict, id: number): string => t.spaces[id]?.[1] ?? BOARD[id].short;

/* ------------------------- engine strings -------------------------- */

const SPACE_BY_NAME = new Map<string, number>();
for (const sp of BOARD) if (!SPACE_BY_NAME.has(sp.name)) SPACE_BY_NAME.set(sp.name, sp.id);

const CARD_BY_TEXT = new Map<string, string>();
for (const c of [...CHANCE, ...CHEST]) CARD_BY_TEXT.set(c.text, c.id);

/**
 * Translate a string the engine or the rules produced - a debt reason, a
 * jail reason, the reason a button is disabled. They are a closed set: fixed
 * phrases, a space name, a card's text, or one of two templates. Anything
 * unrecognised comes back unchanged rather than blank, so a new engine
 * string degrades to English instead of disappearing.
 */
export function trReason(t: Dict, raw: string): string;
export function trReason(t: Dict, raw: string | undefined): string | undefined;
export function trReason(t: Dict, raw: string | undefined): string | undefined {
  if (raw == null) return raw;
  const fixed = t.reasons[raw];
  if (fixed) return fixed;

  const card = CARD_BY_TEXT.get(raw);
  if (card) return t.cards[card] ?? raw;

  const space = SPACE_BY_NAME.get(raw);
  if (space != null) return spaceName(t, space);

  const rent = /^rent on (.+)$/.exec(raw);
  if (rent && SPACE_BY_NAME.has(rent[1])) {
    return t.reasonFns.rentOn(spaceName(t, SPACE_BY_NAME.get(rent[1])!));
  }

  const need = /^You need \$(\d+)$/.exec(raw);
  if (need) return t.reasonFns.youNeed(`$${Number(need[1]).toLocaleString('en-US')}`);

  return raw;
}

/** First letter up, for a reason that starts a sentence. */
export const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export type { Dict };
