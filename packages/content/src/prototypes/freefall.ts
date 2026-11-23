import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

const Bays = z.array(z.int().min(0).max(1000)).min(2).max(6);

export const FreefallContentSchema = PrototypeBaseSchema.extend({
  config: z
    .object({
      /** Lanes across the shaft; even, since the berths mirror. */
      width: z.int().min(4).max(12),
      rows: z.int().min(2).max(10),
      gapPermille: z.int().min(0).max(600),
      /** Points a side must reach within each of the four legs. */
      quotas: z.array(z.int().min(1)).length(4),
      /** Each leg's berth values from the middle lane outward, width / 2 entries. */
      bays: z.object({ first: Bays, second: Bays, third: Bays, fourth: Bays }),
      squareClusters: z.boolean(),
      rival: z.boolean(),
      rivalSkill: z.int().min(0).max(100),
      maxMoves: z.int().min(1),
    })
    .refine((c) => c.width % 2 === 0, "width is even")
    .refine((c) => [c.bays.first, c.bays.second, c.bays.third, c.bays.fourth].every((b) => b.length === c.width / 2), "each leg lists width / 2 berths"),
});
export type FreefallContent = z.infer<typeof FreefallContentSchema>;
