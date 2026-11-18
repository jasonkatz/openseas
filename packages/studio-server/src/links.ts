import { randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { PuzzleIdSchema, lookOf, wordsOf, type CreateTesterLink, type DraftNumbers, type Look, type TesterLink, type Words } from "@openseas/protocol";
import { schema, type Db } from "./db/index.js";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const PUZZLE_IDS = new Set<string>(PuzzleIdSchema.options);

/** Ten characters with nothing that reads as something else (no l, o, 0, 1), and never a puzzle's id: both follow `/play/`. */
export function newLinkId(): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 10; i++) id += ALPHABET[randomInt(ALPHABET.length)];
    if (!PUZZLE_IDS.has(id)) return id;
  }
}

type Row = typeof schema.testerLink.$inferSelect;

/**
 * A stored draft's numbers as they are sent, and as a new link freezes them. A row kept before
 * words, or before the look (ADR 0065), has none: it is sent with none, whole. A row kept before ADR 0062 may still carry `picks`,
 * the takes chosen for frames and cues: it stays in the row as it was, and is never sent or
 * copied on (ADR 0063, ADR 0064).
 */
export function sentNumbers(numbers: DraftNumbers): DraftNumbers & { words: Words; look: Look } {
  const { picks: _picks, ...rest } = numbers as DraftNumbers & { picks?: unknown };
  return { ...rest, words: wordsOf(numbers), look: lookOf(numbers) };
}

const toLink = (r: Row): TesterLink => ({
  id: r.id,
  puzzle: r.puzzle as TesterLink["puzzle"],
  name: r.name,
  author: r.author,
  draft: sentNumbers(r.draft),
  createdAt: r.createdAt.toISOString(),
  withdrawn: r.withdrawnAt !== null,
});

export async function createLink(db: Db, author: string, input: CreateTesterLink): Promise<TesterLink> {
  const [row] = await db.insert(schema.testerLink).values({ id: newLinkId(), puzzle: input.puzzle, name: input.name, author, draft: input.draft }).returning();
  return toLink(row!);
}

export async function findLink(db: Db, id: string): Promise<TesterLink | null> {
  const [row] = await db.select().from(schema.testerLink).where(eq(schema.testerLink.id, id)).limit(1);
  return row ? toLink(row) : null;
}

/** A puzzle's links that still play, newest first. */
export async function listLinks(db: Db, puzzle: string): Promise<TesterLink[]> {
  const rows = await db
    .select()
    .from(schema.testerLink)
    .where(and(eq(schema.testerLink.puzzle, puzzle), isNull(schema.testerLink.withdrawnAt)))
    .orderBy(desc(schema.testerLink.createdAt))
    .limit(200);
  return rows.map(toLink);
}

/** Withdraw a link. It stays in the table and plays nothing. Null when there is no such link. */
export async function withdrawLink(db: Db, id: string): Promise<TesterLink | null> {
  const [row] = await db.update(schema.testerLink).set({ withdrawnAt: new Date() }).where(and(eq(schema.testerLink.id, id), isNull(schema.testerLink.withdrawnAt))).returning();
  return row ? toLink(row) : findLink(db, id);
}
