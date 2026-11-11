import { z } from "zod";

/**
 * Fields every prototype puzzle's content file has (ADR 0036). A prototype is no station, so it
 * has no par: a round is rated against its thresholds, as the captain's space battle is.
 */
export const PrototypeBaseSchema = z.object({
  /** Wall-clock length of a round on the harness, enforced by the server for a recorded one. */
  roundSeconds: z.int().min(10).max(1800),
  /** The stretch of recent play, in seconds, the live tier indicator reads (ADR 0039). Longer for a puzzle that scores in lumps. */
  paceSeconds: z.int().min(1).max(120).default(10),
  /** Performance thresholds the round is rated against (ADR 0028). Guesses until testers have played. */
  thresholds: z.array(z.object({ score: z.int().min(0), rating: z.number() })).min(1),
});
