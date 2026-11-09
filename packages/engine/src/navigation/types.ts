/**
 * Navigation: a round star chart of concentric rings split into octants. Stars fall one at a time
 * from the sky above the chart into the top octant, on the engine's clock, and come to rest against
 * the first star they meet (or at the center). The navigator turns the rings so each star lands
 * where the constellation wants it, or is carried onto its marker later. Stars always pack toward
 * the center: a turn that opens a slot under an outer star lets it slide in. When every marker of
 * the constellation holds its star the constellation is charted and a larger one is dealt. Three
 * or more loose stars of a kind in a row, around a ring or down an octant, clear.
 *
 * Slot index = ring * octants + octant. Ring 0 is innermost. Octant 0 is at the top, where stars
 * enter; octants increase clockwise. Rotating a ring by +1 carries every star on it to octant + 1.
 *
 * Time is data: every move carries the integer `tick` it happens at, and the reducer lands any
 * star whose fall ends by that tick first. Nothing here reads a clock (ADR 0003, ADR 0015).
 */

import type { PrngState } from "../prng.js";

export interface NavigationConfig {
  readonly rings: number;
  readonly octants: number;
  /** Star silhouettes and colors. A kind is `shape * colors + color`, so shapes keep kinds apart without color (rule 6). */
  readonly shapes: number;
  readonly colors: number;
  /** Markers in the first constellation; one more every two completions, up to maxStars. */
  readonly startStars: number;
  readonly maxStars: number;
  /** Chance, in percent, that a new marker copies the kind of a star already on the chart. */
  readonly reuseChancePercent: number;
  /**
   * A constellation of n markers is worth n * n * starPoints, times the chain, plus its efficiency:
   * every landing it took under 2n since it was dealt adds n * starPoints, so one charted in its
   * minimum n landings earns as much again as its stars. Charting cleanly is the lever.
   */
  readonly starPoints: number;
  /**
   * What the chain of constellations charted without a lost heading multiplies the stars by, in percent:
   * the first takes the first entry, and a chain past the end takes the last, the cap.
   */
  readonly chainPercent: readonly number[];
  /** A run of n loose stars of a kind scores runPoints * (n - 2). */
  readonly runPoints: number;
  /** Lost when a star arrives at a blocked octant. Score never goes below zero. */
  readonly lostHeadingPenalty: number;
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** Longest move log the server accepts: turns, drops and waits. */
  readonly maxMoves: number;
  /** Ticks a star takes to fall at the start of the round. */
  readonly fallTicks: number;
  /** Ticks a star takes to fall by the end of the round; the fall quickens evenly towards it. */
  readonly fallTicksMin: number;
}

export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  rings: 3,
  octants: 8,
  shapes: 3,
  colors: 3,
  startStars: 3,
  maxStars: 8,
  reuseChancePercent: 50,
  starPoints: 10,
  chainPercent: [100, 125, 150, 175, 200],
  runPoints: 5,
  lostHeadingPenalty: 40,
  tickMs: 100,
  maxTick: 1500,
  maxMoves: 2000,
  fallTicks: 36,
  fallTicksMin: 18,
};

export interface Star {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  readonly kind: number;
}

export interface Marker {
  readonly ring: number;
  readonly octant: number;
  readonly kind: number;
}

/** The star in the sky: what it is, when it set off and when it comes down. */
export interface FallingStar {
  readonly kind: number;
  readonly startTick: number;
  readonly landTick: number;
}

export type NavigationMove =
  /** Turn one ring by one octant: dir +1 is clockwise. */
  | { readonly type: "rotate"; readonly ring: number; readonly dir: -1 | 1; readonly tick: number }
  /** Bring the falling star down now instead of waiting out its fall. */
  | { readonly type: "drop"; readonly tick: number }
  /** Nothing but time passing, so landings in flight reach the server. */
  | { readonly type: "wait"; readonly tick: number }
  | { readonly type: "end"; readonly tick: number };

export interface Completion {
  readonly markers: readonly Marker[];
  /** Ids of the stars removed, in marker order. */
  readonly ids: readonly number[];
  /** Constellations charted in a row without a lost heading, this one included. */
  readonly chain: number;
  /** What the chain multiplied the stars by, in percent. */
  readonly chainPercent: number;
  /** Landings under 2n it took; each adds n * starPoints. */
  readonly saved: number;
  /** True when it saved any landings, for the callout. */
  readonly efficient: boolean;
  readonly points: number;
}

export interface Run {
  readonly kind: number;
  /** Slots cleared, in order along the ring or down the octant. */
  readonly slots: readonly number[];
  readonly ids: readonly number[];
  readonly points: number;
}

export type NavigationEvent =
  /** A star came to rest. */
  | { readonly seq: number; readonly tick: number; readonly type: "land"; readonly slot: number; readonly id: number; readonly kind: number; readonly onMarker: boolean }
  /** A star arrived at a blocked octant: the octant is swept clear. */
  | { readonly seq: number; readonly tick: number; readonly type: "lost_heading"; readonly octant: number; readonly ids: readonly number[]; readonly penalty: number }
  /** Stars slid inward to pack their columns after a turn or a clearing: each star's old and new slot. */
  | { readonly seq: number; readonly tick: number; readonly type: "fall"; readonly moves: ReadonlyArray<{ readonly id: number; readonly from: number; readonly to: number }> }
  | { readonly seq: number; readonly tick: number; readonly type: "charted"; readonly completion: Completion }
  | { readonly seq: number; readonly tick: number; readonly type: "run"; readonly run: Run };

export interface NavigationMoveReport {
  readonly move: NavigationMove;
  /** Everything that happened from the previous state's tick up to and including this move's tick. */
  readonly events: readonly NavigationEvent[];
  readonly points: number;
}

export interface NavigationState {
  readonly config: NavigationConfig;
  readonly tick: number;
  /** Index = ring * octants + octant. Null is empty. */
  readonly slots: ReadonlyArray<Star | null>;
  readonly markers: readonly Marker[];
  readonly falling: FallingStar;
  /** The kind of the star after the falling one. */
  readonly next: number;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly eventSeq: number;
  /** Logged moves other than waits: turns and drops. */
  readonly moveCount: number;
  /** Every move in the log, waits included. */
  readonly logLength: number;
  /** Stars that have come down, lost headings included. */
  readonly landings: number;
  /** Landings since the current constellation was dealt, for the efficiency bonus. */
  readonly landingsSinceDeal: number;
  readonly completed: number;
  readonly lostHeadings: number;
  readonly runsCleared: number;
  readonly score: number;
  /** Consecutive completions without a lost heading. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly lastMove: NavigationMoveReport | null;
  readonly finished: boolean;
}
