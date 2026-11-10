import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import type { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const RacksContentSchema = PrototypeBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.racks,
});
export type RacksContent = z.infer<typeof RacksContentSchema>;
