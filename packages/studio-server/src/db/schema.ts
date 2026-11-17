import { doublePrecision, index, integer, jsonb, pgSchema, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { DraftNumbers, DraftSave, DraftSaveError, TakeKind, TesterLinkDraft } from "@openseas/protocol";

/** Everything the studio's service owns lives in one Postgres schema, apart from the game's tables wherever the database is. */
export const studio = pgSchema("studio");

/**
 * A tester link (ADR 0042 decision 11): a frozen copy of a draft's numbers, addressed by an id.
 * It never expires. Withdrawing one keeps the row, so the address can say what became of it.
 */
export const testerLink = studio.table("tester_link", {
  id: text().primaryKey(),
  puzzle: text().notNull(),
  name: text().notNull(),
  /** The GitHub login of the owner who made it. */
  author: text().notNull(),
  draft: jsonb().$type<TesterLinkDraft>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp({ withTimezone: true }),
});

/**
 * A draft (ADR 0042 decision 2, ADR 0045): an owner's numbers for one puzzle, and the seed if it
 * pins one. One an owner a puzzle for now; the id is the address, so lifting the unique index is
 * all that variants need. Discarding a draft deletes its row.
 */
export const draft = studio.table(
  "draft",
  {
    id: text().primaryKey(),
    puzzle: text().notNull(),
    /** The owner's GitHub login, lower-cased. */
    owner: text().notNull(),
    numbers: jsonb().$type<DraftNumbers>().notNull(),
    /** Counts saves, from 1. A save must name the revision it was made from. */
    revision: integer().notNull().default(1),
    /** The draft's branch in the service's clone and on the remote, once it has been saved (ADR 0046). */
    branch: text(),
    pullNumber: integer(),
    pullUrl: text(),
    saveState: text().$type<DraftSave["state"]>().notNull().default("idle"),
    saveError: text().$type<DraftSaveError>(),
    /** What the last failed Save's error is about, where it is about one thing: a pick's cue (ADR 0053). */
    saveErrorDetail: text(),
    /** The numbers the last Save wrote into the content file: what the next one must put back where the draft no longer changes them. */
    savedNumbers: jsonb().$type<DraftNumbers>(),
    savedRevision: integer(),
    /** How many turns its chats have run, all together: a turn's number is the draft's, so its commit can be named and reverted (ADR 0060). */
    chatTurns: integer().notNull().default(0),
    /** How many of those turns committed an edit: a draft with any has something to save though no number differs (ADR 0049). */
    chatCommits: integer().notNull().default(0),
    /** Paths outside the puzzle's own files that the owner allowed the agent to write, for this draft. */
    allowedPaths: jsonb().$type<string[]>().notNull().default([]),
    /** What this draft's chats have cost, in US dollars. */
    spentUsd: doublePrecision().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("draft_owner_puzzle").on(t.owner, t.puzzle)],
);

/**
 * A chat (ADR 0047, ADR 0060): one conversation with the agent, with a session of its own. A draft
 * has as many as the owner starts. A chat is the owner's and the puzzle's, and outlasts its draft:
 * when the draft goes, the chat is kept with no draft, to be read, or carried onto the next one.
 */
export const chat = studio.table(
  "chat",
  {
    id: text().primaryKey(),
    /** The owner's GitHub login, lower-cased. */
    owner: text().notNull(),
    puzzle: text().notNull(),
    /** The draft it is on; null once that draft is gone. */
    draftId: text().references(() => draft.id, { onDelete: "set null" }),
    title: text().notNull(),
    /** The agent session it resumes; null until its first turn, and again once carried onto another draft. */
    session: text(),
    /** How many turns it has run. */
    turns: integer().notNull().default(0),
    spentUsd: doublePrecision().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_owner_puzzle").on(t.owner, t.puzzle, t.updatedAt), index("chat_draft").on(t.draftId)],
);

/**
 * One line of a chat (ADR 0047): the owner's message, the agent's reply, a step it took, a refused
 * write waiting on the owner, or how a turn ended. It is its chat's, and names the draft whose turn
 * it was; that is null once the draft is gone, and the line stays with its chat.
 */
export const chatItem = studio.table(
  "chat_item",
  {
    id: serial().primaryKey(),
    chatId: text()
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    draftId: text().references(() => draft.id, { onDelete: "set null" }),
    turn: integer().notNull(),
    kind: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_item_chat").on(t.chatId, t.id), index("chat_item_draft").on(t.draftId, t.turn)],
);

/**
 * What the chat has spent, all drafts together, against the one cap the owner sets (ADR 0047).
 * One row. It outlasts the drafts it was spent on.
 */
export const meter = studio.table("meter", {
  id: integer().primaryKey(),
  spentUsd: doublePrecision().notNull().default(0),
});

/**
 * A take (ADR 0051): one generated candidate for a sound cue, by the SHA-256 of its bytes. The
 * bytes are in the bucket under that hash; this row is what the panel lists. It names the draft it
 * was made on and is not that draft's: a take is kept when its draft is gone. Rows of kind
 * `sprite`, takes of a frame made before pieces were drawn in code (ADR 0062), are left where they
 * are and listed nowhere: no migration removes them (ADR 0063).
 */
export const take = studio.table(
  "take",
  {
    hash: text().primaryKey(),
    kind: text().$type<TakeKind>().notNull(),
    puzzle: text().notNull(),
    /** The cue, as the brief names it (the frame, in a sprite take's row). */
    name: text().notNull(),
    bytes: integer().notNull(),
    /** What the generator was asked for, where the script kept it beside the take. */
    prompt: text(),
    /** The draft it was made on and its number among that draft's takes of this name. */
    draftId: text(),
    take: integer(),
    /** The owner whose chat made it. */
    author: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("take_puzzle").on(t.puzzle, t.kind, t.name)],
);
