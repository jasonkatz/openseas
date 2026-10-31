import { z } from "zod";

export const BilgingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), col: z.int().min(0).max(15), row: z.int().min(0).max(31) }),
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
});
export type BilgingConfigWire = z.infer<typeof BilgingConfigSchema>;
