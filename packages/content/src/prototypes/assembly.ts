import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const AssemblyContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(4).max(10),
    height: z.int().min(4).max(12),
    /** How often each kind is dealt and drawn in a blueprint: panel, girder, strut, cable. */
    kindWeights: z.array(z.int().min(0).max(100)).length(4),
    traySize: z.int().min(1).max(8),
    /** How often a new blueprint has three, four or five parts. */
    sizeWeights: z.array(z.int().min(0).max(100)).length(3),
    /** A fit of n parts scores fitPoints * (n - 2) * its place in the chain. */
    fitPoints: z.int().min(0),
    /** The place in a chain counts up to this. 1: no chains. */
    chainCap: z.int().min(1),
    corePoints: z.int().min(0),
    startCores: z.int().min(0),
    corePermille: z.int().min(0).max(500),
    maxCores: z.int().min(0),
    maxMoves: z.int().min(1),
  }),
});
export type AssemblyContent = z.infer<typeof AssemblyContentSchema>;
