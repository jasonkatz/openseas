import { z } from "zod";

/** Must list exactly the engine's PUZZLE_IDS; the server checks the two agree at compile time. */
export const PuzzleIdSchema = z.enum(["bilging", "sailing", "carpentry", "gunnery", "navigation", "battle", "swordfight"]);
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

const PartId = z.string().regex(/^[a-z][a-z0-9-]*$/).max(32);

/** A content id on the wire: a flag part, a coat, a hat, a title. The server checks it against content. */
export const ContentIdSchema = PartId;

/** Crew ranks, highest first (M6, ADR 0025). The commodore leads; officers recruit; sailors sail. */
export const CrewRankSchema = z.enum(["commodore", "officer", "sailor"]);
export type CrewRank = z.infer<typeof CrewRankSchema>;

/** A crew's flag. The parts are content ids (`content/data/world/crews.json`); the server checks them against content. */
export const CrewFlagWireSchema = z.object({ field: PartId, accent: PartId, pattern: PartId, emblem: PartId });
export type CrewFlagWire = z.infer<typeof CrewFlagWireSchema>;

/** A crew as it is shown on a ship, a profile or the notice board: enough to fly its flag. */
export const CrewTagSchema = z.object({ id: z.string().min(1).max(64), name: z.string(), flag: CrewFlagWireSchema });
export type CrewTag = z.infer<typeof CrewTagSchema>;

/** A pirate's look on deck: a coat and a hat, content ids (`content/data/world/pirates.json`, DESIGN.md 3.6). */
export const PirateLookWireSchema = z.object({ coat: PartId, hat: PartId });
export type PirateLookWire = z.infer<typeof PirateLookWireSchema>;

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
  /** The pirate's crew and their rank in it, or null for a pirate in no crew. */
  crew: CrewTagSchema.extend({ rank: CrewRankSchema }).nullable().default(null),
  /** What the pirate wears on deck. The server always sends one, a default drawn from the id until they pick. */
  look: PirateLookWireSchema.nullable().default(null),
  /** The title the pirate shows after their name, a content id, or null for none. */
  title: PartId.nullable().default(null),
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
  "not_in_melee",
  "is_deckhand",
  "not_deckhand",
  "not_mate_station",
  "not_in_crew",
  "already_in_crew",
  "crew_name_taken",
  "crew_name_bad",
  "crew_flag_bad",
  "crew_rank_low",
  "crew_full",
  "crew_invites_full",
  "no_such_pirate",
  "no_invite",
  "already_invited",
  "already_crewmate",
  "look_bad",
  "title_locked",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
