import { z } from "zod";

const Tick = z.int().min(0).max(100_000);

export const DeflectorsMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flip"), cell: z.int().min(0).max(99), tick: Tick }),
  z.object({ type: z.literal("fire"), volley: z.int().min(1).max(1_000_000), tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  z.object({ type: z.literal("end"), tick: Tick }),
]);
export type DeflectorsMoveWire = z.infer<typeof DeflectorsMoveSchema>;

export const DeflectorsConfigSchema = z.object({
  /** The grid is size by size, with a port at each end of every row and column. */
  size: z.int().min(3).max(10),
  mirrors: z.int().min(1).max(100),
  /** The most beams in a volley. The board has a sign for each of three. */
  maxBeams: z.int().min(1).max(3),
  rampTicks: z.int().min(1).max(100_000),
  minBest: z.int().min(0).max(64),
  bouncePoints: z.int().min(0).max(1000),
  bounceCap: z.int().min(1).max(64),
  perfectPercent: z.int().min(100).max(1000),
  hullPenalty: z.int().min(0).max(100_000),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  tickMs: z.int().min(20).max(5000),
  maxTick: z.int().min(1).max(100_000),
  maxMoves: z.int().min(1).max(1_000_000),
  openingTicks: z.int().min(0).max(10_000),
  chargeTicks: z.int().min(1).max(10_000),
  chargeTicksMin: z.int().min(1).max(10_000),
  beamTicks: z.int().min(0).max(10_000),
  respawnTicks: z.int().min(0).max(10_000),
});
export type DeflectorsConfigWire = z.infer<typeof DeflectorsConfigSchema>;
