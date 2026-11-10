import { z } from "zod";

export const TugMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flick"), pod: z.int().min(0).max(4), dir: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("skip") }),
  z.object({ type: z.literal("end") }),
]);
export type TugMoveWire = z.infer<typeof TugMoveSchema>;

export const TugConfigSchema = z.object({
  width: z.int().min(4).max(10),
  height: z.int().min(4).max(10),
  pods: z.int().min(2).max(5),
  blocks: z.int().min(0).max(16),
  startPar: z.int().min(1).max(4),
  maxPar: z.int().min(1).max(4),
  cleanPerStep: z.int().min(1).max(20),
  parPoints: z.array(z.int().min(0).max(100_000)).min(1).max(8),
  cleanPercent: z.int().min(100).max(1000),
  slack: z.int().min(0).max(20),
  slowPercent: z.int().min(0).max(100),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  skipPenalty: z.int().min(0).max(100_000),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type TugConfigWire = z.infer<typeof TugConfigSchema>;
