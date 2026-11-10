import { z } from "zod";

export const ReactorMoveSchema = z.discriminatedUnion("type", [
  /** 0 up, 1 right, 2 down, 3 left. */
  z.object({ type: z.literal("swipe"), dir: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("end") }),
]);
export type ReactorMoveWire = z.infer<typeof ReactorMoveSchema>;

export const ReactorConfigSchema = z.object({
  size: z.int().min(3).max(8),
  hotGrade: z.int().min(3).max(9),
  ports: z.int().min(1).max(8),
  criticalHot: z.int().min(2).max(64),
  startRods: z.int().min(1).max(63),
  twoPermille: z.int().min(0).max(1000),
  fusePoints: z.array(z.int().min(0).max(100_000)).min(2).max(8),
  dischargePoints: z.int().min(0).max(100_000),
  salvoPercent: z.array(z.int().min(100).max(2000)).min(1).max(8),
  pipelineSwipes: z.int().min(1).max(1000),
  pipelinePercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  scramPenalty: z.int().min(0).max(100_000),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type ReactorConfigWire = z.infer<typeof ReactorConfigSchema>;
