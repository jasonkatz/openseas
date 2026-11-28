// The Racks page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every event of every move, to what the
// prototype's engine hands it on the same seed.
import { DEFAULT_RACKS_CONFIG, RACKS_DEF, racksHint, racksMoveIllegalReason, type RacksConfig, type RacksMove, type RacksState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { RACKS_MIRROR } from "../../src/rungs/mirror/racks.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, RacksConfig> = {
  "as shipped": DEFAULT_RACKS_CONFIG,
  "short racks and quick crates": { ...DEFAULT_RACKS_CONFIG, racks: 4, height: 3, kinds: 2, startCells: 6, crateMin: 1, crateMax: 3, crateMixPercent: 20, landEvery: 2, chainWindow: 2, chainPercent: [100, 150, 175], spillPenalty: 30 },
  "a long row with room marked": { ...DEFAULT_RACKS_CONFIG, racks: 7, height: 6, kinds: 5, startCells: 20, crateMixPercent: 100, landEvery: 6, markRoom: true, bagCopies: 2 },
};

/** The hint half the time, a call now and then, else any shift there is. */
function pickMove(s: RacksState, pick: (n: number) => number): RacksMove {
  const roll = pick(10);
  if (roll < 5) return racksHint(s) ?? { type: "call" };
  if (roll === 5) return { type: "call" };
  const shifts = s.racks.flatMap((_, from) => s.racks.flatMap((_, to) => (racksMoveIllegalReason(s, from, to) === null ? [{ type: "move" as const, from, to }] : [])));
  return shifts.length > 0 ? shifts[pick(shifts.length)]! : { type: "call" };
}

describe("the Racks board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same events after every move: ${name}`, () => {
      const seen = { ships: 0, chains: 0, byCrate: 0, spills: 0 };
      for (let seed = 1; seed <= 6; seed++) {
        for (const s of beside({ def: RACKS_DEF, mirror: RACKS_MIRROR, seed: `seed-${seed}`, config, pickMove, steps: 150 })) {
          for (const e of s.lastMove?.events ?? []) {
            if (e.type === "ship") seen.ships++, e.chain > 1 && seen.chains++, e.byCrate && seen.byCrate++;
            if (e.type === "spill") seen.spills++;
          }
        }
      }
      expect(seen.ships).toBeGreaterThan(0);
      expect(seen.spills).toBeGreaterThan(0);
      if (name === "short racks and quick crates") expect(seen.chains).toBeGreaterThan(0), expect(seen.byCrate).toBeGreaterThan(0);
    });
  }
});
