import { eq } from "drizzle-orm";
import type { TakeKind } from "@openseas/protocol";
import { schema, type Db } from "../db/index.js";
import type { TakeStore } from "./store.js";

/**
 * How each kind of take is served. The type is the service's to say, never the file's. The
 * service makes and lists no take of either kind any more (ADR 0062), but the table and the
 * bucket still hold those made before, and one asked for by its hash is still read (ADR 0063,
 * ADR 0064).
 */
export const TAKE_TYPES: Readonly<Record<TakeKind, string>> = { sprite: "image/webp", sound: "audio/mpeg" };

const keyOf = (hash: string): string => `takes/${hash}`;

/**
 * The takes kept from before (ADR 0051): rows in the table, bytes in the bucket, both by the
 * bytes' hash. Read-only: nothing is added, listed or picked (ADR 0064).
 */
export interface Takes {
  /** A take's bytes and how to serve them, or null when there is no such take. */
  read(hash: string): Promise<{ bytes: Buffer; contentType: string } | null>;
}

export function createTakes(o: { db: Db; store: TakeStore }): Takes {
  const { db, store } = o;
  return {
    async read(hash) {
      const [row] = await db.select({ kind: schema.take.kind }).from(schema.take).where(eq(schema.take.hash, hash)).limit(1);
      if (!row) return null;
      const bytes = await store.get(keyOf(hash));
      return bytes ? { bytes, contentType: TAKE_TYPES[row.kind] } : null;
    },
  };
}
