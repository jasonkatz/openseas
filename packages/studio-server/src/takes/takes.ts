import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Take, TakeKind } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import type { Logger } from "../log.js";
import { scanTakes } from "./scan.js";
import type { TakeStore } from "./store.js";

/**
 * How each kind of take is served. The type is the service's to say, never the file's. A sprite
 * take is none the service makes or lists any more (ADR 0062), but the table and the bucket still
 * hold those made before, and one asked for by its hash is still read (ADR 0063).
 */
export const TAKE_TYPES: Readonly<Record<TakeKind, string>> = { sprite: "image/webp", sound: "audio/mpeg" };

const keyOf = (hash: string): string => `takes/${hash}`;

/** The library of takes (ADR 0042 decision 12, ADR 0051): rows here, bytes in the bucket, both by the bytes' hash. */
export interface Takes {
  /** Keep whatever takes of the puzzle a draft's worktree holds that are not kept yet. The kinds of the new ones. */
  ingest(worktree: string, from: { draft: string; puzzle: string; owner: string }): Promise<TakeKind[]>;
  /** A puzzle's takes, oldest first. */
  list(puzzle: string): Promise<Take[]>;
  /** A take's bytes and how to serve them, or null when there is no such take. */
  read(hash: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** What a take is a take of, from its row alone; null when no take has that hash. */
  info(hash: string): Promise<Pick<Take, "kind" | "puzzle" | "name" | "draft" | "take"> | null>;
}

export function createTakes(o: { db: Db; store: TakeStore; log: Logger }): Takes {
  const { db, store, log } = o;
  return {
    async ingest(worktree, from) {
      const found = scanTakes(worktree, from.puzzle).map((t) => ({ ...t, hash: createHash("sha256").update(t.bytes).digest("hex") }));
      if (found.length === 0) return [];
      const kept = new Set(
        (
          await db
            .select({ hash: schema.take.hash })
            .from(schema.take)
            .where(inArray(schema.take.hash, found.map((t) => t.hash)))
        ).map((r) => r.hash),
      );
      const made: TakeKind[] = [];
      for (const t of found) {
        if (kept.has(t.hash)) continue;
        kept.add(t.hash);
        try {
          // The bytes first: a row always has its take behind it.
          await store.put(keyOf(t.hash), t.bytes, TAKE_TYPES[t.kind]);
          const rows = await db
            .insert(schema.take)
            .values({ hash: t.hash, kind: t.kind, puzzle: from.puzzle, name: t.name, bytes: t.bytes.length, prompt: t.prompt, draftId: from.draft, take: t.take, author: from.owner })
            .onConflictDoNothing()
            .returning({ hash: schema.take.hash });
          if (rows.length) made.push(t.kind);
        } catch (err) {
          log.error({ err, draft: from.draft, name: t.name }, "could not keep a take");
        }
      }
      if (made.length) log.info({ draft: from.draft, puzzle: from.puzzle, takes: made.length }, "takes kept");
      return made;
    },
    async list(puzzle) {
      // Only sounds: the sprite takes kept from before pieces were drawn in code stay in the table and are listed nowhere (ADR 0063).
      const rows = await db
        .select()
        .from(schema.take)
        .where(and(eq(schema.take.puzzle, puzzle), eq(schema.take.kind, "sound")))
        .orderBy(asc(schema.take.createdAt), asc(schema.take.take));
      return rows.map((r) => ({ hash: r.hash, kind: r.kind, puzzle: r.puzzle as Take["puzzle"], name: r.name, bytes: r.bytes, prompt: r.prompt, draft: r.draftId, take: r.take, createdAt: r.createdAt.toISOString() }));
    },
    async read(hash) {
      const [row] = await db.select({ kind: schema.take.kind }).from(schema.take).where(eq(schema.take.hash, hash)).limit(1);
      if (!row) return null;
      const bytes = await store.get(keyOf(hash));
      return bytes ? { bytes, contentType: TAKE_TYPES[row.kind] } : null;
    },
    async info(hash) {
      const [row] = await db.select().from(schema.take).where(eq(schema.take.hash, hash)).limit(1);
      return row ? { kind: row.kind, puzzle: row.puzzle as Take["puzzle"], name: row.name, draft: row.draftId, take: row.take } : null;
    },
  };
}
