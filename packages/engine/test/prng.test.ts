import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextChance, nextInt, nextUint32, seedFromString } from "../src/prng.js";

describe("prng", () => {
  it("is deterministic for the same seed", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 200 }), (seed, n) => {
        let a = seedFromString(seed);
        let b = seedFromString(seed);
        for (let i = 0; i < n; i++) {
          const ra = nextUint32(a);
          const rb = nextUint32(b);
          expect(ra.value).toBe(rb.value);
          a = ra.state;
          b = rb.state;
        }
      }),
    );
  });

  it("differs for different seeds", () => {
    const a = nextUint32(seedFromString("a")).value;
    const b = nextUint32(seedFromString("b")).value;
    expect(a).not.toBe(b);
  });

  it("nextInt stays in range", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        let s = seedFromString(seed);
        for (let i = 0; i < 50; i++) {
          const r = nextInt(s, n);
          expect(r.value).toBeGreaterThanOrEqual(0);
          expect(r.value).toBeLessThan(n);
          s = r.state;
        }
      }),
    );
  });

  it("nextInt is roughly uniform", () => {
    let s = seedFromString("uniform");
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const r = nextInt(s, 6);
      counts[r.value]!++;
      s = r.state;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600);
  });

  it("nextChance never fires at 0 and always at 1000/1000", () => {
    let s = seedFromString("chance");
    for (let i = 0; i < 100; i++) {
      expect(nextChance(s, 0, 1000).value).toBe(false);
      expect(nextChance(s, 1000, 1000).value).toBe(true);
      s = nextUint32(s).state;
    }
  });

  it("pins the sequence so a future refactor cannot silently change every seeded board", () => {
    let s = seedFromString("openseas");
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextUint32(s);
      out.push(r.value);
      s = r.state;
    }
    expect(out).toMatchInlineSnapshot(`
      [
        1336542355,
        4162864206,
        1217186865,
        517288106,
      ]
    `);
  });
});
