import { describe, expect, it } from "vitest";
import { ROUNDS_KEPT, ROUNDS_TOLD, keepRound, sameNumbers, scoreDelta, toldRounds, type PlayedRound, type RoundNote } from "../src/frame/rounds.js";

const note = (score: number, overrides: Record<string, unknown> = {}): RoundNote => ({
  summary: { seed: `s${score}`, score, tier: null, seconds: 60, moves: 10, tuned: Object.keys(overrides).length > 0 },
  bestCombo: 2,
  changes: Object.entries(overrides).map(([key, value]) => ({ key, shipped: 0, value })),
  numbers: { stage: null, overrides, roundSeconds: null, paceSeconds: null, thresholds: null },
});

const played = (...scores: number[]): PlayedRound[] => scores.reduce<PlayedRound[]>((all, s) => keepRound(all, note(s)), []);

describe("the rounds a studio page keeps (ADR 0067)", () => {
  it("keeps the last twenty with ids that count up, and tells the agent only the last five summaries", () => {
    const all = played(...Array.from({ length: 30 }, (_, i) => i));
    expect(all).toHaveLength(ROUNDS_KEPT);
    expect(all[0]!.id).toBe(11);
    expect(all.at(-1)!.id).toBe(30);
    const told = toldRounds(all);
    expect(told).toHaveLength(ROUNDS_TOLD);
    expect(told.map((r) => r.score)).toEqual([25, 26, 27, 28, 29]);
    expect(Object.keys(told[0]!).sort()).toEqual(["moves", "score", "seconds", "seed", "tier", "tuned"]);
  });

  it("measures a round against the one before it, or against the baseline once one is picked", () => {
    const all = played(100, 140, 90);
    expect(scoreDelta(all, 1, null)).toBeNull();
    expect(scoreDelta(all, 2, null)).toBe(40);
    expect(scoreDelta(all, 3, null)).toBe(-50);
    expect(scoreDelta(all, 3, 1)).toBe(-10);
    // The baseline itself is measured against the round before it.
    expect(scoreDelta(all, 2, 2)).toBe(40);
    expect(scoreDelta(all, 9, null)).toBeNull();
  });

  it("knows when the draft already plays on a round's numbers", () => {
    const a = note(1, { "config.pieceKinds": 8 }).numbers;
    expect(sameNumbers(a, { ...a })).toBe(true);
    expect(sameNumbers(a, note(1).numbers)).toBe(false);
  });
});
