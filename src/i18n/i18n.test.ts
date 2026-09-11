import { describe, expect, it } from 'vitest';
// Read as text, not run: the check below is over what the source says.
import engineSource from '../game/engine.ts?raw';
import rulesSource from '../game/rules.ts?raw';
import { BOARD } from '../game/board';
import { CHANCE, CHEST } from '../game/cards';
import { describe as describeEvent, logLine } from '../game/describe';
import { botDecide } from '../game/ai';
import { createGame, reduce, type SeatSpec } from '../game/engine';
import { CLASSIC } from '../game/settings';
import type { GameEvent, GameState } from '../game/types';
import { dictFor, trReason, type Dict, type Lang } from './index';

const LANGS: Lang[] = ['en', 'ru', 'uz'];
const TRANSLATED: Lang[] = ['ru', 'uz'];

/** The structure of a dictionary with the words taken out: every key, every
 *  list length, and whether each leaf is text or a template. */
function shape(v: unknown): unknown {
  if (typeof v === 'function') return 'fn';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
  }
  return typeof v;
}

const withoutReasons = (d: Dict) => ({ ...d, reasons: null });

describe('dictionaries', () => {
  it.each(TRANSLATED)('%s has exactly the shape of English', (lang) => {
    // Catches a missing card, a forgotten preset, a help table one row short,
    // a board with 39 squares - everything TypeScript's Record types let by.
    expect(shape(withoutReasons(dictFor(lang)))).toEqual(shape(withoutReasons(dictFor('en'))));
  });

  it('names all forty squares in every language', () => {
    for (const lang of LANGS) {
      const d = dictFor(lang);
      expect(d.spaces).toHaveLength(BOARD.length);
      for (const [name, short] of d.spaces) {
        expect(name.trim()).not.toBe('');
        expect(short.trim()).not.toBe('');
      }
    }
  });

  it('prints every card in every language', () => {
    for (const lang of LANGS) {
      for (const card of [...CHANCE, ...CHEST]) {
        expect(dictFor(lang).cards[card.id]?.trim(), `${lang} ${card.id}`).toBeTruthy();
      }
    }
  });

  it('keeps every amount a card mentions', () => {
    // A translated card that says $100 where the engine pays $150 is worse
    // than an untranslated one.
    const amounts = (s: string) => (s.match(/\$\d{1,3}(?:,\d{3})*/g) ?? []).sort();
    for (const lang of TRANSLATED) {
      for (const card of [...CHANCE, ...CHEST]) {
        expect(amounts(dictFor(lang).cards[card.id]), `${lang} ${card.id}`).toEqual(amounts(card.text));
      }
    }
  });

  it('declines Russian counts', () => {
    const t = dictFor('ru');
    expect(t.lobby.players(1)).toBe('1 игрок');
    expect(t.lobby.players(3)).toBe('3 игрока');
    expect(t.lobby.players(5)).toBe('5 игроков');
    expect(t.lobby.players(11)).toBe('11 игроков');
    expect(t.lobby.players(21)).toBe('21 игрок');
  });

  it('takes the right Uzbek dative after k, g, q and gʻ', () => {
    const t = dictFor('uz');
    expect(t.log.tradeProposed('Ada', 'Farid')).toContain('Faridga');
    expect(t.log.tradeProposed('Ada', 'Erik')).toContain('Erikka');
    expect(t.log.tradeProposed('Ada', 'Tariq')).toContain('Tariqqa');
    expect(t.log.tradeProposed('Ada', 'Tog‘')).toContain('Tog‘qa');
  });
});

/* -------------------- the engine's own English -------------------- */

/** Every fixed string the engine and the rules can put in front of a player. */
function engineLiterals(): string[] {
  const rules = rulesSource;
  const engine = engineSource;
  const grab = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]);
  return [...new Set([
    ...grab(rules, /reason: '([^']+)'/g),
    ...grab(engine, /how: '([^']+)'/g),
    ...grab(engine, /sendToJail\([^)]*?'([^']+)'\)/g),
    ...grab(engine, /chargePlayer\([^;]*?'([^']+)'/g),
    ...grab(engine, /credit\([^;]*?'([^']+)'\)/g),
  ])];
}

