/**
 * Deterministic PRNG for every engine. sfc32 (Chris Doty-Humphrey) seeded from a string via a
 * 128-bit mixing hash. Everything is 32-bit integer arithmetic so the sequence is identical on
 * every JavaScript engine. Never use floating point to derive integers from this generator.
 */

export interface PrngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/** cyrb128-style string hash producing four 32-bit words. */
export function seedFromString(seed: string): PrngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const state: PrngState = {
    a: (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    b: h2 >>> 0,
    c: h3 >>> 0,
    d: h4 >>> 0,
  };
  // Discard the first outputs so similar seeds diverge quickly.
  let s = state;
  for (let i = 0; i < 12; i++) s = nextUint32(s).state;
  return s;
}

/** Advance the generator by one step. Returns the new state and a uniform 32-bit integer. */
export function nextUint32(s: PrngState): { state: PrngState; value: number } {
  let { a, b, c, d } = s;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  const value = (t + d) >>> 0;
  c = (c + value) | 0;
  return { state: { a: a >>> 0, b: b >>> 0, c: c >>> 0, d: d >>> 0 }, value };
}

/**
 * Uniform integer in [0, n). Uses rejection sampling so the result is unbiased and depends only
 * on integer arithmetic.
 */
export function nextInt(s: PrngState, n: number): { state: PrngState; value: number } {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`nextInt: n must be a positive integer, got ${n}`);
  const limit = 4294967296 - (4294967296 % n);
  let state = s;
  for (;;) {
    const r = nextUint32(state);
    state = r.state;
    if (r.value < limit) return { state, value: r.value % n };
  }
}

/** True with probability `numerator / denominator`. */
export function nextChance(
  s: PrngState,
  numerator: number,
  denominator: number,
): { state: PrngState; value: boolean } {
  const r = nextInt(s, denominator);
  return { state: r.state, value: r.value < numerator };
}
