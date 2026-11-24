import { z } from "zod";

const Tick = z.int().min(0).max(100_000);

export const DeflectorsMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), cell: z.int().min(0).max(99), tick: Tick }),
  z.object({ type: z.literal("turn"), tick: Tick }),
  z.object({ type: z.literal("fire"), tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  z.object({ type: z.literal("end"), tick: Tick }),
]);
export type DeflectorsMoveWire = z.infer<typeof DeflectorsMoveSchema>;

export const DeflectorsConfigSchema = z.object({
  size: z.int().min(3).max(10).describe("Cells along each side of the square grid."),
  emitters: z.int().min(1).max(10).describe("Emitters spread down the left edge. Every one fires at each shot."),
  targets: z.int().min(1).max(8).describe("Targets on the top, right and bottom edges, dealt at the start of the round."),
  mirrors: z.int().min(0).max(100).describe("Mirrors on the grid at the start, set at random."),
  lenses: z.int().min(0).max(99).describe("Lenses on the grid at the start, of the three kinds in turn."),
  recipeWeights: z.array(z.int().min(0).max(1000)).min(1).max(4).describe("How often a target's recipe asks for no lens, one, two, three, as weights. One entry turns recipes off."),
  lensPercent: z.int().min(0).max(1000).describe("Percent each lens in a target's recipe adds to a beam's points."),
  bouncePoints: z.int().min(0).max(1000).describe("Points a beam earns lighting a target, multiplied by the square of its turns plus one, before its lenses."),
  bounceCap: z.int().min(1).max(64).describe("Turns past this many add nothing to a beam's points."),
  litPercent: z.array(z.int().min(0).max(10_000)).min(1).max(10).describe("Percent a shot is multiplied by for one target lit, two, three: one entry for each emitter."),
  spend: z.boolean().describe("On, a shot clears every mirror a beam turned at and every lens a lighting beam passed. Off, the grid stays as built."),
  pieceTicks: z.int().min(1).max(10_000).describe("Ticks between one piece coming into the queue and the next."),
  queueSize: z.int().min(1).max(8).describe("Pieces the queue holds. One more drops the oldest on a cell of the engine's choosing."),
  lensChance: z.int().min(0).max(100).describe("Percent of pieces that are lenses rather than mirrors."),
  fireTicks: z.int().min(0).max(10_000).describe("Ticks after a shot before the emitters can fire again."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds a tick lasts: lower runs the round's clock in ticks faster."),
  maxTick: z.int().min(1).max(100_000).describe("The round ends at this tick, and no move may claim a later one."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type DeflectorsConfigWire = z.infer<typeof DeflectorsConfigSchema>;
