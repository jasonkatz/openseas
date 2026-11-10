import { z } from "zod";

const Cell = z.int().min(0).max(143);

export const SalvageMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tether"), cells: z.array(Cell).min(2).max(144), loop: z.boolean() }),
  z.object({ type: z.literal("end") }),
]);
export type SalvageMoveWire = z.infer<typeof SalvageMoveSchema>;

export const SalvageConfigSchema = z.object({
  width: z.int().min(3).max(12),
  height: z.int().min(3).max(12),
  /** Kinds of debris. The board draws the first `kinds` placeholder pieces. */
  kinds: z.int().min(2).max(8),
  minLine: z.int().min(2).max(5),
  linePoints: z.int().min(0).max(1000),
  loopMin: z.int().min(3).max(12),
  loopPercent: z.int().min(100).max(1000),
  enclosedPoints: z.int().min(0).max(10_000),
  startCrates: z.int().min(0).max(12),
  cratePermille: z.int().min(0).max(500),
  maxCrates: z.int().min(0).max(12),
  crateFloorPoints: z.int().min(0).max(100_000),
  crateLoopPoints: z.int().min(0).max(100_000),
  couplerPermille: z.int().min(0).max(500),
  maxCouplers: z.int().min(0).max(8),
  streakMin: z.int().min(2).max(20),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type SalvageConfigWire = z.infer<typeof SalvageConfigSchema>;
