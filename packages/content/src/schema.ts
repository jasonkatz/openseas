import { z } from "zod";
import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";

const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, "ids are lowercase kebab-case");
const MessageKey = z.string().regex(/^[a-z][a-z0-9_.]*$/, "message keys are dotted snake_case");

export const OutpostSchema = z.object({
  id: Id,
  /** Message-table key for the outpost's display name. */
  nameKey: MessageKey,
  /** Position on the star system chart, in abstract chart units. */
  x: z.number(),
  y: z.number(),
  /** Which buildings this outpost has. v1 outposts all have the same three. */
  buildings: z.array(z.enum(["dock", "cantina", "notice-board"])).min(1),
  /** The landmark the chart draws on the outpost, so each reads apart at a glance. */
  landmark: z.enum(["beacon", "dish", "geyser", "fort", "none"]).default("none"),
  /** Message-table key for the outpost card's one-line description. */
  blurbKey: MessageKey,
});

export const LaneLegSchema = z.object({
  id: Id,
  from: Id,
  to: Id,
  /** Flight time for the leg in seconds. DESIGN.md 3.5 wants 3 to 5 minutes. */
  durationSeconds: z.int().min(30).max(1800),
  /** Chance per leg of a raider encounter, 0..1. */
  encounterChance: z.number().min(0).max(1),
  /** Raider tiers that may spawn on this leg, weighted. */
  raiders: z.array(z.object({ tierId: Id, weight: z.int().min(1) })),
});

export const RaiderTierSchema = z.object({
  id: Id,
  nameKey: MessageKey,
  shipClassId: Id,
  /** Difficulty knobs the space battle's raider AI runs on (DESIGN.md 3.3). */
  movesPerTurn: z.int().min(1).max(8),
  /** Turrets the raider reloads each turn of a fight. */
  reloadPerTurn: z.int().min(0).max(32),
  accuracy: z.number().min(0).max(1),
  aggression: z.number().min(0).max(1),
  /** Plunder paid out on a win, in credits, before the duty-weighted split. */
  plunder: z.int().min(0),
  /**
   * How much a fight against this tier is worth, in percent: the space battle's turn points and the
   * melee's attack rate are scaled by it, so a harder raider rates higher (DESIGN.md 3.3).
   */
  scorePercent: z.int().min(1).max(1000),
  /** The raider crew at the airlock when a boarding happens (M5): one board per pirate aboard, each with this hand. */
  swordsmen: z.object({
    thinkTicks: z.int().min(1).max(10_000),
    skill: z.int().min(0).max(100),
    /** Index into the swordfight content's blades. */
    blade: z.int().min(0).max(15),
  }),
});

export const ShipClassSchema = z.object({
  id: Id,
  nameKey: MessageKey,
  /** Stations aboard. Unstaffed stations produce nothing. */
  stations: z.array(z.enum(["cooling", "engines", "plating", "gunnery", "navigation"])),
  maxCrew: z.int().min(1).max(60),
  /**
   * The crew the ship flies with at the least (DESIGN.md 3.4). Launching with fewer aboard
   * boots up bots, AI crew, to make up the number; they are powered down when the ship docks.
   */
  minCrew: z.int().min(0).max(60),
  /** The stations bots work, in order of preference. Never the nav console: that is a pirate's call. */
  botStations: z.array(z.enum(["cooling", "engines", "plating", "gunnery"])),
  hull: z.int().min(1),
  turrets: z.int().min(0),
  /** Movement token pool size per space battle turn at full engines output. */
  baseTokens: z.int().min(1),
  /** Shipyard price in credits. The only way to acquire a ship (ADR 0010). */
  price: z.int().min(0),
});

