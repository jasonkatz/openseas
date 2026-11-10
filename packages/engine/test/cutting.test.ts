import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_CUTTING_CONFIG,
  InvalidMoveError,
  createCuttingGame,
  cuttingBestCut,
  cuttingBestRemaining,
  cuttingCutIllegalReason,
  cuttingCutPreview,
  cuttingGrade,
  cuttingPieceAt,
  cuttingPureOre,
  cuttingSlabBest,
  cuttingSlabShape,
  cuttingStreakPercentAt,
  cuttingViewString,
  hashCuttingState,
  reduceCutting,
  replayCutting,
  type CuttingConfig,
  type CuttingMove,
  type CuttingState,
} from "../src/index.js";

const cfg = DEFAULT_CUTTING_CONFIG;

type Cut = Extract<CuttingMove, { type: "cut" }>;

function legalCuts(state: CuttingState): Cut[] {
  const out: Cut[] = [];
  for (const p of state.pieces) {
    for (let at = p.x + 1; at < p.x + p.w; at++) out.push({ type: "cut", piece: p.id, vertical: true, at });
    for (let at = p.y + 1; at < p.y + p.h; at++) out.push({ type: "cut", piece: p.id, vertical: false, at });
  }
  return out;
}

/** A legal move from a pick: usually a cut, now and then a slab given up. */
function randomMove(state: CuttingState, pick: number): CuttingMove {
  const cuts = legalCuts(state);
  if (cuts.length === 0 || pick % 17 === 0) return { type: "done" };
  return cuts[pick % cuts.length]!;
}

function playRandom(seed: string, picks: readonly number[], config: CuttingConfig = cfg): { moves: CuttingMove[]; state: CuttingState } {
  let state = createCuttingGame(seed, config);
  const moves: CuttingMove[] = [];
  for (const p of picks) {
    if (state.finished) break;
    const m = randomMove(state, p);
    moves.push(m);
    state = reduceCutting(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 60 });

/** A slab on the table from rows of ore digits, with `cuts` cuts and its true best. */
function slab(rows: readonly string[], cuts: number, extra: Partial<CuttingConfig> = {}): CuttingState {
  const config: CuttingConfig = { ...cfg, width: rows[0]!.length, height: rows.length, minCuts: Math.min(cuts, cfg.minCuts), maxCuts: Math.max(cuts, cfg.maxCuts), ...extra };
  const base = createCuttingGame("t", config);
  const ores = rows.join("").split("").map(Number);
  return { ...base, ores, pieces: [{ id: 1, x: 0, y: 0, w: config.width, h: config.height }], banked: [], cutsAllowed: cuts, cutsLeft: cuts, slabGot: 0, slabBest: cuttingSlabBest(config, ores, cuts), nextId: 2 };
}

/** The most any order of cuts banks from the slab on the table: every legal sequence tried. */
function bruteBest(state: CuttingState): number {
  let best = state.slabGot;
  for (const c of legalCuts(state)) {
    if (state.cutsLeft === 0) break;
    const next = reduceCutting(state, c);
    best = Math.max(best, next.slab === state.slab ? bruteBest(next) : next.lastMove!.slab!.got);
  }
  return best;
}

describe("cutting table", () => {
  it("opens with one whole mixed slab, cuts within the limits and a best worth playing for", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createCuttingGame(seed);
        expect(s.ores.length).toBe(cfg.width * cfg.height);
        expect(s.ores.every((o) => Number.isInteger(o) && o >= 0 && o < cfg.ores)).toBe(true);
        expect(s.pieces).toEqual([{ id: 1, x: 0, y: 0, w: cfg.width, h: cfg.height }]);
        expect(cuttingPureOre(s, s.pieces[0]!)).toBeNull();
        expect(s.cutsAllowed).toBeGreaterThanOrEqual(cfg.minCuts);
        expect(s.cutsAllowed).toBeLessThanOrEqual(cfg.maxCuts);
        expect(s.cutsLeft).toBe(s.cutsAllowed);
        expect(s.slabBest).toBeGreaterThan(0);
        expect(s.slabBest).toBe(cuttingSlabBest(cfg, s.ores, s.cutsAllowed));
        expect(s.score).toBe(0);
        expect(s.finished).toBe(false);
      }),
    );
  });

  it("no slab holds a block of one ore bigger than the cap, at any stage of the round", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 8 }), (seed, skips) => {
        let s = createCuttingGame(seed);
        for (let i = 0; i < skips; i++) s = reduceCutting(s, { type: "done" });
        let largest = 0;
        for (let w = 1; w <= cfg.width; w++) {
          for (let h = 1; h <= cfg.height; h++) {
            for (let x = 0; x + w <= cfg.width; x++) for (let y = 0; y + h <= cfg.height; y++) if (cuttingPureOre(s, { x, y, w, h }) !== null) largest = Math.max(largest, w * h);
          }
        }
        expect(largest * 100).toBeLessThanOrEqual(cfg.maxBlockPercent * cfg.width * cfg.height);
      }),
      { numRuns: 40 },
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createCuttingGame("x", { ...cfg, ores: 1 })).toThrow();
    expect(() => createCuttingGame("x", { ...cfg, minCuts: 5, maxCuts: 4 })).toThrow();
    expect(() => createCuttingGame("x", { ...cfg, partsStart: 6, partsMax: 5 })).toThrow();
    expect(() => createCuttingGame("x", { ...cfg, streakPercent: [] })).toThrow();
    expect(() => createCuttingGame("x", { ...cfg, width: 9 })).toThrow();
    expect(() => createCuttingGame("x", { ...cfg, maxBlockPercent: 5 })).toThrow();
  });

  it("deals on small and large boards and with configs at their limits", () => {
    for (const extra of [{ width: 2, height: 2, partsStart: 2, partsMax: 2 }, { width: 8, height: 8, maxCuts: 12 }, { partsStart: 36, partsMax: 36, minCuts: 1, maxCuts: 1 }, { flawsStart: 0, flawsMax: 0, ores: 2 }] as const) {
      for (let i = 0; i < 10; i++) {
        const s = createCuttingGame(`limits-${i}`, { ...cfg, ...extra });
        expect(s.slabBest).toBeGreaterThan(0);
        expect(cuttingPureOre(s, s.pieces[0]!)).toBeNull();
      }
    }
  });
});

