import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const DeflectorsContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    /** The grid is size by size, with a port at each end of every row and column. */
    size: z.int().min(3).max(10),
    /** Mirrors on the grid. They are dealt once and never move. */
    mirrors: z.int().min(1).max(100),
    /** The most beams in a volley. The board has a sign for each of three. */
    maxBeams: z.int().min(1).max(3),
    /** A volley gets one more beam every rampTicks, up to maxBeams. */
    rampTicks: z.int().min(1),
    /** A volley is dealt exits whose best setting is worth at least what this many turns a beam would score. */
    minBest: z.int().min(0).max(64),
    /** A beam out through its exit after b turns scores bouncePoints * (b + 1) * (b + 1), b counted up to bounceCap. */
    bouncePoints: z.int().min(0),
    bounceCap: z.int().min(1).max(64),
    /** What a perfect volley is multiplied by, in percent. */
    perfectPercent: z.int().min(100),
    /** Lost for every beam that leaves by the wrong port. */
    hullPenalty: z.int().min(0),
    /** What the streak of clean volleys multiplies a clean volley by, in percent. */
    streakPercent: z.array(z.int().min(100)).min(1).max(16),
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
    openingTicks: z.int().min(0),
    /** Ticks a volley waits before it fires, at the start of the round and by the end. */
    chargeTicks: z.int().min(1),
    chargeTicksMin: z.int().min(1),
    /** Ticks more for every beam in the volley after the first. */
    beamTicks: z.int().min(0),
    /** Ticks from a volley firing to the next being dealt. */
    respawnTicks: z.int().min(0),
  }),
});
export type DeflectorsContent = z.infer<typeof DeflectorsContentSchema>;
