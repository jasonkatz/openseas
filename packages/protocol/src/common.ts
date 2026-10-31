import { z } from "zod";

/** Must list exactly the engine's PUZZLE_IDS; the server checks the two agree at compile time. */
export const PuzzleIdSchema = z.enum(["bilging", "sailing"]);
export type PuzzleIdWire = z.infer<typeof PuzzleIdSchema>;

export const RatingViewSchema = z.object({
  puzzle: PuzzleIdSchema,
  /** Display tier key, resolved to text through the message table. Raw numbers are never sent. */
  tier: z.string(),
  rounds: z.int().min(0),
});
export type RatingView = z.infer<typeof RatingViewSchema>;

export const PirateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Whether the owning account is still an anonymous guest. */
  guest: z.boolean(),
  balance: z.int(),
  ratings: z.array(RatingViewSchema),
  ships: z.array(z.object({ id: z.string(), classId: z.string(), name: z.string() })),
});
export type PirateSummary = z.infer<typeof PirateSummarySchema>;

/** Every error carries a message-table key, never English text. */
export const ErrorCodeSchema = z.enum([
  "unauthenticated",
  "no_pirate",
  "invite_required",
  "invite_invalid",
  "pirate_exists",
  "bad_message",
  "unknown_session",
  "session_closed",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
