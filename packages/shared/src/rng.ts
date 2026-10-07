/** Seeded PRNG state — serialisable (plain number). mulberry32. */
export type Rng = { s: number };

export function rngFromSeed(seed: number): Rng {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

/** Advances the RNG; returns [nextRng, float in [0,1)]. Pure. */
export function rngNext(r: Rng): [Rng, number] {
  let t = (r.s + 0x6d2b79f5) >>> 0;
  const next: Rng = { s: t };
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [next, v];
}

/** Integer in [0, n). Pure. */
export function rngInt(r: Rng, n: number): [Rng, number] {
  const [nr, v] = rngNext(r);
  return [nr, Math.floor(v * n)];
}

/** Picks an element. Pure. */
export function rngPick<T>(r: Rng, arr: readonly T[]): [Rng, T] {
  const [nr, i] = rngInt(r, arr.length);
  return [nr, arr[i] as T];
}

/** Fisher-Yates shuffle (returns a new array). Pure. */
export function rngShuffle<T>(r: Rng, arr: readonly T[]): [Rng, T[]] {
  const out = arr.slice();
  let rng = r;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [rng, j] = rngInt(rng, i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [rng, out];
}

/** Hash a string to a 32-bit seed (FNV-1a). */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Non-deterministic seed for new sessions (server side only). */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
