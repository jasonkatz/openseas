import { z } from "zod";

/** Must list exactly the engine's PUZZLE_IDS; the server checks the two agree at compile time. */
export const PuzzleIdSchema = z.enum(["bilging", "sailing", "carpentry", "gunnery", "navigation", "battle"]);
export type PuzzleIdWire = z.infer<typeof PuzzleIdSchema>;

/** The duty puzzles, played at a station aboard. Sea Battle is the captain's game, not a station. */
export const DutyPuzzleIdSchema = z.enum(["bilging", "sailing", "carpentry", "gunnery", "navigation"]);
export type DutyPuzzleIdWire = z.infer<typeof DutyPuzzleIdSchema>;

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
  ships: z.array(z.object({ id: z.string(), classId: z.string(), name: z.string(), islandId: z.string() })),
  /** The island the pirate stands on when not aboard a ship. */
  islandId: z.string(),
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
  "no_ship",
  "ship_elsewhere",
  "ship_full",
  "ship_locked",
  "already_aboard",
  "not_aboard",
  "not_captain",
  "not_owner",
  "not_docked",
  "not_at_sea",
  "bad_route",
  "station_taken",
  "no_station",
  "not_hailed",
  "no_such_class",
  "short_of_coins",
  "aboard_a_ship",
  "in_battle",
  "not_in_battle",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
