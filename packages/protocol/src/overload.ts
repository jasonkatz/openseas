import { z } from "zod";

export const OverloadMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type OverloadMoveWire = z.infer<typeof OverloadMoveSchema>;

export const OverloadConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type OverloadConfigWire = z.infer<typeof OverloadConfigSchema>;
