import { z } from "zod";

const Rack = z.int().min(0).max(7);

export const RacksMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), from: Rack, to: Rack }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("end") }),
]);
export type RacksMoveWire = z.infer<typeof RacksMoveSchema>;

export const RacksConfigSchema = z.object({
  racks: z.int().min(3).max(8),
  height: z.int().min(3).max(8),
  /** Kinds of cell. The board draws the first `kinds` placeholder pieces. */
  kinds: z.int().min(2).max(8),
  startCells: z.int().min(0).max(56),
  crateMin: z.int().min(1).max(8),
  crateMax: z.int().min(1).max(8),
  crateMixPercent: z.int().min(0).max(100),
  landEvery: z.int().min(1).max(20),
  bagCopies: z.int().min(1).max(8),
  shipPoints: z.int().min(0).max(100_000),
  chainWindow: z.int().min(1).max(20),
  chainPercent: z.array(z.int().min(100).max(2000)).min(1).max(16),
  spillPenalty: z.int().min(0).max(100_000),
  markRoom: z.boolean(),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type RacksConfigWire = z.infer<typeof RacksConfigSchema>;
