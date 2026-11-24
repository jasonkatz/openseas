import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const PactContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    hands: z.int().min(1).max(50),
    trickValue: z.int().min(0).max(1000),
    bagValue: z.int().min(0).max(1000),
    /** 0 turns nil off. */
    nilBonus: z.int().min(0).max(10_000),
    /** 0: bags never cost. */
    bagLimit: z.int().min(0).max(100),
    bagPenalty: z.int().min(0).max(10_000),
    setBonus: z.int().min(0).max(1000),
    seatLean: z.int().min(-50).max(50),
    handSeconds: z.int().min(10).max(900),
    maxMoves: z.int().min(1),
  }),
});
export type PactContent = z.infer<typeof PactContentSchema>;
