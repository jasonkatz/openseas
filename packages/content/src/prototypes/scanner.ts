import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const ScannerContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    maxMoves: z.int().min(1),
  }),
});
export type ScannerContent = z.infer<typeof ScannerContentSchema>;
