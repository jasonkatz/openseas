import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const TugContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type TugContent = z.infer<typeof TugContentSchema>;
