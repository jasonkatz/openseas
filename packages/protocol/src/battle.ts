import { z } from "zod";

const Count = z.int().min(0).max(32);
const Permille = z.int().min(0).max(1000);

export const BattleSegmentSchema = z.object({
  move: z.enum(["left", "forward", "right"]).nullable(),
  port: z.boolean(),
  starboard: z.boolean(),
});
export type BattleSegmentWire = z.infer<typeof BattleSegmentSchema>;

export const BattleMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("commit"), segments: z.array(BattleSegmentSchema).max(8), grapple: z.boolean() }),
  /** Aboard only: the ship's deal for the turn, as the server announced it. */
  z.object({ type: z.literal("supply"), left: Count, forward: Count, right: Count, turrets: Count, hull: Permille }),
  /** The captain breaks off the fight. */
  z.object({ type: z.literal("end") }),
]);
export type BattleMoveWire = z.infer<typeof BattleMoveSchema>;

export const BattleSupplySchema = z.object({ left: Count, forward: Count, right: Count, turrets: Count });

export const BattleRaiderSchema = z.object({
  turrets: Count,
  tokensPerTurn: Count,
  reloadPerTurn: Count,
  accuracy: z.int().min(0).max(100),
  aggression: z.int().min(0).max(100),
  startDamage: z.int().min(0).max(999),
});

/** One board, a string per row. Its shape is checked here; the engine's `boardProblems` checks the rest. */
const BoardSchema = z
  .array(z.string().regex(/^[.#^>v<@AB]+$/, "board rows use . # ^ > v < @ A B").min(5).max(32))
  .min(5)
  .max(32)
  .superRefine((rows, ctx) => {
    const width = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== width)) ctx.addIssue({ code: "custom", message: "board rows must be the same width" });
    const all = rows.join("");
    if (all.split("A").length !== 2) ctx.addIssue({ code: "custom", message: "a board needs exactly one A" });
    if (all.split("B").length !== 2) ctx.addIssue({ code: "custom", message: "a board needs exactly one B" });
  });

export const BattleConfigSchema = z.object({
  boards: z.array(BoardSchema).min(1).max(32),
  segments: z.int().min(1).max(8),
  turnSeconds: z.int().min(3).max(600),
  tokenCap: z.int().min(1).max(32),
  turretRange: z.int().min(1).max(16),
  shotDamage: Permille,
  asteroidDamage: Permille,
  ramDamage: Permille,
  grappleDamage: Permille,
  maxTurns: z.int().min(1).max(200),
  turrets: Count,
  startLoaded: Count,
  startDamage: z.int().min(0).max(999),
  supply: BattleSupplySchema.nullable(),
  /** The practice raider. Aboard, the encounter's tier replaces it. */
  raider: BattleRaiderSchema,
  hitPoints: z.int().min(0).max(1_000_000),
  hitTakenPoints: z.int().min(0).max(1_000_000),
  scorePercent: z.int().min(1).max(1000),
  winPoints: z.int().min(0).max(1_000_000),
  turnBonus: z.int().min(0).max(1_000_000),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type BattleConfigWire = z.infer<typeof BattleConfigSchema>;

/** How a fight ended, from the captain's side. */
export const BattleOutcomeSchema = z.enum(["boarded", "crippled", "boarded_by", "crippled_by", "broke_off", "disengaged"]);
export type BattleOutcomeWire = z.infer<typeof BattleOutcomeSchema>;
