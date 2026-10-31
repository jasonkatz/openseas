import { z } from "zod";

export const SailingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), col: z.int().min(0).max(15), rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("end") }),
]);
export type SailingMoveWire = z.infer<typeof SailingMoveSchema>;

export const SailingConfigSchema = z.object({
  width: z.int().min(4).max(16),
  height: z.int().min(8).max(32),
  pieceKinds: z.int().min(2).max(8),
  platformsAtOnce: z.int().min(0).max(6),
  platformSpanMin: z.int().min(1).max(16),
  platformSpanMax: z.int().min(1).max(16),
  platformPoints: z.int().min(0).max(1000),
  runPoints: z.int().min(0).max(1000),
  maxMoves: z.int().min(1).max(10_000),
  topOutPenalty: z.int().min(0).max(10_000),
});
export type SailingConfigWire = z.infer<typeof SailingConfigSchema>;
