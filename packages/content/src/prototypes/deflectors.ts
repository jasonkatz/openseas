import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const DeflectorsContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    /** The grid is size by size, with a port at each end of every row and column. */
    size: z.int().min(3).max(10),
    /** Mirrors on the grid. A spent mirror is replaced, so there are always this many. */
    mirrors: z.int().min(1).max(100),
    /** Lenses on the grid, of the three kinds in turn. They are never spent. */
    lenses: z.int().min(0).max(99),
    /** Beams in every volley. The board has a sign for each of three. */
    beams: z.int().min(1).max(3),
    /** The most lenses a beam's recipe asks for; 0 turns recipes off. */
    recipeLenses: z.int().min(0).max(3),
    /** What each lens in a beam's recipe adds to its points, in percent. */
    lensPercent: z.int().min(0),
    /** Mirrors a fired beam turned at are spent and the grid refills from the top. */
    spend: z.boolean(),
    /** A volley is dealt exits whose best setting is worth at least what this many turns a beam would score. */
    minBest: z.int().min(0).max(64),
    /** A beam home after b turns scores bouncePoints * (b + 1) * (b + 1), b counted up to bounceCap, before its lenses. */
    bouncePoints: z.int().min(0),
    bounceCap: z.int().min(1).max(64),
    /** What a perfect volley is multiplied by, in percent. */
    perfectPercent: z.int().min(100),
    /** Lost for every beam that is not home. */
    hullPenalty: z.int().min(0),
    /** What the streak of clean volleys multiplies a clean volley by, in percent. */
    streakPercent: z.array(z.int().min(100)).min(1).max(16),
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
    openingTicks: z.int().min(0),
    /** Ticks from a volley firing to the next being dealt. */
    respawnTicks: z.int().min(0),
  }),
});
export type DeflectorsContent = z.infer<typeof DeflectorsContentSchema>;
