import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { performanceOf, settleEvent, stepped, tierOf, TIERS } from "../src/index.js";
import { SCALE } from "./helpers.js";

describe("multipliers", () => {
  test("multipliers that meet on one event multiply together, and the result is rounded down once", () => {
    // The guide's example: a closed path of 6 on a streak at 130%: 36, doubled to 72, then 93.6, rounded down to 93.
    const path = settleEvent([{ payout: "path", base: 36 }], [{ percent: 200, scales: ["path"] }, { percent: 130, scales: ["path", "inside"] }]);
    expect(path).toEqual({ points: 93, paid: { path: 93 } });
    // Rounding each multiplier down in turn would lose a point here: 7 × 150% = 10.5, × 150% = 15.75.
    expect(settleEvent([{ payout: "a", base: 7 }], [{ percent: 150, scales: ["a"] }, { percent: 150, scales: ["a"] }]).points).toBe(15);
  });

  test("a multiplier scales only the payouts it names, and the event is rounded down once across them", () => {
    // 5 × 130% = 6.5 and 3 × 130% = 3.9: 10.4 together, so 10, where rounding each down would give 9.
    const both = settleEvent([{ payout: "a", base: 5 }, { payout: "b", base: 3 }], [{ percent: 130, scales: ["a", "b"] }]);
    expect(both.points).toBe(10);
    expect(both.paid).toEqual({ a: 6, b: 4 });
    const one = settleEvent([{ payout: "a", base: 5 }, { payout: "b", base: 3 }], [{ percent: 200, scales: ["a"] }]);
    expect(one).toEqual({ points: 13, paid: { a: 10, b: 3 } });
  });

  test("an event's points are always split by payout exactly, and no payout is paid more than a point over its share", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.record({ percent: fc.integer({ min: 0, max: 1000 }), mask: fc.integer({ min: 0, max: 31 }) }), { maxLength: 4 }),
        (bases, ms) => {
          const pays = bases.map((base, i) => ({ payout: `p${i}`, base }));
          const multipliers = ms.map((m) => ({ percent: m.percent, scales: pays.filter((_, i) => (m.mask >> i) & 1).map((p) => p.payout) }));
          const { points, paid } = settleEvent(pays, multipliers);
          const exact = pays.map((p) => multipliers.reduce((x, m) => (m.scales.includes(p.payout) ? (x * m.percent) / 100 : x), p.base));
          expect(Object.values(paid).reduce((a, b) => a + b, 0)).toBe(points);
          expect(Math.abs(points - Math.floor(exact.reduce((a, b) => a + b, 0) + 1e-6))).toBeLessThanOrEqual(1);
          pays.forEach((p, i) => expect(Math.abs(paid[p.payout]! - exact[i]!)).toBeLessThan(1 + 1e-6));
        },
      ),
    );
  });

  test("a table's last entry holds", () => {
    expect([1, 2, 3, 4, 9].map((n) => stepped([100, 250, 450, 700], n))).toEqual([100, 250, 450, 700, 700]);
    expect(stepped([100], 0)).toBe(0);
  });
});

describe("tiers and performance", () => {
  const starts = { steady: 850, sharp: 2450, masterful: 4800, legendary: 8400 };

  test("a tier begins exactly at its tier start, and performance runs in straight lines between them", () => {
    expect(performanceOf(0, starts, SCALE)).toBe(1000);
    expect(performanceOf(850, starts, SCALE)).toBe(1300);
    expect(performanceOf(849, starts, SCALE)).toBeLessThan(1300);
    expect(performanceOf(2450, starts, SCALE)).toBe(1600);
    expect(performanceOf((850 + 2450) / 2, starts, SCALE)).toBe(1450);
    expect(performanceOf(4800, starts, SCALE)).toBe(1900);
    expect(performanceOf(8400, starts, SCALE)).toBe(2200);
    expect(performanceOf(1e9, starts, SCALE)).toBe(2500);
    expect([849, 850, 2449, 2450, 4799, 4800, 8399, 8400].map((s) => tierOf(performanceOf(s, starts, SCALE), SCALE))).toEqual(["green", "steady", "steady", "sharp", "sharp", "masterful", "masterful", "legendary"]);
  });

  test("a better score is never a worse performance", () => {
    fc.assert(
      fc.property(fc.nat(20_000), fc.nat(20_000), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(performanceOf(lo, starts, SCALE)).toBeLessThanOrEqual(performanceOf(hi, starts, SCALE));
        expect(TIERS.indexOf(tierOf(performanceOf(lo, starts, SCALE), SCALE))).toBeLessThanOrEqual(TIERS.indexOf(tierOf(performanceOf(hi, starts, SCALE), SCALE)));
      }),
    );
  });
});
