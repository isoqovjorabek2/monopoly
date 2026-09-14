import { describe, expect, it } from 'vitest';
import { BOARD } from '../game/board';
import { dictFor, spaceShort, type Lang } from '../i18n';
import { LABEL_TIERS, abbreviate, labelAdvance, longestWord } from './boardLabel';

describe('abbreviate', () => {
  it('leaves words that already fit alone', () => {
    expect(abbreviate('Water Works', LABEL_TIERS.tiny)).toBe('Water Works');
    expect(abbreviate('Kentucky', LABEL_TIERS.mid)).toBe('Kentucky');
  });

  it('cuts long words to their first letters and a full stop', () => {
    expect(abbreviate('Mediterranean', LABEL_TIERS.mid)).toBe('Mediter.');
    expect(abbreviate('St. Charles', LABEL_TIERS.tiny)).toBe('St. Char.');
    expect(abbreviate('Electric Co.', LABEL_TIERS.tiny)).toBe('Elec. Co.');
  });

  it('counts letters, not UTF-16 units', () => {
    expect(abbreviate('Средиземноморский', LABEL_TIERS.tiny)).toBe('Сред.');
    expect(longestWord('Средиземноморский')).toBe(17);
  });

  it('budgets wider letters for Cyrillic and for short labels', () => {
    expect(labelAdvance('Индиана', 'mid')).toBeGreaterThan(labelAdvance('Indiana', 'mid'));
    expect(labelAdvance('Ind.', 'tiny')).toBeGreaterThan(labelAdvance('Indiana', 'mid'));
    expect(labelAdvance('Pensilvaniya', 'full')).toBe(labelAdvance('Pennsylvania', 'full'));
  });

  it('never ends a cut word on its own punctuation', () => {
    expect(abbreviate('Abc-defghij', 5)).toBe('Abc.');
  });

  // The guarantee the type sizing relies on: at a given tier, no printed word
  // is ever longer than the tier, in any language the game ships.
  it.each(['en', 'ru', 'uz'] as Lang[])('keeps every %s tile name within each tier', (lang) => {
    const t = dictFor(lang);
    for (const max of Object.values(LABEL_TIERS)) {
      for (const space of BOARD) {
        const label = abbreviate(spaceShort(t, space.id), max);
        expect(longestWord(label), `${lang} "${label}"`).toBeLessThanOrEqual(max);
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});
