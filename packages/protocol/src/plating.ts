import { z } from "zod";

export const PlatingMoveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place"),
    slot: z.int().min(0).max(2),
    rot: z.int().min(0).max(3),
    flip: z.boolean(),
    col: z.int().min(0).max(31),
    row: z.int().min(0).max(31),
  }),
  z.object({ type: z.literal("end") }),
]);
export type PlatingMoveWire = z.infer<typeof PlatingMoveSchema>;

const Percent = z.number().min(0).max(10_000);

export const PlatingConfigSchema = z.object({
  width: z.int().min(5).max(20).describe("Columns on the board."),
  height: z.int().min(5).max(24).describe("Rows on the board."),
  pieceKinds: z.int().min(1).max(8).describe("How many metals the offered plates come in: cosmetic, it changes no score."),
  breachesAtOnce: z.int().min(1).max(6).describe("Breaches kept on the board at once."),
  minBreachPieces: z.int().min(1).max(6).describe("Smallest size rolled for a new breach, in plates' worth of cells; a crowded hull may get a smaller one."),
  maxBreachPieces: z.int().min(1).max(6).describe("Largest size rolled for a new breach, in plates' worth of cells."),
  basePerCell: z.number().min(0).max(1000).describe("Points for each cell of a sealed breach, before multipliers."),
  multiplierPercent: z.object({
    flawless: Percent.describe("A Flawless seal."),
    solid: Percent.describe("Solid work."),
    holds: Percent.describe("It'll hold."),
    tape: Percent.describe("Duct tape."),
    gum: Percent.describe("Chewing gum and hope."),
  }).describe("What a sealed breach's points multiply by, in percent, for each rating."),
  brushBonusPercent: Percent.describe("Percent added when every plate in a sealed breach is brushed horizontally."),
  growAfterMoves: z.int().min(1).max(1000).describe("A breach left alone for this many placements elsewhere grows by one cell."),
  maxMoves: z.int().min(1).max(10_000).describe("Plates placed before the round ends: a bound that only keeps the move log a sane size."),
  streakPercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("What a Flawless multiplies by, in percent, by its place in the streak; past the end takes the last entry."),
});
export type PlatingConfigWire = z.infer<typeof PlatingConfigSchema>;
