/**
 * Tug (prototype, ADR 0036): a cargo bay in zero gravity. A few blocks are fixed in it and a few
 * cargo pods float there, each its own shape. A pod that is flicked slides in a straight line until
 * a wall, a block or another pod stops it. One clamp is lit on the floor, marked for one pod: bring
 * that pod to rest on it (sliding over it does not count) and it is delivered, the pod stays where
 * it is, and another clamp lights.
 *
 * Every clamp is dealt with a par, the fewest flicks that can deliver it from the bay as it stood
 * when the clamp lit. The engine finds it by searching every bay those flicks can reach, so a clamp
 * is always deliverable and par is exact. Delivering at par is clean and builds a streak; clean
 * deliveries make the clamps harder, slow ones and skips make them easier.
 *
 * Cell index = row * width + col. Row 0 is the top row. Nothing here reads a clock: the round's
 * length is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

export interface TugConfig {
  readonly width: number;
  readonly height: number;
  /** Cargo pods in the bay. Pod n is drawn as the kit's kind n. */
  readonly pods: number;
  /** Fixed blocks, placed off the walls and never touching one another. Fewer are placed if they do not fit. */
  readonly blocks: number;
  /** The par of the first clamp, and the lowest any clamp is dealt at. */
  readonly startPar: number;
  /** The highest par a clamp is dealt at: the depth of the search that deals it. */
  readonly maxPar: number;
  /** Clean deliveries it takes to raise the next clamp's par by one. A slow delivery or a skip takes one back. */
  readonly cleanPerStep: number;
  /** What a delivery is worth by its par: entry par - 1. */
  readonly parPoints: readonly number[];
  /** What delivering at par multiplies by, in percent. */
  readonly cleanPercent: number;
  /** A delivery within this many flicks over par scores in full. */
  readonly slack: number;
  /** What a delivery slower than that scores, in percent. */
  readonly slowPercent: number;
  /** What the streak of clean deliveries multiplies a clean one by, in percent: the first takes the first entry, a streak past the end takes the last. */
  readonly streakPercent: readonly number[];
  /** Lost when a clamp is skipped. The score never goes below zero. */
  readonly skipPenalty: number;
  /** Longest log of flicks and skips the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_TUG_CONFIG: TugConfig = {
  width: 7,
  height: 7,
  pods: 4,
  blocks: 5,
  startPar: 2,
  maxPar: 4,
  cleanPerStep: 2,
  parPoints: [10, 25, 50, 90],
  cleanPercent: 200,
  slack: 2,
  slowPercent: 50,
  streakPercent: [100, 115, 130, 145, 160, 180, 200],
  skipPenalty: 15,
  maxMoves: 600,
};

/** The directions a pod can be flicked: 0 up, 1 right, 2 down, 3 left. */
export type TugDir = 0 | 1 | 2 | 3;

export type TugMove =
  /** Flick pod `pod` in direction `dir`. Refused when the pod cannot move that way at all. */
  | { readonly type: "flick"; readonly pod: number; readonly dir: TugDir }
  /** Give up on the lit clamp for a penalty and the streak; another lights. */
  | { readonly type: "skip" }
  | { readonly type: "end" };

export interface TugClamp {
  /** The pod it wants. */
  readonly pod: number;
  readonly cell: number;
  /** The fewest flicks that could deliver it when it lit. */
  readonly par: number;
}

/** How a delivery measured up to par: at it, within the slack, or slower. */
export type TugGrade = "clean" | "full" | "slow";

/** What stopped a slide. */
export type TugStop = "wall" | "block" | "pod";

export interface TugDelivery {
  readonly pod: number;
  readonly cell: number;
  /** Flicks it took since the clamp lit, and the clamp's par. */
  readonly flicks: number;
  readonly par: number;
  readonly grade: TugGrade;
  /** The streak this delivery was scored at (0 unless clean), and what it multiplied by, in percent. */
  readonly streak: number;
  readonly streakPercent: number;
  readonly points: number;
}

export interface TugMoveReport {
  readonly move: TugMove;
  /** The slide a flick made: which pod, from where to where, and what stopped it. Null for a skip. */
  readonly slide: { readonly pod: number; readonly from: number; readonly to: number; readonly stop: TugStop } | null;
  readonly delivered: TugDelivery | null;
  /** A skip: the clamp given up and what it cost (less than the penalty when the score had less to lose). */
  readonly skipped: { readonly clamp: TugClamp; readonly penalty: number } | null;
  /** The clamp lit by this move, after a delivery or a skip. Null when the same clamp stays lit. */
  readonly clamp: TugClamp | null;
  /** What the move scored: a delivery's points, or a skip's penalty as a negative number. */
  readonly points: number;
}

export interface TugState {
  readonly config: TugConfig;
  /** The fixed blocks' cells, in ascending order. */
  readonly blocks: readonly number[];
  /** Each pod's cell: entry n is pod n. */
  readonly pods: readonly number[];
  readonly clamp: TugClamp;
  /** Flicks made since the clamp lit. */
  readonly flicks: number;
  /** Rises with clean deliveries and falls with slow ones and skips; sets the next clamp's par. */
  readonly level: number;
  readonly rng: PrngState;
  readonly score: number;
  /** Flicks made this round. */
  readonly moveCount: number;
  /** Flicks and skips: the log's length, held to maxMoves. */
  readonly logLength: number;
  readonly delivered: number;
  readonly clean: number;
  readonly skipped: number;
  /** Clean deliveries in a row. */
  readonly combo: number;
  readonly bestCombo: number;
  /** The highest par delivered clean. */
  readonly bestPar: number;
  readonly lastMove: TugMoveReport | null;
  readonly finished: boolean;
}
