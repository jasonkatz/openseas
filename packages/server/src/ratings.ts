import { and, eq } from "drizzle-orm";
import type { Content } from "@openseas/content";
import { NEW_RATING, dutyResults, performanceRating, tierFor, updateRating, type PuzzleId, type Rating } from "@openseas/engine";
import type { RatingView } from "@openseas/protocol";
import { schema, type Tx } from "./db/index.js";

export interface RatingUpdate {
  before: Rating;
  after: Rating;
  view: RatingView;
  tierChange: "up" | "down" | "same";
}

/** Rate one duty-puzzle round against the content thresholds and persist (DESIGN.md 3.6). */
export async function rateDutyRound(tx: Tx, content: Content, pirateId: string, puzzle: PuzzleId, score: number): Promise<RatingUpdate> {
  const [row] = await tx
    .select()
    .from(schema.rating)
    .where(and(eq(schema.rating.pirateId, pirateId), eq(schema.rating.puzzle, puzzle)))
    .for("update");
  const before: Rating = row
    ? { rating: row.rating, deviation: row.deviation, volatility: row.volatility }
    : NEW_RATING;
  const thresholds = content.puzzles[puzzle].thresholds;
  const after = updateRating(before, dutyResults(score, thresholds));
  const rounds = (row?.rounds ?? 0) + 1;
  await tx
    .insert(schema.rating)
    .values({ pirateId, puzzle, rating: after.rating, deviation: after.deviation, volatility: after.volatility, rounds })
    .onConflictDoUpdate({
      target: [schema.rating.pirateId, schema.rating.puzzle],
      set: { rating: after.rating, deviation: after.deviation, volatility: after.volatility, rounds, updatedAt: new Date() },
    });
  const tierBefore = row ? tierFor(before.rating, content.ratingTiers) : null;
  const tierAfter = tierFor(after.rating, content.ratingTiers);
  const tierChange = !tierBefore || tierAfter.min === tierBefore.min ? "same" : tierAfter.min > tierBefore.min ? "up" : "down";
  return { before, after, view: { puzzle, tier: tierAfter.key, rounds }, tierChange };
}

/**
 * One round's own performance against its puzzle's thresholds, and the tier that rating falls in
 * (ADR 0028). Describes the round only; the pirate's standing is `rateDutyRound`'s.
 */
export function roundPerformance(content: Content, puzzle: PuzzleId, score: number): { rating: number; tier: string } {
  const rating = performanceRating(score, content.puzzles[puzzle].thresholds);
  return { rating, tier: tierFor(rating, content.ratingTiers).key };
}
