import { describe, expect, it } from "vitest";
import { NEW_RATING, dutyResults, tierFor, updateRating } from "../src/rating/glicko2.js";

describe("glicko2", () => {
  it("reproduces the worked example from the Glicko-2 paper", () => {
    const player = { rating: 1500, deviation: 200, volatility: 0.06 };
    const next = updateRating(
      player,
      [
        { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
      ],
      0.5,
    );
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.deviation).toBeCloseTo(151.52, 1);
    expect(next.volatility).toBeCloseTo(0.05999, 4);
  });

  it("grows deviation when idle", () => {
    const r = updateRating({ rating: 1500, deviation: 100, volatility: 0.06 }, []);
    expect(r.rating).toBe(1500);
    expect(r.deviation).toBeGreaterThan(100);
  });

  it("wins raise the rating and losses lower it", () => {
    const opp = { rating: 1500, deviation: 60, volatility: 0.06 };
    expect(updateRating(NEW_RATING, [{ opponent: opp, score: 1 }]).rating).toBeGreaterThan(1500);
    expect(updateRating(NEW_RATING, [{ opponent: opp, score: 0 }]).rating).toBeLessThan(1500);
  });

  it("dutyResults beats every threshold at or below the score", () => {
    const thresholds = [
      { score: 100, rating: 1200 },
      { score: 300, rating: 1500 },
      { score: 600, rating: 1800 },
    ];
    expect(dutyResults(300, thresholds).map((r) => r.score)).toEqual([1, 1, 0]);
    expect(dutyResults(0, thresholds).map((r) => r.score)).toEqual([0, 0, 0]);
  });

  it("tierFor picks the highest tier reached", () => {
    const tiers = [
      { key: "a", min: 0 },
      { key: "b", min: 1400 },
      { key: "c", min: 1700 },
    ];
    expect(tierFor(1000, tiers).key).toBe("a");
    expect(tierFor(1400, tiers).key).toBe("b");
    expect(tierFor(2500, tiers).key).toBe("c");
  });
});
