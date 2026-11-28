// The Engines page on the new engine is the game's page with another engine behind it (ADR 0097, ADR 0098). This
// holds what that engine hands the board, the whole state and the whole report of every pair, every chain step and
// every flameout, to what the shipped engine hands it on the same seed.
import { DEFAULT_ENGINES_CONFIG, ENGINES_DEF, enginesRestingPlacements, reduceEngines, type EnginesConfig, type EnginesMove, type EnginesState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { ENGINES_MIRROR } from "../../src/rungs/mirror/engines.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, EnginesConfig> = {
  "as shipped": DEFAULT_ENGINES_CONFIG,
  "two kinds on a narrow core": { ...DEFAULT_ENGINES_CONFIG, width: 6, height: 12, pieceKinds: 2, injectorsAtOnce: 2, injectorSpanMin: 1, injectorSpanMax: 3, flameoutPenalty: 25, chainMultipliers: [1, 2, 5] },
};

/** Mostly a rest that clears something or fills a target, else any rest at all. */
function pickMove(s: EnginesState, pick: (n: number) => number): EnginesMove {
  const rests = enginesRestingPlacements(s).map((r): EnginesMove => ({ type: "place", col: r.col, row: r.row, rot: r.rot }));
  const scoring = rests.filter((m) => reduceEngines(s, m).lastMove!.points > 0);
  return scoring.length > 0 && pick(3) > 0 ? scoring[pick(scoring.length)]! : rests[pick(rests.length)]!;
}

describe("the Engines board's state from the new engine, beside the shipped engine's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every pair: ${name}`, () => {
      const seen = { runs: 0, fired: 0, chains: 0, flameouts: 0 };
      for (let seed = 1; seed <= 3; seed++) {
        const states = beside({ def: ENGINES_DEF, mirror: ENGINES_MIRROR, seed: `seed-${seed}`, config, pickMove, steps: 120 });
        for (const s of states.slice(1)) {
          const r = s.lastMove!;
          for (const round of r.rounds) for (const g of round.groups) g.cause === "run" ? seen.runs++ : seen.fired++;
          if (r.rounds.length > 1) seen.chains++;
          if (r.wipe) seen.flameouts++;
        }
      }
      expect(seen.runs).toBeGreaterThan(0);
      expect(seen.fired).toBeGreaterThan(0);
      if (name !== "as shipped") expect(seen.chains).toBeGreaterThan(0), expect(seen.flameouts).toBeGreaterThan(0);
    }, 120_000);
  }
});
