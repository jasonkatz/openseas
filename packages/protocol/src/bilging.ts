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
  /** True for a duty board aboard a ship: the water is the ship's bilge. Practice boards keep their own. */
  shipWater: z.boolean().default(false),
});
export type BilgingConfigWire = z.infer<typeof BilgingConfigSchema>;
