import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import type { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const DeflectorsContentSchema = PrototypeBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.deflectors,
});
export type DeflectorsContent = z.infer<typeof DeflectorsContentSchema>;
