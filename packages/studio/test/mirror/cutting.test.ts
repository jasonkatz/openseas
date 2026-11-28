// The Cutting page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and the report of every move, to what the
// prototype's engine hands it on the same seed.
import { CUTTING_DEF, cuttingBestCut, DEFAULT_CUTTING_CONFIG, type CuttingConfig, type CuttingMove, type CuttingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { CUTTING_MIRROR } from "../../src/rungs/mirror/cutting.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, CuttingConfig> = {
  "as shipped": DEFAULT_CUTTING_CONFIG,
  "a small slab, few cuts": { ...DEFAULT_CUTTING_CONFIG, width: 4, height: 4, ores: 3, partsStart: 3, partsMax: 5, flawsStart: 0, flawsMax: 1, minCuts: 2, maxCuts: 4, growEvery: 1, maxBlockPercent: 60 },
};

/** The best cut most of the time, any cut now and then, and a slab given up once in a while. */
function pickMove(s: CuttingState, pick: (n: number) => number): CuttingMove {
  const roll = pick(12);
  if (roll === 0) return { type: "done" };
  const best = cuttingBestCut(s);
  if (roll < 8 && best) return { type: "cut", ...best };
  const p = s.pieces[pick(s.pieces.length)]!;
  const vertical = p.w > 1 && (p.h === 1 || pick(2) === 0);
  return vertical ? { type: "cut", piece: p.id, vertical, at: p.x + 1 + pick(p.w - 1) } : { type: "cut", piece: p.id, vertical, at: p.y + 1 + pick(p.h - 1) };
}

describe("the Cutting board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every move: ${name}`, () => {
      const seen = { flawless: 0, clean: 0, rough: 0, stuck: 0, done: 0 };
      for (let seed = 1; seed <= 4; seed++) {
        for (const s of beside({ def: CUTTING_DEF, mirror: CUTTING_MIRROR, seed: `seed-${seed}`, config, pickMove, steps: 60 })) {
          const r = s.lastMove?.slab;
          if (r) seen[r.grade]++, r.reason === "stuck" && seen.stuck++, r.reason === "done" && seen.done++;
        }
      }
      expect(seen.flawless).toBeGreaterThan(0);
      expect(seen.rough).toBeGreaterThan(0);
      expect(seen.done).toBeGreaterThan(0);
    });
  }
});
