import { doublePrecision, index, integer, jsonb, pgSchema, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { DraftNumbers, DraftSave, DraftSaveError, TesterLinkDraft } from "@openseas/protocol";

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
    /** The numbers the last Save wrote into the content file: what the next one must put back where the draft no longer changes them. */
    savedNumbers: jsonb().$type<DraftNumbers>(),
    savedRevision: integer(),
    /** The agent session the draft's chat resumes (ADR 0047); null until its first turn. */
    chatSession: text(),
    /** How many turns the chat has run. */
    chatTurns: integer().notNull().default(0),
    /** How many of those turns committed an edit: a draft with any has something to save though no number differs (ADR 0048). */
    chatCommits: integer().notNull().default(0),
    /** Paths outside the puzzle's own files that the owner allowed the agent to write, for this draft. */
    allowedPaths: jsonb().$type<string[]>().notNull().default([]),
    /** What this draft's chat has cost, in US dollars. */
    spentUsd: doublePrecision().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("draft_owner_puzzle").on(t.owner, t.puzzle)],
);

/**
 * One line of a draft's chat (ADR 0047): the owner's message, the agent's reply, a step it took,
 * a refused write waiting on the owner, or how a turn ended. The chat is the draft's and goes
 * with it.
 */
export const chatItem = studio.table(
  "chat_item",
  {
    id: serial().primaryKey(),
    draftId: text()
      .notNull()
      .references(() => draft.id, { onDelete: "cascade" }),
    turn: integer().notNull(),
    kind: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_item_draft").on(t.draftId, t.id)],
);

/**
 * What the chat has spent, all drafts together, against the one cap the owner sets (ADR 0047).
 * One row. It outlasts the drafts it was spent on.
 */
export const meter = studio.table("meter", {
  id: integer().primaryKey(),
  spentUsd: doublePrecision().notNull().default(0),
});
