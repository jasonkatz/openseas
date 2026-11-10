import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const OverloadContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type OverloadContent = z.infer<typeof OverloadContentSchema>;
