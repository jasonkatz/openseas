import { z } from "zod";

export const EnginesMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), col: z.int().min(0).max(15), row: z.int().min(0).max(31), rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("end") }),
]);
export type EnginesMoveWire = z.infer<typeof EnginesMoveSchema>;

export const EnginesConfigSchema = z.object({
  width: z.int().min(4).max(16).describe("Columns in the drive core."),
  height: z.int().min(8).max(32).describe("Rows in the drive core."),
  pieceKinds: z.int().min(2).max(8).describe("How many kinds of fuel pellet the round deals."),
  injectorsAtOnce: z.int().min(0).max(8).describe("Injectors kept on the board at once."),
  injectorSpanMin: z.int().min(1).max(16).describe("Shortest horizontal bar an injector is dealt as, in cells."),
  injectorSpanMax: z.int().min(1).max(16).describe("Longest horizontal bar an injector is dealt as, in cells."),
  injectorPoints: z.int().min(0).max(1000).describe("Points for each target when an injector fires."),
  runPoints: z.int().min(0).max(1000).describe("Points for each pellet beyond three in a cleared run."),
  maxMoves: z.int().min(1).max(10_000).describe("Pairs placed before the round ends: a bound that only keeps the move log a sane size."),
  flameoutPenalty: z.int().min(0).max(10_000).describe("Points lost when the core fills to the top and is cleared; the score never drops below zero."),
  chainMultipliers: z.array(z.int().min(1).max(1000)).min(1).max(16).describe("What each step of a chain multiplies its points by; steps past the end take the last entry."),
});
export type EnginesConfigWire = z.infer<typeof EnginesConfigSchema>;
