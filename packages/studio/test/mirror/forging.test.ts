// The Forging page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and the report of every strike, to what the
// prototype's engine hands it on the same seed.
import { DEFAULT_FORGING_CONFIG, FORGING_DEF, forgingTargets, reduceForging, type ForgingConfig, type ForgingMove, type ForgingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { FORGING_MIRROR } from "../../src/rungs/mirror/forging.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, ForgingConfig> = {
  "as shipped": DEFAULT_FORGING_CONFIG,
  "a small plate, one blow": { ...DEFAULT_FORGING_CONFIG, width: 4, height: 4, blows: 1, sparks: false, weaveCap: 3 },
  "steps only": { ...DEFAULT_FORGING_CONFIG, width: 5, height: 7, blows: 4, jumps: false, chainCap: 6, weights: [20, 5, 5, 8, 8, 8, 6, 8] },
};

/** Mostly the strike that leaves the press most room, a set first; now and then any. */
function pickMove(s: ForgingState, pick: (n: number) => number): ForgingMove {
  const all = forgingTargets(s);
  if (pick(10) === 0) return { type: "strike", cell: all[pick(all.length)]! };
  const worth = (c: number): number => {
    const after = reduceForging(s, { type: "strike", cell: c });
    const r = after.lastMove!;
    return r.stalled ? -1 : (r.set ? 1000 : 0) + (after.run.length > s.run.length ? 100 : 0) + forgingTargets(after).length;
  };
  return { type: "strike", cell: all.map((c) => ({ c, w: worth(c) })).sort((a, b) => b.w - a.w)[0]!.c };
}

describe("the Forging board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every strike: ${name}`, () => {
      const seen = { sets: 0, sparks: 0, stalls: 0, plates: 0 };
      for (let seed = 1; seed <= 24; seed++) {
        for (const s of beside({ def: FORGING_DEF, mirror: FORGING_MIRROR, seed: `seed-${seed}`, config, pickMove })) {
          const r = s.lastMove;
          if (r?.set) seen.sets++;
          if (r?.sparked) seen.sparks++;
          if (r?.stalled) seen.stalls++;
          if (r?.done) seen.plates++;
        }
      }
      expect(seen.stalls + seen.plates).toBeGreaterThan(0);
      if (name !== "a small plate, one blow") expect(seen.sets).toBeGreaterThan(0);
      if (name === "as shipped") expect(seen.sparks).toBeGreaterThan(0);
    });
  }

  it("ends when the host ends it, and refuses a strike out of reach", () => {
    const s = FORGING_MIRROR.reduce(FORGING_MIRROR.create("seed-1", DEFAULT_FORGING_CONFIG), { type: "strike", cell: 0 });
    const far = Array.from({ length: 36 }, (_, c) => c).find((c) => !forgingTargets(s).includes(c))!;
    expect(() => FORGING_MIRROR.reduce(s, { type: "strike", cell: far })).toThrow();
    expect(FORGING_MIRROR.reduce(s, { type: "end" })).toEqual(FORGING_DEF.reduce(FORGING_DEF.reduce(FORGING_DEF.create("seed-1", DEFAULT_FORGING_CONFIG), { type: "strike", cell: 0 }), { type: "end" }));
  });
});
