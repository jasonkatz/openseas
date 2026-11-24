import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const ForgingContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(4).max(9),
    height: z.int().min(4).max(9),
    /** Strikes a spot takes before it is set. */
    blows: z.int().min(1).max(5),
    jumps: z.boolean(),
    far: z.boolean(),
    sparks: z.boolean(),
    /** One weight a mark: one, two, three, four, rail, slant, star, hook. */
    weights: z.array(z.int().min(0)).length(8),
    preview: z.int().min(0).max(6),
    strikePoints: z.int().min(0),
    chainPoints: z.int().min(0),
    chainCap: z.int().min(1),
    /** A count or a span. 0: no sets. */
    setPoints: z.int().min(0),
    weaveCap: z.int().min(1),
    stallCost: z.int().min(0),
    maxMoves: z.int().min(1),
  }),
});
export type ForgingContent = z.infer<typeof ForgingContentSchema>;
