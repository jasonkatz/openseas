import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const CuttingContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(2).max(8),
    height: z.int().min(2).max(8),
    /** Kinds of ore. The board draws the first `ores` placeholder kinds. */
    ores: z.int().min(2).max(8),
    /** Blocks the first slab is dealt from; one more every `growEvery` slabs, up to `partsMax`. */
    partsStart: z.int().min(2),
    partsMax: z.int().min(2),
    /** Flaws on the first slab; one more every two steps of growth, up to `flawsMax`. */
    flawsStart: z.int().min(0),
    flawsMax: z.int().min(0),
    growEvery: z.int().min(1),
    /** The largest block of one ore a slab may hold, as a share of the slab in percent; a slab with a bigger one is dealt again. */
    maxBlockPercent: z.int().min(10).max(100),
    /** A slab gets the fewest cuts with which the best plan banks this share, in percent, of what an unlimited torch could. */
    budgetPercent: z.int().min(1).max(100),
    minCuts: z.int().min(1).max(12),
    maxCuts: z.int().min(1).max(12),
    /** A pure piece of area a banks for cellPoints * a * a. */
    cellPoints: z.int().min(1),
    /** A slab that banked this share of its best, in percent, is clean; all of it is flawless. */
    cleanPercent: z.int().min(1).max(100),
    cleanBonus: z.int().min(0),
    flawlessBonus: z.int().min(0),
    /** What the streak of clean and flawless slabs multiplies the bonus by, in percent; past the end, the last entry. */
    streakPercent: z.array(z.int().min(100)).min(1),
    maxMoves: z.int().min(1),
  }),
});
export type CuttingContent = z.infer<typeof CuttingContentSchema>;
