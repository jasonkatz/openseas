import { useEffect, useRef, useState } from "react";
import { paceScore, performanceRating, tierFor, type PuzzleId } from "@openseas/engine";
import { content } from "../content.js";

export interface TierPaceOptions {
  puzzle: PuzzleId;
  /** What the round has made so far. It only has to add up over time: a score, or a fight's points. */
  points: number;
  playing: boolean;
  /** Seconds into the round on the round's own clock, so a slowed or paused lab clock reads true. Left out, the wall clock runs. */
  elapsed?: number | undefined;
  /** Reads a stretch of play as a score when the puzzle's score is not points over a round (a fight's rate). An engine function. */
  project?: ((points: number, seconds: number) => number) | undefined;
  /** The numbers to read the pace against when the round is not on the shipped ones: a round the studio tuned (ADR 0042). Left out, content's. */
  numbers?: TierPaceNumbers | undefined;
}

/** What the indicator reads off a puzzle's content file. */
export interface TierPaceNumbers {
  roundSeconds: number;
  paceSeconds: number;
  thresholds: readonly { score: number; rating: number }[];
}

export interface TierPaceValue {
  /** The tier's key in content. */
  tier: string;
  /** Where it stands among the tiers, lowest first. */
  index: number;
  count: number;
}

interface Sample {
  at: number;
  points: number;
}

/**
 * The tier a player is playing at right now (ADR 0039): what they made in the last `paceSeconds`
 * of the round, read as a whole round at that pace and rated against the puzzle's thresholds. The
 * sums are the engine's (`paceScore`, `performanceRating`, `tierFor`); this only keeps the samples.
 * Display only: nothing reads it back.
 */
export function useTierPace(o: TierPaceOptions): TierPaceValue | null {
  const samples = useRef<Sample[]>([]);
  const startedAt = useRef(0);
  const wasPlaying = useRef(false);
  const [, setBeat] = useState(0);
  const ownClock = o.elapsed === undefined;

  // With no round clock handed in, a beat a second keeps the reading falling while nothing scores.
  useEffect(() => {
    if (!o.playing || !ownClock) return;
    const id = setInterval(() => setBeat((b) => b + 1), 1000);
    return () => clearInterval(id);
  }, [o.playing, ownClock]);

  if (!o.playing) {
    wasPlaying.current = false;
    return null;
  }
  if (!wasPlaying.current) {
    wasPlaying.current = true;
    startedAt.current = performance.now();
    samples.current = [];
  }
  const puzzle: TierPaceNumbers = o.numbers ?? content.puzzles[o.puzzle];
  const window = puzzle.paceSeconds;
  const at = o.elapsed ?? (performance.now() - startedAt.current) / 1000;
  const list = samples.current;
  const last = list[list.length - 1];
  // A clock that ran backwards is a new round.
  if (last && at < last.at) list.length = 0;
  if (!list.length) list.push({ at: Math.min(at, 0), points: 0 });
  const tail = list[list.length - 1]!;
  if (at > tail.at) list.push({ at, points: o.points });
  else tail.points = o.points;
  // Keep one sample at or before the window's start: it is what the window is measured from.
  while (list.length > 1 && list[1]!.at <= at - window) list.shift();
  const made = o.points - list[0]!.points;
  const score = o.project ? o.project(made, window) : paceScore(made, window, puzzle.roundSeconds);
  const tiers = content.ratingTiers;
  const tier = tierFor(performanceRating(score, puzzle.thresholds), tiers);
  return { tier: tier.key, index: tiers.findIndex((t) => t.key === tier.key), count: tiers.length };
}