/** Zero-cost grants go through the same shipyard purchase path as paid ships (ADR 0010). */
export const ShipGrantSchema = z.object({
  id: Id,
  shipClassId: Id,
  /** Price actually charged for this grant. 0 for the starter skiff. */
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

/** Shape and color of one ordinary piece kind, index = kind. Tiles are colored squares, each with
 * its own surface `texture`; `mark` names the symbol drawn inside when the player turns marks on,
 * so kinds stay distinguishable without color (rule 6). */
export const PieceStyleSchema = z.object({
  nameKey: MessageKey,
  mark: z.string(),
  texture: z.enum(["knurl", "fan", "waves", "grain", "nacre", "fronds", "pores"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});

/** The ship simulation's tuning. Mirrors the engine's ShipRules; the engine validates it again. */
export const ShipRulesSchema = z.object({
  turnSeconds: z.int().min(1).max(600),
  heatIntakePerTurn: z.int().min(0).max(1000),
  heatIntakeAtFullDamage: z.int().min(0).max(1000),
  ventPerTurn: z.int().min(0).max(1000),
  wearPerTurn: z.int().min(0).max(1000),
  repairPerTurn: z.int().min(0).max(1000),
  idleSpeed: z.int().min(0).max(10_000),
  driveSpeed: z.int().min(0).max(10_000),
  navSpeed: z.int().min(0).max(10_000),
  maxSpeed: z.int().min(0).max(10_000),
  heatSlow: z.int().min(0).max(1000),
  damageSlow: z.int().min(0).max(1000),
  loadPerTurn: z.int().min(0).max(100_000),
  navTokens: z.int().min(0).max(100),
  /** Each station's turn output is clamped to its own percent of par (ADR 0030). */
  outputCapPercent: z.object({
    cooling: z.int().min(100).max(10_000),
    engines: z.int().min(100).max(10_000),
    plating: z.int().min(100).max(10_000),
    gunnery: z.int().min(100).max(10_000),
    navigation: z.int().min(100).max(10_000),
  }),
  graceTurns: z.int().min(0).max(100_000),
  hailTurns: z.int().min(1).max(100_000),
  encounterWindow: z.object({ from: z.int().min(0).max(1000), to: z.int().min(0).max(1000) }),
  /** A bot's output per turn, percent of par, rolled between these: a passable job, never a star turn. */
  botOutput: z.object({ min: z.int().min(0).max(10_000), max: z.int().min(0).max(10_000) }),
  /** Turns a bot relieved by a pirate waits before working another station. */
  botRestTurns: z.int().min(0).max(100_000),
});

/** The star system itself: the content version, where new pirates start, and how ships behave in flight. */
export const StarSystemSchema = z.object({
  version: z.int().min(1),
  /** Where every new pirate, and their starter ship, begins. */
  startOutpostId: Id,
  ship: ShipRulesSchema,
});

/**
 * Fields every duty puzzle's content file has. A puzzle's `config` is the protocol's wire schema for
 * it (ADR 0039): its bounds are declared there and in the engine's validator, never again here.
 * Content keeps what is its own: the round's length, par, thresholds, styles and message keys.
 */
export const DutyPuzzleBaseSchema = z.object({
  /** Wall-clock length of a practice round, enforced by the server. */
  roundSeconds: z.int().min(10).max(1800),
  /**
   * The score a steady, competent player makes in one practice round. Aboard a ship a station's
   * output each turn is its points as a percentage of this, scaled to the turn's length.
   */
  parScore: z.int().min(1),
  /** Performance thresholds the round is rated against (DESIGN.md 3.6). Calibrated from testers. */
  thresholds: z.array(z.object({ score: z.int().min(0), rating: z.number() })).min(1),
});

export const CoolingContentSchema = DutyPuzzleBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.cooling,
  /**
   * How long a swap below the heat line takes to settle, in ms. The board takes no other swap
   * until it lands, so working overheated costs time. Client timing only; scores are unaffected.
   */
  overheatSwapMs: z.int().min(0).max(5000),
  pieces: z.array(PieceStyleSchema).min(3),
  specials: z.object({
    charge: z.object({ nameKey: MessageKey, color: z.string() }),
    magnet: z.object({ nameKey: MessageKey, color: z.string() }),
    slag: z.object({ nameKey: MessageKey, color: z.string() }),
  }),
});

/** Engines pieces are pellets with their own surfaces, so they never read as Cooling tiles. */
export const EnginesPieceStyleSchema = z.object({
  nameKey: MessageKey,
  mark: z.string(),
  texture: z.enum(["weave", "coil", "ripple", "speckle"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});

export const EnginesContentSchema = DutyPuzzleBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.engines,
  /** Ms per row a pair falls on its own. Client timing only; the move log carries landings. */
  fallMs: z.int().min(50).max(5000),
  /** Ms per row while the player hurries the pair (a held swipe on touch, space on a keyboard); a tenth of fallMs. */
  softDropMs: z.int().min(10).max(5000),
  pieces: z.array(EnginesPieceStyleSchema).min(2),
});

export const PlatingContentSchema = DutyPuzzleBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.plating,
  /** Metal kinds plates come in. Cosmetic: shape tells plates apart; metal adds variety. */
  pieces: z.array(PieceStyleSchema).min(1),
  /** Display names for the twelve pentominoes, index = engine shape. */
  shapes: z.array(z.object({ nameKey: MessageKey })).length(12),
});

