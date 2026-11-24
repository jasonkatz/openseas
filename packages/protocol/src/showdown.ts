import { z } from "zod";

const Style = z.enum(["brick", "sponge", "hothead", "shark"]);
const Play = (who: string) =>
  z
    .object({
      slack: z.int().min(-3000).max(3000).describe(`How far short of the price the ${who} still calls, in thousandths of a fair share. Below zero, it wants more.`),
      raiseAt: z.int().min(0).max(6000).describe(`The share of the pot, in thousandths of a fair share, at which the ${who} bets or raises.`),
      bluff: z.int().min(0).max(1000).describe(`Chance, per thousand, that the ${who} bets when checked to with less than a fair share.`),
    })
    .describe(`How the ${who} plays.`);

export const ShowdownMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold") }),
  z.object({ type: z.literal("call") }),
  z.object({ type: z.literal("raise") }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("deal") }),
  z.object({ type: z.literal("end") }),
]);
export type ShowdownMoveWire = z.infer<typeof ShowdownMoveSchema>;

export const ShowdownConfigSchema = z
  .object({
    rivals: z.int().min(1).max(5).describe("Rivals at the table beside you."),
    hands: z.int().min(1).max(200).describe("Hands in a sitting. The round ends after the last."),
    bank: z.int().min(0).max(100_000).describe("Chips you sit down with. Your score is what you stand up with."),
    smallBlind: z.int().min(0).max(1000).describe("The small blind, posted by the seat left of the button."),
    bigBlind: z.int().min(1).max(1000).describe("The big blind, posted by the seat after the small blind. It counts as the first bet before the flop."),
    smallBet: z.int().min(1).max(1000).describe("The bet and raise before the flop and on the flop."),
    bigBet: z.int().min(1).max(1000).describe("The bet and raise on the turn and the river."),
    raiseCap: z.int().min(1).max(8).describe("Bets a street takes, the opening bet or big blind counted."),
    styles: z.array(Style).min(1).max(12).describe("The styles the rivals are dealt from, one a seat, without putting one back."),
    play: z
      .object({ brick: Play("brick"), sponge: Play("sponge"), hothead: Play("hothead"), shark: Play("shark") })
      .describe("Each rival style's numbers."),
    samples: z.int().min(1).max(2000).describe("Deals a rival runs to reckon its share of the pot before it acts."),
    maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts."),
  })
  .refine((c) => c.smallBlind <= c.bigBlind, "the small blind is no more than the big")
  .refine((c) => c.styles.length >= c.rivals, "at least one style a rival");
export type ShowdownConfigWire = z.infer<typeof ShowdownConfigSchema>;
