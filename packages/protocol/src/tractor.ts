import { z } from "zod";

const Cell = z.int().min(0).max(119);

export const TractorMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), cell: Cell }),
  z.object({ type: z.literal("end") }),
]);
export type TractorMoveWire = z.infer<typeof TractorMoveSchema>;

export const TractorConfigSchema = z.object({
  width: z.int().min(4).max(10).describe("Columns on the field."),
  height: z.int().min(4).max(12).describe("Rows on the field. The top row is the hatch, where caches are hauled."),
  kinds: z.int().min(3).max(8).describe("Kinds of loot in the deal: more makes runs harder to find."),
  runPoints: z.int().min(0).max(1000).describe("Points a run earns, multiplied by its length squared."),
  cascadePercent: z
    .array(z.int().min(100).max(1000))
    .min(1)
    .max(16)
    .describe("Percent each wave of one swap multiplies its points by, an entry a wave. The last entry holds, so a lucky cascade is capped."),
  startCaches: z.int().min(0).max(10).describe("Caches on the opening field, in its lower half."),
  cachePermille: z.int().min(0).max(500).describe("Chance, per mille, that a piece drifting in is a cache, while the field holds fewer than its most."),
  maxCaches: z.int().min(0).max(10).describe("The most caches on the field at once. 0 with no start caches: no caches."),
  cachePoints: z.int().min(0).max(100_000).describe("Points for the caches hauled in one swap, multiplied by their number squared."),
  beaconEvery: z.int().min(0).max(1000).describe("A beacon drifts in after every this many scoring swaps. 0 deals none."),
  sweepPoints: z.int().min(0).max(10_000).describe("Points for each piece of loot a beacon sweeps aboard outside a run."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type TractorConfigWire = z.infer<typeof TractorConfigSchema>;
