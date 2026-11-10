import { z } from "zod";

const Tick = z.int().min(0).max(100_000);

export const OverloadMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tap"), cell: z.int().min(0).max(99), tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  // An end may come without a tick: the round then ends at the tick it has reached.
  z.object({ type: z.literal("end"), tick: Tick.optional() }),
]);
export type OverloadMoveWire = z.infer<typeof OverloadMoveSchema>;

export const OverloadConfigSchema = z.object({
  width: z.int().min(3).max(10),
  height: z.int().min(3).max(10),
  refill: z.array(z.int().min(0).max(1000)).length(4),
  boosterPermille: z.int().min(0).max(500),
  burstPoints: z.int().min(0).max(1000),
  chainCap: z.int().min(1).max(1000),
  streakMin: z.int().min(1).max(100),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16),
  tapCap: z.int().min(1).max(12),
  startTaps: z.int().min(0).max(12),
  tapRegenTicks: z.int().min(1).max(10_000),
  refundEvery: z.int().min(0).max(1000),
  tickMs: z.int().min(20).max(5000),
  maxTick: z.int().min(1).max(100_000),
  maxMoves: z.int().min(1).max(1_000_000),
});
export type OverloadConfigWire = z.infer<typeof OverloadConfigSchema>;
