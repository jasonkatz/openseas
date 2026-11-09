import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  COOLING_HEIGHT,
  COOLING_WIDTH,
  DEFAULT_COOLING_CONFIG,
  InvalidMoveError,
  Special,
  createCoolingGame,
  findMatches,
  hashCoolingState,
  idx,
  isSpecial,
  previewSwap,
  reduceCooling,
  replayCooling,
  swapIllegalReason,
  type CoolingConfig,
  type CoolingMove,
  type CoolingState,
  type Piece,
  heatAfterMove,
  heatRowOf,
  heatUnitsPerRow,
} from "../src/index.js";

const cfg = DEFAULT_COOLING_CONFIG;

/** A random legal move for the current state. Returns null if the board has none (never, in practice). */
function randomLegalMove(state: CoolingState, pick: number): CoolingMove | null {
  const legal: CoolingMove[] = [];
  for (let r = 0; r < state.config.height; r++) {
    for (let c = 0; c < state.config.width - 1; c++) {
      if (swapIllegalReason(state, c, r) === null) legal.push({ type: "swap", col: c, row: r });
    }
  }
  if (legal.length === 0) return null;
  return legal[pick % legal.length]!;
}

/** Drive a game with a stream of picks, producing the resulting move log and final state. */
function playRandom(seed: string, picks: readonly number[], config = cfg): { moves: CoolingMove[]; state: CoolingState } {
  let state = createCoolingGame(seed, config);
  const moves: CoolingMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomLegalMove(state, p);
    if (!m) break;
    moves.push(m);
    state = reduceCooling(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 60 });

