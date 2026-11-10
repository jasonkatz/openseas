import { z } from "zod";

export const CoolingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), col: z.int().min(0).max(15), row: z.int().min(0).max(31) }),
  /** The ship's heat, injected into a duty board's log by the ship's turns (DESIGN.md 3.3). */
  z.object({ type: z.literal("heat"), row: z.int().min(0).max(32) }),
  z.object({ type: z.literal("end") }),
]);
export type CoolingMoveWire = z.infer<typeof CoolingMoveSchema>;

export const CoolingConfigSchema = z.object({
  width: z.int().min(3).max(16),
  height: z.int().min(3).max(32),
  pieceKinds: z.int().min(3).max(12),
  specialChancePerMille: z.object({
    charge: z.int().min(0).max(1000),
    magnet: z.int().min(0).max(1000),
    slag: z.int().min(0).max(1000),
  }),
  initialHeatRow: z.int().min(0).max(32),
  minHeatRow: z.int().min(0).max(32),
  heatRisePerMoves: z.int().min(1),
  heatDropPerPoints: z.int().min(1),
  /** True when the heat is a ship's heat (a duty board's, or a harness round's lone ship, ADR 0029); false keeps the board's own. */
  shipHeat: z.boolean().default(false),
  maxMoves: z.int().min(1).max(10_000),
  cascadeMultipliers: z.array(z.int().min(1).max(100)).min(1).max(16),
  streakStepPercent: z.int().min(0).max(1000),
  streakMaxPercent: z.int().min(100).max(1000),
  streakGrace: z.int().min(0).max(16),
});
export type CoolingConfigWire = z.infer<typeof CoolingConfigSchema>;
