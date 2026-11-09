/**
 * Cooling: a 6 wide by 12 tall board of pieces. Swap two horizontally adjacent pieces; runs of 3
 * or more clear; the pieces below float up and new pieces enter from the bottom. Cascades chain.
 * Heat rises with the moves and drops as you clear.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 BOTTOM to top.
 * Pieces rise toward row height-1. Renderers flip for display.
 */

export const COOLING_WIDTH = 6;
export const COOLING_HEIGHT = 12;

/** Kinds below this value are ordinary matchable pieces, numbered 0..pieceKinds-1. */
export const SPECIAL_BASE = 100;

/**
 * Special pieces. Original names for the three special-piece roles every Cooling player knows.
 * - Spark Charge: swap it and it detonates, clearing the 3x3 area around where it lands.
 * - Magnet: swap it with an ordinary piece and every piece of that kind on the board clears.
 * - Slag: cannot be matched. It rides up with the board as pieces below it clear and comes
 *   off by itself, for a bonus, once it is at or above the heat line.
 */
export const Special = {
  Charge: SPECIAL_BASE + 0,
  Magnet: SPECIAL_BASE + 1,
  Slag: SPECIAL_BASE + 2,
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

export interface CoolingConfig {
  readonly width: number;
  readonly height: number;
  /** Number of ordinary piece kinds. Each must be distinguishable by shape and color (rule 6). */
  readonly pieceKinds: number;
  /** Chance per spawned piece, in parts per thousand, of each special. */
  readonly specialChancePerMille: {
    readonly charge: number;
    readonly magnet: number;
    readonly slag: number;
  };
  /** Rows overheated when the game starts. */
  readonly initialHeatRow: number;
  /** The heat never drains below this many rows; venting at the floor is wasted. */
  readonly minHeatRow: number;
  /** Heat rises one row every this many moves. */
  readonly heatRisePerMoves: number;
  /** Heat drops one row every this many points. */
  readonly heatDropPerPoints: number;
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
   * Aboard a ship the heat is the ship's heat, not the board's own: swaps neither raise nor
   * drain it, and `heat` moves, injected into the log from the ship's turns, set it (DESIGN.md
   * 3.3). On the practice page this is false and the board keeps its own heat.
   */
  readonly shipHeat: boolean;
}

export const DEFAULT_COOLING_CONFIG: CoolingConfig = {
  width: COOLING_WIDTH,
  height: COOLING_HEIGHT,
  pieceKinds: 7,
  specialChancePerMille: { charge: 12, magnet: 8, slag: 10 },
  initialHeatRow: 3,
  minHeatRow: 3,
  heatRisePerMoves: 6,
  heatDropPerPoints: 40,
  maxMoves: 10_000,
  shipHeat: false,
  cascadeMultipliers: [1, 2, 3],
  streakStepPercent: 10,
  streakMaxPercent: 150,
  streakGrace: 1,
};

export type CoolingMove =
  /** Swap the piece at (col,row) with the piece at (col+1,row). */
  | { readonly type: "swap"; readonly col: number; readonly row: number }
  /** The ship's heat is this many rows deep: a heat event from the ship's turn (shipHeat only). */
  | { readonly type: "heat"; readonly row: number }
  /** End the round early. */
  | { readonly type: "end" };

export interface ClearedGroup {
  /** Cells cleared, as indices into `cells`. */
  readonly cells: readonly number[];
  /** Ids of the pieces cleared, in the same order as `cells`, so renderers can animate them. */
  readonly ids: readonly number[];
  /** Points this group earned before multipliers. */
  readonly points: number;
  readonly cause: "match" | "charge" | "magnet" | "slag";
}

export interface ClearRound {
  /** 1 for the clear caused directly by the swap, 2+ for cascades. */
  readonly chain: number;
  readonly groups: readonly ClearedGroup[];
  /**
   * Points for this round after the group and cascade multipliers. Slag pieces coming off take the
   * group multiplier only: what they are worth is what was set up by lifting several together.
   */
  readonly points: number;
  /** The board once this round's gaps have risen and refilled. Renderers replay cascades from it. */
  readonly settled: ReadonlyArray<Piece>;
}

export interface MoveReport {
  readonly move: CoolingMove;
  readonly rounds: readonly ClearRound[];
  /** The move's points: its rounds' points times the streak multiplier, rounded down. */
  readonly points: number;
  /** The streak multiplier this move scored at, in percent; 100 for a move that scored nothing. */
  readonly streakPercent: number;
}

export interface CoolingState {
  readonly config: CoolingConfig;
  /** Row-major, index = row * width + col, row 0 at the bottom. Always full once settled. */
  readonly cells: ReadonlyArray<Piece>;
  readonly rng: import("../prng.js").PrngState;
  readonly nextId: number;
  readonly moveCount: number;
  readonly score: number;
  /**
   * Heat level in units of 1 / (heatRisePerMoves * heatDropPerPoints) row, so a move's rise
   * and a point's drain are both whole numbers. Clamped to [minHeatRow, height] rows after
   * every move, which is what makes venting at the floor wasted.
   */
  readonly heat: number;
  /** Number of rows overheated, minHeatRow..height. Derived from `heat`. */
  readonly heatRow: number;
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

