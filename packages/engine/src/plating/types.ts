/**
 * Plating: five-cell plates offered from a queue of three, laid over breaches in the hull
 * plating. A breach is sealed when every cell of it is covered. Tighter fills with fewer plates
 * score higher; plates hanging over sound hull or over each other are waste.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 TOP to bottom (no
 * gravity here, so the natural reading order is kept). Index = row * width + col.
 */

import type { PrngState } from "../prng.js";

export const PLATING_WIDTH = 9;
export const PLATING_HEIGHT = 12;

export type Brush = "h" | "v";

export type BreachRating = "flawless" | "solid" | "holds" | "tape" | "gum";

export interface PlatingConfig {
  readonly width: number;
  readonly height: number;
  /** Cosmetic metal kinds offered plates come in. Each must be distinguishable without color. */
  readonly pieceKinds: number;
  /** Breaches on the board at once. */
  readonly breachesAtOnce: number;
  /** New breaches are made of this many plates' worth of cells (times five). */
  readonly minBreachPieces: number;
  readonly maxBreachPieces: number;
  /** Points per breach cell before multipliers. */
  readonly basePerCell: number;
  /** Percent multiplier per rating. */
  readonly multiplierPercent: Readonly<Record<BreachRating, number>>;
  /** Added when every plate in a sealed breach runs with horizontal brush. */
  readonly brushBonusPercent: number;
  /** A breach left alone for this many placements elsewhere grows by one cell. */
  readonly growAfterMoves: number;
  /** A bound on plates that only keeps the move log a sane size: the clock ends a round. A lab can set it low. */
  readonly maxMoves: number;
  /**
   * What a flawless multiplies by, in percent, by its place in the streak: the first takes the
   * first entry, and a streak past the end of the list takes the last, the cap. A lesser patch
   * resets the streak.
   */
  readonly streakPercent: readonly number[];
}

export const DEFAULT_PLATING_CONFIG: PlatingConfig = {
  width: PLATING_WIDTH,
  height: PLATING_HEIGHT,
  pieceKinds: 4,
  breachesAtOnce: 3,
  minBreachPieces: 1,
  maxBreachPieces: 3,
  basePerCell: 4,
  multiplierPercent: { flawless: 300, solid: 200, holds: 150, tape: 100, gum: 50 },
  brushBonusPercent: 25,
  growAfterMoves: 6,
  maxMoves: 10_000,
  streakPercent: [100, 125, 150, 175, 200],
};

/** A plate waiting in one of the three slots. `shape` indexes PENTOMINOES; `kind` is its metal. */
export interface OfferedPiece {
  readonly shape: number;
  readonly brush: Brush;
  readonly kind: number;
}

export interface Breach {
  readonly id: number;
  /** Sorted cell indices. */
  readonly cells: readonly number[];
  /** Plates laid on this breach so far. */
  readonly pieces: number;
  /** Covered cells outside the breach plus cells covered more than once. */
  readonly waste: number;
  /** Placements elsewhere since this breach was last worked on. */
  readonly idleMoves: number;
  /** True once the breach has grown; it can no longer be a flawless. */
  readonly grown: boolean;
  /** False once any plate with vertical brush lies on it. */
  readonly allHorizontal: boolean;
}

export interface Plate {
  readonly id: number;
  readonly shape: number;
  readonly kind: number;
  readonly brush: Brush;
  readonly cells: readonly number[];
  readonly breachId: number;
}

export type PlatingMove =
  /** Lay the plate in `slot`, rotated `rot` quarter turns and flipped or not, with its bounding box origin at (col,row). */
  | { readonly type: "place"; readonly slot: number; readonly rot: number; readonly flip: boolean; readonly col: number; readonly row: number }
  | { readonly type: "end" };

export interface SealedBreach {
  readonly breachId: number;
  readonly cells: readonly number[];
  readonly rating: BreachRating;
  readonly extra: number;
  readonly waste: number;
  readonly brushBonus: boolean;
  /** Flawless boards in a row this patch made, itself included (1 for a non-flawless). */
  readonly chain: number;
  /** What the streak multiplied this patch by, in percent (100 for a non-flawless). */
  readonly streakPercent: number;
  readonly points: number;
}

export interface PlatingMoveReport {
  readonly move: PlatingMove;
  readonly placed: { readonly plate: Plate; readonly wasteCells: readonly number[] } | null;
  readonly sealed: SealedBreach | null;
  /** Breaches dealt after this move (a replacement, or any that could not spawn earlier). */
  readonly spawned: readonly Breach[];
  readonly grown: { readonly breachId: number; readonly cell: number } | null;
  readonly points: number;
}

export interface PlatingState {
  readonly config: PlatingConfig;
  readonly breaches: readonly Breach[];
  readonly plates: readonly Plate[];
  /** How many plates cover each cell. Hull cells may be covered at most once. */
  readonly covered: readonly number[];
  readonly slots: readonly OfferedPiece[];
  readonly rng: PrngState;
  readonly nextId: number;
  readonly moveCount: number;
  readonly score: number;
  /** Consecutive flawless boards. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly sealedCount: number;
  readonly lastMove: PlatingMoveReport | null;
  readonly finished: boolean;
}
