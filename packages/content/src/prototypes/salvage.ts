import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const SalvageContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(3).max(12),
    height: z.int().min(3).max(12),
    /** Kinds of debris. The board draws the first `kinds` placeholder pieces. */
    kinds: z.int().min(2).max(8),
    minLine: z.int().min(2).max(5),
    /** A line of n pieces scores linePoints * n * n. */
    linePoints: z.int().min(0),
    /** The fewest pieces a line needs before it may close into a loop. */
    loopMin: z.int().min(3).max(12),
    /** What closing a loop multiplies the line's points by, in percent. */
    loopPercent: z.int().min(100),
    enclosedPoints: z.int().min(0),
    startCrates: z.int().min(0),
    cratePermille: z.int().min(0).max(500),
    maxCrates: z.int().min(0),
    crateFloorPoints: z.int().min(0),
    /** A loop nets every crate on the field: k crates score crateLoopPoints * k * k between them. */
    crateLoopPoints: z.int().min(0),
    couplerPermille: z.int().min(0).max(500),
    maxCouplers: z.int().min(0),
    streakMin: z.int().min(2),
    streakPercent: z.array(z.int().min(100)).min(1),
    maxMoves: z.int().min(1),
  }),
});
export type SalvageContent = z.infer<typeof SalvageContentSchema>;
