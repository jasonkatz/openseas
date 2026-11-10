import { z } from "zod";
import { PrototypeBaseSchema } from "./base.js";

export const ScannerContentSchema = PrototypeBaseSchema.extend({
  config: z.object({
    width: z.int().min(3).max(10),
    height: z.int().min(3).max(10),
    /** Contacts in the first sector; one more every growEvery sectors cleared, up to maxContacts. */
    startContacts: z.int().min(1).max(12),
    growEvery: z.int().min(1),
    maxContacts: z.int().min(1).max(12),
    /** A sector of k contacts allows parBase + parPerContact * k pings. */
    parBase: z.int().min(0),
    parPerContact: z.int().min(0),
    /** How far from every contact the opening ping is made, at least. 0 deals none. */
    openingMin: z.int().min(0).max(6),
    /** Deals a sector gets before one the plain arguments cannot clear is kept. */
    dealTries: z.int().min(1).max(50),
    contactPoints: z.int().min(0),
    /** Each ping left over when a sector is cleared clean. */
    savePoints: z.int().min(0),
    overPenalty: z.int().min(0),
    wrongPenalty: z.int().min(0),
    spookPenalty: z.int().min(0),
    streakPercent: z.array(z.int().min(100)).min(1),
    maxMoves: z.int().min(1),
  }),
});
export type ScannerContent = z.infer<typeof ScannerContentSchema>;
