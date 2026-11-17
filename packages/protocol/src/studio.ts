import { z } from "zod";
import { PuzzleIdSchema } from "./common.js";

/**
 * What the puzzle studio and its service say to each other (ADR 0042 decision 4, ADR 0043). Not
 * the game's wire: the game's server knows none of this, and the studio's service deals no round.
 */

/** A tester link's id: ten characters a person can read out. Never a puzzle's id, since both follow `/play/`. */
export const TesterLinkIdSchema = z.string().regex(/^[a-z0-9]{10}$/);

/**
 * A take's address: the SHA-256 of its bytes, in hex. Nobody can guess one, and it never names
 * different bytes. A take was a generated candidate for a sprite or a sound (ADR 0040, ADR 0051).
 * Nothing makes, lists, picks or places one now (ADR 0062), but the service still holds those made
 * before and still gives one to whoever has its hash (ADR 0063, ADR 0064).
 */
export const TakeHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const few = (o: Record<string, unknown>): boolean => Object.keys(o).length <= 128;

/** What kind of puzzle one is, as a label: the content files' own list (`content`'s `PUZZLE_CATEGORIES`; a test in `studio` holds the two to each other). */
export const PuzzleCategorySchema = z.enum(["duty", "fight", "crafting", "prototype"]);
export type PuzzleCategory = z.infer<typeof PuzzleCategorySchema>;

/** A key of the message table, as the table spells it. */
const TextKeySchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/).max(96);
/** The longest a string of the message table may be made in the studio. */
export const TEXT_MAX = 600;

/**
 * A draft's words (ADR 0057): strings of the message table the draft rewrites, by their keys, and
 * the puzzle's category where the draft changes it. A key with no entry reads as the build ships
 * it. Only the shape is checked here: which keys are a puzzle's is `isPuzzleText`, asked where
 * the puzzle is known.
 */
export const WordsSchema = z.object({
  texts: z.record(TextKeySchema, z.string().min(1).max(TEXT_MAX)).refine(few, "too many texts").default({}),
  category: PuzzleCategorySchema.nullable().default(null),
});
export type Words = z.infer<typeof WordsSchema>;
export const NO_WORDS: Words = { texts: {}, category: null };

/** Whether a key of the message table is one puzzle's to rewrite: its own strings, and its name and blurb on the grid. */
export const isPuzzleText = (puzzle: string, key: string): boolean => key.startsWith(`${puzzle}.`) || key === `home.practice_${puzzle}` || key === `home.practice_${puzzle}_blurb`;

/** The names a string fills in (`{count}`), in order. A rewritten string must keep the shipped one's, or the board would print a brace. */
export const textVars = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

/**
 * A draft's numbers and words: what it lays over the puzzle's content file and the message table,
 * and the seed if it pins one. (The name is older than words.)
 * Only the shape is checked here. Whether a build will play them is that build's own question,
 * asked on the page that deals the round (ADR 0042 decisions 3 and 11).
 *
 * A draft once held `picks` too: the take chosen for a frame of a puzzle's atlas (`picks.sprites`)
 * or for a sound cue (`picks.sounds`, a take's hash or `synth`). Pieces are drawn in code and cues
 * are synthesized now, and nothing picks a take (ADR 0062), but drafts and tester links kept
 * before then still carry the key. It is read and dropped: this object names no `picks` key, and
 * an object schema drops a key it does not name, so stored data parses as it always did and the
 * picks go no further (ADR 0063, ADR 0064). Never make this schema strict (a test in `protocol`
 * holds it to that).
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
  /** Defaulted: a draft or a link kept before words has none, and a service older than the site sends none. */
  words: WordsSchema.default(NO_WORDS),
});
/** As it is kept and sent: `words` may be missing, in a row or a link from before there were any. Read them with `wordsOf`. */
export type DraftNumbers = z.input<typeof DraftNumbersSchema>;

/** A draft's words, whole: none where it was kept before there were any. */
export const wordsOf = (numbers: Pick<DraftNumbers, "words">): Words => ({ texts: numbers.words?.texts ?? {}, category: numbers.words?.category ?? null });
/** How many strings a draft rewrites, and one more where it changes the category. */
export const wordCount = (numbers: Pick<DraftNumbers, "words">): number => Object.keys(numbers.words?.texts ?? {}).length + (numbers.words?.category ? 1 : 0);

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
 * Why a Save or an update did not finish. `nothing`: the draft changes no number or word and the chat has edited no file.
 * `unknown_key`: it sets a key the content file has no place for, or rewrites a string that is not the puzzle's or not in the message table.
 * `conflict`: the base branch and the draft's changed the same lines. `interrupted`: the service
 * restarted under it. `pick` and `takes` are only ever read: a Save that could not place a picked
 * take failed with one of them, and a draft may still be kept with that as its last error. No Save
 * places a pick now, so none fails so (ADR 0062, ADR 0064).
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
  /** What the error is about, where it is about one thing. Defaulted for a service older than the site. */
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

