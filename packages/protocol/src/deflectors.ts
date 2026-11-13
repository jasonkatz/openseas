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
  size: z.int().min(3).max(10).describe("Cells along each side of the square grid."),
  mirrors: z.int().min(1).max(100).describe("Mirrors dealt on the grid. They are dealt once and never move."),
  maxBeams: z.int().min(1).max(3).describe("The most beams in a volley, late in the round."),
  rampTicks: z.int().min(1).max(100_000).describe("The round opens with one beam a volley, and a volley gains a beam every this many ticks."),
  minBest: z.int().min(0).max(64).describe("A volley is dealt exits whose best setting is worth at least a beam of this many turns, when any are free."),
  bouncePoints: z.int().min(0).max(1000).describe("Points a beam earns at its exit, multiplied by the square of its turns plus one."),
  bounceCap: z.int().min(1).max(64).describe("Turns past this many add nothing to a beam's points."),
  perfectPercent: z.int().min(100).max(1000).describe("Percent a perfect volley is multiplied by: a clean volley worth its best."),
  hullPenalty: z.int().min(0).max(100_000).describe("Points lost for every beam that leaves by the wrong port. The score never drops below zero."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak multiplies a clean volley by, an entry for each one in a row. The last entry holds."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds a tick lasts: lower runs every count in ticks faster."),
  maxTick: z.int().min(1).max(100_000).describe("The round ends at this tick, and no move may claim a later one."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
  openingTicks: z.int().min(0).max(10_000).describe("Ticks into the round before the first volley is dealt."),
  chargeTicks: z.int().min(1).max(10_000).describe("Ticks a volley waits before it fires as the round opens. The wait shortens evenly to its minimum."),
  chargeTicksMin: z.int().min(1).max(10_000).describe("Ticks a volley waits before it fires by the end of the round."),
  beamTicks: z.int().min(0).max(10_000).describe("Ticks more a volley waits for every beam in it after the first."),
  respawnTicks: z.int().min(0).max(10_000).describe("Ticks from a volley firing to the next being dealt: firing early brings the next one sooner."),
});
export type DeflectorsConfigWire = z.infer<typeof DeflectorsConfigSchema>;
