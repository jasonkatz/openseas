import { z } from "zod";

const Cell = z.int().min(0).max(99);

export const ScannerMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), cell: Cell }),
  z.object({ type: z.literal("lock"), cell: Cell }),
  z.object({ type: z.literal("end") }),
]);
export type ScannerMoveWire = z.infer<typeof ScannerMoveSchema>;

export const ScannerConfigSchema = z.object({
  width: z.int().min(3).max(10).describe("Columns in the sector."),
  height: z.int().min(3).max(10).describe("Rows in the sector."),
  startContacts: z.int().min(1).max(12).describe("Contacts hidden in the first sector."),
  growEvery: z.int().min(1).max(100).describe("Sectors cleared before the next sector hides one more contact."),
  maxContacts: z.int().min(1).max(12).describe("The most contacts a sector ever hides."),
  parBase: z.int().min(0).max(100).describe("Pings every sector is allowed before any are added for its contacts."),
  parPerContact: z.int().min(0).max(20).describe("Pings a sector is allowed for each contact it hides, on top of the base."),
  openingMin: z.int().min(0).max(6).describe("Least distance from every contact at which the opening ping is dealt; zero deals no opening ping."),
  dealTries: z.int().min(1).max(50).describe("Deals tried for a sector that can be cleared with no guess; one takes the first deal as it comes."),
  contactPoints: z.int().min(0).max(100_000).describe("Points for each contact found by a lock, before the streak."),
  savePoints: z.int().min(0).max(100_000).describe("Points for each allowed ping left unspent when a sector is cleared clean, before the streak."),
  overPenalty: z.int().min(0).max(100_000).describe("Points lost for each ping past the sector's allowance."),
  wrongPenalty: z.int().min(0).max(100_000).describe("Points lost for a lock on empty space."),
  spookPenalty: z.int().min(0).max(100_000).describe("Points lost for a ping that lands on a contact."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak of clean sectors multiplies contacts and savings by; a streak past the end takes the last."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts: the round ends there."),
});
export type ScannerConfigWire = z.infer<typeof ScannerConfigSchema>;