/** A chat's id (ADR 0060): the same shape as a draft's. The first chat of a draft from before chats were many has its draft's id. */
export const ChatIdSchema = z.string().regex(/^[a-z0-9]{10}$/);

/** A message to the agent: the owner's words, the model to run, and what the page knows that the service does not. */
export const SendChatSchema = z.object({
  /** The chat it goes to; null starts a new one. A chat from an earlier draft of the puzzle is carried onto this one (ADR 0060). */
  chat: ChatIdSchema.nullable().default(null),
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

/**
 * One of an owner's chats on a puzzle, as the list of them shows it (ADR 0060). A chat is on the
 * puzzle's open draft, or on none: the draft it was on was discarded, or cleared when its pull
 * request merged or closed. Such a chat can be read, and a message carries it onto the open draft.
 */
export const ChatSummarySchema = z.object({
  id: ChatIdSchema,
  puzzle: PuzzleIdSchema,
  /** The owner's name for it, or the start of its first message until they give one. */
  title: z.string(),
  /** The draft it is on; null when that draft is gone. */
  draft: z.string().nullable(),
  /** How many turns it has run. */
  turns: z.int().min(0),
  /** What it has cost, in US dollars. */
  spentUsd: z.number(),
  /** True while a turn of this chat runs. */
  running: z.boolean(),
  createdAt: z.iso.datetime(),
  /** When something was last said in it. */
  updatedAt: z.iso.datetime(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;
/** An owner's chats on a puzzle, and the one cap all drafts share with what has been spent against it, for a chat not yet started. */
export const ChatListSchema = z.object({ chats: z.array(ChatSummarySchema), cap: z.object({ spentUsd: z.number(), capUsd: z.number() }) });
export type ChatList = z.infer<typeof ChatListSchema>;

/** One chat as the page reads it: the items after the one it last saw, whether a turn is running, and the money. */
export const ChatStateSchema = z.object({
  chat: ChatSummarySchema,
  items: z.array(ChatItemSchema),
  /** True while a turn of another chat runs on the same draft: a draft runs one turn at a time, so this chat waits. */
  busy: z.boolean().default(false),
  /** The one cap all drafts share, and what has been spent against it. */
  cap: z.object({ spentUsd: z.number(), capUsd: z.number() }),
  /** The chat's draft as the service now holds it: the agent's tool moves its numbers, and the page follows. Null for a chat whose draft is gone. */
  draft: DraftSchema.nullable(),
  /** The words of the reply the agent is writing now, so far; empty when it is writing none (ADR 0055). */
  live: z.string().default(""),
});
export type ChatState = z.infer<typeof ChatStateSchema>;

/** A chat without its lines: what changes when a turn starts, spends, moves a number or ends. */
export const ChatStatusSchema = ChatStateSchema.omit({ items: true, live: true });
export type ChatStatus = z.infer<typeof ChatStatusSchema>;

/** What a message answers: the chat it went to, new or not. */
export const ChatSentSchema = z.object({ chat: ChatIdSchema });
export type ChatSent = z.infer<typeof ChatSentSchema>;
/** A chat's new name. */
export const RenameChatSchema = z.object({ title: z.string().trim().min(1).max(120) });

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

/**
 * What a kept take is of: a frame of a puzzle's atlas or a sound cue. Only ever read: the service's
 * table holds takes of both kinds made before ADR 0062, and serves one by its hash with the type
 * its kind has (ADR 0063, ADR 0064). Nothing makes one of either kind now.
 */
export const TakeKindSchema = z.enum(["sprite", "sound"]);
export type TakeKind = z.infer<typeof TakeKindSchema>;

/** Who the service takes the caller for. `signIn` says whether it has GitHub keys at all; `dev` that it offers a sign-in with no GitHub, off production; `save` that it can Save. */
export const StudioMeSchema = z.object({
  login: z.string().nullable(),
  signIn: z.boolean(),
  dev: z.boolean(),
  /** Whether this service can Save: it has a clone and a GitHub App. Defaulted for a service older than the site. */
  save: z.boolean().default(false),
  /** Whether this service can run the chat: Save, a model key, a cap, and a user of its own for the agent. Defaulted likewise. */
  chat: z.boolean().default(false),
  /** Whether this service keeps a draft's words (ADR 0057). Defaulted likewise. */
  words: z.boolean().default(false),
});
export type StudioMe = z.infer<typeof StudioMeSchema>;

export const StudioErrorCodeSchema = z.enum(["not_found", "withdrawn", "unauthorized", "forbidden", "bad_request", "conflict", "busy", "capped", "unavailable", "internal"]);
export type StudioErrorCode = z.infer<typeof StudioErrorCodeSchema>;
export const StudioErrorSchema = z.object({ error: StudioErrorCodeSchema });
