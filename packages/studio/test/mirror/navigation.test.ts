// The Navigation page on the new engine is the game's page with another engine behind it (ADR 0097, ADR 0098). This
// holds what that engine hands the board, the whole state and every event of every move, to what the shipped engine
// hands it on the same seed: after every stretch of time let pass, every turn, drop and wait.
import { advanceNavigation, DEFAULT_NAVIGATION_CONFIG, NAVIGATION_DEF, navigationHint, type NavigationConfig, type NavigationMove, type NavigationState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { advanceNavigationMirror, NAVIGATION_MIRROR } from "../../src/rungs/mirror/navigation.js";
import { named } from "./named.js";
import { picker } from "./beside.js";

const CONFIGS: Record<string, NavigationConfig> = {
  "as shipped": DEFAULT_NAVIGATION_CONFIG,
  "few kinds and a fast sky": { ...DEFAULT_NAVIGATION_CONFIG, shapes: 2, colors: 2, fallTicks: 12, fallTicksMin: 4, startStars: 2, maxStars: 5, reuseChancePercent: 80, chainPercent: [100, 133, 166], lostHeadingPenalty: 25, maxTick: 600 },
};

/**
 * The points are compared by themselves: the shipped engine rounds each constellation down, and the new engine once a
 * move, so a stretch that charts two can pay a point more on it (ADR 0098). What a constellation shows it was worth
 * is worked out the game's way in both.
 */
const apart = (s: NavigationState): unknown => ({ ...s, score: 0, lastMove: s.lastMove && { ...s.lastMove, points: 0 } });

describe("the Navigation board's state from the new engine, beside the shipped engine's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same events, tick for tick and move for move: ${name}`, () => {
      const seen = { charted: 0, runs: 0, lost: 0, drops: 0, waits: 0 };
      for (let seed = 1; seed <= 3; seed++) {
        const pick = picker(`seed-${seed}`);
        let shipped = NAVIGATION_DEF.create(`seed-${seed}`, config);
        let mirror = NAVIGATION_MIRROR.create(`seed-${seed}`, config);
        const [a, b] = [named(new Map()), named(new Map())];
        let slack = 0;
        const same = (at: string): void => {
          expect(b(apart(mirror)), at).toEqual(a(apart(shipped)));
          expect(mirror.score - shipped.score, at).toBeGreaterThanOrEqual(0);
          expect(mirror.score - shipped.score, at).toBeLessThanOrEqual(slack);
        };
        same(`seed ${seed}, the deal`);
        while (!shipped.finished) {
          const tick = Math.min(config.maxTick, shipped.tick + 1 + pick(pick(6) === 0 ? 20 : 3));
          const at = `seed ${seed}, tick ${tick}`;
          const [theirs, ours] = [advanceNavigation(shipped, tick), advanceNavigationMirror(mirror, tick)];
          expect(b(apart(ours)), `${at}, time let pass`).toEqual(a(apart(theirs)));
          const helps = navigationHint(theirs);
          const kind = pick(12);
          const move: NavigationMove =
            tick >= config.maxTick ? { type: "wait", tick }
            : helps && kind > 2 ? { type: "rotate", ring: helps.ring, dir: helps.dir, tick }
            : kind === 0 ? { type: "rotate", ring: pick(config.rings), dir: pick(2) === 0 ? 1 : -1, tick }
            : kind === 1 || (!helps && kind > 8) ? { type: "drop", tick }
            : { type: "wait", tick };
          // The page logs a move on the state the last move left, and only shows time passing (useTicked).
          shipped = NAVIGATION_DEF.reduce(shipped, move);
          mirror = NAVIGATION_MIRROR.reduce(mirror, move);
          for (const e of shipped.lastMove!.events) {
            if (e.type === "charted") (seen.charted++, slack++);
            if (e.type === "run") seen.runs++;
            if (e.type === "lost_heading") seen.lost++;
          }
          same(`${at}, ${move.type}`);
          if (move.type === "drop") seen.drops++;
          if (move.type === "wait") seen.waits++;
        }
      }
      expect(seen.charted).toBeGreaterThan(0);
      expect(seen.drops).toBeGreaterThan(0);
      if (name !== "as shipped") expect(seen.runs).toBeGreaterThan(0), expect(seen.lost).toBeGreaterThan(0);
    }, 120_000);
  }
});
