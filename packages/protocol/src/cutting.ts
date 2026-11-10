import { z } from "zod";

export const CuttingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cut"), piece: z.int().min(1).max(10_000_000), vertical: z.boolean(), at: z.int().min(1).max(7) }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("end") }),
]);
export type CuttingMoveWire = z.infer<typeof CuttingMoveSchema>;

export const CuttingConfigSchema = z.object({
  width: z.int().min(2).max(8),
  height: z.int().min(2).max(8),
  ores: z.int().min(2).max(8),
  partsStart: z.int().min(2).max(64),
  partsMax: z.int().min(2).max(64),
  flawsStart: z.int().min(0).max(64),
  flawsMax: z.int().min(0).max(64),
  growEvery: z.int().min(1).max(1000),
  maxBlockPercent: z.int().min(10).max(100),
  budgetPercent: z.int().min(1).max(100),
  minCuts: z.int().min(1).max(12),
  maxCuts: z.int().min(1).max(12),
  cellPoints: z.int().min(1).max(1000),
  cleanPercent: z.int().min(1).max(100),
  cleanBonus: z.int().min(0).max(100_000),
  flawlessBonus: z.int().min(0).max(100_000),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type CuttingConfigWire = z.infer<typeof CuttingConfigSchema>;
