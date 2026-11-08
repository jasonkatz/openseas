import { z } from "zod";
import { ContentIdSchema, CrewRankSchema, CrewTagSchema, PirateLookWireSchema, RatingViewSchema } from "./common.js";

/**
 * Crews (M6, ADR 0025): the social unit and the invite list (DESIGN.md 3.4, 3.7). Not the crew of a
 * ship, which is whoever is aboard it (`CrewViewSchema` in ship.ts): a crew is a lasting band of
 * pirates with a name, a flag and ranks, and its members sail on any ship.
 */

const Id = z.string().min(1).max(64);

/** Where a crewmate is right now, as the viewer can act on it. */
export const CrewWhereSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offline") }),
  z.object({ kind: z.literal("ashore"), islandId: Id }),
  z.object({
    kind: z.literal("aboard"),
    shipId: Id,
    shipName: z.string(),
    /** Docked at this island, or null at sea. */
    islandId: Id.nullable(),
    /** At sea: where the ship is bound and how far along, per mille. */
    to: Id.nullable(),
    progress: z.int().min(0).max(1000),
    /** The viewer could board this ship right now from where they are. */
    joinable: z.boolean(),
  }),
]);
export type CrewWhere = z.infer<typeof CrewWhereSchema>;

export const CrewMemberSchema = z.object({
  pirateId: Id,
  name: z.string(),
  rank: CrewRankSchema,
  joinedAt: z.number(),
  where: CrewWhereSchema,
});
export type CrewMember = z.infer<typeof CrewMemberSchema>;

/** What the crew has done together: voyages arrived with a member aboard, brigands beaten, coins plundered. */
export const CrewStatsSchema = z.object({ voyages: z.int().min(0), victories: z.int().min(0), booty: z.int().min(0) });
export type CrewStats = z.infer<typeof CrewStatsSchema>;

export const CrewInfoSchema = CrewTagSchema.extend({
  foundedAt: z.number(),
  stats: CrewStatsSchema,
  /** Commodore first, then by rank and time in the crew. */
  members: z.array(CrewMemberSchema),
  /** Pirates invited and not yet answered; officers and up see the names. */
  invited: z.array(z.object({ pirateId: Id, name: z.string() })),
});
export type CrewInfo = z.infer<typeof CrewInfoSchema>;

/** An invitation waiting on the viewer. */
export const CrewInviteSchema = z.object({ crew: CrewTagSchema, members: z.int().min(0), by: z.string(), at: z.number() });
export type CrewInvite = z.infer<typeof CrewInviteSchema>;

/** A crew on the tavern's board of crews. */
export const CrewRowSchema = CrewTagSchema.extend({ members: z.int().min(0), stats: CrewStatsSchema });
export type CrewRow = z.infer<typeof CrewRowSchema>;

/** Things that happen to a crew, pushed to its members as they happen. Names are attached so the client can say who. */
export const CrewNoticeSchema = z.discriminatedUnion("type", [
  /** The viewer was invited to a crew. */
  z.object({ type: z.literal("invited"), crew: CrewTagSchema, by: z.string() }),
  z.object({ type: z.literal("founded"), crew: CrewTagSchema }),
  z.object({ type: z.literal("joined"), name: z.string() }),
  z.object({ type: z.literal("declined"), name: z.string() }),
  z.object({ type: z.literal("left"), name: z.string() }),
  z.object({ type: z.literal("removed"), name: z.string(), by: z.string() }),
  /** The viewer was put out of the crew. */
  z.object({ type: z.literal("dismissed"), crewName: z.string(), by: z.string() }),
  z.object({ type: z.literal("rank"), name: z.string(), rank: CrewRankSchema }),
  z.object({ type: z.literal("flag"), by: z.string() }),
  /** Crewmates set sail; the viewer may still catch them at sea. */
  z.object({ type: z.literal("sailed"), names: z.array(z.string()).min(1), shipId: Id, shipName: z.string(), to: Id, joinable: z.boolean() }),
  /** A ship with crewmates aboard beat a brigand. */
  z.object({ type: z.literal("victory"), names: z.array(z.string()).min(1), shipName: z.string(), tierId: Id, booty: z.int().min(0) }),
]);
export type CrewNotice = z.infer<typeof CrewNoticeSchema>;

/** Another pirate, as a tap on their name shows them. Raw ratings are never sent, only tiers. */
export const PirateProfileSchema = z.object({
  pirateId: Id,
  name: z.string(),
  crew: CrewTagSchema.extend({ rank: CrewRankSchema }).nullable(),
  ratings: z.array(RatingViewSchema),
  /** Voyages that reached port with them aboard. */
  voyages: z.int().min(0),
  /** Brigands beaten with them aboard. */
  victories: z.int().min(0).default(0),
  /** What they wear on deck, and the title they show; null from a server that does not say. */
  look: PirateLookWireSchema.nullable().default(null),
  title: ContentIdSchema.nullable().default(null),
  online: z.boolean(),
  /** Whether the viewer has invited them to the viewer's crew and is waiting. */
  invited: z.boolean(),
});
export type PirateProfile = z.infer<typeof PirateProfileSchema>;

/** Names are words: letters, digits, spaces, apostrophes and hyphens. Length is content's to set. */
export const CrewNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(64).regex(/^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u));
