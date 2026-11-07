import { z } from "zod";

export const BilgingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), col: z.int().min(0).max(15), row: z.int().min(0).max(31) }),
  /** The ship's bilge, injected into a duty board's log by the ship's turns (DESIGN.md 3.3). */
  z.object({ type: z.literal("water"), row: z.int().min(0).max(32) }),
  z.object({ type: z.literal("end") }),
]);
export type BilgingMoveWire = z.infer<typeof BilgingMoveSchema>;

export const BilgingConfigSchema = z.object({
  width: z.int().min(3).max(16),
  height: z.int().min(3).max(32),
  pieceKinds: z.int().min(3).max(12),
  specialChancePerMille: z.object({
    keg: z.int().min(0).max(1000),
    ink: z.int().min(0).max(1000),
    barnacle: z.int().min(0).max(1000),
  }),
  initialWaterRow: z.int().min(0).max(32),
  minWaterRow: z.int().min(0).max(32),
  waterRisePerMoves: z.int().min(1),
  waterDropPerPoints: z.int().min(1),
  maxMoves: z.int().min(1).max(10_000),
  /** True when the water is a ship's bilge (a duty board's, or a harness round's lone ship); false keeps the board's own. */
  shipWater: z.boolean().default(false),
  cascadeMultipliers: z.array(z.int().min(1).max(100)).min(1).max(16),
  streakStepPercent: z.int().min(0).max(1000),
  streakMaxPercent: z.int().min(100).max(1000),
  streakGrace: z.int().min(0).max(16),
});
export type BilgingConfigWire = z.infer<typeof BilgingConfigSchema>;
