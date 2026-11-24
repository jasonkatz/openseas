import { z } from "zod";

const Bays = z.array(z.int().min(0).max(10_000)).min(2).max(10);

export const FreefallMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("drop"), lane: z.int().min(0).max(19) }),
  z.object({ type: z.literal("end") }),
]);
export type FreefallMoveWire = z.infer<typeof FreefallMoveSchema>;

export const FreefallConfigSchema = z.object({
  width: z.int().min(4).max(20).multipleOf(2).describe("Lanes across the foot of the shaft, a berth under each. Even, since the berths mirror."),
  entry: z.int().min(2).max(20).multipleOf(2).describe("Lanes across the top, the ones a pod is dropped down. The shaft widens from these to the full width at its foot."),
  rows: z.int().min(2).max(10).describe("Rows of rockers a pod falls through."),
  gapPermille: z.int().min(0).max(600).describe("Chance, per mille, that a rocker's place is left open in the deal."),
  quotas: z
    .array(z.int().min(1).max(100_000))
    .length(5)
    .describe("Points a side must reach within each of the five legs to end it. The other side drops once more."),
  bays: z
    .object({
      first: Bays.describe("The first leg's berth values, from the middle lane outward, mirrored."),
      second: Bays.describe("The second leg's berth values, from the middle lane outward, mirrored."),
      third: Bays.describe("The third leg's berth values, from the middle lane outward, mirrored."),
      fourth: Bays.describe("The fourth leg's berth values, from the middle lane outward, mirrored."),
      fifth: Bays.describe("The fifth and last leg's berth values, from the middle lane outward, mirrored."),
    })
    .describe("What each berth pays, a list a leg, from the middle lane outward."),
  squareClusters: z.boolean().describe("A cluster of n pods scores its berth n times n (on), or n times (off)."),
  rival: z.boolean().describe("A rival drops after each of your drops and races you to each quota. Off: you play the shaft alone."),
  rivalSkill: z.int().min(0).max(100).describe("Percent of the rival's drops that take the most points at once; the rest are a lane at random."),
  turnSeconds: z.int().min(5).max(120).describe("Seconds you have for each drop; when they run out, the lane in hand drops."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
});
export type FreefallConfigWire = z.infer<typeof FreefallConfigSchema>;
