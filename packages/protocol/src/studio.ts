import { z } from "zod";
import { PuzzleIdSchema } from "./common.js";

/**
 * What the puzzle studio and its service say to each other (ADR 0042 decision 4, ADR 0043). Not
 * the game's wire: the game's server knows none of this, and the studio's service deals no round.
 */

/** A tester link's id: ten characters a person can read out. Never a puzzle's id, since both follow `/play/`. */
export const TesterLinkIdSchema = z.string().regex(/^[a-z0-9]{10}$/);

/** A take's address: the SHA-256 of its bytes, in hex. Nobody can guess one, and it never names different bytes. */
export const TakeHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** A frame's or a cue's name, as a brief and the generation scripts spell it. */
const AssetNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const few = (o: Record<string, unknown>): boolean => Object.keys(o).length <= 128;

/**
 * A draft's picks (ADR 0042 decision 2, ADR 0052): the take chosen for a sprite frame or a sound
 * cue, by the take's hash. A cue may also pick `synth`: the synthesized cue over a bundled sample
 * (ADR 0041). A frame or a cue with no entry is as the build ships it. Only the shape is checked:
 * a hash that names no take the service keeps leaves the board as shipped.
 */
export const PicksSchema = z.object({
  sprites: z.record(AssetNameSchema, TakeHashSchema).refine(few, "too many picks").default({}),
  sounds: z.record(AssetNameSchema, z.union([TakeHashSchema, z.literal("synth")])).refine(few, "too many picks").default({}),
});
export type Picks = z.infer<typeof PicksSchema>;
export const NO_PICKS: Picks = { sprites: {}, sounds: {} };

/**
 * A draft's numbers and picks: what it lays over the puzzle's content file and its art, and the
 * seed if it pins one. (The name is older than picks.)
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
  /** Defaulted: a draft or a link kept before picks has none, and a service older than the site sends none. */
  picks: PicksSchema.default(NO_PICKS),
});
/** As it is kept and sent: `picks` may be missing, in a row or a link from before there were any. Read them with `picksOf`. */
export type DraftNumbers = z.input<typeof DraftNumbersSchema>;

/** A draft's picks, whole: none where it was kept before there were any. */
export const picksOf = (numbers: Pick<DraftNumbers, "picks">): Picks => ({ sprites: numbers.picks?.sprites ?? {}, sounds: numbers.picks?.sounds ?? {} });
/** How many frames and cues a draft has picked a take for. */
export const pickCount = (numbers: Pick<DraftNumbers, "picks">): number => Object.keys(numbers.picks?.sprites ?? {}).length + Object.keys(numbers.picks?.sounds ?? {}).length;

/** The numbers a tester link freezes: a copy of a draft's, taken when the link was made. */
export const TesterLinkDraftSchema = DraftNumbersSchema;
export type TesterLinkDraft = DraftNumbers;

export const CreateTesterLinkSchema = z.object({
  puzzle: PuzzleIdSchema,
  /** What the owner calls this draft; a tester sees it in the details sheet. */
  name: z.string().trim().min(1).max(80),
  draft: TesterLinkDraftSchema,
});
export type CreateTesterLink = z.input<typeof CreateTesterLinkSchema>;

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
/**
 * Why a Save or an update did not finish. `nothing`: the draft changes no number, picks no take and the chat has edited no file.
 * `unknown_key`: it sets a key the content file has no place for. `pick`: a pick cannot be placed: its take is not kept, is of
 * another kind, puzzle, frame or cue, or picks a frame the atlas does not have (ADR 0053). `takes`: the service could not read
 * the picked takes or place them. `conflict`: the base branch and the draft's changed the same lines. `interrupted`: the service
 * restarted under it.
 */
export const DraftSaveErrorSchema = z.enum(["nothing", "unknown_key", "pick", "takes", "conflict", "git", "github", "interrupted"]);
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
  /** True once a turn of the chat has committed an edit to the draft's branch: there is something to save even when no number differs (ADR 0049). Defaulted for a service older than the site. */
  edits: z.boolean().default(false),
  /** What the error is about, where it is about one thing: for `pick`, the frame or cue. Defaulted for a service older than the site. */
  detail: z.string().max(80).nullable().default(null),
});
export type DraftSave = z.infer<typeof DraftSaveSchema>;
export const NO_DRAFT_SAVE: DraftSave = { state: "idle", error: null, pull: null, savedRevision: null, behind: false, edits: false, detail: null };

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

