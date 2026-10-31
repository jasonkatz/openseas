/**
 * Carpentry: five-cell planks offered from a queue of three, laid over holes in the hull
 * planking. A hole is patched when every cell of it is covered. Tighter fills with fewer planks
 * score higher; planks hanging over sound hull or over each other are waste.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 TOP to bottom (no
 * gravity here, so the natural reading order is kept). Index = row * width + col.
 */

import type { PrngState } from "../prng.js";

export const CARPENTRY_WIDTH = 9;
export const CARPENTRY_HEIGHT = 12;

export type Grain = "h" | "v";

export type HoleRating = "masterpiece" | "craftsmanship" | "fair" | "sloppy" | "pig";

export interface CarpentryConfig {
  readonly width: number;
  readonly height: number;
  /** Cosmetic wood kinds offered planks come in. Each must be distinguishable without color. */
  readonly pieceKinds: number;
  /** Holes on the board at once. */
  readonly holesAtOnce: number;
  /** New holes are made of this many planks' worth of cells (times five). */
  readonly minHolePieces: number;
  readonly maxHolePieces: number;
  /** Points per hole cell before multipliers. */
  readonly basePerCell: number;
  /** Percent multiplier per rating. */
  readonly multiplierPercent: Readonly<Record<HoleRating, number>>;
  /** Added when every plank in a patched hole runs with horizontal grain. */
  readonly grainBonusPercent: number;
  /** A hole left alone for this many placements elsewhere grows by one cell. */
  readonly growAfterMoves: number;
  /** The round ends after this many planks. */
  readonly maxMoves: number;
}

export const DEFAULT_CARPENTRY_CONFIG: CarpentryConfig = {
  width: CARPENTRY_WIDTH,
  height: CARPENTRY_HEIGHT,
  pieceKinds: 4,
  holesAtOnce: 3,
  minHolePieces: 1,
  maxHolePieces: 3,
  basePerCell: 4,
  multiplierPercent: { masterpiece: 300, craftsmanship: 200, fair: 150, sloppy: 100, pig: 50 },
  grainBonusPercent: 25,
  growAfterMoves: 6,
  maxMoves: 60,
};

/** A plank waiting in one of the three slots. `shape` indexes PENTOMINOES; `kind` is its wood. */
export interface OfferedPiece {
  readonly shape: number;
  readonly grain: Grain;
  readonly kind: number;
}

export interface Hole {
  readonly id: number;
  /** Sorted cell indices. */
  readonly cells: readonly number[];
  /** Planks laid on this hole so far. */
  readonly pieces: number;
  /** Covered cells outside the hole plus cells covered more than once. */
  readonly waste: number;
  /** Placements elsewhere since this hole was last worked on. */
  readonly idleMoves: number;
  /** True once the hole has grown; it can no longer be a masterpiece. */
  readonly grown: boolean;
  /** False once any plank with vertical grain lies on it. */
  readonly allHorizontal: boolean;
}

export interface Plank {
  readonly id: number;
  readonly shape: number;
  readonly kind: number;
  readonly grain: Grain;
  readonly cells: readonly number[];
  readonly holeId: number;
}

export type CarpentryMove =
  /** Lay the plank in `slot`, rotated `rot` quarter turns and flipped or not, with its bounding box origin at (col,row). */
  | { readonly type: "place"; readonly slot: number; readonly rot: number; readonly flip: boolean; readonly col: number; readonly row: number }
  | { readonly type: "end" };

export interface PatchedHole {
  readonly holeId: number;
  readonly cells: readonly number[];
  readonly rating: HoleRating;
  readonly extra: number;
  readonly waste: number;
  readonly grainBonus: boolean;
  /** Masterpiece streak this patch counted at (1 for a non-masterpiece). */
  readonly chain: number;
  readonly points: number;
}

export interface CarpentryMoveReport {
  readonly move: CarpentryMove;
  readonly placed: { readonly plank: Plank; readonly wasteCells: readonly number[] } | null;
  readonly patched: PatchedHole | null;
  /** Holes dealt after this move (a replacement, or any that could not spawn earlier). */
  readonly spawned: readonly Hole[];
  readonly grown: { readonly holeId: number; readonly cell: number } | null;
  readonly points: number;
}

export interface CarpentryState {
  readonly config: CarpentryConfig;
  readonly holes: readonly Hole[];
  readonly planks: readonly Plank[];
  /** How many planks cover each cell. Hull cells may be covered at most once. */
  readonly covered: readonly number[];
  readonly slots: readonly OfferedPiece[];
  readonly rng: PrngState;
  readonly nextId: number;
  readonly moveCount: number;
  readonly score: number;
  /** Consecutive masterpieces. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly patchedCount: number;
  readonly lastMove: CarpentryMoveReport | null;
  readonly finished: boolean;
}
