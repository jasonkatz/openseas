import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const DeflectorsContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type DeflectorsContent = z.infer<typeof DeflectorsContentSchema>;
