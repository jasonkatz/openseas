import { z } from "zod";

export const ScannerMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("end") })]);
export type ScannerMoveWire = z.infer<typeof ScannerMoveSchema>;

export const ScannerConfigSchema = z.object({
  maxMoves: z.int().min(1).max(1_000_000),
});
export type ScannerConfigWire = z.infer<typeof ScannerConfigSchema>;
