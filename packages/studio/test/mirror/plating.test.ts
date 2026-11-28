// The Plating page on the new engine is the game's page with another engine behind it (ADR 0097, ADR 0098). This
// holds what that engine hands the board, the whole state and the whole report of every weld, to what the shipped
// engine hands it on the same seed.
import { DEFAULT_PLATING_CONFIG, PLATING_DEF, platingCheckPlacement, type PlatingConfig, type PlatingMove, type PlatingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { PLATING_MIRROR } from "../../src/rungs/mirror/plating.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, PlatingConfig> = {
  "as shipped": DEFAULT_PLATING_CONFIG,
  "a small hull that widens fast": { ...DEFAULT_PLATING_CONFIG, width: 7, height: 8, breachesAtOnce: 3, minBreachPieces: 1, maxBreachPieces: 2, growAfterMoves: 2, brushBonusPercent: 40, streakPercent: [100, 150, 210] },
};

/**
 * The points are compared by themselves: the shipped engine rounds each seal to the nearest point, and the new engine
 * rounds down, so a seal can pay a point less on it (ADR 0098).
 */
const apart = (s: PlatingState): unknown => ({ ...s, score: 0, lastMove: s.lastMove && { ...s.lastMove, points: 0, sealed: s.lastMove.sealed && { ...s.lastMove.sealed, points: 0 } } });

/** Mostly a weld that wastes least, now and then any the hull takes. */
function pickMove(s: PlatingState, pick: (n: number) => number): PlatingMove {
  const c = s.config;
  const legal: { m: PlatingMove; waste: number }[] = [];
  for (let slot = 0; slot < 3; slot++)
    for (let rot = 0; rot < 4; rot++)
      for (const flip of [false, true])
        for (let row = -2; row < c.height; row++)
          for (let col = -2; col < c.width; col++) {
            const k = platingCheckPlacement(s, slot, rot, flip, col, row);
            if (k.legal) legal.push({ m: { type: "place", slot, rot, flip, col, row }, waste: k.wasteCells.length + k.overhang });
          }
  const least = Math.min(...legal.map((l) => l.waste));
  const tidy = legal.filter((l) => l.waste === least);
  return (pick(5) > 0 ? tidy[pick(tidy.length)]! : legal[pick(legal.length)]!).m;
}

describe("the Plating board's state from the new engine, beside the shipped engine's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every weld: ${name}`, () => {
      const seen = { flawless: 0, seals: 0, widened: 0, across: 0 };
      for (let seed = 1; seed <= 3; seed++) {
        let slack = 0;
        beside({
          def: PLATING_DEF, mirror: PLATING_MIRROR, seed: `seed-${seed}`, config, pickMove, apart, steps: 60,
          also: (theirs, ours, at) => {
            const r = theirs.lastMove!;
            if (r.sealed) slack++;
            expect(theirs.score - ours.score, at).toBeGreaterThanOrEqual(0);
            expect(theirs.score - ours.score, at).toBeLessThanOrEqual(slack);
            if (r.sealed?.rating === "flawless") seen.flawless++;
            else if (r.sealed) seen.seals++;
            if (r.sealed?.brushBonus) seen.across++;
            if (r.grown) seen.widened++;
          },
        });
      }
      expect(seen.flawless).toBeGreaterThan(0);
      expect(seen.seals).toBeGreaterThan(0);
      expect(seen.widened).toBeGreaterThan(0);
    }, 120_000);
  }
});
