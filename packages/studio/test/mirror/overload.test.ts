// The Overload page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every event of every move, to what the
// prototype's engine hands it on the same seed: after every stretch of time let pass, every tap and every wait.
import { advanceOverload, DEFAULT_OVERLOAD_CONFIG, OVERLOAD_DEF, overloadHint, type OverloadConfig, type OverloadMove, type OverloadState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { advanceOverloadMirror, OVERLOAD_MIRROR } from "../../src/rungs/mirror/overload.js";
import { named } from "./named.js";
import { picker } from "./beside.js";

const CONFIGS: Record<string, OverloadConfig> = {
  "as shipped": DEFAULT_OVERLOAD_CONFIG,
  "a charged bank and a low cap": { ...DEFAULT_OVERLOAD_CONFIG, refill: [5, 15, 40, 40], boosterPermille: 150, chainCap: 6, streakMin: 6, burstPoints: 3, refundEvery: 3, streakPercent: [100, 150, 175] },
  "a wide bank, few taps": { ...DEFAULT_OVERLOAD_CONFIG, width: 9, height: 5, tapCap: 3, startTaps: 1, tapRegenTicks: 9, refundEvery: 0, maxTick: 400 },
};

describe("the Overload board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same events, tick for tick and tap for tap: ${name}`, () => {
      const seen = { long: 0, short: 0, refunds: 0, waits: 0, rounds: 0 };
      for (let seed = 1; seed <= 4; seed++) {
        const pick = picker(`seed-${seed}`);
        let shipped = OVERLOAD_DEF.create(`seed-${seed}`, config);
        let mirror = OVERLOAD_MIRROR.create(`seed-${seed}`, config);
        const [a, b] = [named(new Map()), named(new Map())];
        const same = (at: string): void => expect(b(mirror), at).toEqual(a(shipped));
        same(`seed ${seed}, the deal`);
        while (!shipped.finished) {
          const tick = Math.min(config.maxTick, shipped.tick + pick(pick(5) === 0 ? 30 : 6));
          const at = `seed ${seed}, tick ${tick}`;
          // What the board shows while time passes.
          const [theirs, ours] = [advanceOverload(shipped, tick), advanceOverloadMirror(mirror, tick)];
          expect(b(ours), `${at}, time let pass`).toEqual(a(theirs));
          const hint = overloadHint(theirs);
          const roll = pick(10);
          const move: OverloadMove = theirs.taps < 1 || roll === 0 ? { type: "wait", tick } : { type: "tap", cell: hint && roll > 2 ? hint.cell : pick(config.width * config.height), tick };
          shipped = OVERLOAD_DEF.reduce(shipped, move);
          mirror = OVERLOAD_MIRROR.reduce(mirror, move);
          same(`${at}, ${move.type}`);
          if (move.type === "wait") seen.waits++;
          for (const e of shipped.lastMove!.events) if (e.type === "chain") (e.size >= config.streakMin ? seen.long++ : seen.short++), (seen.refunds += e.refund);
        }
        seen.rounds++;
      }
      expect(seen.long).toBeGreaterThan(0);
      expect(seen.short).toBeGreaterThan(0);
      expect(seen.waits).toBeGreaterThan(0);
      if (name === "a charged bank and a low cap") expect(seen.refunds).toBeGreaterThan(0);
    });
  }

  it("keeps the bank the very same while only the clock moves, so the board plays a chain out wave by wave", () => {
    const config = DEFAULT_OVERLOAD_CONFIG;
    const tapped = OVERLOAD_MIRROR.reduce(OVERLOAD_MIRROR.create("seed-1", config), { type: "tap", cell: 0, tick: 1 });
    const later = advanceOverloadMirror(tapped, 9);
    expect(later.tick).toBe(9);
    expect(later.cells).toBe(tapped.cells);
    expect(OVERLOAD_MIRROR.reduce(later, { type: "wait", tick: 12 }).cells).toBe(tapped.cells);
  });

  it("refuses a tick the new engine does not play", () => {
    expect(() => OVERLOAD_MIRROR.validateConfig({ ...DEFAULT_OVERLOAD_CONFIG, tickMs: 50 })).toThrow(/tick of 100 ms/);
  });
});
