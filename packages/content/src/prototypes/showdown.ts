import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

const Play = z.object({ slack: z.int().min(-3000).max(3000), raiseAt: z.int().min(0).max(6000), bluff: z.int().min(0).max(1000) });

export const ShowdownContentSchema = PrototypeBaseSchema.extend({
  config: z
    .object({
      rivals: z.int().min(1).max(5),
      hands: z.int().min(1).max(200),
      /** Chips the player sits down with; the score is what they stand up with. */
      bank: z.int().min(0).max(100_000),
      smallBlind: z.int().min(0).max(1000),
      bigBlind: z.int().min(1).max(1000),
      smallBet: z.int().min(1).max(1000),
      bigBet: z.int().min(1).max(1000),
      raiseCap: z.int().min(1).max(8),
      /** The rival styles dealt from, one a seat. */
      styles: z.array(z.enum(["brick", "sponge", "hothead", "shark"])).min(1).max(12),
      play: z.object({ brick: Play, sponge: Play, hothead: Play, shark: Play }),
      samples: z.int().min(1).max(2000),
      maxMoves: z.int().min(1),
    })
    .refine((c) => c.smallBlind <= c.bigBlind, "the small blind is no more than the big")
    .refine((c) => c.styles.length >= c.rivals, "at least one style a rival"),
});
export type ShowdownContent = z.infer<typeof ShowdownContentSchema>;