describe("cooling board", () => {
  it("starts full, with no matches and no slag pieces", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createCoolingGame(seed);
        expect(s.cells.length).toBe(COOLING_WIDTH * COOLING_HEIGHT);
        for (const p of s.cells) {
          expect(p).toBeDefined();
          expect(p.kind).not.toBe(Special.Slag);
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

describe("cooling determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const a = playRandom(seed, picks);
        const b = replayCooling(seed, a.moves);
        expect(hashCoolingState(b)).toBe(hashCoolingState(a.state));
        expect(b).toEqual(a.state);
      }),
      { numRuns: 200 },
    );
  });

  it("different seeds give different boards", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        expect(hashCoolingState(createCoolingGame(a))).not.toBe(hashCoolingState(createCoolingGame(b)));
      }),
    );
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCoolingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m) break;
          const before = JSON.stringify(state);
          reduceCooling(state, m);
          expect(JSON.stringify(state)).toBe(before);
          state = reduceCooling(state, m);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("cooling rules", () => {
  it("after every move the board is full and holds no standing match", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCoolingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m) break;
          state = reduceCooling(state, m);
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
        let state = createCoolingGame(seed);
        let total = 0;
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m) break;
          state = reduceCooling(state, m);
          expect(state.lastMove?.points ?? 0).toBeGreaterThanOrEqual(0);
          total += state.lastMove?.points ?? 0;
          expect(state.score).toBe(total);
        }
      }),
    );
  });

  it("a plain non-clearing swap is legal and scores nothing", () => {
    // Find a seed and a swap that clears nothing.
    let state = createCoolingGame("plain");
    let found: CoolingMove | null = null;
    for (let r = 0; r < cfg.height && !found; r++) {
      for (let c = 0; c < cfg.width - 1 && !found; c++) {
        const pv = previewSwap(state, c, r);
        if (pv.legal && pv.cells.length === 0) found = { type: "swap", col: c, row: r };
      }
    }
    expect(found).not.toBeNull();
    state = reduceCooling(state, found!);
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
    const after = reduceCooling(s2, { type: "swap", col: 2, row: 0 });
    expect(after.lastMove?.rounds[0]?.groups[0]?.cells).toEqual([0, 1, 2]);
    expect(after.lastMove?.rounds[0]?.points).toBe(3);
    expect(after.score).toBeGreaterThanOrEqual(3);
    expect(after.combo).toBe(1);
  });

  it("a streak adds a step per scoring move in a row, up to its cap, on the move's whole points", () => {
    const state = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "201534")));
    const s2 = withCells(state, { 0: 7, 1: 7, 3: 7 });
    const plain = reduceCooling(s2, { type: "swap", col: 2, row: 0 });
    const raw = plain.lastMove!.rounds.reduce((n, r) => n + r.points, 0);
    expect(plain.lastMove!.streakPercent).toBe(100);
    expect(plain.lastMove!.points).toBe(raw);
    // Fourth in a row: three before it, three steps.
    const fourth = reduceCooling({ ...s2, combo: 3 }, { type: "swap", col: 2, row: 0 });
    expect(fourth.lastMove!.streakPercent).toBe(100 + 3 * cfg.streakStepPercent);
    expect(fourth.lastMove!.points).toBe(Math.floor((raw * (100 + 3 * cfg.streakStepPercent)) / 100));
    expect(fourth.combo).toBe(4);
    // Far into a streak it holds at the cap.
    const long = reduceCooling({ ...s2, combo: 40 }, { type: "swap", col: 2, row: 0 });
    expect(long.lastMove!.streakPercent).toBe(cfg.streakMaxPercent);
  });

  it("one setup swap keeps the streak; one more than the grace breaks it", () => {
    let state: CoolingState = { ...createCoolingGame("plain"), combo: 4 };
    const quiet = (s: CoolingState): CoolingMove => {
      for (let r = 0; r < cfg.height; r++)
        for (let c = 0; c < cfg.width - 1; c++) {
          const pv = previewSwap(s, c, r);
          if (pv.legal && pv.cells.length === 0 && reduceCooling(s, { type: "swap", col: c, row: r }).lastMove!.points === 0) return { type: "swap", col: c, row: r };
        }
      throw new Error("no quiet swap");
    };
    for (let k = 1; k <= cfg.streakGrace; k++) {
      state = reduceCooling(state, quiet(state));
      expect(state.combo).toBe(4);
      expect(state.misses).toBe(k);
    }
    state = reduceCooling(state, quiet(state));
    expect(state.combo).toBe(0);
  });

  it("slag pieces lifted together score 15 by their count squared, and only clears take the cascade", () => {
    // Over many rounds with slag pieces about, every step is scored by the rule for what it cleared.
    const rich: CoolingConfig = { ...cfg, specialChancePerMille: { charge: 40, magnet: 30, slag: 120 } };
    const step = (n: number): number => cfg.cascadeMultipliers[Math.min(n, cfg.cascadeMultipliers.length) - 1]!;
    let lifted = 0;
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 11 })), { minLength: 1, maxLength: 30 }), (seed, swaps) => {
        let st = createCoolingGame(seed, rich);
        for (const [col, row] of swaps) {
          st = reduceCooling(st, { type: "swap", col, row });
          for (const r of st.lastMove!.rounds) {
            const base = r.groups.reduce((n, g) => n + g.points, 0);
            if (r.groups.every((g) => g.cause === "slag")) {
              lifted++;
              expect(r.points).toBe(15 * r.groups.length * r.groups.length);
            } else expect(r.points).toBe(base * r.groups.length * step(r.chain));
          }
        }
      }),
      { numRuns: 60 },
    );
    expect(lifted).toBeGreaterThan(0);
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
    const after = reduceCooling(s, { type: "swap", col: 2, row: 0 });
    const round = after.lastMove!.rounds[0]!;
    expect(round.groups.length).toBe(2);
    expect(round.points).toBe((3 + 3) * 2);
  });

  it("a spark charge clears the 3x3 around where it lands", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    const s = withCells(base, { [idx(cfg, 2, 5)]: Special.Charge });
    const after = reduceCooling(s, { type: "swap", col: 2, row: 5 });
    const round = after.lastMove!.rounds[0]!;
    const charge = round.groups.find((g) => g.cause === "charge")!;
    expect(charge.cells.length).toBe(9);
    for (const c of charge.cells) {
      expect(Math.abs((c % cfg.width) - 3)).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.floor(c / cfg.width) - 5)).toBeLessThanOrEqual(1);
    }
  });

  it("a magnet wipes every piece of the kind it is swapped with", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    const s = withCells(base, { [idx(cfg, 0, 4)]: Special.Magnet });
    const target = s.cells[idx(cfg, 1, 4)]!.kind;
    const count = s.cells.filter((p) => p.kind === target).length;
    const after = reduceCooling(s, { type: "swap", col: 0, row: 4 });
    const magnet = after.lastMove!.rounds[0]!.groups.find((g) => g.cause === "magnet")!;
    expect(magnet.cells.length).toBe(count + 1);
  });

  it("a slag piece can be swapped like any piece and never matches", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    const s = withCells(base, { [idx(cfg, 0, 0)]: Special.Slag, [idx(cfg, 2, 0)]: Special.Slag, [idx(cfg, 3, 0)]: Special.Slag });
    expect(swapIllegalReason(s, 0, 0)).toBeNull();
    expect(findMatches(cfg, s.cells)).toEqual([]);
    const after = reduceCooling(s, { type: "swap", col: 0, row: 0 });
    expect(after.lastMove?.points).toBe(0);
    expect(after.cells[idx(cfg, 1, 0)]!.kind).toBe(Special.Slag);
  });

  it("a slag piece comes off once it is at or above the heat line", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    // Under heat (row 1 < heatRow 3): stays. Above (row 8): clears at the end of the move.
    const s = withCells(base, { [idx(cfg, 5, 1)]: Special.Slag, [idx(cfg, 5, 8)]: Special.Slag });
    expect(s.heatRow).toBe(3);
    const after = reduceCooling(s, { type: "swap", col: 0, row: 11 });
    const g = after.lastMove!.rounds.flatMap((r) => r.groups).filter((x) => x.cause === "slag");
    expect(g.map((x) => x.cells)).toEqual([[idx(cfg, 5, 8)]]);
    expect(after.cells.filter((p) => p.kind === Special.Slag).length).toBe(1);
    expect(after.score).toBe(15);
  });

  it("pieces rise: clearing lifts what is below and new pieces enter from the bottom", () => {
    const base = handBoard(Array.from({ length: 12 }, (_, r) => (r % 2 ? "120453" : "012345")));
    // Build a horizontal three on the top row (row 11) at cols 0..2 after swapping cols 2,3.
    const s = withCells(base, { [idx(cfg, 0, 11)]: 7, [idx(cfg, 1, 11)]: 7, [idx(cfg, 2, 11)]: 2, [idx(cfg, 3, 11)]: 7, [idx(cfg, 3, 10)]: 9 });
    expect(findMatches(cfg, s.cells)).toEqual([]);
    const below = [0, 1, 2].map((c) => s.cells[idx(cfg, c, 10)]!.id);
    const maxId = Math.max(...s.cells.map((p) => p.id));
    const after = reduceCooling(s, { type: "swap", col: 2, row: 11 });
    expect(after.lastMove!.rounds[0]!.groups[0]!.cells).toEqual([idx(cfg, 0, 11), idx(cfg, 1, 11), idx(cfg, 2, 11)]);
    // What was in row 10 is now in row 11, and the three new pieces sit on row 0.
    expect([0, 1, 2].map((c) => after.cells[idx(cfg, c, 11)]!.id)).toEqual(below);
    for (const c of [0, 1, 2]) expect(after.cells[idx(cfg, c, 0)]!.id).toBeGreaterThan(maxId);
  });

  it("move reports describe each cascade step: cleared ids leave, and the last step is the final board", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCoolingGame(seed, cfg);
        for (const pick of picks) {
          const move = randomLegalMove(state, pick);
          if (!move || state.finished) break;
          const before = new Map(state.cells.map((p, i) => [p.id, i]));
          state = reduceCooling(state, move);
          const rounds = state.lastMove!.rounds;
          let board: ReadonlyArray<Piece> | null = null;
          for (const round of rounds) {
            for (const g of round.groups) {
              expect(g.ids.length).toBe(g.cells.length);
              if (round.chain === 1) for (const id of g.ids) expect(before.has(id)).toBe(true);
              const left = new Set(round.settled.map((p) => p.id));
              for (const id of g.ids) expect(left.has(id)).toBe(false);
            }
            expect(round.settled.length).toBe(cfg.width * cfg.height);
            board = round.settled;
          }
          if (board) expect(board).toEqual(state.cells);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("the heat rises with every move, drains with points, and never leaves [floor, top]", () => {
    const per = cfg.heatRisePerMoves * cfg.heatDropPerPoints;
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCoolingGame(seed, cfg);
        let heat = cfg.initialHeatRow * per;
        for (const pick of picks) {
          const move = randomLegalMove(state, pick);
          if (!move || state.finished) break;
          state = reduceCooling(state, move);
          heat += cfg.heatDropPerPoints - state.lastMove!.points * cfg.heatRisePerMoves;
          heat = Math.max(cfg.minHeatRow * per, Math.min(cfg.height * per, heat));
          expect(state.heat).toBe(heat);
          expect(state.heatRow).toBe(Math.floor(heat / per));
          expect(state.heatRow).toBeGreaterThanOrEqual(cfg.minHeatRow);
        }
      }),
    );
  });

  it("venting at the floor is wasted: points scored there do not hold the heat down later", () => {
    const per = heatUnitsPerRow(cfg);
    const floor = cfg.minHeatRow * per;
    // A huge clear while already at the floor leaves the heat at the floor, not below it...
    let heat = heatAfterMove(cfg, floor, 1000);
    expect(heat).toBe(floor);
    // ...so the next heatRisePerMoves scoreless moves raise it a full row, as if it never happened.
    for (let i = 0; i < cfg.heatRisePerMoves; i++) heat = heatAfterMove(cfg, heat, 0);
    expect(heatRowOf(cfg, heat)).toBe(cfg.minHeatRow + 1);
    // And it never overflows the top.
    expect(heatRowOf(cfg, heatAfterMove(cfg, cfg.height * per, 0))).toBe(cfg.height);
  });

  it("rejects out-of-range swaps and moves after the end", () => {
    const s = createCoolingGame("bounds");
    expect(() => reduceCooling(s, { type: "swap", col: 5, row: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceCooling(s, { type: "swap", col: -1, row: 0 })).toThrow(InvalidMoveError);
    expect(() => reduceCooling(s, { type: "swap", col: 0, row: 12 })).toThrow(InvalidMoveError);
    expect(() => reduceCooling(s, { type: "swap", col: 0.5, row: 1 })).toThrow(InvalidMoveError);
    const ended = reduceCooling(s, { type: "end" });
    expect(ended.finished).toBe(true);
    expect(() => reduceCooling(ended, { type: "swap", col: 0, row: 0 })).toThrow(InvalidMoveError);
  });

  it("finishes after maxMoves", () => {
    const small: CoolingConfig = { ...cfg, maxMoves: 5 };
    const { state, moves } = playRandom("short", Array.from({ length: 20 }, (_, i) => i), small);
    expect(moves.length).toBe(5);
    expect(state.finished).toBe(true);
  });

  it("the preview matches what the move actually clears first", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCoolingGame(seed);
        for (const p of picks) {
          if (state.finished) break;
          const m = randomLegalMove(state, p);
          if (!m || m.type !== "swap") break;
          const pv = previewSwap(state, m.col, m.row);
          state = reduceCooling(state, m);
          const first = state.lastMove!.rounds[0];
          const actual = first ? [...new Set(first.groups.flatMap((g) => g.cells))].sort((a, b) => a - b) : [];
          expect(pv.cells).toEqual(actual);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("regression: a slag piece lifted above the heat by a slag piece's own refill comes off in the same move", () => {
    // fast-check counterexample: on the third move a slag piece came off, the refill lifted another
    // slag to cell 32 above the heat line, and it stayed there until the next (plain) swap
    // cleared it, which the preview could not predict.
    let state = createCoolingGame("@m");
    for (const p of [8211, 9701, 7543, 0]) {
      const m = randomLegalMove(state, p);
      if (!m || m.type !== "swap") throw new Error("expected a swap");
      const pv = previewSwap(state, m.col, m.row);
      state = reduceCooling(state, m);
      const first = state.lastMove!.rounds[0];
      const actual = first ? [...new Set(first.groups.flatMap((g) => g.cells))].sort((a, b) => a - b) : [];
      expect(pv.cells).toEqual(actual);
      state.cells.forEach((piece, i) => {
        if (piece.kind === Special.Slag) expect(Math.floor(i / cfg.width)).toBeLessThan(state.heatRow);
      });
    }
  });

  it("every ordinary kind is below the special base", () => {
    const { state } = playRandom("kinds", Array.from({ length: 60 }, (_, i) => i * 31));
    for (const p of state.cells) {
      if (!isSpecial(p.kind)) expect(p.kind).toBeLessThan(cfg.pieceKinds);
    }
  });
});

/** Build a state from rows of single-digit kinds (row 0 first = bottom). Digits beyond pieceKinds are allowed for tests. */
function handBoard(rows: readonly string[]): CoolingState {
  const base = createCoolingGame("hand");
  const cells: Piece[] = [];
  let id = 1;
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      cells[idx(cfg, c, r)] = { id: id++, kind: Number(ch) };
    });
  });
  return { ...base, cells, nextId: id };
}

