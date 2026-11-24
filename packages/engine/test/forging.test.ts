import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_FORGING_CONFIG,
  InvalidMoveError,
  createForgingGame,
  forgingFitMark,
  forgingHint,
  forgingReach,
  forgingStrikeIllegalReason,
  forgingTargets,
  forgingUpcoming,
  forgingViewString,
  hashForgingState,
  reduceForging,
  replayForging,
  summarizeForging,
  type ForgingConfig,
  type ForgingMark,
  type ForgingMove,
  type ForgingSpot,
  type ForgingState,
} from "../src/index.js";

const cfg = DEFAULT_FORGING_CONFIG;

function randomStrike(state: ForgingState, pick: number): ForgingMove | null {
  const t = forgingTargets(state);
  if (t.length === 0) return null;
  return { type: "strike", cell: t[pick % t.length]! };
}

function playRandom(seed: string, picks: readonly number[], config: ForgingConfig = cfg): { moves: ForgingMove[]; state: ForgingState } {
  let state = createForgingGame(seed, config);
  const moves: ForgingMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomStrike(state, p);
    if (!m) break;
    moves.push(m);
    state = reduceForging(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 120 });

const CHAR: Record<string, ForgingMark> = { "1": "one", "2": "two", "3": "three", "4": "four", r: "rail", s: "slant", x: "star", h: "hook", "!": "spark" };

/** A plate from rows of characters: a mark's character per spot, `.` for a set spot. Every live spot at full heat. */
function plate(rows: readonly string[], over: Partial<ForgingConfig> = {}, heat?: readonly number[]): ForgingState {
  const config: ForgingConfig = { ...cfg, width: rows[0]!.length, height: rows.length, ...over };
  const base = createForgingGame("t", config);
  const cells: ForgingSpot[] = rows
    .join("")
    .split("")
    .map((ch, i) => (ch === "." ? { heat: 0, mark: "one" } : { heat: heat?.[i] ?? config.blows, mark: CHAR[ch]! }));
  return { ...base, cells };
}

const strike = (s: ForgingState, cell: number): ForgingState => reduceForging(s, { type: "strike", cell });

describe("forging determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayForging(seed, cfg, moves);
        expect(hashForgingState(replayed)).toBe(hashForgingState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different plates", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashForgingState(createForgingGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat(), (seed, picks, pick) => {
        const { state } = playRandom(seed, picks.slice(0, 20));
        const before = JSON.stringify(state);
        const m = randomStrike(state, pick);
        if (m) reduceForging(state, m);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("no spot ever shows a step too long to land anywhere from it: a four in the middle is cut to a three", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createForgingGame(seed, { ...cfg, sparks: false });
        const check = (): void => {
          state.cells.forEach((c, i) => {
            if (c.heat > 0) expect(forgingReach(state.config, i, c.mark).length, `${c.mark} at ${i}`).toBeGreaterThan(0);
          });
        };
        check();
        for (const p of picks) {
          if (state.finished) break;
          state = reduceForging(state, randomStrike(state, p)!);
          check();
        }
      }),
      { numRuns: 40 },
    );
    // The middle four of a six by six: a four reaches nothing there, a three does.
    for (const cell of [14, 15, 20, 21]) expect(forgingFitMark(cfg, cell, "four")).toBe("three");
    expect(forgingFitMark(cfg, 0, "four")).toBe("four");
    expect(forgingFitMark(cfg, 14, "rail")).toBe("rail");
  });

  it("the marks dealt do not depend on where the player strikes: the preview always comes true, a step cut to fit its spot", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createForgingGame(seed, { ...cfg, sparks: false });
        for (const p of picks) {
          if (state.finished) break;
          const ahead = forgingUpcoming(state, 3);
          const m = randomStrike(state, p)!;
          state = reduceForging(state, m);
          const r = state.lastMove!;
          if (r.next !== null) expect(r.next).toBe(forgingFitMark(state.config, r.cell, ahead[0]!));
          else expect(forgingUpcoming(state, 3)).toEqual(ahead);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceForging(createForgingGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect(summarizeForging(s)).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceForging(s, { type: "end" })).toThrow(InvalidMoveError);
  });

  it("any line of play ends, on a set plate or a stall, and a stall is the only way to leave blows unstruck", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.nat({ max: 10_000 }), { minLength: 200, maxLength: 200 }), (seed, picks) => {
        const { state } = playRandom(seed, picks);
        expect(state.finished).toBe(true);
        const left = state.cells.reduce((n, c) => n + c.heat, 0);
        expect(state.stalled).toBe(left > 0);
        expect(state.moveCount).toBe(cfg.width * cfg.height * cfg.blows - left);
        expect(state.score).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 30 },
    );
  });
});

