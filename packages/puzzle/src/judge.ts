/**
 * Judgement (docs/puzzles/DOMAIN.md, "Judgement"): a round's score placed on the scale every
 * puzzle shares, through the puzzle's tier starts, in straight lines between them. The scale is the
 * host's; the tier starts are the puzzle's, and no host can move them.
 */
import type { TierStarts } from "./document.js";

export const TIERS = ["green", "steady", "sharp", "masterful", "legendary"] as const;
export type Tier = (typeof TIERS)[number];

/** The host's scale: where each tier begins on it, what a score of nothing is worth, and the most a round can be. */
export interface Scale {
  readonly steady: number;
  readonly sharp: number;
  readonly masterful: number;
  readonly legendary: number;
  readonly floor: number;
  readonly ceiling: number;
}

/** A score on the host's scale. Whole numbers throughout, so every host places a score alike. */
export function performanceOf(score: number, starts: TierStarts, scale: Scale): number {
  const xs = [0, starts.steady, starts.sharp, starts.masterful, starts.legendary];
  const ys = [scale.floor, scale.steady, scale.sharp, scale.masterful, scale.legendary];
  const s = Math.max(0, Math.floor(score));
  for (let i = 1; i < xs.length; i++) {
    if (s < xs[i]!) return ys[i - 1]! + Math.floor(((s - xs[i - 1]!) * (ys[i]! - ys[i - 1]!)) / (xs[i]! - xs[i - 1]!));
  }
  // Past Legendary the last line carries on, up to the scale's ceiling.
  const run = starts.legendary - starts.masterful;
  const over = Math.floor(((s - starts.legendary) * (scale.legendary - scale.masterful)) / run);
  return Math.min(scale.ceiling, scale.legendary + over);
}

export function tierOf(performance: number, scale: Scale): Tier {
  if (performance >= scale.legendary) return "legendary";
  if (performance >= scale.masterful) return "masterful";
  if (performance >= scale.sharp) return "sharp";
  if (performance >= scale.steady) return "steady";
  return "green";
}
