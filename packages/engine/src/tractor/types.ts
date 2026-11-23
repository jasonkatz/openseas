/**
 * Tractor (prototype, ADR 0036): loot adrift after a fight, pulled aboard on a tractor beam. The
 * hold's hatch is the top edge of the field, and the beam pulls everything up towards it.
 *
 * The one verb is a swap: a piece trades places with the piece directly under it. A run of three or
 * more pieces of one kind in a row or a column is beamed aboard; a run of n scores runPoints * n * n.
 * The gaps close upward: what is below rises, and new loot drifts in at the bottom. If what rises
 * makes new runs they go too, a wave at a time, each later wave at the next cascadePercent entry
 * (the last holds, so a lucky cascade is capped). A swap that makes no run is allowed and scores
 * nothing: it is how a field is set up, and it spends the round's clock.
 *
 * A cache is a sealed crate: it cannot be swapped and is in no run. It rises with the loot as the
 * pieces above it go, and a cache that reaches the top row is hauled aboard. A beacon is a piece of
 * loot with a mark: it matches as its kind, and when it goes in a run it fires along its mark, a
 * cross (its row and its column) or a saltire (both its diagonals). Every piece of loot on those
 * lines is swept aboard for sweepPoints, a beacon swept fires in turn, and a cache on those lines is
 * hauled at once. Every cache hauled in one swap, off the top or by a sweep, counts together:
 * k caches score cachePoints * k * k. Lining caches up on one row and firing a cross through them
 * is the move the puzzle pays most for.
 *
 * Cell index = row * width + col. Row 0 is the top row, the hatch; new loot enters at the last row.
 * Nothing here reads a clock: the round's length is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

/** A sealed cache: never swapped, never in a run. Hauled off the top row, or by a beacon's sweep. */
export const TRACTOR_CACHE = 100;

/** A beacon's mark: `cross` fires along its row and column, `saltire` along both diagonals. */
export type TractorMark = "cross" | "saltire";

