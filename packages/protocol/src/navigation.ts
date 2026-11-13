import { z } from "zod";

const Tick = z.int().min(0).max(100_000);

export const NavigationMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rotate"), ring: z.int().min(0).max(5), dir: z.union([z.literal(-1), z.literal(1)]), tick: Tick }),
  z.object({ type: z.literal("drop"), tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  z.object({ type: z.literal("end"), tick: Tick }),
]);
export type NavigationMoveWire = z.infer<typeof NavigationMoveSchema>;

export const NavigationConfigSchema = z.object({
  rings: z.int().min(1).max(6).describe("Rings on the star chart."),
  octants: z.int().min(3).max(16).describe("Octants around each ring."),
  shapes: z.int().min(1).max(6).describe("How many star shapes are dealt; a star's kind is its shape and color together."),
  colors: z.int().min(1).max(8).describe("How many star colors are dealt; a star's kind is its shape and color together."),
  startStars: z.int().min(1).max(96).describe("Markers in the first constellation; it gains one every two completions."),
  maxStars: z.int().min(1).max(96).describe("The most markers a constellation grows to."),
  reuseChancePercent: z.int().min(0).max(100).describe("Chance, in percent, that a new marker copies the kind of a star already on the chart."),
  starPoints: z.int().min(0).max(10_000).describe("Base points for a constellation: its markers squared times this, plus an efficiency bonus."),
  chainPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("What constellations charted in a row with no lost heading multiply by, in percent; past the end takes the last."),
  runPoints: z.int().min(0).max(10_000).describe("Points for each star beyond two in a cleared run of loose stars of a kind."),
  lostHeadingPenalty: z.int().min(0).max(10_000).describe("Points lost when a star arrives at a blocked octant; the score never goes below zero."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds each tick lasts on the clock: lower runs the whole round faster."),
  maxTick: z.int().min(1).max(100_000).describe("The tick the round ends on; no move may claim a later one."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts (turns, drops and waits); the round ends when it is reached."),
  fallTicks: z.int().min(1).max(10_000).describe("Ticks a star takes to fall at the start of the round."),
  fallTicksMin: z.int().min(1).max(10_000).describe("Ticks a star takes to fall by the end of the round; the fall quickens evenly towards it."),
});
export type NavigationConfigWire = z.infer<typeof NavigationConfigSchema>;
