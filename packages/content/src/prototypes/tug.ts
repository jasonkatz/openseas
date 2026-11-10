import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const TugContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(4).max(10),
    height: z.int().min(4).max(10),
    /** Cargo pods in the bay. The board draws pod n as the kit's kind n. */
    pods: z.int().min(2).max(5),
    /** Fixed blocks, off the walls and never touching one another. */
    blocks: z.int().min(0).max(16),
    /** The par of the first clamp and the lowest any is dealt at; the highest; and the clean deliveries a step up takes. */
    startPar: z.int().min(1).max(4),
    maxPar: z.int().min(1).max(4),
    cleanPerStep: z.int().min(1),
    /** What a delivery is worth by its par: entry par - 1. */
    parPoints: z.array(z.int().min(0)).min(1),
    /** What delivering at par multiplies by, in percent. */
    cleanPercent: z.int().min(100),
    /** A delivery within this many flicks over par scores in full; slower scores slowPercent. */
    slack: z.int().min(0),
    slowPercent: z.int().min(0).max(100),
    streakPercent: z.array(z.int().min(100)).min(1),
    skipPenalty: z.int().min(0),
    maxMoves: z.int().min(1),
  }),
});
export type TugContent = z.infer<typeof TugContentSchema>;
