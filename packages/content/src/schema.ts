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
  waterIntakePerTurn: z.int().min(0).max(1000),
  waterIntakeAtFullDamage: z.int().min(0).max(1000),
  pumpPerTurn: z.int().min(0).max(1000),
  wearPerTurn: z.int().min(0).max(1000),
  repairPerTurn: z.int().min(0).max(1000),
  idleSpeed: z.int().min(0).max(10_000),
  sailSpeed: z.int().min(0).max(10_000),
  navSpeed: z.int().min(0).max(10_000),
  maxSpeed: z.int().min(0).max(10_000),
  waterSlow: z.int().min(0).max(1000),
  damageSlow: z.int().min(0).max(1000),
  loadPerTurn: z.int().min(0).max(100_000),
  navTokens: z.int().min(0).max(100),
  maxOutputPercent: z.int().min(100).max(10_000),
  graceTurns: z.int().min(0).max(100_000),
  hailTurns: z.int().min(1).max(100_000),
  encounterWindow: z.object({ from: z.int().min(0).max(1000), to: z.int().min(0).max(1000) }),
});

/** The ocean itself: the content version, where new pirates start, and how ships behave at sea. */
export const OceanSchema = z.object({
  version: z.int().min(1),
  /** Where every new pirate, and their starter ship, begins. */
  startIslandId: Id,
  ship: ShipRulesSchema,
});

/** Fields every duty puzzle's content file has. */
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

export const BilgingContentSchema = DutyPuzzleBaseSchema.extend({
  config: z.object({
    width: z.int().min(3),
    height: z.int().min(3),
    pieceKinds: z.int().min(3).max(12),
    specialChancePerMille: z.object({ keg: z.int().min(0), ink: z.int().min(0), barnacle: z.int().min(0) }),
    initialWaterRow: z.int().min(0),
    minWaterRow: z.int().min(0),
    waterRisePerMoves: z.int().min(1),
    waterDropPerPoints: z.int().min(1),
    maxMoves: z.int().min(1),
  }),
  /**
   * How long a swap below the water line takes to settle, in ms. The board takes no other swap
   * until it lands, so working underwater costs time. Client timing only; scores are unaffected.
   */
  underwaterSwapMs: z.int().min(0).max(5000),
  pieces: z.array(PieceStyleSchema).min(3),
  specials: z.object({
    keg: z.object({ nameKey: MessageKey, color: z.string() }),
    ink: z.object({ nameKey: MessageKey, color: z.string() }),
    barnacle: z.object({ nameKey: MessageKey, color: z.string() }),
  }),
});

