import { z } from "zod";

const Cell = z.int().min(0).max(99);

export const ScannerMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), cell: Cell }),
  z.object({ type: z.literal("lock"), cell: Cell }),
  z.object({ type: z.literal("end") }),
]);
export type ScannerMoveWire = z.infer<typeof ScannerMoveSchema>;

export const ScannerConfigSchema = z.object({
  width: z.int().min(3).max(10),
  height: z.int().min(3).max(10),
  startContacts: z.int().min(1).max(12),
  growEvery: z.int().min(1).max(100),
  maxContacts: z.int().min(1).max(12),
  parBase: z.int().min(0).max(100),
  parPerContact: z.int().min(0).max(20),
  openingMin: z.int().min(0).max(6),
  dealTries: z.int().min(1).max(50),
  contactPoints: z.int().min(0).max(100_000),
  savePoints: z.int().min(0).max(100_000),
  overPenalty: z.int().min(0).max(100_000),
  wrongPenalty: z.int().min(0).max(100_000),
  spookPenalty: z.int().min(0).max(100_000),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type ScannerConfigWire = z.infer<typeof ScannerConfigSchema>;
