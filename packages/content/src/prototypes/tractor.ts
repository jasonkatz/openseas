import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const TractorContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(4).max(10),
    height: z.int().min(4).max(12),
    /** Kinds of loot. The board draws the first `kinds` of its pieces. */
    kinds: z.int().min(3).max(8),
    /** A run of n pieces scores runPoints * n * n. */
    runPoints: z.int().min(0),
    /** What each wave of one swap multiplies by, in percent; the last entry holds. */
    cascadePercent: z.array(z.int().min(100)).min(1),
    startCaches: z.int().min(0),
    cachePermille: z.int().min(0).max(500),
    maxCaches: z.int().min(0),
    /** Every cache hauled in one swap counts together: k caches score cachePoints * k * k. */
    cachePoints: z.int().min(0),
    /** A beacon drifts in after every this many scoring swaps. 0: no beacons. */
    beaconEvery: z.int().min(0),
    sweepPoints: z.int().min(0),
    maxMoves: z.int().min(1),
  }),
});
export type TractorContent = z.infer<typeof TractorContentSchema>;