describe("cutting determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayCutting(seed, cfg, moves);
        expect(hashCuttingState(replayed)).toBe(hashCuttingState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different slabs", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashCuttingState(createCuttingGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { state } = playRandom(seed, picks.slice(0, 12));
        if (state.finished) return;
        const before = JSON.stringify(state);
        reduceCutting(state, randomMove(state, picks[12] ?? 1));
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceCutting(createCuttingGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect({ score: s.score, moves: s.moveCount, bestCombo: s.bestCombo }).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceCutting(s, { type: "end" })).toThrow(InvalidMoveError);
  });
});

describe("cutting rules", () => {
  it("keeps the table's invariants after every move", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createCuttingGame(seed);
        for (const p of picks) {
          const move = randomMove(state, p);
          const next = reduceCutting(state, move);
          const r = next.lastMove!;
          // The score is what the report says.
          expect(next.score).toBe(state.score + r.points);
          // Pieces on the table are mixed rectangles inside the slab that do not overlap each other or anything banked.
          const covered = new Array<number>(cfg.width * cfg.height).fill(0);
          for (const piece of next.pieces) {
            expect(piece.x >= 0 && piece.y >= 0 && piece.w >= 1 && piece.h >= 1 && piece.x + piece.w <= cfg.width && piece.y + piece.h <= cfg.height).toBe(true);
            expect(cuttingPureOre(next, piece)).toBeNull();
            for (let y = piece.y; y < piece.y + piece.h; y++) for (let x = piece.x; x < piece.x + piece.w; x++) covered[y * cfg.width + x]!++;
          }
          for (const b of next.banked) {
            expect(cuttingPureOre(next, b)).toBe(b.ore);
            expect(b.points).toBe(cfg.cellPoints * (b.w * b.h) ** 2);
            for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) covered[y * cfg.width + x]!++;
          }
          expect(covered.every((n) => n === 1)).toBe(true);
          expect(new Set([...next.pieces, ...next.banked].map((q) => q.id)).size).toBe(next.pieces.length + next.banked.length);
          expect(next.slabGot).toBe(next.banked.reduce((a, b) => a + b.points, 0));
          expect(next.cutsLeft).toBeGreaterThanOrEqual(0);
          if (r.slab) {
            // No sequence of cuts beats the table's best.
            expect(r.slab.got).toBeLessThanOrEqual(r.slab.best);
            expect(r.slab.grade).toBe(cuttingGrade(cfg, r.slab.got, r.slab.best));
            // A fresh slab is on the table.
            expect(next.slab).toBe(state.slab + 1);
            expect(next.pieces.length).toBe(1);
            expect(next.banked.length).toBe(0);
            expect(next.cutsLeft).toBe(next.cutsAllowed);
            expect(next.slabBest).toBeGreaterThan(0);
            expect(next.slabsDone).toBe(state.slabsDone + 1);
          } else {
            // A slab that goes on can still bank something.
            expect(next.slab).toBe(state.slab);
            expect(next.cutsLeft).toBe(state.cutsLeft - 1);
            expect(cuttingBestRemaining(next)).toBeGreaterThan(0);
          }
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });

  it("the best is exactly what the best order of cuts banks: every sequence tried on small slabs", () => {
    for (let i = 0; i < 12; i++) {
      const small = createCuttingGame(`brute-${i}`, { ...cfg, width: 4, height: 3, partsStart: 4, partsMax: 4, minCuts: 3, maxCuts: 3 });
      expect(bruteBest(small)).toBe(small.slabBest);
    }
    for (let i = 0; i < 4; i++) {
      const s = createCuttingGame(`brute-wide-${i}`, { ...cfg, width: 4, height: 4, partsStart: 5, partsMax: 5, minCuts: 3, maxCuts: 3 });
      expect(bruteBest(s)).toBe(s.slabBest);
    }
  });

  it("following the best cut banks the best, and the slab is flawless", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 6 }), (seed, skips) => {
        let s = createCuttingGame(seed);
        for (let i = 0; i < skips; i++) s = reduceCutting(s, { type: "done" });
        const n = s.slab;
        const want = s.slabBest;
        while (s.slab === n) {
          const b = cuttingBestCut(s);
          expect(b).not.toBeNull();
          expect(cuttingCutIllegalReason(s, b!.piece, b!.vertical, b!.at)).toBeNull();
          s = reduceCutting(s, { type: "cut", ...b! });
        }
        expect(s.lastMove!.slab).toMatchObject({ got: want, best: want, grade: "flawless" });
      }),
      { numRuns: 40 },
    );
  });

  it("a cut splits a piece, banks each pure side for its area squared and leaves the mixed side", () => {
    // Left two columns are ore 0; the right two are mixed.
    const s = slab(["0012", "0012", "0021"], 3);
    const preview = cuttingCutPreview(s, 1, true, 2)!;
    expect(preview.line).toEqual([2, 0, 2, 3]);
    expect(preview.halves[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 3, ore: 0, points: 36 });
    expect(preview.halves[1]).toMatchObject({ x: 2, y: 0, w: 2, h: 3, ore: null, points: 0 });
    expect(preview.points).toBe(36);
    const next = reduceCutting(s, { type: "cut", piece: 1, vertical: true, at: 2 });
    const r = next.lastMove!;
    expect(r.points).toBe(36);
    expect(r.cut!.halves[0]).toMatchObject({ ore: 0, points: 36 });
    expect(r.slab).toBeNull();
    expect(next.pieces).toEqual([{ id: 3, x: 2, y: 0, w: 2, h: 3 }]);
    expect(next.banked).toEqual([{ id: 2, x: 0, y: 0, w: 2, h: 3, ore: 0, points: 36 }]);
    expect(next.cutsLeft).toBe(2);
    expect(next.biggest).toBe(6);
    expect(cuttingPieceAt(next, 0, 0)).toBeNull();
    expect(cuttingPieceAt(next, 3, 2)?.id).toBe(3);
    // A cut that leaves both sides mixed banks nothing, and both stay on the table.
    const two = reduceCutting(next, { type: "cut", piece: 3, vertical: false, at: 2 });
    expect(two.lastMove!.cut!.halves.map((h) => h.points)).toEqual([0, 0]);
    expect(two.pieces.map((p) => p.id)).toEqual([4, 5]);
    // Then a cut down the two-by-two frees both of its columns at once.
    const three = reduceCutting(two, { type: "cut", piece: 4, vertical: true, at: 3 });
    expect(three.lastMove!.cut!.halves.map((h) => [h.ore, h.points])).toEqual([[1, 4], [2, 4]]);
  });

  it("refuses cuts on the edge, outside the piece, through a piece that is gone, or with no cuts left", () => {
    const s = slab(["0012", "0012", "0021"], 3);
    const bad = (move: CuttingMove): void => {
      expect(() => reduceCutting(s, move)).toThrow(InvalidMoveError);
    };
    bad({ type: "cut", piece: 1, vertical: true, at: 0 });
    bad({ type: "cut", piece: 1, vertical: true, at: 4 });
    bad({ type: "cut", piece: 1, vertical: false, at: 3 });
    bad({ type: "cut", piece: 9, vertical: true, at: 2 });
    bad({ type: "cut", piece: 1, vertical: true, at: 1.5 });
    bad({ type: "bogus" } as unknown as CuttingMove);
    expect(cuttingCutPreview(s, 1, true, 0)).toBeNull();
    const next = reduceCutting(s, { type: "cut", piece: 1, vertical: true, at: 2 });
    // Piece 1 was cut: it is no longer on the table, and the line must lie inside the piece named.
    expect(() => reduceCutting(next, { type: "cut", piece: 1, vertical: true, at: 3 })).toThrow(InvalidMoveError);
    expect(() => reduceCutting(next, { type: "cut", piece: 3, vertical: true, at: 2 })).toThrow(InvalidMoveError);
    expect(cuttingCutIllegalReason({ ...s, cutsLeft: 0 }, 1, true, 2)).toBe("no cuts left");
  });

  it("a slab ends when the table is bare, and all of its best is flawless", () => {
    const s = slab(["0011", "0011"], 3, { flawlessBonus: 100, cleanBonus: 40 });
    expect(s.slabBest).toBe(32);
    const next = reduceCutting(s, { type: "cut", piece: 1, vertical: true, at: 2 });
    const r = next.lastMove!;
    expect(r.slab).toMatchObject({ reason: "clear", got: 32, best: 32, grade: "flawless", bonus: 100, streak: 1, streakPercent: 100, scrap: [], cutsLeft: 2 });
    expect(r.points).toBe(132);
    expect(next.score).toBe(132);
    expect(next).toMatchObject({ slab: 1, slabsDone: 1, flawless: 1, combo: 1, totalGot: 32, totalBest: 32 });
  });

  it("a slab ends when the cuts are spent, what is left is scrap, and the grade follows the share of the best", () => {
    // One cut only: the best frees the 2x3 block of ore 0 (36); the row cut frees nothing.
    const s = slab(["0012", "0021", "0012"], 1, { minCuts: 1 });
    expect(s.slabBest).toBe(36);
    const rough = reduceCutting(s, { type: "cut", piece: 1, vertical: false, at: 1 });
    expect(rough.lastMove!.slab).toMatchObject({ reason: "cuts", got: 0, best: 36, grade: "rough", bonus: 0, streak: 0 });
    expect(rough.lastMove!.slab!.scrap.length).toBe(2);
    expect(rough.combo).toBe(0);
    expect(rough.rough).toBe(1);
    const flawless = reduceCutting(s, { type: "cut", piece: 1, vertical: true, at: 2 });
    expect(flawless.lastMove!.slab).toMatchObject({ reason: "cuts", got: 36, grade: "flawless" });
    expect(flawless.lastMove!.slab!.scrap).toEqual([{ id: 3, x: 2, y: 0, w: 2, h: 3 }]);
    // The grade's thresholds.
    expect(cuttingGrade(cfg, 100, 100)).toBe("flawless");
    expect(cuttingGrade(cfg, 80, 100)).toBe("clean");
    expect(cuttingGrade(cfg, 79, 100)).toBe("rough");
  });

  it("a slab ends at once when no cut that is left could bank anything", () => {
    // Two checkerboards side by side: after the cut between them, one cut frees nothing from either.
    const s = slab(["0101", "1010"], 2, { minCuts: 1 });
    const next = reduceCutting(s, { type: "cut", piece: 1, vertical: true, at: 2 });
    expect(next.lastMove!.slab).toMatchObject({ reason: "stuck", got: 0, cutsLeft: 1 });
    expect(next.slab).toBe(1);
  });

  it("clean and flawless slabs build a streak that multiplies the bonus; a rough one, or one given up, breaks it", () => {
    let s = createCuttingGame("streak");
    const flawlessSlab = (state: CuttingState): CuttingState => {
      let t = state;
      const n = t.slab;
      while (t.slab === n) t = reduceCutting(t, { type: "cut", ...cuttingBestCut(t)! });
      return t;
    };
    for (let i = 1; i <= 6; i++) {
      const before = s.score;
      const got = s.slabBest;
      s = flawlessSlab(s);
      const percent = cuttingStreakPercentAt(cfg, i);
      expect(s.combo).toBe(i);
      expect(s.lastMove!.slab).toMatchObject({ streak: i, streakPercent: percent, bonus: Math.floor((cfg.flawlessBonus * percent) / 100) });
      expect(s.score).toBe(before + got + Math.floor((cfg.flawlessBonus * percent) / 100));
    }
    expect(cuttingStreakPercentAt(cfg, 6)).toBe(cfg.streakPercent[cfg.streakPercent.length - 1]);
    expect(cuttingStreakPercentAt(cfg, 0)).toBe(100);
    const gaveUp = reduceCutting(s, { type: "done" });
    expect(gaveUp.lastMove).toMatchObject({ cut: null, points: 0, slab: { reason: "done", got: 0, grade: "rough", bonus: 0, streak: 0 } });
    expect(gaveUp.combo).toBe(0);
    expect(gaveUp.bestCombo).toBe(6);
    expect(gaveUp.moveCount).toBe(s.moveCount);
    expect(gaveUp.logLength).toBe(s.logLength + 1);
  });

  it("slabs grow as they are finished: more blocks, then more flaws, up to the caps", () => {
    expect(cuttingSlabShape(cfg, 0)).toEqual({ parts: cfg.partsStart, flaws: cfg.flawsStart });
    expect(cuttingSlabShape(cfg, cfg.growEvery)).toEqual({ parts: cfg.partsStart + 1, flaws: cfg.flawsStart });
    expect(cuttingSlabShape(cfg, cfg.growEvery * 2)).toEqual({ parts: cfg.partsStart + 2, flaws: cfg.flawsStart + 1 });
    expect(cuttingSlabShape(cfg, 1000)).toEqual({ parts: cfg.partsMax, flaws: cfg.flawsMax });
  });

  it("the budget of cuts is the fewest that reach the share of what an unlimited torch could bank", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createCuttingGame(seed);
        // One cut short of a cut for every cell is as good as no limit at all.
        const unlimited = cuttingSlabBest(cfg, s.ores, cfg.width * cfg.height - 1);
        const reaches = (cuts: number): boolean => cuttingSlabBest(cfg, s.ores, cuts) * 100 >= cfg.budgetPercent * unlimited;
        if (s.cutsAllowed > cfg.minCuts) expect(reaches(s.cutsAllowed - 1)).toBe(false);
        if (s.cutsAllowed < cfg.maxCuts) expect(reaches(s.cutsAllowed)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it("stops at the move cap", () => {
    let s = createCuttingGame("cap", { ...cfg, maxMoves: 3 });
    s = reduceCutting(s, { type: "done" });
    s = reduceCutting(s, { type: "done" });
    expect(s.finished).toBe(false);
    s = reduceCutting(s, { type: "done" });
    expect(s.finished).toBe(true);
  });

  it("the view string names every cell still on the table and every piece", () => {
    const s = slab(["0012", "0012", "0021"], 3);
    expect(cuttingViewString(s.ores, s.config.width, s.pieces)).toBe("001200120021;0.0.4.3");
    const next = reduceCutting(s, { type: "cut", piece: 1, vertical: true, at: 2 });
    expect(cuttingViewString(next.ores, next.config.width, next.pieces)).toBe("..12..12..21;2.0.2.3");
  });
});
