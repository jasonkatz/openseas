import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const ReactorContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type ReactorContent = z.infer<typeof ReactorContentSchema>;
