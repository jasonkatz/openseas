import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const RacksContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type RacksContent = z.infer<typeof RacksContentSchema>;
