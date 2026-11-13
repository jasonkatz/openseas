import { z } from "zod";

const Dir = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const Tick = z.int().min(0).max(100_000);
const Cell = z.int().min(0).max(63);

export const GunneryMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("arrow"), col: Cell, row: Cell, dir: Dir, tick: Tick }),
  z.object({ type: z.literal("remove"), col: Cell, row: Cell, tick: Tick }),
  z.object({ type: z.literal("wait"), tick: Tick }),
  z.object({ type: z.literal("end"), tick: Tick }),
]);
export type GunneryMoveWire = z.infer<typeof GunneryMoveSchema>;

export const GunneryConfigSchema = z.object({
  decks: z.array(z.array(z.string().regex(/^[#.XBCH]+$/).min(5).max(64)).min(5).max(64)).min(1).max(32).describe("The decks the seed picks from, a string per row: # wall, . deck tile, X crate, B feeder, C turret, H hatch."),
  tickMs: z.int().min(20).max(5000).describe("Milliseconds each tick lasts on the clock: lower runs the whole round faster."),
  maxTick: z.int().min(1).max(100_000).describe("The tick the round ends on; no move may claim a later one."),
  maxMoves: z.int().min(1).max(10_000).describe("Logged moves before the round ends: a bound that keeps the move log a sane size."),
  maxOnDeck: z.int().min(1).max(64).describe("The feeder holds back while this many pieces are on deck."),
  spawnEveryTicks: z.int().min(1).max(1000).describe("Ticks between drops from the feeder at the start of the round."),
  spawnEveryTicksMin: z.int().min(1).max(1000).describe("Ticks between drops by the end of the round; the rhythm quickens evenly towards it."),
  queueLength: z.int().min(0).max(8).describe("How many upcoming pieces the feeder shows."),
  bag: z.array(z.int().min(0).max(64)).length(4).describe("Pieces of each kind in a refill of the feeder's shuffled bag, in order: cell, sabot, slug, coolant."),
  fireAfterTicks: z.int().min(1).max(10_000).describe("A full turret fires itself this many ticks after its load completes."),
  stepPoints: z.int().min(0).max(100_000).describe("Points for a cell or sabot going into a turret that wants it."),
  loadPoints: z.int().min(0).max(100_000).describe("Points for completing a turret's load."),
  comboStep: z.int().min(0).max(100_000).describe("Extra points on a full load for each load already in the combo."),
  comboCap: z.int().min(0).max(1000).describe("The most earlier loads in a combo that earn the extra points."),
  broadsidePoints: z.int().min(0).max(100_000).describe("Points for a broadside: every turret has fired since the last one."),
});
export type GunneryConfigWire = z.infer<typeof GunneryConfigSchema>;
