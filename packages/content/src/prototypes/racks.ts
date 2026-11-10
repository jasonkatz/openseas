import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const RacksContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    racks: z.int().min(3).max(8),
    /** Cells a rack holds: a rack ships when it holds this many of one kind. */
    height: z.int().min(3).max(8),
    /** Kinds of cell. The board draws the first `kinds` placeholder pieces. */
    kinds: z.int().min(2).max(8),
    startCells: z.int().min(0),
    crateMin: z.int().min(1).max(8),
    crateMax: z.int().min(1).max(8),
    /** Chance in a hundred that a crate's next cell is drawn afresh; otherwise it repeats the one under it. */
    crateMixPercent: z.int().min(0).max(100),
    /** Moves a crate hangs before it lands by itself. */
    landEvery: z.int().min(1).max(20),
    bagCopies: z.int().min(1).max(8),
    shipPoints: z.int().min(0),
    /** A shipment this many actions or fewer after the last carries the chain on. */
    chainWindow: z.int().min(1).max(20),
    chainPercent: z.array(z.int().min(100)).min(1),
    spillPenalty: z.int().min(0),
    /** False marks any rack for a crate, a full one too. True keeps the mark to racks with room. */
    markRoom: z.boolean(),
    maxMoves: z.int().min(1),
  }),
});
export type RacksContent = z.infer<typeof RacksContentSchema>;
