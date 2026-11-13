import { jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import type { TesterLinkDraft } from "@openseas/protocol";

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
