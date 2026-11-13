import { z } from "zod";

export const TugMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flick"), pod: z.int().min(0).max(4), dir: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("skip") }),
  z.object({ type: z.literal("end") }),
]);
export type TugMoveWire = z.infer<typeof TugMoveSchema>;

export const TugConfigSchema = z.object({
  width: z.int().min(4).max(10).describe("Columns in the bay."),
  height: z.int().min(4).max(10).describe("Rows in the bay."),
  pods: z.int().min(2).max(5).describe("Cargo pods in the bay."),
  blocks: z.int().min(0).max(16).describe("Fixed blocks in the bay that stop a sliding pod; fewer are placed if they do not fit."),
  startPar: z.int().min(1).max(4).describe("Par of the first clamp, and the lowest par any clamp is dealt at."),
  maxPar: z.int().min(1).max(4).describe("The highest par a clamp is dealt at: raise it for harder clamps late in a round."),
  cleanPerStep: z.int().min(1).max(20).describe("Clean deliveries it takes to raise the next clamp's par by one; a slow one or a skip takes one back."),
  parPoints: z.array(z.int().min(0).max(100_000)).min(1).max(8).describe("Points a delivery is worth by its clamp's par: the first entry is par 1."),
  cleanPercent: z.int().min(100).max(1000).describe("Percent a clean delivery, one made within par, multiplies its points by."),
  slack: z.int().min(0).max(20).describe("A delivery within this many flicks over par still scores in full; beyond it the delivery is slow."),
  slowPercent: z.int().min(0).max(100).describe("Percent of its points a slow delivery scores."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak of clean deliveries multiplies a clean one by; a streak past the end takes the last."),
  skipPenalty: z.int().min(0).max(100_000).describe("Points lost when a clamp is skipped."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest log of flicks and skips the server accepts: the round ends there."),
});
export type TugConfigWire = z.infer<typeof TugConfigSchema>;
