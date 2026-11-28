// The Refining page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every event of every move, to what the
// prototype's engine hands it on the same seed: after every stretch of time let pass, every swap, early draw and wait.
import { advanceRefining, DEFAULT_REFINING_CONFIG, REFINING_DEF, refiningHint, refiningLinks, type RefiningConfig, type RefiningMove } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { advanceRefiningMirror, REFINING_MIRROR } from "../../src/rungs/mirror/refining.js";
import { named } from "./named.js";
import { picker } from "./beside.js";

const CONFIGS: Record<string, RefiningConfig> = {
  "as shipped": DEFAULT_REFINING_CONFIG,
  "rich feed, a short cap": { ...DEFAULT_REFINING_CONFIG, vapourPermille: 700, oilPermille: 150, catalystPermille: 120, runCap: 2, pulseTicks: 30 },
  "heavy feed, smoke on every spill": { ...DEFAULT_REFINING_CONFIG, width: 4, height: 6, vapourPermille: 300, oilPermille: 200, smokeEvery: 1, foulPoints: 150, pulseTicks: 20 },
};

describe("the Refining board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same events, tick for tick and move for move: ${name}`, () => {
      const seen = { clear: 0, foul: 0, early: 0, sank: 0, smoke: 0, waits: 0, ends: 0 };
      for (let seed = 1; seed <= 4; seed++) {
        const pick = picker(`seed-${seed}`);
        let shipped = REFINING_DEF.create(`seed-${seed}`, config);
        let mirror = REFINING_MIRROR.create(`seed-${seed}`, config);
        const [a, b] = [named(new Map()), named(new Map())];
        const same = (at: string): void => expect(b(mirror), at).toEqual(a(shipped));
        same(`seed ${seed}, the deal`);
        // One round in four is ended early by the player.
        const endAt = seed === 4 ? Math.floor(config.maxTick / 3) : Infinity;
        while (!shipped.finished) {
          const tick = Math.min(config.maxTick, shipped.tick + pick(pick(6) === 0 ? 25 : 5));
          const at = `seed ${seed}, tick ${tick}`;
          const [theirs, ours] = [advanceRefining(shipped, tick), advanceRefiningMirror(mirror, tick)];
          expect(b(ours), `${at}, time let pass`).toEqual(a(theirs));
          const kind = pick(12);
          const helps = refiningHint(theirs);
          const all = refiningLinks(theirs);
          const swap = helps && kind > 4 ? helps : kind > 1 && all.length > 0 ? all[pick(all.length)]! : null;
          const move: RefiningMove =
            tick >= endAt ? { type: "end", tick } : kind === 0 ? { type: "draw", tick } : swap ? { type: "swap", cell: swap.cell, dir: swap.dir, tick } : { type: "wait", tick };
          shipped = REFINING_DEF.reduce(shipped, move);
          mirror = REFINING_MIRROR.reduce(mirror, move);
          same(`${at}, ${move.type}`);
          if (move.type === "wait") seen.waits++;
          if (move.type === "end") seen.ends++;
          for (const e of shipped.lastMove!.events) {
            if (e.type !== "draw") continue;
            if (e.value.grade === "clear") seen.clear++;
            if (e.value.grade === "foul") seen.foul++;
            if (!e.value.up) seen.sank++;
            if (e.early) seen.early++;
            seen.smoke += e.smoke.length;
          }
        }
      }
      expect(seen.clear).toBeGreaterThan(0);
      expect(seen.foul).toBeGreaterThan(0);
      expect(seen.early).toBeGreaterThan(0);
      expect(seen.sank).toBeGreaterThan(0);
      expect(seen.waits).toBeGreaterThan(0);
      expect(seen.ends).toBe(1);
      if (name === "heavy feed, smoke on every spill") expect(seen.smoke).toBeGreaterThan(0);
    }, 120_000);
  }

  it("refuses a tick the new engine does not play", () => {
    expect(() => REFINING_MIRROR.validateConfig({ ...DEFAULT_REFINING_CONFIG, tickMs: 50 })).toThrow(/tick of 100 ms/);
  });
});
