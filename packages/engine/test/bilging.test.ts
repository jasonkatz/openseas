import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BILGING_HEIGHT,
  BILGING_WIDTH,
  DEFAULT_BILGING_CONFIG,
  InvalidMoveError,
  Special,
  createBilgingGame,
  findMatches,
  hashBilgingState,
  idx,
  isSpecial,
  previewSwap,
  reduceBilging,
  replayBilging,
  swapIllegalReason,
  type BilgingConfig,
  type BilgingMove,
  type BilgingState,
  type Piece,
} from "../src/index.js";

const cfg = DEFAULT_BILGING_CONFIG;

/** A random legal move for the current state. Returns null if the board has none (never, in practice). */
function randomLegalMove(state: BilgingState, pick: number): BilgingMove | null {
  const legal: BilgingMove[] = [];
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) === null) legal.push({ type: "swap", col: c, row: r });
    }
  }
  if (legal.length === 0) return null;
  return legal[pick % legal.length]!;
}

/** Drive a game with a stream of picks, producing the resulting move log and final state. */
function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: BilgingMove[]; state: BilgingState } {
  let state = createBilgingGame(seed, config);
  const moves: BilgingMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomLegalMove(state, p);
    if (!m) break;
    moves.push(m);
    state = reduceBilging(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 60 });

describe("bilging board", () => {
  it("starts full, with no matches and no barnacles", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createBilgingGame(seed);
        expect(s.cells.length).toBe(BILGING_WIDTH * BILGING_HEIGHT);
        for (const p of s.cells) {
          expect(p).toBeDefined();
          expect(p.kind).not.toBe(Special.Barnacle);
        }
        expect(findMatches(cfg, s.cells)).toEqual([]);
      }),
    );
  });

  it("gives every piece a unique id", () => {
    const { state } = playRandom("ids", Array.from({ length: 40 }, (_, i) => i * 7919));
    const ids = new Set(state.cells.map((p) => p.id));
    expect(ids.size).toBe(state.cells.length);
  });
});

