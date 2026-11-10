import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const OverloadContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(3).max(10),
    height: z.int().min(3).max(10),
    /** How likely a fresh capacitor is to hold 0, 1, 2 or 3 charges, as weights. */
    refill: z.array(z.int().min(0)).length(4),
    /** Chance, per thousand, that a fresh capacitor is a booster. */
    boosterPermille: z.int().min(0).max(500),
    /** A chain of n bursts scores burstPoints * n * n, and burstPoints * n * chainCap past the cap. */
    burstPoints: z.int().min(0),
    chainCap: z.int().min(1),
    /** A chain this long builds the streak; a shorter one breaks it. */
    streakMin: z.int().min(1),
    streakPercent: z.array(z.int().min(100)).min(1),
    /** The most taps held, and how many the round opens with. */
    tapCap: z.int().min(1).max(12),
    startTaps: z.int().min(0).max(12),
    /** Ticks for one tap to come back. */
    tapRegenTicks: z.int().min(1),
    /** A chain gives one tap back for every this many bursts; 0 gives none. */
    refundEvery: z.int().min(0),
    tickMs: z.int().min(20).max(5000),
    maxTick: z.int().min(1),
    maxMoves: z.int().min(1),
  }),
});
export type OverloadContent = z.infer<typeof OverloadContentSchema>;