/** Sailing pieces are discs with their own surfaces, so they never read as Bilging tiles. */
export const SailPieceStyleSchema = z.object({
  nameKey: MessageKey,
  mark: z.string(),
  texture: z.enum(["weave", "coil", "ripple", "speckle"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});

export const SailingContentSchema = DutyPuzzleBaseSchema.extend({
  config: z.object({
    width: z.int().min(4).max(16),
    height: z.int().min(8).max(32),
    pieceKinds: z.int().min(2).max(8),
    platformsAtOnce: z.int().min(0).max(8),
    platformSpanMin: z.int().min(1),
    platformSpanMax: z.int().min(1),
    platformPoints: z.int().min(0),
    runPoints: z.int().min(0),
    maxMoves: z.int().min(1),
    topOutPenalty: z.int().min(0),
  }),
  /** Ms per row a pair falls on its own. Client timing only; the move log carries landings. */
  fallMs: z.int().min(50).max(5000),
  /** Ms per row while the player hurries the pair (a held swipe on touch, space on a keyboard); a tenth of fallMs. */
  softDropMs: z.int().min(10).max(5000),
  pieces: z.array(SailPieceStyleSchema).min(2),
});

export const CarpentryContentSchema = DutyPuzzleBaseSchema.extend({
  config: z.object({
    width: z.int().min(5).max(20),
    height: z.int().min(5).max(24),
    pieceKinds: z.int().min(1).max(8),
    holesAtOnce: z.int().min(1).max(6),
    minHolePieces: z.int().min(1).max(6),
    maxHolePieces: z.int().min(1).max(6),
    basePerCell: z.number().min(0),
    multiplierPercent: z.object({
      masterpiece: z.number().min(0),
      craftsmanship: z.number().min(0),
      fair: z.number().min(0),
      sloppy: z.number().min(0),
      pig: z.number().min(0),
    }),
    grainBonusPercent: z.number().min(0),
    growAfterMoves: z.int().min(1),
    maxMoves: z.int().min(1),
  }),
  /** Wood kinds planks come in. Cosmetic: shape tells planks apart; wood adds variety. */
  pieces: z.array(PieceStyleSchema).min(1),
  /** Display names for the twelve pentominoes, index = engine shape. */
  shapes: z.array(z.object({ nameKey: MessageKey })).length(12),
});

export const GunneryContentSchema = DutyPuzzleBaseSchema.extend({
  config: z.object({
    /**
     * The decks a round may be played on; the seed picks one. One string per row: # wall,
     * . plank, X crate, B chute, C cannon, H hatch. The engine checks at startup that each has no
     * loop built in, a stream that leaves, and every gun within reach.
     */
    decks: z
      .array(
        z
          .array(z.string().regex(/^[#.XBCH]+$/, "deck rows use # . X B C H"))
          .min(5)
          .superRefine((rows, ctx) => {
            const width = rows[0]!.length;
            if (rows.some((r) => r.length !== width)) ctx.addIssue({ code: "custom", message: "deck rows must be the same width" });
            const all = rows.join("");
            const count = (ch: string): number => all.split(ch).length - 1;
            if (count("C") !== 4) ctx.addIssue({ code: "custom", message: "deck needs exactly four cannons" });
            if (count("B") !== 1) ctx.addIssue({ code: "custom", message: "deck needs exactly one chute" });
          }),
      )
      .min(1)
      .superRefine((decks, ctx) => {
        const [w, h] = [decks[0]![0]!.length, decks[0]!.length];
        if (decks.some((d) => d.length !== h || d[0]!.length !== w)) ctx.addIssue({ code: "custom", message: "every deck must be the same size" });
      }),
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
    maxOnDeck: z.int().min(1),
    spawnEveryTicks: z.int().min(1),
    spawnEveryTicksMin: z.int().min(1),
    queueLength: z.int().min(0).max(8),
    /** Pieces per refill of the chute's shuffled bag: powder, wad, shot, water. */
    bag: z.array(z.int().min(0)).length(4),
    fireAfterTicks: z.int().min(1),
    stepPoints: z.int().min(0),
    loadPoints: z.int().min(0),
    comboStep: z.int().min(0),
    comboCap: z.int().min(0),
    /** Points when every gun has fired since the last broadside. */
    broadsidePoints: z.int().min(0),
  }),
  /** Powder, wad, shot, water, in that order (the engine's kind numbers). */
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
  config: z.object({
    rings: z.int().min(1).max(6),
    octants: z.int().min(3).max(16),
    shapes: z.int().min(1).max(6),
    colors: z.int().min(1).max(8),
    startStars: z.int().min(1),
    maxStars: z.int().min(1),
    reuseChancePercent: z.int().min(0).max(100),
    starPoints: z.int().min(0),
    efficiencyBonus: z.int().min(0),
    /** A run of n loose stars of a kind scores runPoints * (n - 2). */
    runPoints: z.int().min(0),
    boochPenalty: z.int().min(0),
    /** Wall-clock ms per tick on the client; the server bounds claimed ticks with it. */
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
    /** Ticks a star takes to fall at the start of the round, and by the end. */
    fallTicks: z.int().min(1),
    fallTicksMin: z.int().min(1),
  }),
  colors: z.array(StarColorSchema).min(1),
  shapes: z.array(StarShapeSchema).min(1),
});

export const NamesSchema = z.object({
  adjectives: z.array(z.string().min(2)).min(20),
  nouns: z.array(z.string().min(2)).min(20),
});

export const MessagesSchema = z.record(MessageKey, z.string());

export const WorldSchema = OceanSchema.extend({
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
export type ShipRules = z.infer<typeof ShipRulesSchema>;
export type Ocean = z.infer<typeof OceanSchema>;
export type PieceStyle = z.infer<typeof PieceStyleSchema>;
export type SailPieceStyle = z.infer<typeof SailPieceStyleSchema>;
export type BilgingContent = z.infer<typeof BilgingContentSchema>;
export type SailingContent = z.infer<typeof SailingContentSchema>;
export type CarpentryContent = z.infer<typeof CarpentryContentSchema>;
export type GunneryContent = z.infer<typeof GunneryContentSchema>;
export type NavigationContent = z.infer<typeof NavigationContentSchema>;
export type StarColor = z.infer<typeof StarColorSchema>;
export type StarShape = z.infer<typeof StarShapeSchema>;
export type World = z.infer<typeof WorldSchema>;
