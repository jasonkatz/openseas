import { z } from "zod";

export const CuttingMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type CuttingMoveWire = z.infer<typeof CuttingMoveSchema>;

export const CuttingConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type CuttingConfigWire = z.infer<typeof CuttingConfigSchema>;
