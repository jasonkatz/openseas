import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const ReactorContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    /** The core is size by size. */
    size: z.int().min(3).max(8),
    /** The grade that is hot: it fuses with nothing and must go out through a port. */
    hotGrade: z.int().min(3).max(9),
    /** Ports open on the rim at once. */
    ports: z.int().min(1).max(8),
    /** This many hot rods in the core at once and it scrams. */
    criticalHot: z.int().min(2),
    startRods: z.int().min(1),
    /** Chance, per thousand, that the next rod to enter is grade 2 instead of grade 1. */
    twoPermille: z.int().min(0).max(1000),
    /** What fusing into each grade scores: grade 2 first, the hot grade last. */
    fusePoints: z.array(z.int().min(0)).min(2),
    dischargePoints: z.int().min(0),
    /** What one, two, three rods out in one swipe multiply that swipe's discharges by, in percent. */
    salvoPercent: z.array(z.int().min(100)).min(1),
    /** A discharge within this many swipes of the last keeps the pipeline's run going. */
    pipelineSwipes: z.int().min(1),
    /** What the pipeline multiplies a discharge by, in percent; past the end, the last entry (the cap). */
    pipelinePercent: z.array(z.int().min(100)).min(1),
    scramPenalty: z.int().min(0),
    maxMoves: z.int().min(1),
  }),
});
export type ReactorContent = z.infer<typeof ReactorContentSchema>;
