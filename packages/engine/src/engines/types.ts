/**
 * Engines: conjoined pairs of colored segments fall into a board. Injectors sit in the board with
 * colored targets; fill every target of an injector with its color and the injector clears. Runs of
 * four or more of one color clear too. Cascades chain.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 BOTTOM to top. Pieces
 * enter in the top row. Renderers flip for display.
 */

import type { PrngState } from "../prng.js";

export const ENGINES_WIDTH = 12;
export const ENGINES_HEIGHT = 20;

export interface EnginesConfig {
  readonly width: number;
  readonly height: number;
  /** Number of segment colors. Each must be distinguishable without color (rule 6). */
  readonly pieceKinds: number;
  /** Injectors on the board at once. */
  readonly injectorsAtOnce: number;
  /** Shortest and longest horizontal bar; stacks, L shapes and squares are dealt alongside bars. */
  readonly injectorSpanMin: number;
  readonly injectorSpanMax: number;
  /** Points per target when an injector clears. */
  readonly injectorPoints: number;
  /** Points per segment beyond three in a cleared run: a run of n scores runPoints * (n - 3). */
  readonly runPoints: number;
  /** A bound on pairs that only keeps the move log a sane size: the clock ends a round. A lab can set it low. */
  readonly maxMoves: number;
  /** Points lost when the core fills to the top and is cleared. Score never drops below zero. */
  readonly flameoutPenalty: number;
  /**
   * What each step of a chain multiplies by: the landing's own clear is step 1, and steps past the
   * end take the last entry, the cap. Steep, because a chain through the core is the skill in Engines.
   */
  readonly chainMultipliers: readonly number[];
}

export const DEFAULT_ENGINES_CONFIG: EnginesConfig = {
  width: ENGINES_WIDTH,
  height: ENGINES_HEIGHT,
  pieceKinds: 3,
  injectorsAtOnce: 6,
  injectorSpanMin: 2,
  injectorSpanMax: 4,
  injectorPoints: 6,
  runPoints: 4,
  maxMoves: 10_000,
  flameoutPenalty: 40,
  chainMultipliers: [1, 3, 6, 10],
};

export interface Segment {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  readonly kind: number;
  /** The pair this segment arrived in. Halves stay linked while both are on the board. */
  readonly pair: number;
}

export interface InjectorCell {
  readonly col: number;
  readonly row: number;
  /** The kind this cell wants, or null for a blank cell that holds anything. */
  readonly want: number | null;
}

/**
 * An injector is a connected shape of cells: a bar, a stack, an L or a square. A cell with no cell
 * of the same injector directly beneath it has a shelf under it, so pellets rest in it; cells above
 * fill by falling in on top. Pellets may slide into any injector cell from the side.
 */
export interface Injector {
  readonly id: number;
  readonly cells: readonly InjectorCell[];
}

/** The kinds of the two halves of a falling pair. */
export interface EnginesPair {
  readonly a: number;
  readonly b: number;
}

/**
 * Rotation of a pair anchored at (col, top row):
 * 0: a at (col), b at (col+1), horizontal. 1: a below, b above, vertical, in column col.
 * 2: b at (col), a at (col+1). 3: b below, a above.
 */
export type Rotation = 0 | 1 | 2 | 3;

export type EnginesMove =
  /**
   * Rest the current pair with its anchor at (col, row) in rotation `rot`. The engine accepts any
   * resting position reachable from the spawn by sliding, turning and falling, so a pair can be
   * steered under an injector; it rejects positions that float or could not be reached.
   */
  | { readonly type: "place"; readonly col: number; readonly row: number; readonly rot: Rotation }
  | { readonly type: "end" };

export interface EnginesClearedGroup {
  readonly cells: readonly number[];
  readonly ids: readonly number[];
  /** The group's base points, before the round's group count and chain multiplier. */
  readonly points: number;
  /** What the group added to the score: its base points times the round's group count and chain multiplier. */
  readonly scored: number;
  readonly cause: "run" | "injector";
  /** Set when an injector cleared. */
  readonly injectorId?: number;
}

export interface EnginesClearRound {
  readonly chain: number;
  readonly groups: readonly EnginesClearedGroup[];
  readonly points: number;
  /** Board and injectors once this round's removals have settled and new injectors spawned. */
  readonly settled: ReadonlyArray<Segment | null>;
  readonly injectors: readonly Injector[];
}

export interface EnginesMoveReport {
  readonly move: EnginesMove;
  /** Where the two halves came to rest, as cell indices and ids, for the drop animation. */
  readonly landed: { readonly cells: readonly [number, number]; readonly ids: readonly [number, number] } | null;
  readonly rounds: readonly EnginesClearRound[];
  readonly points: number;
  /**
   * Set when, after this placement, no pair could enter the top row: the core was cleared,
   * `penalty` points were lost and new injectors dealt. `ids` are the segments swept away.
   */
  readonly wipe: { readonly ids: readonly number[]; readonly penalty: number; readonly injectors: readonly Injector[] } | null;
}

export interface EnginesState {
  readonly config: EnginesConfig;
  /** Row-major, index = row * width + col, row 0 at the bottom. Null is empty. */
  readonly cells: ReadonlyArray<Segment | null>;
  readonly injectors: readonly Injector[];
  readonly current: EnginesPair;
  readonly next: EnginesPair;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly nextPair: number;
  readonly nextInjectorId: number;
  readonly moveCount: number;
  readonly score: number;
  /** Consecutive placements that cleared something. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly lastMove: EnginesMoveReport | null;
  readonly finished: boolean;
}
