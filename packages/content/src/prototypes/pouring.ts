import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const PouringContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    size: z.int().min(5).max(9),
    /** Kinds of glass. The board draws the first `glasses` of its glasses. */
    glasses: z.int().min(2).max(6),
    /** Kinds of brew. The board draws the first `brews` of its brews. */
    brews: z.int().min(2).max(6),
    offer: z.int().min(1).max(3),
    rivals: z.int().min(0).max(3),
    rivalSkill: z.int().min(0).max(100),
    pourPoints: z.int().min(0),
    agePoints: z.int().min(0),
    ageMax: z.int().min(0),
    ringPoints: z.int().min(0),
    /** k lines served by one pour score linePoints * k * k. */
    linePoints: z.int().min(0),
    cleanPercent: z.int().min(100).max(400),
    tolerance: z.int().min(1).max(6),
    soberAfter: z.int().min(1).max(10),
    icePerBag: z.int().min(0).max(6),
    ragsPerBag: z.int().min(0).max(6),
    lastCall: z.int().min(4).max(60),
    maxMoves: z.int().min(1),
  }),
});
export type PouringContent = z.infer<typeof PouringContentSchema>;
