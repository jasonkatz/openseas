import { z } from "zod";
import { ContentIdSchema } from "./common.js";

/**
 * The pirate's own sheet (DESIGN.md 3.6): what their record holds and how far along every title is.
 * Only the pirate sees their sheet; others see the card a tap on a name opens (`PirateProfileSchema`).
 */

/** What the records say a pirate has done. Every count only grows. */
export const PirateRecordSchema = z.object({
  /** When the pirate was made, server clock ms. */
  since: z.number(),
  /** Voyages that reached port with them aboard. */
  voyages: z.int().min(0),
  /** Of those, the ones they launched as captain. */
  captained: z.int().min(0),
  /** Raiders beaten with them aboard: a share of a purse each. */
  victories: z.int().min(0),
  /** Credits of plunder paid to them, in all. */
  plunder: z.int().min(0),
  /** Boards that moved their standing, every puzzle together. */
  boards: z.int().min(0),
});
export type PirateRecord = z.infer<typeof PirateRecordSchema>;

/**
 * One title and where the pirate stands against it. `have` and `need` are a count for the counting
 * titles, and for a standing title the index of the pirate's tier and of the tier it asks (`have`
 * is -1 while unrated). An earned title stays earned, whatever `have` says now (ADR 0033).
 */
export const TitleProgressSchema = z.object({
  id: ContentIdSchema,
  earned: z.boolean(),
  have: z.int().min(-1),
  need: z.int().min(0),
});
export type TitleProgress = z.infer<typeof TitleProgressSchema>;

export const PirateSheetSchema = z.object({
  record: PirateRecordSchema,
  /** Every title in content order. */
  titles: z.array(TitleProgressSchema),
});
export type PirateSheet = z.infer<typeof PirateSheetSchema>;
