import { z } from "zod";

export const EnginesMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), col: z.int().min(0).max(15), row: z.int().min(0).max(31), rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("end") }),
]);
export type EnginesMoveWire = z.infer<typeof EnginesMoveSchema>;

export const EnginesConfigSchema = z.object({
  width: z.int().min(4).max(16),
  height: z.int().min(8).max(32),
  pieceKinds: z.int().min(2).max(8),
  injectorsAtOnce: z.int().min(0).max(8),
  injectorSpanMin: z.int().min(1).max(16),
  injectorSpanMax: z.int().min(1).max(16),
  injectorPoints: z.int().min(0).max(1000),
  runPoints: z.int().min(0).max(1000),
  maxMoves: z.int().min(1).max(10_000),
  flameoutPenalty: z.int().min(0).max(10_000),
  chainMultipliers: z.array(z.int().min(1).max(1000)).min(1).max(16),
});
export type EnginesConfigWire = z.infer<typeof EnginesConfigSchema>;
