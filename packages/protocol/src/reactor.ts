import { z } from "zod";

export const ReactorMoveSchema = z.discriminatedUnion("type", [
  /** 0 up, 1 right, 2 down, 3 left. */
  z.object({ type: z.literal("swipe"), dir: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("end") }),
]);
export type ReactorMoveWire = z.infer<typeof ReactorMoveSchema>;

export const ReactorConfigSchema = z.object({
  size: z.int().min(3).max(8).describe("The core is this many cells on each side."),
  hotGrade: z.int().min(3).max(9).describe("The grade at which a rod is hot: it stops fusing and must go out through a port."),
  ports: z.int().min(1).max(8).describe("Ports open on the rim of the core at once."),
  criticalHot: z.int().min(2).max(64).describe("This many hot rods in the core at once and it goes critical: a scram."),
  startRods: z.int().min(1).max(63).describe("Rods in the core at the start of a round and again after a scram."),
  twoPermille: z.int().min(0).max(1000).describe("Chance, per thousand, that the next rod to enter is grade 2 instead of grade 1."),
  fusePoints: z.array(z.int().min(0).max(100_000)).min(2).max(8).describe("Points for fusing into each grade: the first entry is grade 2, the last is the hot grade."),
  dischargePoints: z.int().min(0).max(100_000).describe("Points for a hot rod pushed out through a port, before the salvo and the pipeline multiply it."),
  salvoPercent: z.array(z.int().min(100).max(2000)).min(1).max(8).describe("Percent a swipe's discharges are multiplied by, by rods out in that swipe; past the end takes the last entry."),
  pipelineSwipes: z.int().min(1).max(1000).describe("A discharge within this many swipes of the last one keeps the pipeline going."),
  pipelinePercent: z.array(z.int().min(100).max(1000)).min(1).max(16).describe("Percent the pipeline multiplies a discharge by, by its place in the run; a run past the end takes the last."),
  scramPenalty: z.int().min(0).max(100_000).describe("Points lost on a scram, when the core jams or goes critical and is emptied."),
  maxMoves: z.int().min(1).max(1_000_000).describe("Longest move log the server accepts: the round ends there."),
});
export type ReactorConfigWire = z.infer<typeof ReactorConfigSchema>;
