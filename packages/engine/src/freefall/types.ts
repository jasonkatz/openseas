/**
 * Freefall (prototype, ADR 0036, ADR 0081): cargo pods dropped down a shaft of rockers into the
 * berths at its foot. A successor to the original's Treasure Drop, faithful to its mechanics.
 *
 * The one verb is a drop: pick one of the `entry` lanes at the top and let a pod fall. The shaft
 * widens as it falls, like a tree: its top row spans the `entry` lanes in the middle, and each row
 * down spans a little more, until the last spans all `width` lanes, one berth under each. It holds
 * `rows` rows of rockers in a brick pattern: a rocker spans two neighbouring lanes, one side its
 * cradle and the other its arm. A pod falls straight down its lane, a row at a time:
 *
 * - Onto an empty cradle: it comes to rest there. The rocker does not move.
 * - Onto a cradle that holds a pod: it rolls over to the arm side.
 * - Onto (or over to) the arm: it falls on past it, and the rocker flips once for every pod that
 *   passes, so the cradle and the arm change sides. A pod resting in a cradle that flips an odd
 *   number of times is tossed and falls down its own lane; flipped an even number, it lands back.
 * - Past the last row: into the berth under its lane, which pays that berth's value.
 *
 * Every pod in motion falls in step, a row at a time, so pods that come to the same lane at the
 * same row fuse into a cluster and fall as one. A cluster onto an empty cradle leaves one pod at
 * rest and rolls the rest over to the arm. A cluster of n into a berth worth v scores v * n * n
 * (`squareClusters`; off, v * n).
 *
 * A round is four legs. Each leg has a quota and its own berth values, mirrored about the middle
 * (`bays.<leg>` lists them from the middle lane outward). Points go to whoever dropped the pod
 * that set them off. With `rival` on, a rival drops after every drop of the player's, from the
 * same PRNG, picking the drop worth most at once `rivalSkill` percent of the time and a lane at
 * random otherwise. When either side's points in a leg reach the quota, the other side drops once
 * more and the leg ends; without a rival, it ends at once. Pods at rest stay where they are from
 * one leg to the next. The round ends after the fourth leg, or on `end`. The score is the
 * player's lead: their points less the rival's, never below zero. Without a rival it is their
 * points.
 *
 * Lanes are 0..width-1 left to right across the foot; rows 0..rows-1 top to bottom. A row spans
 * `rowSpan` lanes, centred. Rows alternate: an even row's rockers start at its first lane, an odd
 * row's one lane in, so an odd row's outer lanes are open. A drop names its lane across the foot;
 * only the entry lanes in the middle take one.
 */
import type { PrngState } from "../prng.js";

/** The four legs of a round, in order. */
export const FREEFALL_LEGS = ["first", "second", "third", "fourth"] as const;
export type FreefallLeg = (typeof FREEFALL_LEGS)[number];

