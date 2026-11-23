import { z } from "zod";

const Bays = z.array(z.int().min(0).max(1000)).min(2).max(6);

export const FreefallMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("drop"), lane: z.int().min(0).max(11) }),
  z.object({ type: z.literal("end") }),
]);
export type FreefallMoveWire = z.infer<typeof FreefallMoveSchema>;

export const FreefallConfigSchema = z.object({
  width: z.int().min(4).max(12).multipleOf(2).describe("Lanes across the shaft, and berths at its foot. Even, since the berths mirror."),
  rows: z.int().min(2).max(10).describe("Rows of rockers a pod falls through."),
  gapPermille: z.int().min(0).max(600).describe("Chance, per mille, that a rocker's place is left open in the deal."),
  quotas: z
    .array(z.int().min(1).max(100_000))
    .length(4)
    .describe("Points a side must reach within each of the four legs to end it. The other side drops once more."),
  bays: z
    .object({
      first: Bays.describe("The first leg's berth values, from the middle lane outward, mirrored."),
      second: Bays.describe("The second leg's berth values, from the middle lane outward, mirrored."),
      third: Bays.describe("The third leg's berth values, from the middle lane outward, mirrored."),
      fourth: Bays.describe("The fourth leg's berth values, from the middle lane outward, mirrored."),
    })
    .describe("What each berth pays, a list a leg, from the middle lane outward."),
  squareClusters: z.boolean().describe("A cluster of n pods scores its berth n times n (on), or n times (off)."),
  rival: z.boolean().describe("A rival drops after each of your drops and races you to each quota. Off: you play the shaft alone."),
  rivalSkill: z.int().min(0).max(100).describe("Percent of the rival's drops that take the most points at once; the rest are a lane at random."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type FreefallConfigWire = z.infer<typeof FreefallConfigSchema>;
