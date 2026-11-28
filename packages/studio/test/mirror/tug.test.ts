// The Tug page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099). This
// holds what that engine hands the board, the whole state and the report of every move, to what the prototype's
// engine hands it on the same seed.
import { DEFAULT_TUG_CONFIG, TUG_DEF, tugFlickIllegalReason, tugSolve, type TugConfig, type TugDir, type TugMove, type TugState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { TUG_MIRROR } from "../../src/rungs/mirror/tug.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, TugConfig> = {
  "as shipped": DEFAULT_TUG_CONFIG,
  "a small bay, no slack": { ...DEFAULT_TUG_CONFIG, width: 5, height: 5, pods: 3, blocks: 2, startPar: 1, maxPar: 3, cleanPerStep: 1, slack: 0, skipPenalty: 40 },
};

/**
 * The points are compared by themselves: the prototype rounds a delivery's points down after each multiplier, and
 * the new engine rounds a move's once, so a delivery can pay a point more (ADR 0099).
 */
const apart = (s: TugState): unknown => ({
  ...s,
  score: 0,
  lastMove: s.lastMove && { ...s.lastMove, points: 0, skipped: s.lastMove.skipped && { ...s.lastMove.skipped, penalty: 0 }, delivered: s.lastMove.delivered && { ...s.lastMove.delivered, points: 0 } },
});

/** The solver's next flick most of the time, a skip now and then, else any flick. */
function pickMove(s: TugState, pick: (n: number) => number): TugMove {
  const roll = pick(12);
  if (roll === 0) return { type: "skip" };
  const plan = roll < 8 ? tugSolve(s) : null;
  if (plan && plan.length > 0) return plan[0]!;
  for (;;) {
    const [pod, dir] = [pick(s.pods.length), pick(4) as TugDir];
    if (tugFlickIllegalReason(s, pod, dir) === null) return { type: "flick", pod, dir };
  }
}

describe("the Tug board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every move: ${name}`, () => {
      const seen = { clean: 0, full: 0, slow: 0, skips: 0 };
      for (let seed = 1; seed <= 5; seed++) {
        beside({
          def: TUG_DEF, mirror: TUG_MIRROR, seed: `seed-${seed}`, config, pickMove, apart, steps: 120,
          also: (theirs, ours, at) => {
            const d = ours.score - theirs.score;
            expect(d, at).toBeGreaterThanOrEqual(0);
            expect(d, at).toBeLessThanOrEqual(theirs.delivered);
            const r = theirs.lastMove!;
            if (r.delivered) seen[r.delivered.grade]++;
            if (r.skipped) seen.skips++, expect(ours.lastMove!.skipped!.penalty, at).toBeLessThanOrEqual(r.skipped.penalty + d);
          },
        });
      }
      expect(seen.clean).toBeGreaterThan(0);
      expect(seen.skips).toBeGreaterThan(0);
      expect(seen.full + seen.slow).toBeGreaterThan(0);
    });
  }
});
