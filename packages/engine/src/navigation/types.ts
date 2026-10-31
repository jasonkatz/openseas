/**
 * Navigation: a star chart of concentric rings split into octants. Stars fall from the rim toward
 * the center, one at a time, into an octant the chart deals. The navigator turns the rings so each
 * star lands on, or is later carried onto, the hollow marker of its kind. When every marker of the
 * constellation holds its star the constellation completes and a larger one is dealt.
 *
 * Slot index = ring * octants + octant. Ring 0 is innermost. Octant 0 is at the top; octants
 * increase clockwise. Rotating a ring by +1 carries every star on it to octant + 1.
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
  /** Points per completion are n * n * starPoints, times the chain. */
  readonly starPoints: number;
  /** Added when a constellation of n markers completes within 2n drops of being dealt. */
  readonly efficiencyBonus: number;
  /** Lost when a star is dropped into a full octant. Score never goes below zero. */
  readonly boochPenalty: number;
  /** The round ends after this many drops. */
  readonly maxDrops: number;
  /** Longest move log the server accepts: drops plus rotations. */
  readonly maxMoves: number;
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
  efficiencyBonus: 30,
  boochPenalty: 40,
  maxDrops: 80,
  maxMoves: 1200,
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

/** The star about to fall: what it is and the octant the chart dealt it. */
export interface FallingStar {
  readonly kind: number;
  readonly octant: number;
}

export type NavigationMove =
  /** Turn one ring by one octant: dir +1 is clockwise. */
  | { readonly type: "rotate"; readonly ring: number; readonly dir: -1 | 1 }
  /** Let the current star fall into its octant. */
  | { readonly type: "drop" }
  | { readonly type: "end" };

export interface Completion {
  readonly markers: readonly Marker[];
  /** Ids of the stars removed, in marker order. */
  readonly ids: readonly number[];
  readonly chain: number;
  readonly efficient: boolean;
  readonly points: number;
}

export interface NavigationMoveReport {
  readonly move: NavigationMove;
  /** Where the dropped star came to rest. */
  readonly landed: { readonly slot: number; readonly id: number } | null;
  /** A drop into a full octant: the stars swept off the chart. */
  readonly booch: { readonly octant: number; readonly ids: readonly number[]; readonly penalty: number } | null;
  /** Constellations completed by this move, in order (a drop can complete one, and the redeal can complete another at once). */
  readonly completions: readonly Completion[];
  readonly points: number;
}

export interface NavigationState {
  readonly config: NavigationConfig;
  /** Index = ring * octants + octant. Null is empty. */
  readonly slots: ReadonlyArray<Star | null>;
  readonly markers: readonly Marker[];
  readonly current: FallingStar;
  readonly next: FallingStar;
  readonly rng: PrngState;
  readonly nextId: number;
  /** Drops so far. Rotations are free. */
  readonly moveCount: number;
  /** Every move in the log, rotations included. */
  readonly logLength: number;
  /** Drops since the current constellation was dealt, for the efficiency bonus. */
  readonly dropsSinceDeal: number;
  readonly completed: number;
  readonly score: number;
  /** Consecutive completions without a booch. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly lastMove: NavigationMoveReport | null;
  readonly finished: boolean;
}
