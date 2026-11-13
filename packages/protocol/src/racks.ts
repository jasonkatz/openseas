import { z } from "zod";

const Rack = z.int().min(0).max(7);

export const RacksMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), from: Rack, to: Rack }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("end") }),
]);
export type RacksMoveWire = z.infer<typeof RacksMoveSchema>;

export const RacksConfigSchema = z.object({
  racks: z.int().min(3).max(8).describe("Racks in the row."),
  height: z.int().min(3).max(8).describe("Cells a rack holds; a rack ships when it holds this many of one kind."),
  kinds: z.int().min(2).max(8).describe("Kinds of fuel cell in play."),
  startCells: z.int().min(0).max(56).describe("Fuel cells dealt onto the racks before the first move."),
  crateMin: z.int().min(1).max(8).describe("Fewest cells a crate holds."),
  crateMax: z.int().min(1).max(8).describe("Most cells a crate holds."),
  crateMixPercent: z.int().min(0).max(100).describe("Chance in a hundred that a crate's next cell is drawn afresh rather than repeating the one under it."),
  landEvery: z.int().min(1).max(20).describe("Moves a crate hangs before it lands by itself."),
  bagCopies: z.int().min(1).max(8).describe("Copies of each kind in the bag crates are drawn from; a smaller bag deals the kinds more evenly."),
  shipPoints: z.int().min(0).max(100_000).describe("Points for a shipment, before the chain multiplies it."),
  chainWindow: z.int().min(1).max(20).describe("A shipment within this many actions of the last carries the chain on; one means the very next action."),
  chainPercent: z.array(z.int().min(100).max(2000)).min(1).max(16).describe("Percent the chain multiplies a shipment by; a chain past the end takes the last entry."),
  spillPenalty: z.int().min(0).max(100_000).describe("Points lost when a crate lands on a rack with no room for it and spills the rack."),
  markRoom: z.boolean().describe("On: a new crate is marked for a rack with room for it while any has. Off: any rack, a full one too."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts: the round ends there."),
});
export type RacksConfigWire = z.infer<typeof RacksConfigSchema>;
