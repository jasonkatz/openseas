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
  width: z.int().min(3).max(10).describe("Columns of capacitors."),
  height: z.int().min(3).max(10).describe("Rows of capacitors."),
  refill: z.array(z.int().min(0).max(1000)).length(4).describe("Weights for a fresh capacitor holding no, one, two or three charges: fuller capacitors make longer chains."),
  boosterPermille: z.int().min(0).max(500).describe("Chance, per mille, that a fresh capacitor is a booster."),
  burstPoints: z.int().min(0).max(1000).describe("Points a chain earns, multiplied by its bursts squared up to the chain cap."),
  chainCap: z.int().min(1).max(1000).describe("Bursts past this many in a chain stop squaring: each one still scores, at the cap's rate."),
  streakMin: z.int().min(1).max(100).describe("A chain this long builds the streak. A shorter one breaks it, and a tap that bursts nothing does neither."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak multiplies a chain by, an entry for each long chain in a row. The last entry holds."),
  tapCap: z.int().min(1).max(12).describe("The most taps the player can hold."),
  startTaps: z.int().min(0).max(12).describe("Taps the player holds when the round opens."),
  tapRegenTicks: z.int().min(1).max(10_000).describe("Ticks for one tap to come back. Nothing is banked while the player holds the most taps."),
  refundEvery: z.int().min(0).max(1000).describe("A chain gives one tap back for every this many bursts in it. Zero gives none back."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds a tick lasts: lower runs every count in ticks faster."),
  maxTick: z.int().min(1).max(100_000).describe("The round ends at this tick, and no move may claim a later one."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type OverloadConfigWire = z.infer<typeof OverloadConfigSchema>;
