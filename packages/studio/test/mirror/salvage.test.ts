// The Paths page on the new engine is the shipped Salvage page with another engine behind it (ADR 0097). This
// holds what that engine hands the board, the whole state and the whole report of every move, to what the
// shipped engine hands it on the same seed, at every stage of the ladder.
import { DEFAULT_SALVAGE_CONFIG, SALVAGE_DEF, salvageCanClose, salvageCanExtend, salvageLineValue, type SalvageConfig, type SalvageState } from "@openseas/engine";
import { nextInt, seedFromString } from "@openseas/puzzle";
import { describe, expect, it } from "vitest";
import { pathsStage, SALVAGE_MIRROR } from "../../src/rungs/mirror/salvage.js";
import { named } from "./named.js";

/** What Salvage switches off by its numbers to cut each stage. */
const OFF = {
  paths: { streakPercent: [100], startCrates: 0, maxCrates: 0, cratePermille: 0, loopMin: 0, orderLength: 0, volatileEvery: 0 },
  streak: { loopMin: 0, orderLength: 0, volatileEvery: 0 },
  loops: { volatileEvery: 0 },
  full: {},
} as const;
const CONFIGS: Record<string, SalvageConfig> = {
  "as shipped": DEFAULT_SALVAGE_CONFIG,
  "few kinds, many prizes, fast timers": { ...DEFAULT_SALVAGE_CONFIG, kinds: 3, cratePermille: 150, maxCrates: 5, startCrates: 4, loopPercent: 300, orderLength: 5, volatileEvery: 2, fuse: 3, streakMin: 6, streakPercent: [100, 125, 155, 190, 235] },
  "a small board": { ...DEFAULT_SALVAGE_CONFIG, width: 5, height: 6, kinds: 4, minLine: 2, loopMin: 3, startCrates: 1, maxCrates: 2, cratePermille: 300, volatileEvery: 3, fuse: 2, orderLength: 4, streakMin: 3, crateFloorPoints: 7 },
};

/** A legal move on the shipped board, picked by a stream of the test's own: a wide loop where one lies ready, else a wandering path, closed when it can be. */
function pickMove(s: SalvageState, pick: (n: number) => number): { cells: number[]; loop: boolean } {
  const { width, height, loopMin, minLine } = s.config;
  if (loopMin > 0 && pick(2) === 0) {
    for (let c = 0; c < s.cells.length; c++) {
      const [x, y] = [c % width, Math.floor(c / width)];
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
      const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([dx, dy]) => (y + dy!) * width + x + dx!);
      if (ring.every((cell, i) => i === 0 || salvageCanExtend(s, ring.slice(0, i), cell)) && salvageCanClose(s, ring)) return { cells: ring, loop: true };
    }
  }
  for (;;) {
    const cells = [pick(s.cells.length)];
    const want = minLine + pick(8);
    while (cells.length < want) {
      const next = Array.from({ length: s.cells.length }, (_, c) => c).filter((c) => salvageCanExtend(s, cells, c));
      if (next.length === 0) break;
      cells.push(next[pick(next.length)]!);
    }
    if (cells.length >= minLine) return { cells, loop: salvageCanClose(s, cells) && pick(3) > 0 };
  }
}

/**
 * The points are compared by themselves: Salvage rounds a path's points down and then each prize taken at the
 * floor, and Paths rounds once a move, so a move with prizes at the floor can pay a point more. At the first
 * stage Paths has no streak at all, where Salvage counts one that multiplies by nothing. And the best streak: a
 * move that builds the streak and then has a timer run out was paid at the longer streak, which Paths counts as
 * the best and Salvage does not.
 */
function apart(s: SalvageState, stage: string): unknown {
  const streak = stage === "paths" ? { combo: 0, bestCombo: 0, grace: false } : {};
  return { ...s, ...streak, ...(stage === "full" ? { bestCombo: 0 } : {}), score: 0, lastMove: s.lastMove && { ...s.lastMove, ...(stage === "paths" ? { streak: 0 } : {}), points: 0, haulPoints: 0 } };
}