describe('engine strings', () => {
  it('finds the strings it is checking', () => {
    const found = engineLiterals();
    // Guards the regexes: a refactor that hides the literals from them would
    // otherwise turn the next test into a pass that checks nothing.
    expect(found.length).toBeGreaterThanOrEqual(24);
    expect(found).toContain('You need the full colour set');
    expect(found).toContain('rolled three doubles');
    expect(found).toContain('jail fine');
  });

  it.each(TRANSLATED)('translates every one of them into %s', (lang) => {
    const t = dictFor(lang);
    const missing = engineLiterals().filter((raw) => trReason(t, raw) === raw);
    expect(missing).toEqual([]);
  });

  it('translates the templated ones', () => {
    const ru = dictFor('ru');
    expect(trReason(ru, 'rent on Boardwalk')).toBe('аренда за «Набережная»');
    expect(trReason(ru, 'You need $1500')).toBe('Нужно $1,500');
    expect(trReason(ru, 'Income Tax')).toBe('Подоходный налог');
    expect(trReason(ru, CHANCE[9].text)).toBe(ru.cards[CHANCE[9].id]);
  });

  it('leaves English, and anything unknown, as it was', () => {
    const en = dictFor('en');
    for (const raw of engineLiterals()) expect(trReason(en, raw)).toBe(raw);
    expect(trReason(en, 'rent on Boardwalk')).toBe('rent on Boardwalk');
    expect(trReason(dictFor('ru'), 'something new')).toBe('something new');
    expect(trReason(en, undefined)).toBeUndefined();
  });
});

/* ---------------------- whole games, every tongue ------------------- */

const seats = (n: number): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'topper' as const, color: '#fff', isBot: true,
  }));

/** Every event a few full bot games produce, with the state it landed on. */
function playedEvents(): { state: GameState; event: GameEvent }[] {
  const out: { state: GameState; event: GameEvent }[] = [];
  for (const seed of [7, 4242, 90210]) {
    let s = createGame({ ...CLASSIC, seed, winCondition: 'turn-limit', turnLimit: 60 }, seats(4));
    let r = reduce(s, { type: 'START_GAME', playerId: 'p0' });
    s = r.state;
    for (const event of r.events) out.push({ state: s, event });
    let guard = 0;
    while (s.phase !== 'game_over' && guard++ < 20000) {
      let acted = false;
      for (const pid of s.seats) {
        const a = botDecide(s, pid);
        if (!a) continue;
        r = reduce(s, a);
        if (r.state.version === s.version) continue;
        s = r.state;
        for (const event of r.events) out.push({ state: s, event });
        acted = true;
        break;
      }
      if (!acted) break;
    }
  }
  return out;
}

describe('the table log', () => {
  const played = playedEvents();

  it('plays enough to be worth checking', () => {
    const kinds = new Set(played.map((p) => p.event.type));
    for (const k of ['DICE_ROLLED', 'BOUGHT', 'RENT_PAID', 'CARD_DRAWN', 'JAILED', 'GAME_OVER']) {
      expect(kinds, k).toContain(k);
    }
  });

  it('says something for every line, in every language', () => {
    for (const lang of LANGS) {
      const t = dictFor(lang);
      for (const { state, event } of played) {
        if (!logLine(event, 0)) continue;
        expect(describeEvent(state, event, t).trim(), `${lang} ${event.type}`).not.toBe('');
      }
    }
  });

  it('never lets the engine’s English through in another language', () => {
    for (const lang of TRANSLATED) {
      const t = dictFor(lang);
      for (const { event } of played) {
        const raw = event.type === 'JAILED' ? event.reason
          : event.type === 'LEFT_JAIL' ? event.how
            : event.type === 'TAX_PAID' ? event.label
              : event.type === 'DEBT_INCURRED' ? event.reason
                : null;
        if (raw) expect(trReason(t, raw), `${lang} ${event.type}: ${raw}`).not.toBe(raw);
      }
    }
  });
});
