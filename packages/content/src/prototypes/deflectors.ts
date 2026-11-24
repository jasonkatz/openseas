import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const DeflectorsContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    /** The grid is size by size, with a port at each end of every row and column. */
    size: z.int().min(3).max(10),
    /** Emitters on the left edge, spread down it. The board has a mark for each. */
    emitters: z.int().min(1).max(10),
    /** Targets on the top, right and bottom edges, dealt at the start. */
    targets: z.int().min(1).max(8),
    /** Mirrors on the grid at the start, set at random. */
    mirrors: z.int().min(0).max(100),
    /** Lenses on the grid at the start, of the three kinds in turn. */
    lenses: z.int().min(0).max(99),
    /** How often a recipe asks for no lens, one, two and so on, as weights. One entry turns recipes off. */
    recipeWeights: z.array(z.int().min(0)).min(1).max(4),
    /** What each lens in a target's recipe adds to a beam's points, in percent. */
    lensPercent: z.int().min(0),
    /** A beam lighting a target after b turns scores bouncePoints * (b + 1) * (b + 1), b counted up to bounceCap, before its lenses. */
    bouncePoints: z.int().min(0),
    bounceCap: z.int().min(1).max(64),
    /** What a shot is multiplied by, in percent, for one target lit, two, and so on: one entry an emitter. */
    litPercent: z.array(z.int().min(0)).min(1).max(10),
    /** Mirrors a fired beam turned at, and lenses a lighting beam passed, leave the grid. */
    spend: z.boolean(),
    /** Pieces the round deals, placed or binned. */
    pieces: z.int().min(1).max(1000),
    /** How many pieces the queue shows ahead. */
    queueSize: z.int().min(1).max(8),
    /** How often a piece is a lens, in percent. */
    lensChance: z.int().min(0).max(100),
    /** Ticks after a shot before the emitters can fire again. */
    fireTicks: z.int().min(0),
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
  }),
});
export type DeflectorsContent = z.infer<typeof DeflectorsContentSchema>;