function withCells(state: CoolingState, overrides: Record<number, number>): CoolingState {
  const cells = state.cells.slice();
  let nextId = state.nextId;
  for (const [k, kind] of Object.entries(overrides)) {
    cells[Number(k)] = { id: nextId++, kind };
  }
  return { ...state, cells, nextId };
}

describe("cooling aboard a ship (DESIGN.md 3.3)", () => {
  const aboard: CoolingConfig = { ...cfg, shipHeat: true };

  it("heat events set the heat; swaps neither raise nor drain it", () => {
    let s = createCoolingGame("ship", aboard);
    expect(s.heatRow).toBe(cfg.initialHeatRow);
    s = reduceCooling(s, { type: "heat", row: 0 });
    expect(s.heatRow).toBe(0);
    expect(s.heat).toBe(0);
    expect(s.moveCount).toBe(0);
    expect(s.lastMove).toMatchObject({ move: { type: "heat", row: 0 }, points: 0, rounds: [] });
    for (let i = 0; i < 20; i++) {
      const m = randomLegalMove(s, i * 7);
      if (!m) break;
      s = reduceCooling(s, m);
      expect(s.heatRow).toBe(0);
    }
    expect(s.moveCount).toBe(20);
    s = reduceCooling(s, { type: "heat", row: 9 });
    expect(s.heatRow).toBe(9);
    expect(s.heat).toBe(9 * heatUnitsPerRow(aboard));
    expect(s.moveCount).toBe(20);
  });

  it("a heat event below the floor or above the top, or on a practice board, is refused", () => {
    const s = createCoolingGame("ship", aboard);
    expect(() => reduceCooling(s, { type: "heat", row: -1 })).toThrow(InvalidMoveError);
    expect(() => reduceCooling(s, { type: "heat", row: aboard.height + 1 })).toThrow(InvalidMoveError);
    expect(() => reduceCooling(s, { type: "heat", row: 1.5 })).toThrow(InvalidMoveError);
    const practice = createCoolingGame("ship", cfg);
    expect(() => reduceCooling(practice, { type: "heat", row: 2 })).toThrow(InvalidMoveError);
  });

  it("replays bit for bit with heat events in the log", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.nat({ max: 1_000_000 }), { minLength: 0, maxLength: 60 }), (seed, picks) => {
        let state = createCoolingGame(seed, aboard);
        const moves: CoolingMove[] = [];
        for (const p of picks) {
          const m: CoolingMove | null = p % 5 === 0 ? { type: "heat", row: (p >> 3) % (aboard.height + 1) } : randomLegalMove(state, p);
          if (!m) break;
          state = reduceCooling(state, m);
          moves.push(m);
        }
        const again = replayCooling(seed, moves, aboard);
        expect(hashCoolingState(again)).toBe(hashCoolingState(state));
        expect(again).toEqual(state);
      }),
      { numRuns: 100 },
    );
  });

  it("the config refuses a non-boolean shipHeat", () => {
    expect(() => createCoolingGame("x", { ...cfg, shipHeat: 1 as unknown as boolean })).toThrow();
  });
});
