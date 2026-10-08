import { schema, type Db, type Tx } from "./db/index.js";

/** Gameplay analytics row (DESIGN.md 4.6). Never blocks gameplay: callers may fire and forget. */
export async function recordEvent(db: Db | Tx, pirateId: string | null, type: string, data: Record<string, unknown>): Promise<void> {
  await db.insert(schema.event).values({ pirateId, type, data });
}
