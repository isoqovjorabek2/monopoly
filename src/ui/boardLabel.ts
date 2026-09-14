/* ------------------------------------------------------------------ *
 * Tile labels that fit the tile.
 *
 * A board on a phone held sideways is about 330px across, which leaves a
 * tile 25px wide. "MEDITERRANEAN" in that width comes out at 5.5px, and
 * "Средиземноморский" smaller still - measured, not guessed, and less than
 * half of the 13px or so a label needs to be read. No choice of font closes
 * a gap that size. Printing fewer letters does: the colour band already
 * says which set, so a tile only needs enough of its name to be told apart
 * from its neighbours, and the full name is a tap away.
 *
 * So every word longer than the tier allows is cut to its first letters and
 * a full stop. Characters are counted as code points, not UTF-16 units, so
 * Cyrillic and the Uzbek apostrophe letters are cut where a reader would cut
 * them.
 * ------------------------------------------------------------------ */

/** The longest word each size of board prints. */
export const LABEL_TIERS = {
  /** A laptop-sized board, tiles roughly 40-70px wide. */
  mid: 8,
  /** A phone-sized board, tiles roughly 25-35px wide. */
  tiny: 5,
} as const;

/** Punctuation a cut word should not end on before its own full stop. */
const TRAILING = /[.,'’‘\-&]+$/u;

/** Shorten every word longer than `max` characters to `max - 1` letters and a full stop. */
export function abbreviate(label: string, max: number): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const letters = Array.from(word);
      if (letters.length <= max) return word;
      return `${letters.slice(0, Math.max(1, max - 1)).join('').replace(TRAILING, '')}.`;
    })
    .join(' ');
}

/**
 * How wide an average capital is in the board's display face, in em.
 *
 * The type is sized as tile width / (letters x advance), so this has to be
 * honest per script. Oswald's Cyrillic capitals are noticeably wider than its
 * Latin ones: sized with the Latin figure, Russian eight-letter words wrapped
 * mid-word on a laptop ("ИНДИАН/А"). Short labels budget wider still, because
 * one wide letter in five moves the average far more than one in thirteen.
 */
export function labelAdvance(label: string, tier: 'full' | 'mid' | 'tiny'): number {
  const cyrillic = /[Ѐ-ӿ]/u.test(label);
  if (tier === 'tiny') return cyrillic ? 0.76 : 0.64;
  return cyrillic ? 0.68 : 0.54;
}

/** The longest word in characters, which is what the type has to be sized to fit. */
export function longestWord(label: string): number {
  return Math.max(1, ...label.split(/\s+/).map((word) => Array.from(word).length));
}
