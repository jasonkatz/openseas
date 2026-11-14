import { z } from "zod";
import { PuzzleIdSchema } from "./common.js";

/**
 * What the puzzle studio and its service say to each other (ADR 0042 decision 4, ADR 0043). Not
 * the game's wire: the game's server knows none of this, and the studio's service deals no round.
 */

/** A tester link's id: ten characters a person can read out. Never a puzzle's id, since both follow `/play/`. */
export const TesterLinkIdSchema = z.string().regex(/^[a-z0-9]{10}$/);

/**
 * The numbers a tester link freezes: what a draft lays over the puzzle's content file, and the
 * seed if it pins one. Only its shape is checked here. Whether a build will play it is that
 * build's own question, asked when the link is opened (ADR 0042 decision 11).
 */
export const TesterLinkDraftSchema = z.object({
  /** A pinned seed, or null for a fresh one each round. */
  seed: z.string().min(1).max(64).nullable(),
  /** Config overrides by dotted path under `config`. */
  overrides: z.record(z.string().min(1).max(128), z.json()).refine((o) => Object.keys(o).length <= 128, "too many overrides"),
  roundSeconds: z.int().min(1).max(100_000).nullable(),
  paceSeconds: z.int().min(1).max(100_000).nullable(),
  thresholds: z
    .array(z.object({ score: z.int().min(0), rating: z.number() }))
    .min(1)
    .max(32)
    .nullable(),
});
export type TesterLinkDraft = z.infer<typeof TesterLinkDraftSchema>;

export const CreateTesterLinkSchema = z.object({
  puzzle: PuzzleIdSchema,
  /** What the owner calls this draft; a tester sees it in the details sheet. */
  name: z.string().trim().min(1).max(80),
  draft: TesterLinkDraftSchema,
});
export type CreateTesterLink = z.infer<typeof CreateTesterLinkSchema>;

export const TesterLinkSchema = z.object({
  id: TesterLinkIdSchema,
  puzzle: PuzzleIdSchema,
  name: z.string(),
  /** The GitHub login of whoever made it. */
  author: z.string(),
  draft: TesterLinkDraftSchema,
  createdAt: z.iso.datetime(),
  /** A withdrawn link is kept, so its address says what happened to it, and plays nothing. */
  withdrawn: z.boolean(),
});
export type TesterLink = z.infer<typeof TesterLinkSchema>;

export const TesterLinkListSchema = z.object({ links: z.array(TesterLinkSchema) });

/** Who the service takes the caller for. `signIn` says whether it has GitHub keys at all; `dev` that it offers a sign-in with no GitHub, off production. */
export const StudioMeSchema = z.object({
  login: z.string().nullable(),
  signIn: z.boolean(),
  dev: z.boolean(),
});
export type StudioMe = z.infer<typeof StudioMeSchema>;

export const StudioErrorCodeSchema = z.enum(["not_found", "withdrawn", "unauthorized", "forbidden", "bad_request", "internal"]);
export type StudioErrorCode = z.infer<typeof StudioErrorCodeSchema>;
export const StudioErrorSchema = z.object({ error: StudioErrorCodeSchema });
