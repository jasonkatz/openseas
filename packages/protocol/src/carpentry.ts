import { z } from "zod";

export const CarpentryMoveSchema = z.discriminatedUnion("type", [
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
export type CarpentryMoveWire = z.infer<typeof CarpentryMoveSchema>;

const Percent = z.number().min(0).max(10_000);

export const CarpentryConfigSchema = z.object({
  width: z.int().min(5).max(20),
  height: z.int().min(5).max(24),
  pieceKinds: z.int().min(1).max(8),
  holesAtOnce: z.int().min(1).max(6),
  minHolePieces: z.int().min(1).max(6),
  maxHolePieces: z.int().min(1).max(6),
  basePerCell: z.number().min(0).max(1000),
  multiplierPercent: z.object({ masterpiece: Percent, craftsmanship: Percent, fair: Percent, sloppy: Percent, pig: Percent }),
  grainBonusPercent: Percent,
  growAfterMoves: z.int().min(1).max(1000),
  maxMoves: z.int().min(1).max(10_000),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
});
export type CarpentryConfigWire = z.infer<typeof CarpentryConfigSchema>;
