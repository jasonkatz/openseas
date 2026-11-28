// The Tractor page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every wave and settling of every swap, to what
// the prototype's engine hands it on the same seed.
import { DEFAULT_TRACTOR_CONFIG, TRACTOR_DEF, tractorHint, tractorSwapIllegalReason, type TractorConfig, type TractorMove, type TractorState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { TRACTOR_MIRROR } from "../../src/rungs/mirror/tractor.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, TractorConfig> = {
  "as shipped": DEFAULT_TRACTOR_CONFIG,
  "beacons and caches often": { ...DEFAULT_TRACTOR_CONFIG, width: 5, height: 7, kinds: 4, startCaches: 3, cachePermille: 200, maxCaches: 5, beaconEvery: 1, cascadePercent: [100, 133, 175] },
};

/**
 * The points are compared by themselves: the prototype rounds each wave down, and the new engine rounds a swap's
 * once, so a swap of several waves can pay a point or so more (ADR 0099).
 */
const apart = (s: TractorState): unknown => ({ ...s, score: 0, lastMove: s.lastMove && { ...s.lastMove, points: 0 } });

/** The hint most of the time, else any swap the prototype allows. */
function pickMove(s: TractorState, pick: (n: number) => number): TractorMove {
  const hint = tractorHint(s);
  if (pick(10) < 7 && hint !== null) return { type: "swap", cell: hint };
  for (;;) {
    const cell = pick(s.config.width * (s.config.height - 1));
    if (tractorSwapIllegalReason(s, cell) === null) return { type: "swap", cell };
  }
}

describe("the Tractor board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every swap: ${name}`, () => {
      const seen = { waves: 0, cascades: 0, fired: 0, caches: 0, topped: 0, shuffles: 0 };
      for (let seed = 1; seed <= 5; seed++) {
        let slack = 0;
        beside({
          def: TRACTOR_DEF, mirror: TRACTOR_MIRROR, seed: `seed-${seed}`, config, pickMove, apart, steps: 120,
          also: (theirs, ours, at) => {
            const r = theirs.lastMove!;
            slack += r.waves.length;
            const d = ours.score - theirs.score;
            expect(d, at).toBeGreaterThanOrEqual(0);
            expect(d, at).toBeLessThanOrEqual(slack);
            seen.waves += r.waves.length;
            if (r.waves.length > 1) seen.cascades++;
            seen.fired += r.waves.reduce((n, w) => n + w.fired.length, 0);
            seen.caches += r.caches.length;
            seen.topped += r.waves.reduce((n, w) => n + w.settles.reduce((k, s) => k + s.topped.length, 0), 0);
            if (r.shuffled) seen.shuffles++;
          },
        });
      }
      expect(seen.cascades).toBeGreaterThan(0);
      expect(seen.caches).toBeGreaterThan(0);
      if (name !== "as shipped") expect(seen.fired).toBeGreaterThan(0), expect(seen.topped).toBeGreaterThan(0);
    });
  }
});