describe("forging plate", () => {
  it("opens with every spot at full heat, marks only from the layers on", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createForgingGame(seed, { ...cfg, jumps: false, far: false });
        expect(s.cells.length).toBe(36);
        for (const c of s.cells) {
          expect(c.heat).toBe(3);
          expect(["one", "two", "three"]).toContain(c.mark);
        }
        expect(forgingTargets(s).length).toBe(36);
      }),
      { numRuns: 30 },
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createForgingGame("x", { ...cfg, width: 3 })).toThrow();
    expect(() => createForgingGame("x", { ...cfg, weights: [1, 2, 3] })).toThrow();
    expect(() => createForgingGame("x", { ...cfg, weights: [0, 0, 0, 5, 5, 5, 5, 5] })).toThrow();
    expect(() => createForgingGame("x", { ...cfg, weaveCap: 0 })).toThrow();
  });

  it("draws the view as heat and mark, two characters a spot", () => {
    const s = plate(["1234", "rsxh", "!...", "...."]);
    expect(forgingViewString(s.cells)).toBe("31323334" + "3r3s3x3h" + "3!......" + "........");
  });
});

describe("forging marks", () => {
  const c6 = { ...cfg, width: 6, height: 6 };
  const at = (col: number, row: number): number => row * 6 + col;
  const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

  it("a step lands exactly that far in any of eight directions, jumping what is between", () => {
    expect(sorted(forgingReach(c6, at(2, 2), "two"))).toEqual(sorted([at(2, 0), at(4, 0), at(4, 2), at(4, 4), at(2, 4), at(0, 4), at(0, 2), at(0, 0)]));
    expect(sorted(forgingReach(c6, at(0, 0), "four"))).toEqual(sorted([at(4, 0), at(4, 4), at(0, 4)]));
  });

  it("a rail lands at the edge along its row or column, a slant at the edge along a diagonal, a star at either", () => {
    expect(sorted(forgingReach(c6, at(2, 3), "rail"))).toEqual(sorted([at(2, 0), at(5, 3), at(2, 5), at(0, 3)]));
    // Up-right from (2,3): (3,2),(4,1),(5,0); down-right: (3,4),(4,5); down-left: (1,4),(0,5); up-left: (1,2),(0,1).
    expect(sorted(forgingReach(c6, at(2, 3), "slant"))).toEqual(sorted([at(5, 0), at(4, 5), at(0, 5), at(0, 1)]));
    expect(sorted(forgingReach(c6, at(2, 3), "star"))).toEqual(sorted([at(2, 0), at(5, 3), at(2, 5), at(0, 3), at(5, 0), at(4, 5), at(0, 5), at(0, 1)]));
    // From a corner a rail runs along the two edges it sits on.
    expect(sorted(forgingReach(c6, at(0, 0), "rail"))).toEqual(sorted([at(5, 0), at(0, 5)]));
  });

  it("a hook lands two along and one across", () => {
    expect(sorted(forgingReach(c6, at(0, 0), "hook"))).toEqual(sorted([at(1, 2), at(2, 1)]));
  });

  it("a set spot is never a target, and a strike off the targets is refused", () => {
    let s = plate(["2.2...", "......", "2.....", "......", "......", "......"]);
    s = strike(s, at(0, 0));
    expect(forgingTargets(s)).toEqual([at(2, 0), at(0, 2)]);
    expect(forgingStrikeIllegalReason(s, at(1, 1))).not.toBeNull();
    expect(() => strike(s, at(1, 1))).toThrow(InvalidMoveError);
  });
});

