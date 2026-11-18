import { z } from "zod";
import { PuzzleCategorySchema } from "../schema.js";

const ThresholdsSchema = z.array(z.object({ score: z.int().min(0), rating: z.number() })).min(1);

/**
 * One stage of a puzzle's ladder (ADR 0065): the puzzle with some of its layers switched off, for
 * a new player to learn on. `config` is laid over the puzzle's own config, key by key, and the
 * result is held to the puzzle's schema like the config itself. A stage has its own round length
 * and thresholds, since it scores less than the whole puzzle. The whole puzzle is the last stage,
 * named `full`, and is not listed: it is the file's own numbers.
 */
export const StageSchema = z.object({
  /** A lowercase word; its name and its one-line card are `<puzzle>.stage.<id>` and `<puzzle>.stage.<id>_intro`. */
  id: z.string().regex(/^[a-z]+$/).refine((id) => id !== "full", "full is the whole puzzle and is not listed"),
  roundSeconds: z.int().min(10).max(1800),
  thresholds: ThresholdsSchema,
  config: z.record(z.string(), z.unknown()),
});
export type Stage = z.infer<typeof StageSchema>;

/** The id of the whole puzzle, the ladder's last stage. */
export const FULL_STAGE = "full";

/** The numbers a stage is played on: the file's own, with the stage's laid over them. The whole puzzle for `full`, null, or a stage the file does not list. */
export function stageNumbers<C extends object>(
  file: { readonly config: C; readonly roundSeconds: number; readonly thresholds: readonly { score: number; rating: number }[]; readonly stages?: readonly Stage[] },
  id: string | null,
): { config: C; roundSeconds: number; thresholds: readonly { score: number; rating: number }[]; stage: Stage | null } {
  const stage = id === null ? undefined : file.stages?.find((s) => s.id === id);
  if (!stage) return { config: file.config, roundSeconds: file.roundSeconds, thresholds: file.thresholds, stage: null };
  return { config: { ...file.config, ...stage.config } as C, roundSeconds: stage.roundSeconds, thresholds: stage.thresholds, stage };
}

/**
 * Fields every prototype puzzle's content file has (ADR 0036). A prototype is no station, so it
 * has no par: a round is rated against its thresholds, as the captain's space battle is.
 */
export const PrototypeBaseSchema = z.object({
  /** Wall-clock length of a round on the studio, enforced by the server for a recorded one. */
  category: PuzzleCategorySchema,
  roundSeconds: z.int().min(10).max(1800),
  /** The stretch of recent play, in seconds, the live tier indicator reads (ADR 0039). Longer for a puzzle that scores in lumps. */
  paceSeconds: z.int().min(1).max(120).default(10),
  /** Performance thresholds the round is rated against (ADR 0028). Guesses until testers have played. */
  thresholds: ThresholdsSchema,
  /** The ladder a new player climbs before the whole puzzle (ADR 0065), simplest first. Empty: the puzzle has none yet. */
  stages: z.array(StageSchema).max(4).default([]),
});