describe("the Salvage board's state from the new engine, beside the shipped engine's", () => {
  for (const [name, whole] of Object.entries(CONFIGS)) {
    for (const stage of ["paths", "streak", "loops", "full"] as const) {
      it(`is the same state and the same report after every move: ${name}, at the stage ${stage}`, () => {
        const config: SalvageConfig = { ...whole, ...OFF[stage] };
        expect(pathsStage(config)).toBe(stage);
        const seen = { moves: 0, loops: 0, floor: 0, blasts: 0, roundedApart: 0 };
        for (let seed = 1; seed <= 6; seed++) {
          let shipped = SALVAGE_DEF.create(`seed-${seed}`, config);
          let mirror = SALVAGE_MIRROR.create(`seed-${seed}`, config);
          const [a, b] = [named(new Map()), named(new Map())];
          // The same seed deals the same opening board and bounty.
          expect(b(mirror)).toEqual(a(shipped));
          let picks = seedFromString(`picks-${seed}`);
          const pick = (n: number): number => {
            const r = nextInt(picks, n);
            picks = r.state;
            return r.value;
          };
          let score = 0;
          for (let m = 0; m < 80; m++) {
            const { cells, loop } = pickMove(shipped, pick);
            const value = salvageLineValue(shipped, cells, loop);
            const floorBefore = shipped.cratesFloor;
            shipped = SALVAGE_DEF.reduce(shipped, { type: "tether", cells, loop });
            mirror = SALVAGE_MIRROR.reduce(mirror, { type: "tether", cells, loop });
            const at = `${name}, ${stage}, seed ${seed}, move ${m + 1}`;
            expect(b(apart(mirror, stage)), at).toEqual(a(apart(shipped, stage)));
            const [theirs, ours] = [shipped.lastMove!, mirror.lastMove!];
            const floor = shipped.cratesFloor - floorBefore;
            const banked = Math.floor(((value.base + floor * config.crateFloorPoints) * theirs.streakPercent) / 100);
            expect(ours.points, at).toBe(banked);
            expect(ours.haulPoints + ours.rounds.reduce((n, r) => n + r.points, 0), at).toBe(banked);
            if (banked !== theirs.points) seen.roundedApart++, expect(floor, at).toBeGreaterThan(0), expect(banked - theirs.points, at).toBeLessThanOrEqual(theirs.rounds.length);
            score += banked;
            expect(mirror.score, at).toBe(score);
            if (stage !== "paths") expect(mirror.bestCombo - shipped.bestCombo, at).toBeGreaterThanOrEqual(0), expect(mirror.bestCombo - shipped.bestCombo, at).toBeLessThanOrEqual(mirror.blasts > 0 ? 1 : 0);
            // The engine's hash, which the studio checks a replay by, reads a mirrored state as it reads its own.
            expect(typeof SALVAGE_MIRROR.hash(mirror), at).toBe("string");
            seen.moves++;
            seen.loops += theirs.loop ? 1 : 0;
            seen.floor += floor;
            seen.blasts += theirs.blasts.length;
          }
        }
        expect(seen.moves).toBe(480);
        if (stage !== "paths") expect(seen.floor).toBeGreaterThan(0);
        if (stage === "loops" || stage === "full") expect(seen.loops).toBeGreaterThan(0);
        if (stage === "full") expect(seen.blasts).toBeGreaterThan(0);
      });
    }
  }

  it("refuses numbers that switch off layers no stage of the ladder leaves out together", () => {
    expect(() => SALVAGE_MIRROR.validateConfig({ ...DEFAULT_SALVAGE_CONFIG, loopMin: 0 })).toThrow(/no stage of Paths/);
    expect(() => SALVAGE_MIRROR.validateConfig(DEFAULT_SALVAGE_CONFIG)).not.toThrow();
  });
});
