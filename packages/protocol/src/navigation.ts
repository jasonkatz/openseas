import { z } from "zod";

export const NavigationMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rotate"), ring: z.int().min(0).max(5), dir: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal("drop") }),
  z.object({ type: z.literal("end") }),
]);
export type NavigationMoveWire = z.infer<typeof NavigationMoveSchema>;

export const NavigationConfigSchema = z.object({
  rings: z.int().min(1).max(6),
  octants: z.int().min(3).max(16),
  shapes: z.int().min(1).max(6),
  colors: z.int().min(1).max(8),
  startStars: z.int().min(1).max(96),
  maxStars: z.int().min(1).max(96),
  reuseChancePercent: z.int().min(0).max(100),
  starPoints: z.int().min(0).max(10_000),
  efficiencyBonus: z.int().min(0).max(10_000),
  boochPenalty: z.int().min(0).max(10_000),
  maxDrops: z.int().min(1).max(100_000),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type NavigationConfigWire = z.infer<typeof NavigationConfigSchema>;