export interface TractorConfig {
  readonly width: number;
  readonly height: number;
  /** Kinds of loot: 0 to kinds - 1. */
  readonly kinds: number;
  /** A run of n pieces scores runPoints * n * n. */
  readonly runPoints: number;
  /** What each wave of a swap multiplies its points by, in percent: the first wave takes the first entry, a wave past the end takes the last. */
  readonly cascadePercent: readonly number[];
  /** Caches on the opening field. */
  readonly startCaches: number;
  /** Chance, per thousand, that a piece drifting in is a cache, while fewer than maxCaches are on the field. */
  readonly cachePermille: number;
  readonly maxCaches: number;
  /** Every cache hauled in one swap counts together: k caches score cachePoints * k * k. */
  readonly cachePoints: number;
  /** A beacon drifts in with the loot after every this many scoring swaps. 0 deals none. */
  readonly beaconEvery: number;
  /** Each piece of loot a beacon sweeps aboard, outside any run. */
  readonly sweepPoints: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_TRACTOR_CONFIG: TractorConfig = {
  width: 6,
  height: 9,
  kinds: 5,
  runPoints: 5,
  cascadePercent: [100, 150, 200],
  startCaches: 1,
  cachePermille: 25,
  maxCaches: 3,
  cachePoints: 150,
  beaconEvery: 5,
  sweepPoints: 10,
  maxMoves: 800,
};

export interface TractorPiece {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  /** 0 to kinds - 1 for loot, or TRACTOR_CACHE. */
  readonly kind: number;
  /** A beacon's mark. Only loot carries one, and only a beacon. */
  readonly mark?: TractorMark;
}

export type TractorMove =
  /** Swap the piece at `cell` with the piece directly under it. */
  | { readonly type: "swap"; readonly cell: number }
  | { readonly type: "end" };

/** A piece as it left the field: where it was and what it was. */
export interface TractorTaken {
  readonly cell: number;
  readonly id: number;
  readonly kind: number;
  readonly mark?: TractorMark;
}

/** One run: its cells in order along the line, its kind and its points before the wave's percent. */
export interface TractorRun {
  readonly cells: readonly number[];
  readonly kind: number;
  readonly points: number;
}

/** A beacon that fired: where it was, its mark, and the cells its sweep took (loot and caches), nearest first. */
export interface TractorFire {
  readonly cell: number;
  readonly id: number;
  readonly mark: TractorMark;
  readonly swept: readonly number[];
}

/** One settling: caches taken off the top row first (none in a wave's first), then the rise and the new loot. */
export interface TractorSettle {
  /** Caches hauled off the top row at the start of this settling. */
  readonly topped: readonly TractorTaken[];
  /** Pieces that rose: each one's cell before and after. */
  readonly rises: ReadonlyArray<{ readonly id: number; readonly from: number; readonly to: number }>;
  /** Pieces that drifted in, with the cell each came to rest in and how many rows below the bottom it started. */
  readonly spawned: ReadonlyArray<{ readonly id: number; readonly cell: number; readonly kind: number; readonly mark?: TractorMark; readonly rise: number }>;
  /** The field once this settling is done. */
  readonly cells: readonly TractorPiece[];
}

/** One wave of a swap: the runs it found, the beacons they fired, what went, and how the field settled. */
export interface TractorWave {
  readonly runs: readonly TractorRun[];
  readonly fired: readonly TractorFire[];
  /** Loot that went: every piece in a run, then every piece swept. */
  readonly cleared: readonly TractorTaken[];
  /** Loot swept by beacons, not in any run. */
  readonly swept: readonly TractorTaken[];
  /** Caches a sweep hauled. */
  readonly caches: readonly TractorTaken[];
  /** The wave's percent, and its points after it (runs and sweeps; caches are paid once, for the whole swap). */
  readonly percent: number;
  readonly points: number;
  readonly settles: readonly TractorSettle[];
}

/** What a swap is worth at once, before anything rises: the engine's own sum, for the board's preview and the hint. */
export interface TractorSwapValue {
  /** True when the swap makes at least one run. */
  readonly scores: boolean;
  readonly runs: readonly TractorRun[];
  /** Cells of every piece the first wave would clear, sweeps included. */
  readonly cleared: readonly number[];
  /** Cells of every cache the first wave's sweeps would haul. */
  readonly caches: readonly number[];
  /** Beacons that would fire. */
  readonly fired: number;
  /** The first wave's points, and what its caches would score if no other cache came aboard in the swap. */
  readonly points: number;
}

export interface TractorMoveReport {
  readonly move: TractorMove;
  /** The two cells swapped: the piece that was at `cell` is now at `below`. */
  readonly cell: number;
  readonly below: number;
  /** The field right after the swap, before anything went. */
  readonly swapped: readonly TractorPiece[];
  /** Every wave, in order. Empty for a swap that made no run. */
  readonly waves: readonly TractorWave[];
  /** Every cache hauled in the swap, by sweep or off the top, and what they scored together. */
  readonly caches: readonly TractorTaken[];
  readonly cachePoints: number;
  /** No swap could make a run, so the loot was dealt again in place. */
  readonly shuffled: boolean;
  /** Everything the swap scored. */
  readonly points: number;
}

export interface TractorState {
  readonly config: TractorConfig;
  /** Always full once a move has settled. */
  readonly cells: readonly TractorPiece[];
  readonly rng: PrngState;
  readonly nextId: number;
  readonly score: number;
  /** Swaps made, scoring or not. */
  readonly moveCount: number;
  /** Swaps that made a run. */
  readonly clears: number;
  /** Swaps that made none. */
  readonly duds: number;
  /** Loot beamed aboard, runs and sweeps. */
  readonly cleared: number;
  /** The most waves one swap set off. */
  readonly bestCombo: number;
  readonly cachesHauled: number;
  /** The most caches one swap hauled. */
  readonly bestCaches: number;
  readonly beaconsFired: number;
  /** The longest run made. */
  readonly longest: number;
  readonly lastMove: TractorMoveReport | null;
  readonly finished: boolean;
}
