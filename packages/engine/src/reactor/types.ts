/**
 * Reactor (prototype, ADR 0036): a square core of fuel rods, worked with one verb. A swipe slides
 * every rod as far as it will go that way. Two rods of one grade that meet fuse into one of the next
 * grade, once a swipe. After a swipe that changed anything a new rod enters on the edge the rods
 * slid away from, in a lane that changed. A rod of the top grade is hot: it fuses with nothing and
 * only takes up room until a swipe pushes it against the wall where a port is open. Then it is
 * discharged for the big score, that port closes and another opens somewhere on the rim. Hot rods
 * stacked nose to tail at a port all leave in the one swipe, a salvo, for far more than one by one.
 *
 * Cell index = row * size + col, row 0 at the top. A direction and a port's side share one
 * numbering: 0 up or top, 1 right, 2 down or bottom, 3 left. A port's lane is a column for the top
 * and bottom walls and a row for the left and right ones.
 *
 * Nothing here reads a clock: the round's length is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

/** 0 up, 1 right, 2 down, 3 left. */
export type ReactorDir = 0 | 1 | 2 | 3;

export interface ReactorConfig {
  /** The core is size by size. */
  readonly size: number;
  /** The grade that is hot: it no longer fuses and must go out through a port. */
  readonly hotGrade: number;
  /** Ports open on the rim at once. */
  readonly ports: number;
  /** This many hot rods in the core at once and it goes critical: a scram. One fewer is the most a player may hold. */
  readonly criticalHot: number;
  /** Rods in the core at the start, and after a scram. */
  readonly startRods: number;
  /** Chance, per thousand, that the next rod to enter is grade 2 instead of grade 1. */
  readonly twoPermille: number;
  /** What fusing into each grade scores: the first entry is grade 2, the last is the hot grade. */
  readonly fusePoints: readonly number[];
  /** A hot rod out through a port, before the pipeline. */
  readonly dischargePoints: number;
  /**
   * What the rods out in one swipe multiply that swipe's discharges by, in percent: one rod takes the
   * first entry, two the second, and more than the list is long takes the last.
   */
  readonly salvoPercent: readonly number[];
  /** A discharge within this many swipes of the last one keeps the pipeline going. */
  readonly pipelineSwipes: number;
  /** What the pipeline multiplies a discharge by, in percent: the first in a run takes the first entry, a run past the end takes the last. */
  readonly pipelinePercent: readonly number[];
  /** Lost when no swipe can change anything and the core is emptied. The score never goes below zero. */
  readonly scramPenalty: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_REACTOR_CONFIG: ReactorConfig = {
  size: 4,
  hotGrade: 4,
  ports: 2,
  criticalHot: 4,
  startRods: 2,
  twoPermille: 200,
  fusePoints: [2, 5, 12],
  dischargePoints: 100,
  salvoPercent: [100, 250, 400],
  pipelineSwipes: 8,
  pipelinePercent: [100, 125, 150, 175, 200],
  scramPenalty: 150,
  maxMoves: 1500,
};

export interface ReactorRod {
  /** Stable identity for animation. Never reused within a game. A rod keeps its id when another fuses into it. */
  readonly id: number;
  readonly grade: number;
}

export interface ReactorPort {
  /** The wall it is on: 0 top, 1 right, 2 bottom, 3 left. A swipe that way pushes rods against it. */
  readonly side: ReactorDir;
  /** A column for the top and bottom walls, a row for the left and right ones. */
  readonly lane: number;
}

export type ReactorMove =
  | { readonly type: "swipe"; readonly dir: ReactorDir }
  | { readonly type: "end" };

/** Where one rod went in a swipe. Every rod in the core before the swipe has exactly one. */
export interface ReactorSlide {
  readonly id: number;
  readonly from: number;
  /** The cell it came to rest in; for a rod that fused away, the cell of the rod it joined; for a discharged rod, the cell at the port. */
  readonly to: number;
  /** Set when this rod fused into another and is gone: the id of the rod that took it in. */
  readonly into: number | null;
  /** True when it left through a port. */
  readonly out: boolean;
}

export interface ReactorFusion {
  /** The rod that remains, now one grade higher. */
  readonly id: number;
  readonly cell: number;
  readonly grade: number;
  /** True when the fusion made a hot rod. */
  readonly hot: boolean;
  readonly points: number;
}

export interface ReactorDischarge {
  readonly id: number;
  readonly port: ReactorPort;
  /** The cell at the wall the rod left from. */
  readonly cell: number;
  /** The run of discharges this one was scored in, and what that multiplied by, in percent. */
  readonly pipeline: number;
  readonly percent: number;
  /** After the pipeline, before a double. */
  readonly points: number;
}

/** The core was emptied: why, what was in it, what it cost, and the rods it restarts with. */
export interface ReactorScram {
  /** `jammed`: no swipe could change anything. `critical`: too many hot rods at once. */
  readonly cause: "jammed" | "critical";
  readonly ids: readonly number[];
  readonly penalty: number;
  readonly fresh: ReadonlyArray<{ readonly id: number; readonly cell: number; readonly grade: number }>;
}

export interface ReactorMoveReport {
  readonly move: ReactorMove;
  readonly dir: ReactorDir;
  readonly slides: readonly ReactorSlide[];
  readonly fusions: readonly ReactorFusion[];
  readonly discharges: readonly ReactorDischarge[];
  /** What the count of rods out in this swipe multiplied their points by, in percent. */
  readonly salvoPercent: number;
  /** What the discharges scored between them, after the salvo. */
  readonly dischargeTotal: number;
  /** Ports that opened to replace the ones used, in the order they were used. */
  readonly opened: readonly ReactorPort[];
  /** The rod that entered after the swipe. */
  readonly entered: { readonly id: number; readonly cell: number; readonly grade: number } | null;
  readonly scram: ReactorScram | null;
  /** True when the pipeline lapsed on this swipe: too many swipes since the last discharge. */
  readonly lapsed: boolean;
  /** Fusions and discharges, the discharges multiplied for a salvo, less a scram's penalty. */
  readonly points: number;
}

export interface ReactorState {
  readonly config: ReactorConfig;
  /** Index = row * size + col. Null is empty. */
  readonly cells: ReadonlyArray<ReactorRod | null>;
  /** The open ports, oldest first. */
  readonly ports: readonly ReactorPort[];
  /** The grade of the rod that enters after the next swipe. */
  readonly next: number;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly score: number;
  /** Swipes made. */
  readonly moveCount: number;
  /** Discharges in the current run of the pipeline; 0 once it has lapsed. */
  readonly combo: number;
  readonly bestCombo: number;
  /** Swipes since the last discharge, while a pipeline is running. */
  readonly sinceDischarge: number;
  readonly discharges: number;
  /** Swipes that discharged two or more rods. */
  readonly salvos: number;
  readonly fusions: number;
  readonly scrams: number;
  readonly lastMove: ReactorMoveReport | null;
  readonly finished: boolean;
}
