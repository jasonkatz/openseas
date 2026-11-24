import { z } from "zod";

export const PactMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bid"), bid: z.int().min(0).max(13) }),
  z.object({ type: z.literal("play"), card: z.int().min(0).max(51) }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("deal") }),
  z.object({ type: z.literal("end") }),
]);
export type PactMoveWire = z.infer<typeof PactMoveSchema>;

export const PactConfigSchema = z.object({
  hands: z.int().min(1).max(50).describe("Hands in a sitting. The round ends after the last."),
  trickValue: z.int().min(0).max(1000).describe("Points for each trick of a pact that is made, and lost for each when it falls short."),
  bagValue: z.int().min(0).max(1000).describe("Points for each trick taken over the pact (a bag)."),
  nilBonus: z.int().min(0).max(10_000).describe("What a nil bid scores when it takes no trick, and loses when it takes one. 0 turns nil off."),
  bagLimit: z.int().min(0).max(100).describe("Bags a side gathers over the sitting before they cost it the penalty. 0: bags never cost."),
  bagPenalty: z.int().min(0).max(10_000).describe("What a side loses each time its bags reach the limit."),
  setBonus: z.int().min(0).max(1000).describe("Points a side scores for each trick of the rivals' pact when the rivals fall short. 0: none."),
  seatLean: z.int().min(-50).max(50).describe("How far the other seats lean their bids over what their cards count to, in tenths of a trick. Higher bids bolder."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type PactConfigWire = z.infer<typeof PactConfigSchema>;
