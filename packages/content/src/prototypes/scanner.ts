import { PUZZLE_CONFIG_SCHEMAS } from "@openseas/protocol";
import type { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const ScannerContentSchema = PrototypeBaseSchema.extend({
  config: PUZZLE_CONFIG_SCHEMAS.scanner,
});
export type ScannerContent = z.infer<typeof ScannerContentSchema>;
