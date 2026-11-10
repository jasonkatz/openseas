/**
 * Cutting (prototype, ADR 0036): a slab of salvage made of blocks of ore, with a few flaws in them,
 * cut up with a torch. A cut runs along a grid line the whole way across the piece it is made in
 * and splits that piece in two, so every piece is a rectangle. A piece that holds one ore only is
 * pure: it banks at once for its area squared and leaves the table. Cuts are limited, so the art is
 * freeing the big blocks whole and choosing what to give up. When the cuts are spent, or nothing
 * more can be banked, the slab is graded against the best any plan could have made of it and the
 * next slab is dealt.
 *
 * Cell index = y * width + x. Row 0 is the top row. A vertical cut `at` runs down the grid line
 * between columns at - 1 and at; a horizontal one runs between rows at - 1 and at. Nothing here
 * reads a clock: the round's length is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

export interface CuttingConfig {
  readonly width: number;
  readonly height: number;
  /** Kinds of ore: 0 to ores - 1. */
  readonly ores: number;
  /** Blocks the first slab is dealt from; one more every `growEvery` slabs, up to `partsMax`. */
  readonly partsStart: number;
  readonly partsMax: number;
  /** Flaws scattered on the first slab; one more every two steps of growth, up to `flawsMax`. */
  readonly flawsStart: number;
  readonly flawsMax: number;
  /** Slabs finished between one step of growth and the next. */
  readonly growEvery: number;
  /**
   * The largest block of one ore a slab may hold, as a share of the slab in percent. A slab with a
   * bigger one is dealt again: one huge block is one obvious cut and a windfall.
   */
  readonly maxBlockPercent: number;
  /**
   * How tight the budget of cuts is. A slab is given the fewest cuts with which the best plan banks
   * at least this share, in percent, of what a torch with no limit could bank; kept within
   * `minCuts` and `maxCuts`.
   */
  readonly budgetPercent: number;
  readonly minCuts: number;
  readonly maxCuts: number;
  /** A pure piece of area a banks for cellPoints * a * a. */
  readonly cellPoints: number;
  /** A slab that banked at least this share of its best, in percent, is clean. All of it is flawless. */
  readonly cleanPercent: number;
  /** The bonus for a clean slab and for a flawless one, before the streak. */
  readonly cleanBonus: number;
  readonly flawlessBonus: number;
  /** What the streak of clean and flawless slabs multiplies the bonus by, in percent: the first takes the first entry, a streak past the end takes the last. */
  readonly streakPercent: readonly number[];
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_CUTTING_CONFIG: CuttingConfig = {
  width: 6,
  height: 6,
  ores: 4,
  partsStart: 5,
  partsMax: 7,
  flawsStart: 1,
  flawsMax: 2,
  growEvery: 2,
  maxBlockPercent: 45,
  budgetPercent: 85,
  minCuts: 3,
  maxCuts: 6,
  cellPoints: 1,
  cleanPercent: 80,
  cleanBonus: 40,
  flawlessBonus: 100,
  streakPercent: [100, 125, 150, 175, 200],
  maxMoves: 600,
};

/** A rectangle of the slab: its top-left cell and its size in cells. */
export interface CuttingRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A piece on the table. Its id is stable for animation and never reused within a game. */
export interface CuttingPiece extends CuttingRect {
  readonly id: number;
}

/** A piece that was pure and banked: where it was, what it was and what it paid. */
export interface CuttingBanked extends CuttingPiece {
  readonly ore: number;
  readonly points: number;
}

export type CuttingMove =
  /** Cut `piece` along the grid line `at`: a column line when `vertical`, a row line otherwise. */
  | { readonly type: "cut"; readonly piece: number; readonly vertical: boolean; readonly at: number }
  /** Give the slab up as it stands and take the next one. */
  | { readonly type: "done" }
  | { readonly type: "end" };

export type CuttingGrade = "flawless" | "clean" | "rough";

/** One side of a cut: the new piece, and what it banked when it is pure. */
export interface CuttingHalf {
  readonly piece: CuttingPiece;
  /** The ore the piece is all of, or null when it is mixed and stays on the table. */
  readonly ore: number | null;
  /** What it banked: 0 for a mixed piece. */
  readonly points: number;
}

/** What a cut would do, before it is made: the engine's own sum, so the board can show it while the cut is lined up. */
export interface CuttingPreview {
  /** The line as two grid points (x0, y0) to (x1, y1), in cells from the slab's top-left corner. */
  readonly line: readonly [number, number, number, number];
  readonly halves: readonly [CuttingPreviewHalf, CuttingPreviewHalf];
  /** What the cut would bank at once. */
  readonly points: number;
}

export interface CuttingPreviewHalf extends CuttingRect {
  readonly ore: number | null;
  readonly points: number;
}

/** How a slab ended. */
export interface CuttingSlabReport {
  /** `clear`: nothing left on the table. `cuts`: the cuts are spent. `stuck`: no cut left could bank anything. `done`: the player gave it up. */
  readonly reason: "clear" | "cuts" | "stuck" | "done";
  /** What was banked from the slab, and the best any plan could have banked with its cuts. */
  readonly got: number;
  readonly best: number;
  readonly grade: CuttingGrade;
  /** The grade's bonus after the streak. */
  readonly bonus: number;
  /** The streak this slab was graded at (0 for a rough one), and what it multiplied the bonus by, in percent. */
  readonly streak: number;
  readonly streakPercent: number;
  /** Mixed pieces still on the table: scrap. */
  readonly scrap: readonly CuttingPiece[];
  /** Cuts that went unused. */
  readonly cutsLeft: number;
}

export interface CuttingMoveReport {
  readonly move: CuttingMove;
  /** The cut made, or null for a slab given up. */
  readonly cut: {
    /** The piece as it was before the cut. */
    readonly piece: CuttingPiece;
    readonly vertical: boolean;
    readonly at: number;
    /** Left then right for a vertical cut, top then bottom for a horizontal one. */
    readonly halves: readonly [CuttingHalf, CuttingHalf];
  } | null;
  /** Set when this move ended the slab. The state then holds the next one. */
  readonly slab: CuttingSlabReport | null;
  /** Everything the move scored: what the cut banked and the slab's bonus. */
  readonly points: number;
}

export interface CuttingState {
  readonly config: CuttingConfig;
  /** The ore in every cell of the slab on the table. */
  readonly ores: readonly number[];
  /** Mixed pieces still on the table, in the order they were made. */
  readonly pieces: readonly CuttingPiece[];
  /** Pieces banked from this slab, in the order they were banked. */
  readonly banked: readonly CuttingBanked[];
  /** Counts up from 0: which slab this is. */
  readonly slab: number;
  readonly cutsAllowed: number;
  readonly cutsLeft: number;
  /** Banked from this slab so far, and the best any plan could bank from it with its cuts. */
  readonly slabGot: number;
  readonly slabBest: number;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly score: number;
  /** Cuts made. */
  readonly moveCount: number;
  /** Every move in the log, slabs given up included. */
  readonly logLength: number;
  /** Clean and flawless slabs in a row. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly slabsDone: number;
  readonly flawless: number;
  readonly clean: number;
  readonly rough: number;
  /** Banked from finished slabs, and the sum of their bests: the round's yield is one over the other. */
  readonly totalGot: number;
  readonly totalBest: number;
  /** The largest piece banked, in cells. */
  readonly biggest: number;
  readonly lastMove: CuttingMoveReport | null;
  readonly finished: boolean;
}
