import { z } from "zod";

const Tick = z.int().min(0).max(100_000);

export const RefiningMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), cell: z.int().min(0).max(99), dir: z.enum(["upRight", "downRight"]), tick: Tick }),
  z.object({ type: z.literal("draw"), tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  // An end may come without a tick: the round then ends at the tick it has reached.
  z.object({ type: z.literal("end"), tick: Tick.optional() }),
]);
export type RefiningMoveWire = z.infer<typeof RefiningMoveSchema>;

export const RefiningConfigSchema = z.object({
  width: z.int().min(3).max(10).describe("Columns in the tower. A fresh column takes this many draws to reach the outlet."),
  height: z.int().min(3).max(10).describe("Pieces in a column: taller columns are harder to make clear."),
  vapourPermille: z.int().min(1).max(1000).describe("Chance, per mille, that a piece of fresh feed is vapour, the light fraction a clear column is made of."),
  oilPermille: z.int().min(0).max(1000).describe("Chance, per mille, that a piece of fresh feed is oil. The rest is tar; vapour and oil together are at most 1000."),
  catalystPermille: z.int().min(0).max(300).describe("Chance, per mille, that a piece of fresh feed is a catalyst, fixed where it lies. 0 deals none."),
  clearPoints: z.int().min(0).max(10_000).describe("A clear column pays this times its place in the clear run, up to the run cap."),
  runCap: z.int().min(1).max(50).describe("The clear run stops growing a column's pay at this many. 1 pays every clear column the same."),
  smoothPoints: z.int().min(0).max(10_000).describe("What a smooth column pays: no tar, no smoke, more vapour than oil. It ends the clear run."),
  catalystPoints: z.int().min(0).max(10_000).describe("What each catalyst in a clear or smooth column pays."),
  foulPoints: z.int().min(0).max(10_000).describe("What each tar or smoke in a column that rises to the tank costs."),
  smokeEvery: z.int().min(0).max(100).describe("Every this many vapour spilled into the sump come back as one smoke on the tower. 0: none does."),
  pulseTicks: z.int().min(5).max(10_000).describe("Ticks between the clock's draws of the outlet. Drawing early starts the count again."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds a tick lasts: lower runs every count in ticks faster."),
  maxTick: z.int().min(1).max(100_000).describe("The round ends at this tick, and no move may claim a later one."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type RefiningConfigWire = z.infer<typeof RefiningConfigSchema>;