describe("forging scoring", () => {
  const at = (col: number, row: number): number => row * 6 + col;
  const quiet = { sparks: false };

  it("the n-th strike scores n times strikePoints: the further into the plate, the more", () => {
    let s = plate(["11....", "11....", "......", "......", "......", "......"], { ...quiet, blows: 3, chainPoints: 0 });
    const gains: number[] = [];
    for (const c of [at(0, 0), at(1, 0), at(0, 0)]) {
      const before = s.score;
      s = strike(s, c);
      gains.push(s.score - before);
    }
    expect(gains).toEqual([1, 2, 3].map((n) => n * cfg.strikePoints));
  });

  it("every strike scores, and a spot is set after its blows", () => {
    let s = plate(["11....", "11....", "......", "......", "......", "......"], { ...quiet, blows: 1 });
    s = strike(s, at(0, 0));
    expect(s.cells[at(0, 0)]!.heat).toBe(0);
    expect(s.lastMove!.next).toBeNull();
    expect(s.score).toBe(cfg.strikePoints);
  });

  it("striking the same mark again builds a chain, capped", () => {
    let s = plate(["111111", "111111", "......", "......", "......", "......"], { ...quiet, blows: 1, setPoints: 0 });
    const path = [at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0), at(5, 0)];
    const adds: number[] = [];
    for (const c of path) {
      const before = s.score;
      s = strike(s, c);
      adds.push(s.score - before - cfg.strikePoints * s.moveCount);
    }
    expect(adds).toEqual([0, 10, 20, 30, 30, 30]);
    expect(s.bestChain).toBe(6);
  });

  it("four strikes holding each step once are a count; a span begun at once links to it and pays double", () => {
    let s = plate(["12x3.h", "...1..", "......", "4...rs", "......", "......"], { ...quiet, blows: 1, chainPoints: 0 });
    // A count: one, two, three, four.
    s = strike(s, at(0, 0));
    s = strike(s, at(1, 0));
    s = strike(s, at(3, 0));
    expect(s.lastMove!.set).toBeNull();
    s = strike(s, at(0, 3));
    expect(s.lastMove!.set).toEqual({ family: "count", weave: 1, points: cfg.setPoints });
    // Then at once a span: rail, slant, star, hook. It links, the weave's second set.
    s = strike(s, at(4, 3));
    s = strike(s, at(5, 3));
    s = strike(s, at(2, 0));
    s = strike(s, at(5, 0));
    expect(s.lastMove!.set).toEqual({ family: "span", weave: 2, points: cfg.setPoints * 2 });
    expect(s.bestWeave).toBe(2);
    expect(s.score).toBe(36 * cfg.strikePoints + 3 * cfg.setPoints);
  });

  it("a spark stands in for a missing mark", () => {
    let s = plate(["1!....", "......", "......", "......", "......", "......"], { ...quiet, blows: 2, chainPoints: 0 });
    s = strike(s, at(0, 0));
    s = strike(s, at(1, 0));
    expect(s.run).toEqual(["one", "spark"]);
  });

  it("a mark that repeats breaks the set in the making", () => {
    let s = plate(["12.2..", "......", "......", "......", "......", "......"], { ...quiet, blows: 1, chainPoints: 0 });
    s = strike(s, at(0, 0));
    s = strike(s, at(1, 0));
    s = strike(s, at(3, 0));
    expect(s.run).toEqual(["two"]);
    expect(s.lastMove!.broke).toBe(true);
  });

  it("a strike with nowhere to land next is a stall: it scores, and the round ends on it with blows left", () => {
    let s = plate(["4.....", "......", "......", "......", "......", ".....1"], { sparks: false, blows: 1 });
    s = strike(s, at(0, 0));
    expect(s.lastMove!.stalled).toBe(true);
    expect(s.lastMove!.done).toBe(false);
    expect(s.score).toBe(cfg.strikePoints);
    expect(s.stalled).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.cells[at(5, 5)]!.heat).toBe(1);
    expect(forgingTargets(s)).toEqual([]);
    expect(() => strike(s, at(5, 5))).toThrow(InvalidMoveError);
  });

  it("setting the last spot ends the round without a stall", () => {
    let s = plate(["1.....", "......", "......", "......", "......", "......"], { sparks: false, blows: 1 });
    s = { ...s, cells: s.cells.map((c, i) => (i === 0 ? c : { heat: 0, mark: "one" })) };
    s = strike(s, at(0, 0));
    expect(s.lastMove!.done).toBe(true);
    expect(s.lastMove!.stalled).toBe(false);
    expect(s.score).toBe(cfg.strikePoints + cfg.platePoints);
    expect(s.stalled).toBe(false);
    expect(s.finished).toBe(true);
  });

  it("the last spot at the plate's highest heat earns a spark", () => {
    let s = plate(["11....", "......", "......", "......", "......", "......"], { blows: 2 });
    s = { ...s, cells: s.cells.map((c, i) => (i <= 1 ? c : { heat: 0, mark: "one" })) };
    s = strike(s, at(0, 0));
    expect(s.lastMove!.sparked).toBe(false);
    s = strike(s, at(1, 0));
    expect(s.lastMove!.sparked).toBe(true);
    expect(s.cells[at(1, 0)]!.mark).toBe("spark");
    expect(s.sparksEarned).toBe(1);
    // A spark lands on any live spot but its own.
    expect(forgingTargets(s)).toEqual([at(0, 0)]);
  });
});

describe("forging hint", () => {
  it("names a legal strike and never a stall when another is open", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 40));
        if (state.finished) return;
        const h = forgingHint(state);
        expect(h).not.toBeNull();
        expect(forgingStrikeIllegalReason(state, h!)).toBeNull();
        const stalls = forgingTargets(state).filter((c) => strike(state, c).lastMove!.stalled);
        if (stalls.length < forgingTargets(state).length) expect(strike(state, h!).lastMove!.stalled).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});
