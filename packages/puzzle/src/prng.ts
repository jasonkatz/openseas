/**
 * How a stream is made (docs/puzzles/DOMAIN.md, "Streams"): sfc32 seeded from a string through a
 * 128-bit mixing hash. Everything is 32-bit whole-number arithmetic, so a stream gives the same
 * run on every JavaScript runtime. Nothing here keeps state: each step returns the next one.
 */

export interface StreamState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/** The start of the stream a text names. */
export function streamFrom(text: string): StreamState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  let s: StreamState = { a: (h1 ^ h2 ^ h3 ^ h4) >>> 0, b: h2 >>> 0, c: h3 >>> 0, d: h4 >>> 0 };
  // The first outputs are thrown away so seeds that look alike part at once.
  for (let i = 0; i < 12; i++) s = next32(s)[1];
  return s;
}

/** One step: a whole number of 32 bits, and the stream after it. */
export function next32(s: StreamState): readonly [number, StreamState] {
  let { a, b, c, d } = s;
  const t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  const value = (t + d) >>> 0;
  c = (c + value) | 0;
  return [value, { a: a >>> 0, b: b >>> 0, c: c >>> 0, d: d >>> 0 }];
}

/** A whole number from 0 to n - 1, each alike. Values that would lean are thrown away, so none is favoured. */
export function nextBelow(s: StreamState, n: number): readonly [number, StreamState] {
  if (!Number.isInteger(n) || n <= 0 || n > 4294967296) throw new Error(`a roll needs a whole number of sides from 1, got ${n}`);
  const limit = 4294967296 - (4294967296 % n);
  let state = s;
  for (;;) {
    const [value, after] = next32(state);
    state = after;
    if (value < limit) return [value % n, state];
  }
}
