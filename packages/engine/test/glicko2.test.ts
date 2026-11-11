import { describe, expect, it } from "vitest";
import { NEW_RATING, dutyResults, paceScore, performanceRating, tierFor, updateRating } from "../src/rating/glicko2.js";

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

  it("performanceRating reads a score off the line through the thresholds", () => {
    const thresholds = [
      { score: 100, rating: 1100 },
      { score: 300, rating: 1300 },
      { score: 500, rating: 1500 },
    ];
    expect(performanceRating(100, thresholds)).toBe(1100);
    expect(performanceRating(300, thresholds)).toBe(1300);
    expect(performanceRating(400, thresholds)).toBe(1400);
    // Below the first threshold the line runs to one step under it at a score of 0.
    expect(performanceRating(0, thresholds)).toBe(900);
    expect(performanceRating(50, thresholds)).toBe(1000);
    expect(performanceRating(-20, thresholds)).toBe(900);
    // Above the top it carries on at the last step's slope.
    expect(performanceRating(700, thresholds)).toBe(1700);
    expect(performanceRating(1500, thresholds)).toBe(2500);
  });

  it("paceScore reads a stretch of play as a whole round at that pace", () => {
    // 30 points in 10 seconds, kept up for 150, is a round of 450.
    expect(paceScore(30, 10, 150)).toBe(450);
    expect(paceScore(0, 10, 150)).toBe(0);
    // A stretch that lost points reads as nothing, never as less.
    expect(paceScore(-40, 10, 150)).toBe(0);
    expect(Number.isInteger(paceScore(7, 30, 120))).toBe(true);
    // A whole round as the window is the round's own score.
    expect(paceScore(440, 150, 150)).toBe(440);
  });

  it("performanceRating is whole and never falls with a higher score", () => {
    const thresholds = [
      { score: 60, rating: 1100 },
      { score: 150, rating: 1300 },
      { score: 300, rating: 1500 },
    ];
    let last = -1;
    for (let s = 0; s <= 1000; s += 7) {
      const r = performanceRating(s, thresholds);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});
