import { z } from "zod";

const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, "ids are lowercase kebab-case");
const MessageKey = z.string().regex(/^[a-z][a-z0-9_.]*$/, "message keys are dotted snake_case");

export const IslandSchema = z.object({
  id: Id,
  /** Message-table key for the island's display name. */
  nameKey: MessageKey,
  /** Position on the ocean chart, in abstract chart units. */
  x: z.number(),
  y: z.number(),
  /** Which buildings this island has. v1 islands all have the same three. */
  buildings: z.array(z.enum(["dock", "tavern", "notice-board"])).min(1),
});

export const RouteLegSchema = z.object({
  id: Id,
  from: Id,
  to: Id,
  /** Sailing time for the leg in seconds. DESIGN.md 3.5 wants 3 to 5 minutes. */
  durationSeconds: z.int().min(30).max(1800),
  /** Chance per leg of a brigand encounter, 0..1. */
  encounterChance: z.number().min(0).max(1),
  /** Brigand tiers that may spawn on this leg, weighted. */
  brigands: z.array(z.object({ tierId: Id, weight: z.int().min(1) })),
});

export const BrigandTierSchema = z.object({
  id: Id,
  nameKey: MessageKey,
  shipClassId: Id,
  /** Difficulty knobs consumed by the sea battle AI at M4. */
  movesPerTurn: z.int().min(1).max(4),
  accuracy: z.number().min(0).max(1),
  aggression: z.number().min(0).max(1),
  /** Booty paid out on a win, in coins, before the duty-weighted split. */
  booty: z.int().min(0),
});

export const ShipClassSchema = z.object({
  id: Id,
  nameKey: MessageKey,
  /** Stations aboard. Unstaffed stations produce nothing. */
  stations: z.array(z.enum(["bilging", "sailing", "carpentry", "gunnery", "navigation"])),
  maxCrew: z.int().min(1).max(60),
  hull: z.int().min(1),
  cannons: z.int().min(0),
  /** Movement token pool size per sea battle turn at full sailing output. */
  baseTokens: z.int().min(1),
  /** Shipyard price in coins. The only way to acquire a ship (ADR 0010). */
  price: z.int().min(0),
});

/** Zero-cost grants go through the same shipyard purchase path as paid ships (ADR 0010). */
export const ShipGrantSchema = z.object({
  id: Id,
  shipClassId: Id,
  /** Price actually charged for this grant. 0 for the starter sloop. */
  price: z.int().min(0),
  /** All requirements must hold. Add fields here, never code, to gate the grant later. */
  requires: z.object({
    voyagesCompleted: z.int().min(0),
    /** Minimum rating tier key in any one puzzle, or null for none. */
    minTier: z.string().nullable(),
  }),
  /** Grant at most once per pirate. */
  once: z.boolean(),
  /** Granted automatically at pirate creation, or only on request at a shipyard. */
  automatic: z.boolean(),
});

export const RatingTierSchema = z.object({
  key: z.string(),
  nameKey: MessageKey,
  min: z.number(),
});

export const BilgingContentSchema = z.object({
  config: z.object({
    width: z.int().min(3),
    height: z.int().min(3),
    pieceKinds: z.int().min(3).max(12),
    specialChancePerMille: z.object({ keg: z.int().min(0), ink: z.int().min(0), barnacle: z.int().min(0) }),
    initialWaterRow: z.int().min(0),
    waterRisePerMoves: z.int().min(1),
    waterDropPerPoints: z.int().min(1),
    maxMoves: z.int().min(1),
  }),
  /** Wall-clock length of a practice round, enforced by the server. */
  roundSeconds: z.int().min(10).max(1800),
  /** Performance thresholds the round is rated against (DESIGN.md 3.6). Calibrated from testers. */
  thresholds: z.array(z.object({ score: z.int().min(0), rating: z.number() })).min(1),
  /**
   * Each ordinary piece kind, index = kind. Tiles are colored squares; `mark` names the symbol
   * drawn inside the tile when the player turns marks on, so kinds stay distinguishable without
   * color (rule 6).
   */
  pieces: z
    .array(z.object({ nameKey: MessageKey, mark: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/) }))
    .min(3),
  specials: z.object({
    keg: z.object({ nameKey: MessageKey, color: z.string() }),
    ink: z.object({ nameKey: MessageKey, color: z.string() }),
    barnacle: z.object({ nameKey: MessageKey, color: z.string() }),
  }),
});

export const NamesSchema = z.object({
  adjectives: z.array(z.string().min(2)).min(20),
  nouns: z.array(z.string().min(2)).min(20),
});

export const MessagesSchema = z.record(MessageKey, z.string());

export const WorldSchema = z.object({
  version: z.int().min(1),
  islands: z.array(IslandSchema).min(1),
  routes: z.array(RouteLegSchema),
  brigandTiers: z.array(BrigandTierSchema),
  shipClasses: z.array(ShipClassSchema).min(1),
  shipGrants: z.array(ShipGrantSchema),
});

export type Island = z.infer<typeof IslandSchema>;
export type RouteLeg = z.infer<typeof RouteLegSchema>;
export type BrigandTier = z.infer<typeof BrigandTierSchema>;
export type ShipClass = z.infer<typeof ShipClassSchema>;
export type ShipGrant = z.infer<typeof ShipGrantSchema>;
export type RatingTier = z.infer<typeof RatingTierSchema>;
export type BilgingContent = z.infer<typeof BilgingContentSchema>;
export type World = z.infer<typeof WorldSchema>;
