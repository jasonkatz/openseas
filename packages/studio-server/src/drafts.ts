import { and, eq, sql } from "drizzle-orm";
import type { CreateDraft, Draft, SaveDraft } from "@openseas/protocol";
import { schema, type Db } from "./db/index.js";
import { newLinkId } from "./links.js";

type Row = typeof schema.draft.$inferSelect;

const toDraft = (r: Row): Draft => ({
  id: r.id,
  puzzle: r.puzzle as Draft["puzzle"],
  owner: r.owner,
  numbers: r.numbers,
  revision: r.revision,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const ownerKey = (login: string): string => login.toLowerCase();

/** An owner's open drafts, one puzzle's or all of them, most lately saved first. */
export async function listDrafts(db: Db, login: string, puzzle?: string): Promise<Draft[]> {
  const mine = eq(schema.draft.owner, ownerKey(login));
  const rows = await db
    .select()
    .from(schema.draft)
    .where(puzzle ? and(mine, eq(schema.draft.puzzle, puzzle)) : mine)
    .orderBy(sql`${schema.draft.updatedAt} desc`);
  return rows.map(toDraft);
}

/** Open a draft. Null when the owner already has one for the puzzle: there is one a puzzle (ADR 0042 decision 2). */
export async function createDraft(db: Db, login: string, input: CreateDraft): Promise<Draft | null> {
  const [row] = await db.insert(schema.draft).values({ id: newLinkId(), puzzle: input.puzzle, owner: ownerKey(login), numbers: input.numbers }).onConflictDoNothing().returning();
  return row ? toDraft(row) : null;
}

export type SaveResult = { ok: true; draft: Draft } | { ok: false; reason: "not_found" | "conflict" };

/** Save a draft's numbers over the revision the caller last saw. A draft saved since is left as it is. */
export async function saveDraft(db: Db, login: string, id: string, input: SaveDraft): Promise<SaveResult> {
  const mine = and(eq(schema.draft.id, id), eq(schema.draft.owner, ownerKey(login)));
  const [row] = await db
    .update(schema.draft)
    .set({ numbers: input.numbers, revision: sql`${schema.draft.revision} + 1`, updatedAt: new Date() })
    .where(and(mine, eq(schema.draft.revision, input.revision)))
    .returning();
  if (row) return { ok: true, draft: toDraft(row) };
  const [there] = await db.select({ id: schema.draft.id }).from(schema.draft).where(mine).limit(1);
  return { ok: false, reason: there ? "conflict" : "not_found" };
}

/** Discard a draft: the row goes. False when the owner has no such draft. */
export async function discardDraft(db: Db, login: string, id: string): Promise<boolean> {
  const gone = await db.delete(schema.draft).where(and(eq(schema.draft.id, id), eq(schema.draft.owner, ownerKey(login)))).returning({ id: schema.draft.id });
  return gone.length > 0;
}
