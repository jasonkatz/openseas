// The Pouring page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every act of every move, the rivals' and the
// turns lost among them, to what the prototype's engine hands it on the same seed.
import { DEFAULT_POURING_CONFIG, POURING_DEF, pouringHint, pouringLegalCells, type PouringConfig, type PouringMove, type PouringState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { POURING_MIRROR } from "../../src/rungs/mirror/pouring.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, PouringConfig> = {
  "as shipped": DEFAULT_POURING_CONFIG,
  "alone, a small bar": { ...DEFAULT_POURING_CONFIG, size: 5, rivals: 0, ragsPerBag: 4, icePerBag: 4, glasses: 2, brews: 3, lastCall: 60, maxMoves: 200 },
  "three rivals, low tolerance": { ...DEFAULT_POURING_CONFIG, size: 7, rivals: 3, rivalSkill: 20, tolerance: 1, soberAfter: 5, offer: 3, glasses: 6, brews: 6, cleanPercent: 150, lastCall: 15 },
  "a tiny bag": { ...DEFAULT_POURING_CONFIG, size: 5, glasses: 2, brews: 2, icePerBag: 0, ragsPerBag: 1, offer: 3, rivals: 3, tolerance: 1 },
};

/** The hint most of the time, a drink now and then, else any legal pour. */
function pickMove(s: PouringState, pick: (n: number) => number): PouringMove {
  const roll = pick(10);
  const hint = pouringHint(s);
  if (roll < 6 && hint) return { type: "pour", ...hint };
  const slot = pick(s.seats[0]!.hand.length);
  const cells = pouringLegalCells(s, slot);
  return roll === 9 || cells.length === 0 ? { type: "drink", slot } : { type: "pour", slot, cell: cells[pick(cells.length)]! };
}

describe("the Pouring board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and every act the same after every move: ${name}`, () => {
      const seen = { served: 0, wipes: 0, tosses: 0, sleeps: 0, rivals: 0, rounds: 0 };
      for (let seed = 1; seed <= 8; seed++) {
        const states = beside({ def: POURING_DEF, mirror: POURING_MIRROR, seed: `seed-${seed}`, config, pickMove });
        for (const s of states) for (const a of s.lastMove?.acts ?? []) {
          seen.served += a.lines.length;
          if (a.type === "wipe") seen.wipes++;
          if (a.type === "toss") seen.tosses++;
          if (a.type === "sleep") seen.sleeps++;
          if (a.seat > 0) seen.rivals++;
        }
        if (states.at(-1)!.finished) seen.rounds++;
      }
      expect(seen.served).toBeGreaterThan(0);
      expect(seen.rounds).toBe(8);
      if (name !== "alone, a small bar") expect(seen.rivals).toBeGreaterThan(0);
      if (name === "alone, a small bar") expect(seen.wipes + seen.tosses).toBeGreaterThan(0);
      if (name === "three rivals, low tolerance") expect(seen.sleeps).toBeGreaterThan(0);
    });
  }
});