/** The models the chat can run on (ADR 0047). The service knows which model each name means; the site only names the choice. */
export const ChatModelSchema = z.enum(["sonnet", "haiku", "opus"]);
export type ChatModel = z.infer<typeof ChatModelSchema>;

/** One round played on the page, as a message to the agent carries it (ADR 0042 decision 5). */
export const RoundSummarySchema = z.object({
  seed: z.string().max(64),
  score: z.number(),
  /** The tier the score fell in, by its key; null when the round was not rated. */
  tier: z.string().max(32).nullable(),
  /** How long the round ran, in seconds. */
  seconds: z.number().min(0),
  moves: z.int().min(0),
  /** True when the round was dealt on the draft's numbers, false on the shipped ones. */
  tuned: z.boolean(),
});
export type RoundSummary = z.infer<typeof RoundSummarySchema>;

/** A message to the agent: the owner's words, the model to run, and what the page knows that the service does not. */
export const SendChatSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  model: ChatModelSchema,
  /** The last few rounds played, oldest first. */
  rounds: z.array(RoundSummarySchema).max(8),
  /** What the current build refuses of the draft's numbers, a line each: the service imports no engine and cannot tell. */
  refusals: z.array(z.string().max(300)).max(16),
});
export type SendChat = z.infer<typeof SendChatSchema>;

/**
 * Why a turn failed. `agent`: the agent's process ended on an error. `worktree`: the service could
 * not prepare the draft's worktree. `restart`: the service restarted while the turn ran. `idle`:
 * the agent said nothing for so long that the service stopped it.
 */
export const ChatFailureSchema = z.enum(["agent", "worktree", "restart", "idle"]);
export type ChatFailure = z.infer<typeof ChatFailureSchema>;

const item = <K extends string, D extends z.ZodRawShape>(kind: K, data: D) => z.object({ id: z.int(), turn: z.int(), kind: z.literal(kind), at: z.iso.datetime(), ...data });

/**
 * One line of a draft's chat, in order (ADR 0047). `user`: the owner's message, or one sent while
 * a turn ran to steer it. `reply`: the agent's words, shown whole and never through the message
 * table. `step`: one thing it did, a line, with the output or diff behind it. `ask`: a write
 * outside the puzzle's files that the service refused, for the owner to allow or not. `turn`: how
 * a turn ended, with its commit, what it cost, and whether it was reverted since.
 */
export const ChatItemSchema = z.discriminatedUnion("kind", [
  item("user", { text: z.string(), model: ChatModelSchema, steer: z.boolean() }),
  item("reply", { text: z.string() }),
  item("step", { tool: z.string(), summary: z.string(), detail: z.string().nullable(), failed: z.boolean() }),
  item("ask", { path: z.string(), state: z.enum(["pending", "allowed", "refused"]) }),
  item("turn", {
    status: z.enum(["done", "stopped", "failed", "capped"]),
    /** Why a failed turn failed, as far as the service can say; absent on a turn that did not fail, and on rows from before this was kept. */
    reason: ChatFailureSchema.nullish(),
    /** What the agent or the service said as it failed, as it said it, cut short. For the owner to read, not for the message table. */
    error: z.string().nullish(),
    /** The commit the turn's edits made in the draft's worktree; null when it edited nothing. */
    commit: z.string().nullable(),
    costUsd: z.number(),
    reverted: z.boolean(),
  }),
]);
export type ChatItem = z.infer<typeof ChatItemSchema>;

