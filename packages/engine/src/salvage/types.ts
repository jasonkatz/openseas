/**
 * Salvage (prototype, ADR 0036): a field of drifting debris, hauled in by tether. The player draws
 * a line through touching pieces of one kind (touching includes diagonals) and hauls every piece on
 * it; a line of n scores n squared. Closing the line back onto its first piece makes it a net: every
 * loot crate on the field comes in with it, worth far more together than apart, and so does any
 * debris inside the loop. That is the only way to haul a crate for its full worth: left alone, a
 * crate sinks as the debris under it is hauled and is taken for a little when it reaches the floor.
 * Hauled pieces leave gaps; the pieces above fall and new debris drifts in at the top.
 *
 * Cell index = row * width + col. Row 0 is the top row, where debris enters; the floor is the last
 * row. Nothing here reads a clock: the round's length is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

/** A loot crate: never part of a line. Hauled inside a loop, or off the floor. */
export const SALVAGE_CRATE = 100;
/** A coupler: part of any line, and the line may change kind across it. */
export const SALVAGE_COUPLER = 101;

export interface SalvageConfig {
  readonly width: number;
  readonly height: number;
  /** Kinds of debris: 0 to kinds - 1. */
  readonly kinds: number;
  /** The shortest line that can be hauled. */
  readonly minLine: number;
  /** A line of n pieces scores linePoints * n * n. */
  readonly linePoints: number;
  /** The fewest pieces a line needs before it may close into a loop. */
  readonly loopMin: number;
  /** What closing a loop multiplies the line's own points by, in percent. */
  readonly loopPercent: number;
  /** Each piece of debris hauled from inside a loop. */
  readonly enclosedPoints: number;
  /** Crates on the opening field. */
  readonly startCrates: number;
  /** Chance, per thousand, that a piece drifting in is a crate, while fewer than maxCrates are on the field. */
  readonly cratePermille: number;
  readonly maxCrates: number;
  /** A crate that sinks to the floor is hauled for this. */
  readonly crateFloorPoints: number;
  /** A loop nets every crate on the field: k crates score crateLoopPoints * k * k between them. */
  readonly crateLoopPoints: number;
  /** Chance, per thousand, that a piece drifting in is a coupler, while fewer than maxCouplers are on the field. */
  readonly couplerPermille: number;
  readonly maxCouplers: number;
  /** A line this long or longer builds the streak; a shorter one spends the streak's one grace, then breaks it. */
  readonly streakMin: number;
  /** What the streak multiplies a haul by, in percent: the first long line takes the first entry, a streak past the end takes the last. */
  readonly streakPercent: readonly number[];
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_SALVAGE_CONFIG: SalvageConfig = {
  width: 7,
  height: 8,
  kinds: 5,
  minLine: 3,
  linePoints: 1,
  loopMin: 4,
  loopPercent: 200,
  enclosedPoints: 10,
  startCrates: 2,
  cratePermille: 35,
  maxCrates: 3,
  crateFloorPoints: 30,
  crateLoopPoints: 50,
  couplerPermille: 30,
  maxCouplers: 2,
  streakMin: 5,
  streakPercent: [100, 115, 130, 145, 160, 180, 200],
  maxMoves: 600,
};

export interface SalvagePiece {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  /** 0 to kinds - 1 for debris, or SALVAGE_CRATE, or SALVAGE_COUPLER. */
  readonly kind: number;
}

export type SalvageMove =
  /** Haul the pieces at `cells`, in the order the line was drawn. `loop` closes it back onto its first piece. */
  | { readonly type: "tether"; readonly cells: readonly number[]; readonly loop: boolean }
  | { readonly type: "end" };

/** A piece as it left the field: where it was and what it was. */
export interface SalvageHauled {
  readonly cell: number;
  readonly id: number;
  readonly kind: number;
}

/** One settling of the field: crates taken off the floor first (none in the first round), then the fall and the refill. */
export interface SalvageRound {
  /** Crates hauled off the floor at the start of this round. */
  readonly floor: readonly SalvageHauled[];
  /** What those crates scored, after the streak. */
  readonly points: number;
  /** Pieces that fell: each one's cell before and after. */
  readonly falls: ReadonlyArray<{ readonly id: number; readonly from: number; readonly to: number }>;
  /** Debris that drifted in, with the cell it came to rest in and how many rows above the top it started. */
  readonly spawned: ReadonlyArray<{ readonly id: number; readonly cell: number; readonly kind: number; readonly drop: number }>;
  /** The field once this round has settled. */
  readonly cells: readonly SalvagePiece[];
}

/** What a line is worth before it is hauled: the engine's own sum, so the board can show it while the line is drawn. */
export interface SalvageValue {
  /** Pieces on the line. */
  readonly length: number;
  /** True when the line closes into a loop. */
  readonly loop: boolean;
  /** Cells of debris inside the loop, in index order. Empty for an open line. */
  readonly enclosed: readonly number[];
  /** Cells of every crate the loop nets: all of them on the field. Empty for an open line. */
  readonly netted: readonly number[];
  /** Line, loop, enclosed debris and netted crates, before the streak. */
  readonly base: number;
}

export interface SalvageMoveReport {
  readonly move: SalvageMove;
  /** The line, in the order drawn. */
  readonly line: readonly SalvageHauled[];
  /** True when the line closed into a loop. */
  readonly loop: boolean;
  /** Debris hauled from inside the loop. */
  readonly enclosed: readonly SalvageHauled[];
  /** Crates the loop netted, from anywhere on the field. */
  readonly netted: readonly SalvageHauled[];
  /** The streak this haul was scored at, and what it multiplied by, in percent. */
  readonly streak: number;
  readonly streakPercent: number;
  /** The haul's own points (line, loop, enclosed debris, netted crates), after the streak. */
  readonly haulPoints: number;
  readonly rounds: readonly SalvageRound[];
  /** No line was left on the field, so the debris was dealt again in place. */
  readonly shuffled: boolean;
  /** Everything the move scored: the haul and every crate off the floor. */
  readonly points: number;
}

export interface SalvageState {
  readonly config: SalvageConfig;
  /** Always full: every cell holds a piece once a move has settled. */
  readonly cells: readonly SalvagePiece[];
  readonly rng: PrngState;
  readonly nextId: number;
  readonly score: number;
  /** Hauls made. */
  readonly moveCount: number;
  /** Long lines in a row. */
  readonly combo: number;
  readonly bestCombo: number;
  /** True while the streak can still take one short line without breaking. */
  readonly grace: boolean;
  /** Pieces hauled, crates included. */
  readonly hauled: number;
  /** Crates netted by loops, and crates taken off the floor. */
  readonly cratesNetted: number;
  readonly cratesFloor: number;
  readonly loops: number;
  /** The longest line hauled. */
  readonly longest: number;
  readonly lastMove: SalvageMoveReport | null;
  readonly finished: boolean;
}
