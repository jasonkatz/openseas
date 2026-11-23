import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const RefiningContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(3).max(10),
    height: z.int().min(3).max(10),
    /** Chance, per thousand, that fresh feed is vapour, and that it is oil; the rest is tar. */
    vapourPermille: z.int().min(1).max(1000),
    oilPermille: z.int().min(0).max(1000),
    /** Chance, per thousand, that fresh feed is a catalyst instead. 0: none. */
    catalystPermille: z.int().min(0).max(300),
    /** The k-th clear column of a run pays clearPoints * k, k capped at runCap. */
    clearPoints: z.int().min(0),
    runCap: z.int().min(1).max(50),
    smoothPoints: z.int().min(0),
    catalystPoints: z.int().min(0),
    /** Each tar or smoke in a rising column costs this. */
    foulPoints: z.int().min(0),
    /** Every this many vapour spilled come back as one smoke. 0: none does. */
    smokeEvery: z.int().min(0).max(100),
    /** Ticks between the clock's draws. */
    pulseTicks: z.int().min(5),
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
  }),
});
export type RefiningContent = z.infer<typeof RefiningContentSchema>;
