import { z } from "zod";

const Cell = z.int().min(0).max(143);

export const SalvageMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tether"), cells: z.array(Cell).min(2).max(144), loop: z.boolean() }),
  z.object({ type: z.literal("end") }),
]);
export type SalvageMoveWire = z.infer<typeof SalvageMoveSchema>;

export const SalvageConfigSchema = z.object({
  width: z.int().min(3).max(12).describe("Columns on the field."),
  height: z.int().min(3).max(12).describe("Rows on the field."),
  kinds: z.int().min(2).max(8).describe("Kinds of debris in the deal: more makes long lines harder to find."),
  minLine: z.int().min(2).max(5).describe("The shortest line that can be hauled."),
  linePoints: z.int().min(0).max(1000).describe("Points a line earns, multiplied by its length squared."),
  loopMin: z.int().min(3).max(12).describe("The fewest pieces a line needs before it may close into a loop."),
  loopPercent: z.int().min(100).max(1000).describe("Percent a line's own points are multiplied by when it closes into a loop."),
  enclosedPoints: z.int().min(0).max(10_000).describe("Points for each piece of debris hauled from inside a loop."),
  startCrates: z.int().min(0).max(12).describe("Crates on the opening field."),
  cratePermille: z.int().min(0).max(500).describe("Chance, per mille, that a piece drifting in is a crate, while the field holds fewer than its most."),
  maxCrates: z.int().min(0).max(12).describe("The most crates on the field at once."),
  crateFloorPoints: z.int().min(0).max(100_000).describe("Points for a crate that sinks to the floor and is hauled there."),
  crateLoopPoints: z.int().min(0).max(100_000).describe("Points a loop earns for the crates it nets, multiplied by their number squared."),
  couplerPermille: z.int().min(0).max(500).describe("Chance, per mille, that a piece drifting in is a coupler, while the field holds fewer than its most."),
  maxCouplers: z.int().min(0).max(8).describe("The most couplers on the field at once."),
  streakMin: z.int().min(2).max(20).describe("A line this long builds the streak. A shorter one spends the streak's one grace, then breaks it."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak multiplies a haul by, an entry for each long line in a row. The last entry holds."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type SalvageConfigWire = z.infer<typeof SalvageConfigSchema>;
