import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Content } from "@openseas/content";
import { NEW_RATING, isPuzzleId, tierFor } from "@openseas/engine";
import type { PirateSummary } from "@openseas/protocol";
import { schema, type Db } from "./db/index.js";
import { balance } from "./ledger.js";
import { applyAutomaticGrants } from "./shipyard.js";
import { recordEvent } from "./events.js";

export function randomPirateName(content: Content, pick: (n: number) => number = randomInt): string {
  const a = content.names.adjectives[pick(content.names.adjectives.length)]!;
  const n = content.names.nouns[pick(content.names.nouns.length)]!;
  return `${a} ${n}`;
}

export class PirateExistsError extends Error {
  constructor() {
    super("pirate exists");
    this.name = "PirateExistsError";
  }
}

/** Create the pirate for an auth user, with a unique random name and the starter grant. */
export async function createPirate(db: Db, content: Content, userId: string): Promise<{ id: string; name: string }> {
  const [existing] = await db.select().from(schema.pirate).where(eq(schema.pirate.userId, userId));
  if (existing) throw new PirateExistsError();

  for (let attempt = 0; attempt < 20; attempt++) {
    const name = attempt < 10 ? randomPirateName(content) : `${randomPirateName(content)} ${randomInt(100, 999)}`;
    const [taken] = await db.select({ id: schema.pirate.id }).from(schema.pirate).where(eq(schema.pirate.name, name));
    if (taken) continue;
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.pirate).values({ id, userId, name });
      await applyAutomaticGrants(tx, content, id, name, { voyagesCompleted: 0, bestRating: null });
      await recordEvent(tx, id, "pirate.created", {});
    });
    return { id, name };
  }
  throw new Error("could not find a free pirate name");
}

export async function findPirateByUser(db: Db, userId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: schema.pirate.id, name: schema.pirate.name })
    .from(schema.pirate)
    .where(eq(schema.pirate.userId, userId));
  return row ?? null;
}

export async function summarizePirate(db: Db, content: Content, pirateId: string, guest: boolean): Promise<PirateSummary | null> {
  const [p] = await db.select().from(schema.pirate).where(eq(schema.pirate.id, pirateId));
  if (!p) return null;
  const [coins, ships, ratings] = await Promise.all([
    balance(db, pirateId),
    db.select().from(schema.ship).where(eq(schema.ship.ownerId, pirateId)),
    db.select().from(schema.rating).where(eq(schema.rating.pirateId, pirateId)),
  ]);
  return {
    id: p.id,
    name: p.name,
    guest,
    balance: coins,
    ships: ships.map((s) => ({ id: s.id, classId: s.classId, name: s.name })),
    ratings: ratings.flatMap((r) =>
      isPuzzleId(r.puzzle)
        ? [{ puzzle: r.puzzle, tier: tierFor(r.rating ?? NEW_RATING.rating, content.ratingTiers).key, rounds: r.rounds }]
        : [],
    ),
  };
}
