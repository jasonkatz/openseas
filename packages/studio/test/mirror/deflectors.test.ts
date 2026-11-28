// The Deflectors page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and every event of every move, to what the
// prototype's engine hands it on the same seed: after every stretch of time let pass, every piece, turn, bin and shot.
import { advanceDeflectors, DEFAULT_DEFLECTORS_CONFIG, DEFLECTORS_DEF, deflectorsHint, type DeflectorsConfig, type DeflectorsMove, type DeflectorsState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { advanceDeflectorsMirror, DEFLECTORS_MIRROR } from "../../src/rungs/mirror/deflectors.js";
import { named } from "./named.js";
import { picker } from "./beside.js";

const CONFIGS: Record<string, DeflectorsConfig> = {
  "as shipped": DEFAULT_DEFLECTORS_CONFIG,
  "splitters, kept grid, a short cap": { ...DEFAULT_DEFLECTORS_CONFIG, size: 7, emitters: 5, targets: 8, mirrors: 12, splitterChance: 30, spend: false, bounceCap: 2, bouncePoints: 7, lensPercent: 35, litPercent: [100, 150, 175, 300] },
  "plain targets, a short supply": { ...DEFAULT_DEFLECTORS_CONFIG, size: 4, emitters: 2, targets: 4, mirrors: 3, lenses: 0, recipeWeights: [1], lensChance: 0, pieces: 12, queueSize: 2, fireTicks: 0 },
};

/**
 * The points are compared by themselves: the prototype rounds each beam down and then the shot, and the new engine
 * rounds a move's once, so a shot can pay a point a lighting beam more (ADR 0099). The beams' own points, drawn on
 * the board, are the prototype's in both.
 */
const apart = (s: DeflectorsState): unknown => ({ ...s, score: 0, bestShot: 0, lastMove: s.lastMove && { ...s.lastMove, points: 0 } });

describe("the Deflectors board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same events, tick for tick and move for move: ${name}`, () => {
      const seen = { shots: 0, lit: 0, several: 0, bins: 0, turns: 0, waits: 0, dry: 0 };
      for (let seed = 1; seed <= 5; seed++) {
        const pick = picker(`seed-${seed}`);
        let shipped = DEFLECTORS_DEF.create(`seed-${seed}`, config);
        let mirror = DEFLECTORS_MIRROR.create(`seed-${seed}`, config);
        const [a, b] = [named(new Map()), named(new Map())];
        let slack = 0;
        const same = (at: string): void => {
          expect(b(apart(mirror)), at).toEqual(a(apart(shipped)));
          expect(mirror.score - shipped.score, at).toBeGreaterThanOrEqual(0);
          expect(mirror.score - shipped.score, at).toBeLessThanOrEqual(slack);
        };
        same(`seed ${seed}, the deal`);
        while (!shipped.finished) {
          const tick = Math.min(config.maxTick, shipped.tick + pick(pick(5) === 0 ? 20 : 4));
          const at = `seed ${seed}, tick ${tick}`;
          const [theirs, ours] = [advanceDeflectors(shipped, tick), advanceDeflectorsMirror(mirror, tick)];
          expect(b(apart(ours)), `${at}, time let pass`).toEqual(a(apart(theirs)));
          const kind = pick(12);
          const hint = deflectorsHint(theirs);
          if (theirs.queue.length === 0) seen.dry++;
          const move: DeflectorsMove =
            tick >= theirs.fireTick && (kind < 3 || (kind < 6 && !hint) || theirs.queue.length === 0)
              ? { type: "fire", tick }
              : theirs.queue.length > 0 && hint && kind < 10
                ? hint.turn ? { type: "turn", tick } : { type: "place", cell: hint.cell, tick }
                : theirs.queue.length > 0 && kind === 11
                  ? { type: "bin", tick }
                  : theirs.queue.length > 0 && kind === 10
                    ? { type: "place", cell: pick(config.size * config.size), tick }
                    : { type: "wait", tick };
          shipped = DEFLECTORS_DEF.reduce(theirs, move);
          mirror = DEFLECTORS_MIRROR.reduce(ours, move);
          for (const e of shipped.lastMove!.events) if (e.type === "fire") (seen.shots++, (seen.lit += e.outcome.lit), (slack += e.outcome.lit)), e.outcome.lit > 1 && seen.several++;
          same(`${at}, ${move.type}`);
          if (move.type === "bin") seen.bins++;
          if (move.type === "turn") seen.turns++;
          if (move.type === "wait") seen.waits++;
        }
      }
      expect(seen.lit).toBeGreaterThan(5);
      if (name !== "as shipped") expect(seen.several).toBeGreaterThan(0);
      expect(seen.bins).toBeGreaterThan(0);
      expect(seen.waits).toBeGreaterThan(0);
      if (name === "as shipped") expect(seen.turns).toBeGreaterThan(0);
      if (name === "plain targets, a short supply") expect(seen.dry).toBeGreaterThan(0);
    }, 120_000);
  }

  it("refuses a tick the new engine does not play", () => {
    expect(() => DEFLECTORS_MIRROR.validateConfig({ ...DEFAULT_DEFLECTORS_CONFIG, tickMs: 50 })).toThrow(/tick of 100 ms/);
  });
});
