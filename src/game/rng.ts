/* Counter-based PRNG. `rand(seed, cursor)` is a pure function, so the
 * generator has no hidden state: the whole of it lives in the two numbers
 * we already keep in GameState. Replaying (seed, actionLog) reproduces a
 * game exactly, which is what makes the netcode and the tests work. */

/** splitmix32 - fast, well-distributed, and stable across engines. */
function hash(a: number): number {
  let x = a | 0;
  x = (x + 0x9e3779b9) | 0;
  let z = x;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

/** Uniform float in [0, 1). */
export function rand(seed: number, cursor: number): number {
  return hash(hash(seed) ^ hash(cursor * 0x85ebca6b)) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function randInt(seed: number, cursor: number, min: number, max: number): number {
  return min + Math.floor(rand(seed, cursor) * (max - min + 1));
}

/** Two dice from consecutive cursor positions. Returns the new cursor too. */
export function rollDice(seed: number, cursor: number): {
  dice: [number, number];
  cursor: number;
} {
  const d1 = randInt(seed, cursor, 1, 6);
  const d2 = randInt(seed, cursor + 1, 1, 6);
  return { dice: [d1, d2], cursor: cursor + 2 };
}

/** Deterministic Fisher-Yates. Used once per deck at game start. */
export function shuffle<T>(items: readonly T[], seed: number, cursor: number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(seed, cursor + i, 0, i);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