describe("bilging determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayBilging(seed, a.moves);
        expect(hashBilgingState(b)).toBe(hashBilgingState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("different seeds give different boards", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(hashBilgingState(createBilgingGame(a))).not.toBe(hashBilgingState(createBilgingGame(b)));
      }),
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createBilgingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m) break;
          const before = JSON.stringify(state);
          reduceBilging(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceBilging(state, m);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("bilging rules", () => {
  it("after every move the board is full and holds no standing match", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createBilgingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m) break;
          state = reduceBilging(state, m);
          expect(state.cells.every((c) => c !== null && c !== undefined)).toBe(true);
          expect(findMatches(cfg, state.cells)).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("score is the sum of move points and never decreases", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createBilgingGame(seed);
        let total = 0;
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m) break;
          state = reduceBilging(state, m);
          expect(state.lastMove?.points ?? 0).toBeGreaterThanOrEqual(0);
          total += state.lastMove?.points ?? 0;
          expect(state.score).toBe(total);
        }
      }),
    );
  });

  it("a plain non-clearing swap is legal and resets the combo", () => {
    // Find a seed and a swap that clears nothing.
    let state = createBilgingGame("plain");
    let found: BilgingMove | null = null;
    for (let r = 0; r < cfg.height && !found; r++) {
      for (let c = 0; c < cfg.width - 1 && !found; c++) {
        const pv = previewSwap(state, c, r);
        if (pv.legal && pv.cells.length === 0) found = { type: "swap", col: c, row: r };
      }
    }
    expect(found).not.toBeNull();
    state = reduceBilging(state, found!);
    expect(state.lastMove?.points).toBe(0);
    expect(state.combo).toBe(0);
    expect(state.moveCount).toBe(1);
  });

  it("clearing three in a row scores 3 and cascades multiply", () => {
    const state = handBoard([
      // row 0 (bottom) .. row 11 (top); kinds as digits, row strings left to right
      "012345",
      "120453",
      "201534",
      "012345",
      "120453",
      "201534",
      "012345",
      "120453",
      "201534",
      "012345",
      "120453",
      "201534",
    ]);
    // No match anywhere at the start.
    expect(findMatches(cfg, state.cells)).toEqual([]);
    // Make row 0 into 0,1,2,3,4,5 -> swap won't help; build an explicit three instead.
    const s2 = withCells(state, { 0: 7, 1: 7, 3: 7 }); // row 0: 7,7,2,7,4,5 -> swap cols 2,3 gives 7,7,7,2
    const after = reduceBilging(s2, { type: "swap", col: 2, row: 0 });
    expect(after.lastMove?.rounds[0]?.groups[0]?.cells).toEqual([0, 1, 2]);
    expect(after.lastMove?.rounds[0]?.points).toBe(3);
    expect(after.score).toBeGreaterThanOrEqual(3);
    expect(after.combo).toBe(1);
  });

  it("two separate threes in one swap are worth more than the sum", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    // row 0: 7 7 x 7 . . and row 1 : 8 8 x 8 ...; swap col 2 of row 0 forms a 7-run only.
    // Instead make a vertical and horizontal pair cleared by one swap:
    // row 0: [7,7,2,7,4,5]; col 2 rows 1..2 = 6,6 and row 0 col 3 after swap... keep it simple:
    // row 0 = 7 7 2 7 4 5 ; rows 1,2 at col 3 = 2,2 so swapping (2,0)<->(3,0) gives 7 7 7 2 with 2 above 2,2.
    const s = withCells(base, {
      [idx(cfg, 0, 0)]: 7,
      [idx(cfg, 1, 0)]: 7,
      [idx(cfg, 2, 0)]: 2,
      [idx(cfg, 3, 0)]: 7,
      [idx(cfg, 3, 1)]: 2,
      [idx(cfg, 3, 2)]: 2,
      [idx(cfg, 3, 3)]: 9,
    });
    expect(findMatches(cfg, s.cells)).toEqual([]);
    const after = reduceBilging(s, { type: "swap", col: 2, row: 0 });
    const round = after.lastMove!.rounds[0]!;
    expect(round.groups.length).toBe(2);
    expect(round.points).toBe((3 + 3) * 2);
  });

  it("a powder keg clears the 3x3 around where it lands", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    const s = withCells(base, { [idx(cfg, 2, 5)]: Special.Keg });
    const after = reduceBilging(s, { type: "swap", col: 2, row: 5 });
    const round = after.lastMove!.rounds[0]!;
    const keg = round.groups.find((g) => g.cause === "keg")!;
    expect(keg.cells.length).toBe(9);
    for (const c of keg.cells) {
      expect(Math.abs((c % cfg.width) - 3)).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.floor(c / cfg.width) - 5)).toBeLessThanOrEqual(1);
    }
  });

  it("an ink cloud wipes every piece of the kind it is swapped with", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    const s = withCells(base, { [idx(cfg, 0, 4)]: Special.Ink });
    const target = s.cells[idx(cfg, 1, 4)]!.kind;
    const count = s.cells.filter((p) => p.kind === target).length;
    const after = reduceBilging(s, { type: "swap", col: 0, row: 4 });
    const ink = after.lastMove!.rounds[0]!.groups.find((g) => g.cause === "ink")!;
    expect(ink.cells.length).toBe(count + 1);
  });

  it("a barnacle can be swapped like any piece and never matches", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    const s = withCells(base, { [idx(cfg, 0, 0)]: Special.Barnacle, [idx(cfg, 2, 0)]: Special.Barnacle, [idx(cfg, 3, 0)]: Special.Barnacle });
    expect(swapIllegalReason(s, 0, 0)).toBeNull();
    expect(findMatches(cfg, s.cells)).toEqual([]);
    const after = reduceBilging(s, { type: "swap", col: 0, row: 0 });
    expect(after.lastMove?.points).toBe(0);
    expect(after.cells[idx(cfg, 1, 0)]!.kind).toBe(Special.Barnacle);
  });

  it("a barnacle comes off once it is at or above the water line", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    // Under water (row 1 < waterRow 3): stays. Above (row 8): clears at the end of the move.
    const s = withCells(base, { [idx(cfg, 5, 1)]: Special.Barnacle, [idx(cfg, 5, 8)]: Special.Barnacle });
    expect(s.waterRow).toBe(3);
    const after = reduceBilging(s, { type: "swap", col: 0, row: 11 });
    const g = after.lastMove!.rounds.flatMap((r) => r.groups).filter((x) => x.cause === "barnacle");
    expect(g.map((x) => x.cells)).toEqual([[idx(cfg, 5, 8)]]);
    expect(after.cells.filter((p) => p.kind === Special.Barnacle).length).toBe(1);
    expect(after.score).toBe(15);
  });

  it("pieces rise: clearing lifts what is below and new pieces enter from the bottom", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    // Build a horizontal three on the top row (row 11) at cols 0..2 after swapping cols 2,3.
    const s = withCells(base, { [idx(cfg, 0, 11)]: 7, [idx(cfg, 1, 11)]: 7, [idx(cfg, 2, 11)]: 2, [idx(cfg, 3, 11)]: 7, [idx(cfg, 3, 10)]: 9 });
    expect(findMatches(cfg, s.cells)).toEqual([]);
    const below = [0, 1, 2].map((c) => s.cells[idx(cfg, c, 10)]!.id);
    const maxId = Math.max(...s.cells.map((p) => p.id));
    const after = reduceBilging(s, { type: "swap", col: 2, row: 11 });
    expect(after.lastMove!.rounds[0]!.groups[0]!.cells).toEqual([idx(cfg, 0, 11), idx(cfg, 1, 11), idx(cfg, 2, 11)]);
    // What was in row 10 is now in row 11, and the three new pieces sit on row 0.
    expect([0, 1, 2].map((c) => after.cells[idx(cfg, c, 11)]!.id)).toEqual(below);
    for (const c of [0, 1, 2]) expect(after.cells[idx(cfg, c, 0)]!.id).toBeGreaterThan(maxId);
  });

  it("the water line rises with moves and drops with points", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks);
        const expected =
          cfg.initialWaterRow +
          Math.floor(state.moveCount / cfg.waterRisePerMoves) -
          Math.floor(state.score / cfg.waterDropPerPoints);
        expect(state.waterRow).toBe(Math.max(0, Math.min(cfg.height, expected)));
      }),
    );
  });

  it("rejects out-of-range swaps and moves after the end", () => {
    const s = createBilgingGame("bounds");
    expect(() => reduceBilging(s, { type: "swap", col: 5, row: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceBilging(s, { type: "swap", col: -1, row: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceBilging(s, { type: "swap", col: 0, row: 12 })).toThrow(InvalidMoveError);
    expect(() => reduceBilging(s, { type: "swap", col: 0.5, row: 1 })).toThrow(InvalidMoveError);
    const ended = reduceBilging(s, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reduceBilging(ended, { type: "swap", col: 0, row: 0 })).toThrow(InvalidMoveError);
  });

  it("finishes after maxMoves", () => {
    const small: BilgingConfig = { ...cfg, maxMoves: 5 };
    const { state, moves } = playRandom("short", Array.from({ length: 20 }, (_, i) => i), small);
    expect(moves.length).toBe(5);
    expect(state.finished).toBe(true);
  });

  it("the preview matches what the move actually clears first", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createBilgingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m || m.type !== "swap") break;
          const pv = previewSwap(state, m.col, m.row);
          state = reduceBilging(state, m);
          const first = state.lastMove!.rounds[0];
          const actual = first ? [...new Set(first.groups.flatMap((g) => g.cells))].sort((a, b) => a - b) : [];
          expect(pv.cells).toEqual(actual);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("every ordinary kind is below the special base", () => {
    const { state } = playRandom("kinds", Array.from({ length: 60 }, (_, i) => i * 31));
    for (const p of state.cells) {
      if (!isSpecial(p.kind)) expect(p.kind).toBeLessThan(cfg.pieceKinds);
    }
  });
});

/** Build a state from rows of single-digit kinds (row 0 first = bottom). Digits beyond pieceKinds are allowed for tests. */
function handBoard(rows: readonly string[]): BilgingState {
  const base = createBilgingGame("hand");
  const cells: Piece[] = [];
  let id = 1;
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      cells[idx(cfg, c, r)] = { id: id++, kind: Number(ch) };
    });
  });
  return { ...base, cells, nextId: id };
}

function withCells(state: BilgingState, overrides: Record<number, number>): BilgingState {
  const cells = state.cells.slice();
  let nextId = state.nextId;
  for (const [k, kind] of Object.entries(overrides)) {
    cells[Number(k)] = { id: nextId++, kind };
  }
  return { ...state, cells, nextId };
}
