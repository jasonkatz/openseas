import { z } from "zod";

const Cell = z.int().min(0).max(80);
const Slot = z.int().min(0).max(2);

export const PouringMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pour"), slot: Slot, cell: Cell }),
  z.object({ type: z.literal("drink"), slot: Slot }),
  z.object({ type: z.literal("end") }),
]);
export type PouringMoveWire = z.infer<typeof PouringMoveSchema>;

export const PouringConfigSchema = z.object({
  size: z.int().min(5).max(9).describe("Squares along each side of the bar. A full row or column is served."),
  glasses: z.int().min(2).max(6).describe("Kinds of glass, each its own outline. Fewer make drinks suit each other more often."),
  brews: z.int().min(2).max(6).describe("Kinds of brew, each its own colour and mark. Fewer make drinks suit each other more often."),
  offer: z.int().min(1).max(3).describe("Drinks in each pirate's hand to choose from."),
  rivals: z.int().min(0).max(3).describe("Rival pirates at the bar, taking their turns after yours. 0: you pour alone."),
  rivalSkill: z.int().min(0).max(100).describe("Percent of a rival's turns on which it takes its best pour; on the rest it pours anything that fits."),
  pourPoints: z.int().min(0).max(1000).describe("What every drink is worth, poured or drunk."),
  agePoints: z.int().min(0).max(1000).describe("What a drink gains for each turn it waits in a hand. 0: drinks never age."),
  ageMax: z.int().min(0).max(20).describe("The most turns of waiting a drink's value counts."),
  ringPoints: z.int().min(0).max(1000).describe("Points for the first ring on a clean square."),
  linePoints: z.int().min(0).max(10_000).describe("Points for serving lines, multiplied by the number served by one pour, squared."),
  cleanPercent: z.int().min(100).max(400).describe("Percent lines served by a pour onto a clean square are worth. 100: a clean square adds nothing."),
  tolerance: z.int().min(1).max(6).describe("Drinks downed, without enough pours between, that put a pirate out cold for a turn."),
  soberAfter: z.int().min(1).max(10).describe("Pours that take one drink off a pirate's count."),
  icePerBag: z.int().min(0).max(6).describe("Ice in each bag of drinks: set down on any empty square, and anything stands beside it. 0 deals none."),
  ragsPerBag: z.int().min(0).max(6).describe("Rags in each bag of drinks: wipe one drink off the bar. 0 deals none."),
  lastCall: z.int().min(4).max(60).describe("Turns each pirate takes before last call ends the round."),
  maxMoves: z.int().min(1).max(1000).describe("Longest move log the server accepts."),
});
export type PouringConfigWire = z.infer<typeof PouringConfigSchema>;
