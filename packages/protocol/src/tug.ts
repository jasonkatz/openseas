import { z } from "zod";

export const TugMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type TugMoveWire = z.infer<typeof TugMoveSchema>;

export const TugConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type TugConfigWire = z.infer<typeof TugConfigSchema>;
