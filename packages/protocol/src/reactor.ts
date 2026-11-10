import { z } from "zod";

export const ReactorMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type ReactorMoveWire = z.infer<typeof ReactorMoveSchema>;

export const ReactorConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type ReactorConfigWire = z.infer<typeof ReactorConfigSchema>;
