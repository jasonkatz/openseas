import { and, desc, eq } from "drizzle-orm";
import type { ChatSummary } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";

export type ChatRow = typeof schema.chat.$inferSelect;

/** How long a chat's title is when it is the start of its first message. */
const TITLE_MAX = 80;

/** A chat's name until the owner gives it one: the start of its first message, on one line. */
export function titleOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

export const toSummary = (r: ChatRow, running: boolean): ChatSummary => ({
  id: r.id,
  puzzle: r.puzzle as ChatSummary["puzzle"],
  title: r.title,
  draft: r.draftId,
  turns: r.turns,
  spentUsd: r.spentUsd,
  running,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const ownerKey = (login: string): string => login.toLowerCase();

/** An owner's chats on a puzzle, those of its open draft and those whose draft is gone, the one last spoken in first (ADR 0060). */
export async function chatRows(db: Db, login: string, puzzle: string): Promise<ChatRow[]> {
  return db
    .select()
    .from(schema.chat)
    .where(and(eq(schema.chat.owner, ownerKey(login)), eq(schema.chat.puzzle, puzzle)))
    .orderBy(desc(schema.chat.updatedAt), desc(schema.chat.createdAt));
}

/** One of an owner's chats, or null. */
export async function chatRow(db: Db, login: string, id: string): Promise<ChatRow | null> {
  const [row] = await db
    .select()
    .from(schema.chat)
    .where(and(eq(schema.chat.id, id), eq(schema.chat.owner, ownerKey(login))))
    .limit(1);
  return row ?? null;
}

/** Give a chat a name of the owner's. Null when there is no such chat. */
export async function renameChat(db: Db, login: string, id: string, title: string): Promise<ChatRow | null> {
  const [row] = await db
    .update(schema.chat)
    .set({ title: titleOf(title) })
    .where(and(eq(schema.chat.id, id), eq(schema.chat.owner, ownerKey(login))))
    .returning();
  return row ?? null;
}

/** Delete a chat and its lines. Its turns' commits stay on the draft's branch: they are the draft's work, not the conversation's. */
export async function deleteChat(db: Db, login: string, id: string): Promise<boolean> {
  const gone = await db
    .delete(schema.chat)
    .where(and(eq(schema.chat.id, id), eq(schema.chat.owner, ownerKey(login))))
    .returning({ id: schema.chat.id });
  return gone.length > 0;
}
