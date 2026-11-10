import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import type { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const CuttingContentSchema = PrototypeBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.cutting,
});
export type CuttingContent = z.infer<typeof CuttingContentSchema>;