export const GunneryContentSchema = DutyPuzzleBaseSchema.extend({
  /**
   * The game's decks carry four turrets, two a side (DESIGN.md 3.3). That is content's rule, not the
   * wire's: the engine plays a deck with any number, so a lab deck may carry more or fewer.
   */
  config: PUZZLE_CONFIG_SCHEMAS.gunnery.superRefine((config, ctx) => {
    config.decks.forEach((rows, i) => {
      if (rows.join("").split("C").length !== 5) ctx.addIssue({ code: "custom", message: "deck needs exactly four turrets", path: ["decks", i] });
    });
  }),
  /** Cell, sabot, slug, coolant, in that order (the engine's kind numbers). */
  pieces: z.array(PieceStyleSchema).length(4),
});

/** Star styles: a kind is shape x color, so each axis is listed on its own. */
export const StarColorSchema = z.object({
  nameKey: MessageKey,
  /** Symbol drawn on the star when marks are on, so colors stay apart without color (rule 6). */
  mark: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});
export const StarShapeSchema = z.object({
  nameKey: MessageKey,
  shape: z.enum(["spark", "star", "comet"]),
});

export const NavigationContentSchema = DutyPuzzleBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.navigation,
  colors: z.array(StarColorSchema).min(1),
  shapes: z.array(StarShapeSchema).min(1),
});

/** The captain's space battle: not a duty board, so no par; rated against thresholds until there is a human opponent. */
export const BattleContentSchema = z.object({
  /** Wall-clock length of a practice fight, enforced by the server. Aboard, the fight runs on the ship's turns. */
  roundSeconds: z.int().min(10).max(1800),
  thresholds: z.array(z.object({ score: z.int().min(0), rating: z.number() })).min(1),
  config: PUZZLE_CONFIG_SCHEMAS.battle,
});

