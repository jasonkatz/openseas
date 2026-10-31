/**
 * Sailing: conjoined pairs of colored segments fall into a board. Platforms sit in the board with
 * colored targets; fill every target of a platform with its color and the platform clears. Runs of
 * four or more of one color clear too. Cascades chain.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 BOTTOM to top. Pieces
 * enter in the top row. Renderers flip for display.
 */

import type { PrngState } from "../prng.js";

export const SAILING_WIDTH = 12;
export const SAILING_HEIGHT = 20;

export interface SailingConfig {
  readonly width: number;
  readonly height: number;
  /** Number of segment colors. Each must be distinguishable without color (rule 6). */
  readonly pieceKinds: number;
  /** Platforms on the board at once. */
  readonly platformsAtOnce: number;
  /** Shortest and longest horizontal bar; stacks, L shapes and squares are dealt alongside bars. */
  readonly platformSpanMin: number;
  readonly platformSpanMax: number;
  /** Points per target when a platform clears. */
  readonly platformPoints: number;
  /** Points per segment beyond three in a cleared run: a run of n scores runPoints * (n - 3). */
  readonly runPoints: number;
  /** The round ends after this many pairs. */
  readonly maxMoves: number;
  /** Points lost when the rigging fills to the top and is cleared. Score never drops below zero. */
  readonly topOutPenalty: number;
}

export const DEFAULT_SAILING_CONFIG: SailingConfig = {
  width: SAILING_WIDTH,
  height: SAILING_HEIGHT,
  pieceKinds: 3,
  platformsAtOnce: 6,
  platformSpanMin: 2,
  platformSpanMax: 4,
  platformPoints: 6,
  runPoints: 4,
  maxMoves: 120,
  topOutPenalty: 40,
};

export interface Segment {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  readonly kind: number;
  /** The pair this segment arrived in. Halves stay linked while both are on the board. */
  readonly pair: number;
}

export interface PlatformCell {
  readonly col: number;
  readonly row: number;
  /** The kind this cell wants, or null for a blank cell that holds anything. */
  readonly want: number | null;
}

/**
 * A platform is a connected shape of cells: a bar, a stack, an L or a square. A cell with no cell
 * of the same platform directly beneath it has a shelf under it, so discs rest in it; cells above
 * fill by falling in on top. Discs may slide into any platform cell from the side.
 */
export interface Platform {
  readonly id: number;
  readonly cells: readonly PlatformCell[];
}

/** The kinds of the two halves of a falling pair. */
export interface SailingPair {
  readonly a: number;
  readonly b: number;
}

/**
 * Rotation of a pair anchored at (col, top row):
 * 0: a at (col), b at (col+1), horizontal. 1: a below, b above, vertical, in column col.
 * 2: b at (col), a at (col+1). 3: b below, a above.
 */
export type Rotation = 0 | 1 | 2 | 3;

export type SailingMove =
  /**
   * Rest the current pair with its anchor at (col, row) in rotation `rot`. The engine accepts any
   * resting position reachable from the spawn by sliding, turning and falling, so a pair can be
   * steered under a platform; it rejects positions that float or could not be reached.
   */
  | { readonly type: "place"; readonly col: number; readonly row: number; readonly rot: Rotation }
  | { readonly type: "end" };

export interface SailingClearedGroup {
  readonly cells: readonly number[];
  readonly ids: readonly number[];
  readonly points: number;
  readonly cause: "run" | "platform";
  /** Set when a platform cleared. */
  readonly platformId?: number;
}

export interface SailingClearRound {
  readonly chain: number;
  readonly groups: readonly SailingClearedGroup[];
  readonly points: number;
  /** Board and platforms once this round's removals have settled and new platforms spawned. */
  readonly settled: ReadonlyArray<Segment | null>;
  readonly platforms: readonly Platform[];
}

export interface SailingMoveReport {
  readonly move: SailingMove;
  /** Where the two halves came to rest, as cell indices and ids, for the drop animation. */
  readonly landed: { readonly cells: readonly [number, number]; readonly ids: readonly [number, number] } | null;
  readonly rounds: readonly SailingClearRound[];
  readonly points: number;
  /**
   * Set when, after this placement, no pair could enter the top row: the rigging was cleared,
   * `penalty` points were lost and new platforms dealt. `ids` are the segments swept away.
   */
  readonly wipe: { readonly ids: readonly number[]; readonly penalty: number; readonly platforms: readonly Platform[] } | null;
}

export interface SailingState {
  readonly config: SailingConfig;
  /** Row-major, index = row * width + col, row 0 at the bottom. Null is empty. */
  readonly cells: ReadonlyArray<Segment | null>;
  readonly platforms: readonly Platform[];
  readonly current: SailingPair;
  readonly next: SailingPair;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly nextPair: number;
  readonly nextPlatformId: number;
  readonly moveCount: number;
  readonly score: number;
  /** Consecutive placements that cleared something. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly lastMove: SailingMoveReport | null;
  readonly finished: boolean;
}