export interface FreefallConfig {
  /** Lanes across the foot of the shaft, a berth under each. Even. */
  readonly width: number;
  /** Lanes across the top, the ones a pod is dropped down: the middle of the width. Even, and no more than it. */
  readonly entry: number;
  /** Rows of rockers. */
  readonly rows: number;
  /** Chance, per thousand, that a rocker's place is left open in the deal. */
  readonly gapPermille: number;
  /** Points a side must reach within each leg to end it, one entry a leg. */
  readonly quotas: readonly number[];
  /** Each leg's berth values, from the middle lane outward: width / 2 entries, mirrored. */
  readonly bays: { readonly [L in FreefallLeg]: readonly number[] };
  /** A cluster of n scores its berth n * n times (true), or n times (false). */
  readonly squareClusters: boolean;
  /** A rival drops after every drop of the player's. */
  readonly rival: boolean;
  /** Percent of the rival's drops that are the drop worth most at once; the rest are a lane at random. */
  readonly rivalSkill: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_FREEFALL_CONFIG: FreefallConfig = {
  width: 8,
  entry: 4,
  rows: 7,
  gapPermille: 60,
  quotas: [12, 40, 24, 70],
  bays: {
    first: [2, 2, 2, 2],
    second: [1, 2, 5, 12],
    third: [1, 3, 5, 8],
    fourth: [1, 4, 10, 20],
  },
  squareClusters: true,
  rival: true,
  rivalSkill: 70,
  maxMoves: 400,
};

/** Who dropped a pod: the player (0) or the rival (1). */
export type FreefallSide = 0 | 1;

export interface FreefallRocker {
  /** The left of the two lanes it spans. */
  readonly lane: number;
  readonly row: number;
  /** Which side its cradle is on: 0 the left lane, 1 the right. */
  readonly cradle: 0 | 1;
  /** The pod at rest in its cradle, by id; 0 when empty. */
  readonly pod: number;
}

export type FreefallMove =
  /** Drop a pod down `lane`. */
  | { readonly type: "drop"; readonly lane: number }
  | { readonly type: "end" };

/** Pods in motion in one lane, fallen as one: a single pod, or a cluster. */
export interface FreefallStack {
  readonly lane: number;
  readonly ids: readonly number[];
}

/** One row of a drop's fall: what reached it, what came to rest, what flipped and what was tossed. */
export interface FreefallStep {
  readonly row: number;
  /** Everything in motion as it reached this row, a stack a lane. */
  readonly arriving: readonly FreefallStack[];
  /** Pods that came to rest, with the rocker (its index in `rockers`) they rest in. */
  readonly rested: ReadonlyArray<{ readonly rocker: number; readonly id: number }>;
  /** Rockers that flipped, with how many times. */
  readonly flipped: ReadonlyArray<{ readonly rocker: number; readonly times: number }>;
  /** Pods tossed out of a cradle that flipped an odd number of times, with the lane they fall down. */
  readonly tossed: ReadonlyArray<{ readonly rocker: number; readonly id: number; readonly lane: number }>;
}

/** A stack that reached the foot of the shaft: its berth, its value and its points. */
export interface FreefallLanding {
  readonly lane: number;
  readonly ids: readonly number[];
  readonly value: number;
  readonly points: number;
}

/** One drop and everything it set off. */
export interface FreefallDrop {
  readonly side: FreefallSide;
  readonly lane: number;
  /** The new pod's id. */
  readonly id: number;
  readonly steps: readonly FreefallStep[];
  readonly landed: readonly FreefallLanding[];
  readonly points: number;
  /** The leg it was dropped in (0 to 3). */
  readonly leg: number;
  /** The shaft once it settled. */
  readonly rockers: readonly FreefallRocker[];
  /** True when this drop closed its leg: the next drop is in the next leg, or the round is over. */
  readonly legEnded: boolean;
}

/** What a drop down a lane would do, worked out on the shaft as it stands: for the board's preview, the hint and the rival. */
export interface FreefallDropValue {
  readonly lane: number;
  readonly points: number;
  /** Pods it would bring down to the berths. */
  readonly pods: number;
  /** The largest cluster it would land. */
  readonly cluster: number;
}

export interface FreefallMoveReport {
  readonly move: FreefallMove;
  /** The player's drop, then the rival's, when it dropped. */
  readonly drops: readonly FreefallDrop[];
}

export interface FreefallState {
  readonly config: FreefallConfig;
  readonly rockers: readonly FreefallRocker[];
  readonly rng: PrngState;
  readonly nextId: number;
  /** The leg being played, 0 to 3. */
  readonly leg: number;
  /** Each side's points in this leg: [player, rival]. */
  readonly legPoints: readonly [number, number];
  /** Each side's points over the round. */
  readonly totals: readonly [number, number];
  /** One side reached the quota: the other side's next drop closes the leg. Who reached it, or null. */
  readonly closing: FreefallSide | null;
  /** The player's lead over the rival, totals[0] - totals[1], never below zero. */
  readonly score: number;
  /** The player's drops. */
  readonly moveCount: number;
  /** The rival's drops. */
  readonly rivalDrops: number;
  /** Legs the player reached the quota of first. */
  readonly legsWon: number;
  /** The most pods one of the player's drops brought down. */
  readonly bestCombo: number;
  /** The largest cluster the player landed. */
  readonly bestCluster: number;
  readonly lastMove: FreefallMoveReport | null;
  readonly finished: boolean;
}
