import { z } from "zod";

export const PlatingMoveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place"),
    slot: z.int().min(0).max(2),
    rot: z.int().min(0).max(3),
    flip: z.boolean(),
    col: z.int().min(0).max(31),
    row: z.int().min(0).max(31),
  }),
  z.object({ type: z.literal("end") }),
]);
export type PlatingMoveWire = z.infer<typeof PlatingMoveSchema>;

const Percent = z.number().min(0).max(10_000);

export const PlatingConfigSchema = z.object({
  width: z.int().min(5).max(20),
  height: z.int().min(5).max(24),
  pieceKinds: z.int().min(1).max(8),
  breachesAtOnce: z.int().min(1).max(6),
  minBreachPieces: z.int().min(1).max(6),
  maxBreachPieces: z.int().min(1).max(6),
  basePerCell: z.number().min(0).max(1000),
  multiplierPercent: z.object({ flawless: Percent, solid: Percent, holds: Percent, tape: Percent, gum: Percent }),
  brushBonusPercent: Percent,
  growAfterMoves: z.int().min(1).max(1000),
  maxMoves: z.int().min(1).max(10_000),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
});
export type PlatingConfigWire = z.infer<typeof PlatingConfigSchema>;