/** Swordfight blocks are beveled squares with their own surface per color, so they never read as Cooling tiles. */
export const SwordPieceStyleSchema = z.object({
  nameKey: MessageKey,
  mark: z.string(),
  texture: z.enum(["facet", "rivet", "scale", "hatch", "swirl", "rings"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});

/** The boarding fight: not a duty board, so no par; rated against thresholds until there is a human opponent (ADR 0022). */
export const SwordfightContentSchema = z.object({
  /** Wall-clock length of a practice fight, enforced by the server. Aboard, the melee has its own length. */
  roundSeconds: z.int().min(10).max(1800),
  /** A steady fighter's attack a minute: the melee counts in the plunder as duty turns at a pirate's rate against this (ADR 0030). */
  parRatePerMinute: z.int().min(1),
  thresholds: z.array(z.object({ score: z.int().min(0), rating: z.number() })).min(1),
  config: PUZZLE_CONFIG_SCHEMAS.swordfight,
  /** Ms per row while the player hurries the pair; free fall is fallTicks * tickMs a row. Client timing only. */
  softDropMs: z.int().min(10).max(5000),
  pieces: z.array(SwordPieceStyleSchema).min(3),
});

export const NamesSchema = z.object({
  adjectives: z.array(z.string().min(2)).min(20),
  nouns: z.array(z.string().min(2)).min(20),
  /** What a ship's bots are called, each with a unit number after it: "Gasket-7" (DESIGN.md 3.4). */
  bots: z.array(z.string().min(2)).min(6),
});

export const MessagesSchema = z.record(MessageKey, z.string());

const FlagPart = z.object({ id: Id, nameKey: MessageKey });

/** A crew's flag: a field color, an accent color for the pattern and emblem, a pattern and an emblem (DESIGN.md 3.7). */
export const CrewFlagSchema = z.object({ field: Id, accent: Id, pattern: Id, emblem: Id });

/**
 * Crews (M6): the social unit and the invite list (DESIGN.md 3.4, 3.7). What founding one costs, how
 * big one may grow, and the parts a flag is made of. Every emblem and pattern is a shape, so flags
 * read apart without color (rule 6).
 */
export const CrewRulesSchema = z.object({
  /** Credits the founder pays into nothing: the first sink in the economy. */
  foundingFee: z.int().min(0).max(1_000_000),
  maxMembers: z.int().min(2).max(500),
  /** Invitations a crew may have waiting at once. */
  maxInvites: z.int().min(1).max(500),
  name: z.object({ min: z.int().min(1).max(64), max: z.int().min(1).max(64) }),
  colors: z.array(FlagPart.extend({ hex: z.string().regex(/^#[0-9a-f]{6}$/) })).min(2),
  patterns: z.array(FlagPart).min(1),
  emblems: z.array(FlagPart).min(1),
  /** The flag a new crew is offered before its founder changes anything. */
  defaultFlag: CrewFlagSchema,
});

/** A pirate's look: a jacket color and a headgear, both ids from `pirates.json` (DESIGN.md 3.6). */
export const PirateLookSchema = z.object({ jacket: Id, headgear: Id });

/**
 * What a title asks of a pirate's record. Counts only ever grow; standing can fall, which is why an
 * earned title is kept once it is earned (ADR 0033). `start` titles are every pirate's from the first day.
 */
export const TitleRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  /** Voyages that reached port with the pirate aboard. */
  z.object({ kind: z.literal("voyages"), count: z.int().min(1).max(1_000_000) }),
  /** Voyages that reached port with the pirate as the captain who launched. */
  z.object({ kind: z.literal("captained"), count: z.int().min(1).max(1_000_000) }),
  /** Raiders beaten with the pirate aboard: each win's share of the purse is one. */
  z.object({ kind: z.literal("victories"), count: z.int().min(1).max(1_000_000) }),
  /** Credits of plunder the pirate has been paid, in all. */
  z.object({ kind: z.literal("plunder"), count: z.int().min(1).max(100_000_000) }),
  /** Standing at a puzzle at this rating tier or above. */
  z.object({ kind: z.literal("standing"), puzzle: Id, tier: Id }),
]);

export const TitleSchema = z.object({ id: Id, nameKey: MessageKey, requires: TitleRequirementSchema });

/**
 * A pirate's identity beyond the name (DESIGN.md 3.6): the jackets and headgear a pirate may wear on deck
 * and the titles a record earns. Every headgear is its own silhouette, so a look reads without color
 * (rule 6), and none of them is a bot's kerchief.
 */
export const PirateRulesSchema = z.object({
  jackets: z.array(FlagPart.extend({ hex: z.string().regex(/^#[0-9a-f]{6}$/) })).min(2),
  headgear: z.array(FlagPart).min(2),
  titles: z.array(TitleSchema).min(1),
});

export const WorldSchema = StarSystemSchema.extend({
  outposts: z.array(OutpostSchema).min(1),
  lanes: z.array(LaneLegSchema),
  raiderTiers: z.array(RaiderTierSchema),
  shipClasses: z.array(ShipClassSchema).min(1),
  shipGrants: z.array(ShipGrantSchema),
  crews: CrewRulesSchema,
  pirates: PirateRulesSchema,
});

export type Outpost = z.infer<typeof OutpostSchema>;
export type LaneLeg = z.infer<typeof LaneLegSchema>;
export type RaiderTier = z.infer<typeof RaiderTierSchema>;
export type ShipClass = z.infer<typeof ShipClassSchema>;
export type ShipGrant = z.infer<typeof ShipGrantSchema>;
export type RatingTier = z.infer<typeof RatingTierSchema>;
export type PieceStyle = z.infer<typeof PieceStyleSchema>;
export type EnginesPieceStyle = z.infer<typeof EnginesPieceStyleSchema>;
export type CoolingContent = z.infer<typeof CoolingContentSchema>;
export type EnginesContent = z.infer<typeof EnginesContentSchema>;
export type PlatingContent = z.infer<typeof PlatingContentSchema>;
export type GunneryContent = z.infer<typeof GunneryContentSchema>;
export type NavigationContent = z.infer<typeof NavigationContentSchema>;
export type BattleContent = z.infer<typeof BattleContentSchema>;
export type SwordfightContent = z.infer<typeof SwordfightContentSchema>;
export type SwordPieceStyle = z.infer<typeof SwordPieceStyleSchema>;
export type StarColor = z.infer<typeof StarColorSchema>;
export type StarShape = z.infer<typeof StarShapeSchema>;
export type World = z.infer<typeof WorldSchema>;
export type CrewRules = z.infer<typeof CrewRulesSchema>;
export type CrewFlag = z.infer<typeof CrewFlagSchema>;
export type PirateRules = z.infer<typeof PirateRulesSchema>;
export type PirateLook = z.infer<typeof PirateLookSchema>;
export type Title = z.infer<typeof TitleSchema>;
export type TitleRequirement = z.infer<typeof TitleRequirementSchema>;
export type ShipRules = z.infer<typeof ShipRulesSchema>;
export type StarSystem = z.infer<typeof StarSystemSchema>;
export type OutpostLandmark = Outpost["landmark"];
