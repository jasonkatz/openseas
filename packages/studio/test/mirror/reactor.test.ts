// The Reactor page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and the report of every swipe, to what the
// prototype's engine hands it on the same seed.
import { DEFAULT_REACTOR_CONFIG, REACTOR_DEF, reactorHint, reactorLegalDirs, type ReactorConfig, type ReactorMove, type ReactorState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { REACTOR_MIRROR } from "../../src/rungs/mirror/reactor.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, ReactorConfig> = {
  "as shipped": DEFAULT_REACTOR_CONFIG,
  "hot early, many ports": { ...DEFAULT_REACTOR_CONFIG, hotGrade: 3, fusePoints: [3, 7], ports: 5, criticalHot: 5, twoPermille: 450, salvoPercent: [100, 175, 333], pipelinePercent: [100, 133, 166], pipelineSwipes: 4, dischargePoints: 77 },
  "a big core": { ...DEFAULT_REACTOR_CONFIG, size: 6, hotGrade: 5, fusePoints: [1, 3, 9, 27], ports: 3, criticalHot: 3, startRods: 5, scramPenalty: 90 },
};

/**
 * The points are compared by themselves: the prototype rounds each discharge down and then the salvo, and the new
 * engine rounds a swipe's once, so a swipe can pay a point more (ADR 0099).
 */
const apart = (s: ReactorState): unknown => ({ ...s, score: 0, lastMove: s.lastMove && { ...s.lastMove, points: 0, scram: s.lastMove.scram && { ...s.lastMove.scram, penalty: 0 } } });

function pickMove(s: ReactorState, pick: (n: number) => number): ReactorMove | null {
  const dirs = reactorLegalDirs(s);
  if (dirs.length === 0) return null;
  const hint = reactorHint(s);
  return { type: "swipe", dir: pick(3) > 0 && hint !== null ? hint : dirs[pick(dirs.length)]! };
}

describe("the Reactor board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every swipe: ${name}`, () => {
      const seen = { discharges: 0, salvos: 0, scrams: 0, lapses: 0, fusions: 0 };
      for (let seed = 1; seed <= 5; seed++) {
        let slack = 0;
        beside({
          def: REACTOR_DEF, mirror: REACTOR_MIRROR, seed: `seed-${seed}`, config, pickMove, apart, steps: 250,
          also: (theirs, ours, at) => {
            // Each discharge rounded down loses less than a point, which the salvo then multiplies, and the salvo loses one more.
            const r = theirs.lastMove!;
            if (r.discharges.length > 0) slack += Math.ceil((r.discharges.length * r.salvoPercent) / 100) + 1;
            const d = ours.score - theirs.score;
            expect(d, at).toBeGreaterThanOrEqual(0);
            expect(d, at).toBeLessThanOrEqual(slack);
            seen.discharges += r.discharges.length;
            seen.fusions += r.fusions.length;
            if (r.discharges.length > 1) seen.salvos++;
            if (r.scram) seen.scrams++;
            if (r.lapsed) seen.lapses++;
          },
        });
      }
      expect(seen.discharges).toBeGreaterThan(0);
      expect(seen.fusions).toBeGreaterThan(0);
      expect(seen.scrams).toBeGreaterThan(0);
      if (name === "hot early, many ports") expect(seen.salvos).toBeGreaterThan(0);
    });
  }
});
