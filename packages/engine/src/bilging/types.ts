/**
 * Bilging: a 6 wide by 12 tall board of pieces. Swap two horizontally adjacent pieces; runs of 3
 * or more clear; the pieces below float up and new pieces enter from the bottom. Cascades chain.
 * Water rises as the bilge fills and drops as you clear.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 BOTTOM to top.
 * Pieces rise toward row height-1. Renderers flip for display.
 */

export const BILGING_WIDTH = 6;
export const BILGING_HEIGHT = 12;

/** Kinds below this value are ordinary matchable pieces, numbered 0..pieceKinds-1. */
export const SPECIAL_BASE = 100;

/**
 * Special pieces. Original names for the three special-piece roles every Bilging player knows.
 * - Powder Keg: swap it and it detonates, clearing the 3x3 area around where it lands.
 * - Ink Cloud: swap it with an ordinary piece and every piece of that kind on the board clears.
 * - Barnacle: cannot be matched. It rides up with the board as pieces below it clear and comes
 *   off by itself, for a bonus, once it is at or above the water line.
 */
export const Special = {
  Keg: SPECIAL_BASE + 0,
  Ink: SPECIAL_BASE + 1,
  Barnacle: SPECIAL_BASE + 2,
} as const;

export type SpecialKind = (typeof Special)[keyof typeof Special];

export function isSpecial(kind: number): kind is SpecialKind {
  return kind >= SPECIAL_BASE;
}

export interface Piece {
  /** Stable identity so renderers can animate a piece as it falls. Never reused within a game. */
  readonly id: number;
  readonly kind: number;
}

export interface BilgingConfig {
  readonly width: number;
  readonly height: number;
  /** Number of ordinary piece kinds. Each must be distinguishable by shape and color (rule 6). */
  readonly pieceKinds: number;
  /** Chance per spawned piece, in parts per thousand, of each special. */
  readonly specialChancePerMille: {
    readonly keg: number;
    readonly ink: number;
    readonly barnacle: number;
  };
  /** Rows under water when the game starts. */
  readonly initialWaterRow: number;
  /** The bilge never drains below this many rows; pumping at the floor is wasted. */
  readonly minWaterRow: number;
  /** Water rises one row every this many moves. */
  readonly waterRisePerMoves: number;
  /** Water drops one row every this many points. */
  readonly waterDropPerPoints: number;
  /**
   * A bound on swaps that only keeps the move log a sane size: the clock ends a round, and the
   * score is points per round on it (DESIGN.md 3.3). A lab can set it low to end a round early.
   */
  readonly maxMoves: number;
  /**
   * What each step of a cascade multiplies by: the swap's own clear is step 1, and steps past the
   * end of the list take its last entry, so the list's end is the cap. Clearing several groups in
   * one step multiplies by their count on top, uncapped: that is the skill (a planned double).
   */
  readonly cascadeMultipliers: readonly number[];
  /** Each scoring move in a row adds this many percent to the move's points, from the second on. */
  readonly streakStepPercent: number;
  /** The streak multiplier never passes this, in percent. */
  readonly streakMaxPercent: number;
  /** Non-scoring swaps in a row the streak survives (setups); one more breaks it. */
  readonly streakGrace: number;
  /**
   * Aboard a ship the water is the ship's bilge, not the board's own: swaps neither raise nor
   * drain it, and `water` moves, injected into the log from the ship's turns, set it (DESIGN.md
   * 3.3). On the practice page this is false and the board keeps its own water.
   */
  readonly shipWater: boolean;
}

export const DEFAULT_BILGING_CONFIG: BilgingConfig = {
  width: BILGING_WIDTH,
  height: BILGING_HEIGHT,
  pieceKinds: 7,
  specialChancePerMille: { keg: 12, ink: 8, barnacle: 10 },
  initialWaterRow: 3,
  minWaterRow: 3,
  waterRisePerMoves: 6,
  waterDropPerPoints: 40,
  maxMoves: 10_000,
  shipWater: false,
  cascadeMultipliers: [1, 2, 3],
  streakStepPercent: 10,
  streakMaxPercent: 150,
  streakGrace: 1,
};

export type BilgingMove =
  /** Swap the piece at (col,row) with the piece at (col+1,row). */
  | { readonly type: "swap"; readonly col: number; readonly row: number }
  /** The ship's bilge is this many rows deep: a water event from the ship's turn (shipWater only). */
  | { readonly type: "water"; readonly row: number }
  /** End the round early. */
  | { readonly type: "end" };

export interface ClearedGroup {
  /** Cells cleared, as indices into `cells`. */
  readonly cells: readonly number[];
  /** Ids of the pieces cleared, in the same order as `cells`, so renderers can animate them. */
  readonly ids: readonly number[];
  /** Points this group earned before multipliers. */
  readonly points: number;
  readonly cause: "match" | "keg" | "ink" | "barnacle";
}

export interface ClearRound {
  /** 1 for the clear caused directly by the swap, 2+ for cascades. */
  readonly chain: number;
  readonly groups: readonly ClearedGroup[];
  /**
   * Points for this round after the group and cascade multipliers. Barnacles coming off take the
   * group multiplier only: what they are worth is what was set up by lifting several together.
   */
  readonly points: number;
  /** The board once this round's gaps have risen and refilled. Renderers replay cascades from it. */
  readonly settled: ReadonlyArray<Piece>;
}

export interface MoveReport {
  readonly move: BilgingMove;
  readonly rounds: readonly ClearRound[];
  /** The move's points: its rounds' points times the streak multiplier, rounded down. */
  readonly points: number;
  /** The streak multiplier this move scored at, in percent; 100 for a move that scored nothing. */
  readonly streakPercent: number;
}

export interface BilgingState {
  readonly config: BilgingConfig;
  /** Row-major, index = row * width + col, row 0 at the bottom. Always full once settled. */
  readonly cells: ReadonlyArray<Piece>;
  readonly rng: import("../prng.js").PrngState;
  readonly nextId: number;
  readonly moveCount: number;
  readonly score: number;
  /**
   * Water level in units of 1 / (waterRisePerMoves * waterDropPerPoints) row, so a move's rise
   * and a point's drain are both whole numbers. Clamped to [minWaterRow, height] rows after
   * every move, which is what makes pumping at the floor wasted.
   */
  readonly water: number;
  /** Number of rows under water, minWaterRow..height. Derived from `water`. */
  readonly waterRow: number;
  /**
   * Scoring moves in the current streak. Drives the combo meter and the streak multiplier. One
   * non-scoring swap (a setup) leaves it alone; more than `streakGrace` in a row break it.
   */
  readonly combo: number;
  /** Non-scoring swaps since the last scoring one. */
  readonly misses: number;
  readonly bestCombo: number;
  readonly lastMove: MoveReport | null;
  readonly finished: boolean;
}

