import { integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("draft_owner_puzzle").on(t.owner, t.puzzle)],
);
