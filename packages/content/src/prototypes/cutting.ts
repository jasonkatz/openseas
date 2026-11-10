import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const CuttingContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type CuttingContent = z.infer<typeof CuttingContentSchema>;
