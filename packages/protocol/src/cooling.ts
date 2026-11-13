import { z } from "zod";

export const CoolingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), col: z.int().min(0).max(15), row: z.int().min(0).max(31) }),
  /** The ship's heat, injected into a duty board's log by the ship's turns (DESIGN.md 3.3). */
  z.object({ type: z.literal("heat"), row: z.int().min(0).max(32) }),
  z.object({ type: z.literal("end") }),
]);
export type CoolingMoveWire = z.infer<typeof CoolingMoveSchema>;

export const CoolingConfigSchema = z.object({
  width: z.int().min(3).max(16).describe("Columns on the board."),
  height: z.int().min(3).max(32).describe("Rows on the board."),
  pieceKinds: z.int().min(3).max(12).describe("How many ordinary piece kinds the board deals."),
  specialChancePerMille: z.object({
    charge: z.int().min(0).max(1000).describe("The spark charge."),
    magnet: z.int().min(0).max(1000).describe("The magnet."),
    slag: z.int().min(0).max(1000).describe("The slag."),
  }).describe("Chance, in parts per thousand, that a dealt piece is each special."),
  initialHeatRow: z.int().min(0).max(32).describe("Rows overheated when the round starts."),
  minHeatRow: z.int().min(0).max(32).describe("The heat never drains below this many rows, so venting at the floor is wasted."),
  heatRisePerMoves: z.int().min(1).describe("Heat rises one row every this many moves."),
  heatDropPerPoints: z.int().min(1).describe("Heat drops one row every this many points scored."),
  maxMoves: z.int().min(1).max(10_000).describe("Swaps before the round ends: a bound that only keeps the move log a sane size."),
  /** True when the heat is a ship's heat (a duty board's, or a harness round's lone ship); false keeps the board's own. */
  shipHeat: z.boolean().default(false).describe("On, the heat is the ship's and swaps neither raise nor drain it; off, the board keeps its own heat."),
  cascadeMultipliers: z.array(z.int().min(1).max(100)).min(1).max(16).describe("What each step of a cascade multiplies its points by; steps past the end take the last entry."),
  streakStepPercent: z.int().min(0).max(1000).describe("Percent added to a move's points for each scoring move in a row before it."),
  streakMaxPercent: z.int().min(100).max(1000).describe("The cap on the streak multiplier, in percent."),
  streakGrace: z.int().min(0).max(16).describe("Non-scoring swaps in a row the streak survives; one more breaks it."),
});
export type CoolingConfigWire = z.infer<typeof CoolingConfigSchema>;
