import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import type { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const SalvageContentSchema = PrototypeBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.salvage,
});
export type SalvageContent = z.infer<typeof SalvageContentSchema>;
