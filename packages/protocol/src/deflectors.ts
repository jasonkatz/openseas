import { z } from "zod";

export const DeflectorsMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type DeflectorsMoveWire = z.infer<typeof DeflectorsMoveSchema>;

export const DeflectorsConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type DeflectorsConfigWire = z.infer<typeof DeflectorsConfigSchema>;
