import { z } from "zod";

export const RacksMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type RacksMoveWire = z.infer<typeof RacksMoveSchema>;

export const RacksConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type RacksConfigWire = z.infer<typeof RacksConfigSchema>;
