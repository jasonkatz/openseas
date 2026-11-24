import { z } from "zod";

const Cell = z.int().min(0).max(80);

export const ForgingMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("strike"), cell: Cell }),
  z.object({ type: z.literal("end") }),
]);
export type ForgingMoveWire = z.infer<typeof ForgingMoveSchema>;

export const ForgingConfigSchema = z.object({
  width: z.int().min(4).max(9).describe("Spots across the plate."),
  height: z.int().min(4).max(9).describe("Spots down the plate."),
  blows: z.int().min(1).max(5).describe("Strikes a spot takes before it is set."),
  jumps: z.boolean().describe("The jumps layer: rails, slants and hooks are dealt. Off: steps only."),
  far: z.boolean().describe("The far layer: steps of four, and stars where jumps are dealt. Off: steps of one to three."),
  sparks: z.boolean().describe("The sparks layer: the last spot at the plate's highest heat shows a spark, which lands anywhere."),
  weights: z
    .array(z.int().min(0).max(100))
    .length(8)
    .describe("How often each mark is dealt: one, two, three, four, rail, slant, star, hook. A mark whose layer is off is never dealt."),
  preview: z.int().min(0).max(6).describe("Upcoming marks shown beside the plate: the next ones the deal will give."),
  strikePoints: z.int().min(0).max(1000).describe("The n-th strike of the round scores this times n, so going further into the plate pays more."),
  platePoints: z.int().min(0).max(100_000).describe("Bonus for setting the whole plate, the round with no strikes left."),
  chainPoints: z.int().min(0).max(1000).describe("Points the n-th strike of a chain of one mark adds, times n - 1."),
  chainCap: z.int().min(1).max(20).describe("The most times a chain's step is paid."),
  setPoints: z.int().min(0).max(10_000).describe("Points for a count (each step once) or a span (each jump once). 0 switches sets off."),
  weaveCap: z.int().min(1).max(20).describe("The k-th set of a weave scores setPoints times k, up to this. 1: sets never link."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type ForgingConfigWire = z.infer<typeof ForgingConfigSchema>;
