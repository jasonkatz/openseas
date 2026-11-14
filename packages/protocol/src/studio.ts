import { z } from "zod";
import { PuzzleIdSchema } from "./common.js";

/**
 * What the puzzle studio and its service say to each other (ADR 0042 decision 4, ADR 0043). Not
 * the game's wire: the game's server knows none of this, and the studio's service deals no round.
 */

/** A tester link's id: ten characters a person can read out. Never a puzzle's id, since both follow `/play/`. */
export const TesterLinkIdSchema = z.string().regex(/^[a-z0-9]{10}$/);

/**
 * A draft's numbers: what it lays over the puzzle's content file, and the seed if it pins one.
 * Only the shape is checked here. Whether a build will play them is that build's own question,
 * asked on the page that deals the round (ADR 0042 decisions 3 and 11).
 */
export const DraftNumbersSchema = z.object({
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
export type DraftNumbers = z.infer<typeof DraftNumbersSchema>;

/** The numbers a tester link freezes: a copy of a draft's, taken when the link was made. */
export const TesterLinkDraftSchema = DraftNumbersSchema;
export type TesterLinkDraft = DraftNumbers;

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

/** A draft's id: the shape of a tester link's, and as random. A puzzle has one draft an owner today; the id is what lets variants follow (ADR 0042 decision 2). */
export const DraftIdSchema = z.string().regex(/^[a-z0-9]{10}$/);

/**
 * A draft as the service keeps it (ADR 0045): the owner's numbers for one puzzle. `revision`
 * counts its saves; a save names the revision it was made from and is refused when that is no
 * longer the stored one, so two pages open on one draft cannot overwrite each other unseen.
 */
/** Why a Save or an update did not finish. `nothing`: the draft changes no number. `unknown_key`: it sets a key the content file has no place for. `conflict`: the base branch and the draft's changed the same lines. `interrupted`: the service restarted under it. */
export const DraftSaveErrorSchema = z.enum(["nothing", "unknown_key", "conflict", "git", "github", "interrupted"]);
export type DraftSaveError = z.infer<typeof DraftSaveErrorSchema>;

/**
 * Where a draft stands with Save (ADR 0046): whether its branch is being written now, why the
 * last try failed, its pull request once it has one, which revision of the draft that holds, and
 * whether the base branch has moved on since the draft's branch left it.
 */
export const DraftSaveSchema = z.object({
  state: z.enum(["idle", "saving", "failed"]),
  error: DraftSaveErrorSchema.nullable(),
  pull: z.object({ number: z.int(), url: z.url() }).nullable(),
  savedRevision: z.int().nullable(),
  behind: z.boolean(),
});
export type DraftSave = z.infer<typeof DraftSaveSchema>;
export const NO_DRAFT_SAVE: DraftSave = { state: "idle", error: null, pull: null, savedRevision: null, behind: false };

export const DraftSchema = z.object({
  id: DraftIdSchema,
  puzzle: PuzzleIdSchema,
  /** The GitHub login it belongs to, lower-cased. */
  owner: z.string(),
  numbers: DraftNumbersSchema,
  revision: z.int().min(1),
  /** Defaulted, so a site newer than the service it reaches still reads its drafts. */
  save: DraftSaveSchema.default(NO_DRAFT_SAVE),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Draft = z.infer<typeof DraftSchema>;

export const DraftListSchema = z.object({ drafts: z.array(DraftSchema) });

export const CreateDraftSchema = z.object({ puzzle: PuzzleIdSchema, numbers: DraftNumbersSchema });
export type CreateDraft = z.infer<typeof CreateDraftSchema>;

export const SaveDraftSchema = z.object({ numbers: DraftNumbersSchema, revision: z.int().min(1) });
export type SaveDraft = z.infer<typeof SaveDraftSchema>;

/** Save a draft: the revision on the page, which must be the stored one, and a name for the tester link Save makes first. */
export const SaveRequestSchema = z.object({ revision: z.int().min(1), name: z.string().trim().min(1).max(80) });
export type SaveRequest = z.infer<typeof SaveRequestSchema>;

/** What Save answers at once: the tester link, and the draft with its branch now being written. */
export const SaveStartedSchema = z.object({ draft: DraftSchema, link: TesterLinkSchema });
export type SaveStarted = z.infer<typeof SaveStartedSchema>;

/** Who the service takes the caller for. `signIn` says whether it has GitHub keys at all; `dev` that it offers a sign-in with no GitHub, off production; `save` that it can Save. */
export const StudioMeSchema = z.object({
  login: z.string().nullable(),
  signIn: z.boolean(),
  dev: z.boolean(),
  /** Whether this service can Save: it has a clone and a GitHub App. Defaulted for a service older than the site. */
  save: z.boolean().default(false),
});
export type StudioMe = z.infer<typeof StudioMeSchema>;

export const StudioErrorCodeSchema = z.enum(["not_found", "withdrawn", "unauthorized", "forbidden", "bad_request", "conflict", "unavailable", "internal"]);
export type StudioErrorCode = z.infer<typeof StudioErrorCodeSchema>;
export const StudioErrorSchema = z.object({ error: StudioErrorCodeSchema });
