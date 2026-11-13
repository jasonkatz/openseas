import { z } from "zod";

export const CuttingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cut"), piece: z.int().min(1).max(10_000_000), vertical: z.boolean(), at: z.int().min(1).max(7) }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("end") }),
]);
export type CuttingMoveWire = z.infer<typeof CuttingMoveSchema>;

export const CuttingConfigSchema = z.object({
  width: z.int().min(2).max(8).describe("Columns in the slab."),
  height: z.int().min(2).max(8).describe("Rows in the slab."),
  ores: z.int().min(2).max(8).describe("Kinds of ore a slab is dealt from."),
  partsStart: z.int().min(2).max(64).describe("Blocks of ore the first slab is dealt from; more blocks make a busier slab."),
  partsMax: z.int().min(2).max(64).describe("The most blocks a slab is ever dealt from."),
  flawsStart: z.int().min(0).max(64).describe("Flaws, single cells of another ore, scattered on the first slab."),
  flawsMax: z.int().min(0).max(64).describe("The most flaws a slab is ever dealt; one is added every two steps of growth."),
  growEvery: z.int().min(1).max(1000).describe("Slabs finished between one step of growth, a block more per slab, and the next."),
  maxBlockPercent: z.int().min(10).max(100).describe("Largest block of one ore a slab may hold, as a percent of the slab; a bigger one is dealt again."),
  budgetPercent: z.int().min(1).max(100).describe("A slab gets the fewest cuts whose best plan banks this percent of the most it could; higher means more cuts."),
  minCuts: z.int().min(1).max(12).describe("Fewest cuts a slab is given."),
  maxCuts: z.int().min(1).max(12).describe("Most cuts a slab is given."),
  cellPoints: z.int().min(1).max(1000).describe("A piece of one ore banks this times its area squared."),
  cleanPercent: z.int().min(1).max(100).describe("A slab that banks at least this percent of its best is clean; banking all of it is flawless."),
  cleanBonus: z.int().min(0).max(100_000).describe("Bonus points for a clean slab, before the streak."),
  flawlessBonus: z.int().min(0).max(100_000).describe("Bonus points for a flawless slab, before the streak."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak of clean and flawless slabs multiplies the bonus by; a streak past the end takes the last."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts: the round ends there."),
});
export type CuttingConfigWire = z.infer<typeof CuttingConfigSchema>;
