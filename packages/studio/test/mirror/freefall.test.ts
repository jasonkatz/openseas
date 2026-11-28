// The Freefall page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every drop of every move, the rival's among
// them, to what the prototype's engine hands it on the same seed.
import { DEFAULT_FREEFALL_CONFIG, FREEFALL_DEF, freefallEntryLanes, freefallHint, type FreefallConfig, type FreefallMove, type FreefallState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { FREEFALL_MIRROR } from "../../src/rungs/mirror/freefall.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, FreefallConfig> = {
  "as shipped": DEFAULT_FREEFALL_CONFIG,
  "alone, plain clusters": { ...DEFAULT_FREEFALL_CONFIG, rival: false, squareClusters: false, gapPermille: 0 },
  "wide, deep, a sharp rival": { ...DEFAULT_FREEFALL_CONFIG, width: 12, entry: 4, rows: 10, gapPermille: 200, rivalSkill: 100, quotas: [30, 60, 60, 90, 120], bays: { first: [1, 1, 2, 3, 5, 8], second: [1, 2, 3, 5, 8, 13], third: [2, 2, 2, 2, 2, 2], fourth: [0, 1, 4, 9, 16, 25], fifth: [5, 4, 3, 2, 1, 0] } },
};

/** The hint half the time, else any entry lane. */
function pickMove(s: FreefallState, pick: (n: number) => number): FreefallMove {
  const hint = freefallHint(s);
  if (pick(2) === 0 && hint !== null) return { type: "drop", lane: hint };
  const [lo, hi] = freefallEntryLanes(s.config);
  return { type: "drop", lane: lo + pick(hi - lo + 1) };
}

describe("the Freefall board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and every drop the same after every move: ${name}`, () => {
      const seen = { tossed: 0, clusters: 0, legs: 0, rounds: 0 };
      for (let seed = 1; seed <= 8; seed++) {
        const states = beside({ def: FREEFALL_DEF, mirror: FREEFALL_MIRROR, seed: `seed-${seed}`, config, pickMove });
        for (const s of states) for (const d of s.lastMove?.drops ?? []) {
          seen.tossed += d.steps.reduce((n, st) => n + st.tossed.length, 0);
          seen.clusters += d.landed.filter((l) => l.ids.length > 1).length;
          seen.legs += d.legEnded ? 1 : 0;
        }
        if (states.at(-1)!.finished) seen.rounds++;
      }
      expect(seen.tossed).toBeGreaterThan(0);
      expect(seen.clusters).toBeGreaterThan(0);
      expect(seen.legs).toBeGreaterThan(0);
      expect(seen.rounds).toBe(8);
    });
  }
});