/** A draft's chat as the page reads it: the items after the one it last saw, whether a turn is running, and the money. */
export const ChatStateSchema = z.object({
  items: z.array(ChatItemSchema),
  running: z.boolean(),
  /** What this draft's chat has cost so far. */
  spentUsd: z.number(),
  /** The one cap all drafts share, and what has been spent against it. */
  cap: z.object({ spentUsd: z.number(), capUsd: z.number() }),
  /** The draft as the service now holds it: the agent's tool moves its numbers, and the page follows. */
  draft: DraftSchema,
  /** The words of the reply the agent is writing now, so far; empty when it is writing none (ADR 0055). */
  live: z.string().default(""),
});
export type ChatState = z.infer<typeof ChatStateSchema>;

/** A chat without its lines: what changes when a turn starts, spends, moves a number or ends. */
export const ChatStatusSchema = ChatStateSchema.omit({ items: true, live: true });
export type ChatStatus = z.infer<typeof ChatStatusSchema>;

/**
 * One message of a chat's event stream (ADR 0055). `state`: the whole chat, sent first on every
 * connection, so a page that reconnects needs nothing it had. `item`: a line that is new, or
 * changed since it was sent (a step's outcome, an answered ask, a reverted turn), told apart by
 * its id. `delta`: more words of the reply being written; `reset` first forgets the words so far,
 * when the reply they were part of has arrived whole as an item or is being written again.
 * `status`: everything of the chat but its lines.
 */
export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: ChatStateSchema }),
  z.object({ type: z.literal("item"), item: ChatItemSchema }),
  z.object({ type: z.literal("delta"), text: z.string(), reset: z.boolean() }),
  z.object({ type: z.literal("status"), status: ChatStatusSchema }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const ChatRevertSchema = z.object({ turn: z.int().min(1) });
export const ChatAllowSchema = z.object({ item: z.int(), allow: z.boolean() });

/** What a take is of: a sprite frame, or a sound cue. */
export const TakeKindSchema = z.enum(["sprite", "sound"]);
export type TakeKind = z.infer<typeof TakeKindSchema>;

/**
 * A take (ADR 0040, ADR 0051): one generated candidate for a frame or a cue, kept by the service
 * in the form it would be committed in (a fitted square frame, a mastered sound) under the hash of
 * those bytes. Takes outlast the draft they were made on, so a frame or a cue gathers a library.
 */
export const TakeSchema = z.object({
  hash: TakeHashSchema,
  kind: TakeKindSchema,
  puzzle: PuzzleIdSchema,
  /** The frame or the cue it is a take of, as the brief names it. */
  name: z.string(),
  bytes: z.int().min(0),
  /** What the generator was asked for, where the script kept it. */
  prompt: z.string().nullable(),
  /** The draft it was made on, and its number among that draft's takes of this name: how the owner and the agent name it to each other. */
  draft: z.string().nullable(),
  take: z.int().nullable(),
  createdAt: z.iso.datetime(),
});
export type Take = z.infer<typeof TakeSchema>;
export const TakeListSchema = z.object({ takes: z.array(TakeSchema) });

/** Who the service takes the caller for. `signIn` says whether it has GitHub keys at all; `dev` that it offers a sign-in with no GitHub, off production; `save` that it can Save. */
export const StudioMeSchema = z.object({
  login: z.string().nullable(),
  signIn: z.boolean(),
  dev: z.boolean(),
  /** Whether this service can Save: it has a clone and a GitHub App. Defaulted for a service older than the site. */
  save: z.boolean().default(false),
  /** Whether this service can run the chat: Save, a model key, a cap, and a user of its own for the agent. Defaulted likewise. */
  chat: z.boolean().default(false),
  /** Whether this service keeps takes: it has a bucket to keep them in. Defaulted likewise. */
  takes: z.boolean().default(false),
  /** Whether this service keeps a draft's picks: one older than them drops what it is sent. Defaulted likewise. */
  picks: z.boolean().default(false),
});
export type StudioMe = z.infer<typeof StudioMeSchema>;

export const StudioErrorCodeSchema = z.enum(["not_found", "withdrawn", "unauthorized", "forbidden", "bad_request", "conflict", "capped", "unavailable", "internal"]);
export type StudioErrorCode = z.infer<typeof StudioErrorCodeSchema>;
export const StudioErrorSchema = z.object({ error: StudioErrorCodeSchema });
