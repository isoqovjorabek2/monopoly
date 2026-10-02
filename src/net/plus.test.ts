import { afterEach, describe, expect, it } from 'vitest';
import { BOARD } from '../game/board';
import { CHANCE } from '../game/cards';
import { CLASSIC } from '../game/settings';
import { dictFor, setBoardTheme, spaceName, spaceShort, tr, trReason } from '../i18n';
import { BOARD_THEMES, themeSpaces } from '../i18n/themes';
import { boardsOpen, cleanSkin, plusWinners, roomTheme, SKINS, tablePlus } from './plus';
import { plusMoments } from './plusMoments';
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
  settings: { ...CLASSIC, boardTheme: 'tashkent' }, cfRules: {} as RoomSnapshot['cfRules'], mafRules: {} as RoomSnapshot['mafRules'], mf: null,
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

  it('opens the boards for one game when the host watched a video', () => {
    const trial = room([seat('a')], { themeTrial: true });
    expect(boardsOpen(trial)).toBe(true);
    expect(tablePlus(trial)).toBe(false);
    expect(roomTheme(trial)).toBe('tashkent');
    expect(roomTheme(room([seat('a')], { themeTrial: false }))).toBe('silk');
  });

  it('draws Nest Egg tables and old tables with no theme as they always were', () => {
    expect(roomTheme(room([seat('a', { plus: true })], { kind: 'cashflow' }))).toBe('silk');
    const old = room([seat('a', { plus: true })]);
    delete old.settings.boardTheme;
    expect(roomTheme(old)).toBe('silk');
  });
});

describe('the winner\'s confetti', () => {
  const over = (winnerId: string | null) => ({ phase: 'game_over', winnerId }) as RoomSnapshot['game'];

  it('falls for a Plus player who won, and nobody else', () => {
    const seats = [seat('a', { plus: true }), seat('b')];
    expect(plusWinners(room(seats, { game: over('a') }))).toEqual(['a']);
    expect(plusWinners(room(seats, { game: over('b') }))).toEqual([]);
    expect(plusWinners(room(seats, { game: { phase: 'preroll', winnerId: null } as RoomSnapshot['game'] }))).toEqual([]);
    expect(plusWinners(room([seat('bot', { plus: true, isBot: true })], { game: over('bot') }))).toEqual([]);
    expect(plusWinners(room(seats, { kind: 'cashflow', cf: over('a') as unknown as RoomSnapshot['cf'] }))).toEqual(['a']);
  });

  it('falls for every Plus seat on the side that took an Omertà table', () => {
    const seats = [seat('a', { plus: true }), seat('b', { plus: true }), seat('c')];
    const mf = (extra: object) => ({
      phase: 'game_over', winner: 'village', winnerId: null,
      finalRoles: { a: 'doctor', b: 'godfather', c: 'villager' }, ...extra,
    }) as unknown as RoomSnapshot['mf'];
    expect(plusWinners(room(seats, { kind: 'mafia', mf: mf({}) }))).toEqual(['a']);
    expect(plusWinners(room(seats, { kind: 'mafia', mf: mf({ winner: 'mafia' }) }))).toEqual(['b']);
    expect(plusWinners(room(seats, { kind: 'mafia', mf: mf({ winner: 'jester', winnerId: 'c' }) }))).toEqual([]);
  });
});

describe('Plus moments', () => {
  const seats = [seat('a', { plus: true }), seat('b'), seat('bot', { plus: true, isBot: true })];
  const table = room(seats);

  it('mark a Plus player\'s turn, purchase and rent, and nobody else\'s', () => {
    expect(plusMoments(table, [
      { type: 'TURN_STARTED', playerId: 'a', turnNumber: 3 },
      { type: 'BOUGHT', playerId: 'a', spaceId: 1, price: 60 },
      { type: 'RENT_PAID', from: 'b', to: 'a', amount: 10, spaceId: 1 },
      { type: 'TURN_STARTED', playerId: 'b', turnNumber: 4 },
      { type: 'BOUGHT', playerId: 'bot', spaceId: 3, price: 60 },
      { type: 'RENT_PAID', from: 'a', to: 'b', amount: 10, spaceId: 5 },
    ])).toEqual([{ kind: 'turn', playerId: 'a' }, { kind: 'coins', playerId: 'a' }]);
  });

  it('cover Nest Egg\'s escape and an Omertà night survived', () => {
    expect(plusMoments(table, [{ type: 'ESCAPED', playerId: 'a', income: 5000 }])).toEqual([{ kind: 'escape', playerId: 'a' }]);
    expect(plusMoments(table, [{ type: 'DAWN', round: 2, deaths: [], saved: ['a', 'b'], silenced: [] }]))
      .toEqual([{ kind: 'saved', playerId: 'a' }]);
  });

  it('are nothing at a table with no Plus player', () => {
    expect(plusMoments(room([seat('a'), seat('b')]), [{ type: 'TURN_STARTED', playerId: 'a', turnNumber: 1 }])).toEqual([]);
    expect(plusMoments(null, [{ type: 'TURN_STARTED', playerId: 'a', turnNumber: 1 }])).toEqual([]);
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
