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
  mirrors: z.int().min(1).max(100).describe("Mirrors on the grid. A spent mirror is replaced, so there are always this many."),
  lenses: z.int().min(0).max(99).describe("Lenses on the grid, of the three kinds in turn. A beam passes straight through one; they are never spent."),
  beams: z.int().min(1).max(3).describe("Beams in every volley, from the first second to the last."),
  recipeLenses: z.int().min(0).max(3).describe("The most lenses a beam's recipe asks for. 0 turns recipes off: a beam is home at its exit whatever it passed."),
  lensPercent: z.int().min(0).max(1000).describe("Percent each lens in a beam's recipe adds to its points."),
  spend: z.boolean().describe("On, every mirror a fired beam turned at is spent: what stood above it drops, and a fresh mirror comes in at the top. Off, mirrors never move."),
  minBest: z.int().min(0).max(64).describe("A volley is dealt exits whose best setting is worth at least a beam of this many turns, when any are free."),
  bouncePoints: z.int().min(0).max(1000).describe("Points a beam earns home, multiplied by the square of its turns plus one, before its lenses."),
  bounceCap: z.int().min(1).max(64).describe("Turns past this many add nothing to a beam's points."),
  perfectPercent: z.int().min(100).max(1000).describe("Percent a perfect volley is multiplied by: a clean volley worth its best."),
  hullPenalty: z.int().min(0).max(100_000).describe("Points lost for every beam that is not home: the wrong port, or the wrong lenses. The score never drops below zero."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the streak multiplies a clean volley by, an entry for each one in a row. The last entry holds."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds a tick lasts: lower runs the round's clock in ticks faster."),
  maxTick: z.int().min(1).max(100_000).describe("The round ends at this tick, and no move may claim a later one."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
  openingTicks: z.int().min(0).max(10_000).describe("Ticks into the round before the first volley is dealt."),
  respawnTicks: z.int().min(0).max(10_000).describe("Ticks from a volley firing to the next being dealt: time for the grid to settle."),
});
export type DeflectorsConfigWire = z.infer<typeof DeflectorsConfigSchema>;
