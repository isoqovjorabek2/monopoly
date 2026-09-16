import { afterEach, describe, expect, it } from 'vitest';
import { BOARD } from '../game/board';
import { CHANCE } from '../game/cards';
import { CLASSIC } from '../game/settings';
import { dictFor, setBoardTheme, spaceName, spaceShort, tr, trReason } from '../i18n';
import { BOARD_THEMES, themeSpaces } from '../i18n/themes';
import { cleanSkin, roomTheme, SKINS, tablePlus } from './plus';
import type { RoomSnapshot, SeatInfo } from './protocol';

/* ------------------------------------------------------------------ *
 * Party Hall Plus at the table: who unlocks it, which board shows, and
 * that a theme renames words without touching anything the engine uses.
 * ------------------------------------------------------------------ */

const seat = (playerId: string, extra: Partial<SeatInfo> = {}): SeatInfo => ({
  playerId, name: playerId, token: 'camel', color: '#fff', isBot: false, botLevel: 'normal',
  isHost: false, connected: true, ping: 0, ...extra,
});

const room = (seats: SeatInfo[], extra: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  roomId: 'ROOM', hostId: seats[0]?.playerId ?? 'h', kind: 'monopoly', seats,
  settings: { ...CLASSIC, boardTheme: 'tashkent' }, cfRules: {} as RoomSnapshot['cfRules'],
  game: null, cf: null, epoch: 0, rev: 0, ...extra,
});

afterEach(() => setBoardTheme('silk'));

describe('a Plus table', () => {
  it('is unlocked by any person holding Plus, and never by a bot', () => {
    expect(tablePlus(room([seat('a'), seat('b', { plus: true })]))).toBe(true);
    expect(tablePlus(room([seat('a'), seat('bot', { plus: true, isBot: true })]))).toBe(false);
    expect(tablePlus(room([seat('a')]))).toBe(false);
  });

  it('shows a chosen theme only while a Plus player sits in the lobby', () => {
    expect(roomTheme(room([seat('a', { plus: true })]))).toBe('tashkent');
    expect(roomTheme(room([seat('a')]))).toBe('silk');
  });

  it('keeps the board a game started on, whoever leaves', () => {
    const started = room([seat('a')], { game: {} as RoomSnapshot['game'] });
    expect(roomTheme(started)).toBe('tashkent');
  });

  it('draws Nest Egg tables and old tables with no theme as they always were', () => {
    expect(roomTheme(room([seat('a', { plus: true })], { kind: 'cashflow' }))).toBe('silk');
    const old = room([seat('a', { plus: true })]);
    delete old.settings.boardTheme;
    expect(roomTheme(old)).toBe('silk');
  });
});

describe('board themes', () => {
  it('rename the squares in every language, and nothing on the Silk Road', () => {
    setBoardTheme('europe');
    expect(spaceName(tr(), 39)).toBe('Paris');
    setBoardTheme('tashkent');
    expect(spaceName(tr(), 23)).toBe('Chorsu Bazaar');
    expect(spaceShort(tr(), 23)).toBe('Chorsu');
    setBoardTheme('silk');
    expect(spaceName(tr(), 39)).toBe('Tashkent');
  });

  it('leave the corners, taxes and decks alone', () => {
    setBoardTheme('europe');
    for (const id of [0, 2, 4, 7, 10, 20, 30, 38]) expect(spaceName(tr(), id)).toBe(BOARD[id].name);
  });

  it('cover exactly the same squares in every language', () => {
    for (const theme of BOARD_THEMES) {
      const ids = (lang: 'en' | 'ru' | 'uz') => Object.keys(themeSpaces(theme, lang)).sort().join(',');
      expect(ids('ru')).toBe(ids('en'));
      expect(ids('uz')).toBe(ids('en'));
    }
  });

  it('translate engine strings into the board being played', () => {
    setBoardTheme('europe');
    // The engine still says the base name; the reader sees the theme's.
    expect(trReason(tr(), 'rent on Tashkent')).toBe('rent on Paris');
    expect(tr().cards.ch16).toContain('Paris');
    expect(tr().cards[CHANCE[9].id]).toBe(dictFor('en').cards[CHANCE[9].id]);
  });

  it('never change the base dictionaries the tests and the engine read', () => {
    setBoardTheme('europe');
    expect(spaceName(dictFor('en'), 39)).toBe('Tashkent');
  });
});

describe('finishes', () => {
  it('only lets through finishes this build can draw', () => {
    for (const f of SKINS) expect(cleanSkin(f)).toBe(f);
    expect(cleanSkin('rainbow')).toBe('classic');
    expect(cleanSkin(undefined)).toBe('classic');
    expect(cleanSkin({ toString: () => 'gilded' })).toBe('classic');
  });
});
