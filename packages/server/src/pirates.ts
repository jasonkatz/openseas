import { randomInt, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { defaultLook, pirateLookProblem, type Content, type PirateLook, type Title } from "@openseas/content";
import { NEW_RATING, isPuzzleId, tierFor } from "@openseas/engine";
import type { ErrorCode, PirateRecord, PirateSheet, PirateSummary, TitleProgress } from "@openseas/protocol";
import { schema, type Db } from "./db/index.js";
import { balance } from "./ledger.js";
import { applyAutomaticGrants } from "./shipyard.js";
import { recordEvent } from "./events.js";

export function randomPirateName(content: Content, pick: (n: number) => number = randomInt): string {
  const a = content.names.adjectives[pick(content.names.adjectives.length)]!;
  const n = content.names.nouns[pick(content.names.nouns.length)]!;
  return `${a} ${n}`;
}

/** A request about the pirate's own sheet refused. The code is sent to the client as is. */
export class PirateError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "PirateError";
  }
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
      await tx.insert(schema.pirate).values({ id, userId, name, islandId: content.world.startIslandId });
      await applyAutomaticGrants(tx, content, id, name, { voyagesCompleted: 0, bestRating: null }, content.world.startIslandId);
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
  const [coins, ships, ratings, [crew]] = await Promise.all([
    balance(db, pirateId),
    db.select().from(schema.ship).where(eq(schema.ship.ownerId, pirateId)),
    db.select().from(schema.rating).where(eq(schema.rating.pirateId, pirateId)),
    db
      .select({ id: schema.crew.id, name: schema.crew.name, flag: schema.crew.flag, rank: schema.crewMember.rank })
      .from(schema.crewMember)
      .innerJoin(schema.crew, eq(schema.crew.id, schema.crewMember.crewId))
      .where(eq(schema.crewMember.pirateId, pirateId)),
  ]);
  return {
    id: p.id,
    name: p.name,
    look: lookOf(content, p.id, p.look),
    title: shownTitle(content, p.title),
    guest,
    balance: coins,
    islandId: p.islandId ?? content.world.startIslandId,
    ships: ships.map((s) => ({ id: s.id, classId: s.classId, name: s.name, islandId: s.islandId ?? content.world.startIslandId })),
    ratings: ratings.flatMap((r) =>
      isPuzzleId(r.puzzle)
        ? [{ puzzle: r.puzzle, tier: tierFor(r.rating ?? NEW_RATING.rating, content.ratingTiers).key, rounds: r.rounds }]
        : [],
    ),
    crew: crew ? { id: crew.id, name: crew.name, flag: crew.flag, rank: crew.rank === "commodore" || crew.rank === "officer" ? crew.rank : "sailor" } : null,
  };
}

// ---- identity: the look and the titles (DESIGN.md 3.6, ADR 0033)

/** The look a pirate wears: the one they picked while content still offers it, else the default drawn from their id. */
export function lookOf(content: Content, pirateId: string, picked: PirateLook | null): PirateLook {
  return picked && !pirateLookProblem(content.world.pirates, picked) ? picked : defaultLook(content.world.pirates, pirateId);
}

/** A stored title as it may be shown: null once content no longer has it. */
function shownTitle(content: Content, titleId: string | null): string | null {
  return titleId && content.world.pirates.titles.some((t) => t.id === titleId) ? titleId : null;
}

/**
 * Who the ship service asks what a pirate wears on deck. Kept in memory for every pirate who has
 * connected since the server started, which is everyone a ship room can hold.
 */
export class PirateLooks {
  private readonly looks = new Map<string, PirateLook>();
  constructor(private readonly content: Content) {}
  lookOf(pirateId: string): PirateLook {
    return this.looks.get(pirateId) ?? defaultLook(this.content.world.pirates, pirateId);
  }
  remember(pirateId: string, look: PirateLook | null): void {
    if (look) this.looks.set(pirateId, look);
  }
}

/** What the records say a pirate has done, from the voyage tables and the ledger. Every count only grows. */
export async function pirateRecord(db: Db, pirateId: string): Promise<PirateRecord | null> {
  const [p] = await db.select({ createdAt: schema.pirate.createdAt }).from(schema.pirate).where(eq(schema.pirate.id, pirateId));
  if (!p) return null;
  const [[voyages], [captained], [purse], [boards]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.voyageCrew)
      .innerJoin(schema.voyage, eq(schema.voyage.id, schema.voyageCrew.voyageId))
      .where(and(eq(schema.voyageCrew.pirateId, pirateId), eq(schema.voyage.outcome, "arrived"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.voyage)
      .where(and(eq(schema.voyage.captainId, pirateId), eq(schema.voyage.outcome, "arrived"))),
    // A win pays every pirate aboard a share of the purse (ADR 0030), so a share is a brigand beaten.
    db
      .select({ n: sql<number>`count(*)::int`, coins: sql<number>`coalesce(sum(${schema.ledgerEntry.delta}), 0)::int` })
      .from(schema.ledgerEntry)
      .where(and(eq(schema.ledgerEntry.pirateId, pirateId), eq(schema.ledgerEntry.reason, "booty"), gt(schema.ledgerEntry.delta, 0))),
    db.select({ n: sql<number>`coalesce(sum(${schema.rating.rounds}), 0)::int` }).from(schema.rating).where(eq(schema.rating.pirateId, pirateId)),
  ]);
  return {
    since: p.createdAt.getTime(),
    voyages: voyages?.n ?? 0,
    captained: captained?.n ?? 0,
    victories: purse?.n ?? 0,
    booty: purse?.coins ?? 0,
    boards: boards?.n ?? 0,
  };
}

/**
 * How far a record is along a title: a count against the count it asks, or for standing the index
 * of the pirate's tier at that puzzle against the index it asks (-1 while unrated).
 */
export function titleProgress(content: Content, title: Title, record: PirateRecord, ratings: ReadonlyMap<string, number>): { have: number; need: number; met: boolean } {
  const r = title.requires;
  switch (r.kind) {
    case "start":
      return { have: 0, need: 0, met: true };
    case "standing": {
      const tiers = content.ratingTiers;
      const need = Math.max(0, tiers.findIndex((t) => t.key === r.tier));
      const rating = ratings.get(r.puzzle);
      const have = rating === undefined ? -1 : tiers.findIndex((t) => t.key === tierFor(rating, tiers).key);
      return { have, need, met: have >= need };
    }
    default: {
      const have = record[r.kind];
      return { have, need: r.count, met: have >= r.count };
    }
  }
}

async function ratingsOf(db: Db, pirateId: string): Promise<Map<string, number>> {
  const rows = await db.select({ puzzle: schema.rating.puzzle, rating: schema.rating.rating }).from(schema.rating).where(eq(schema.rating.pirateId, pirateId));
  return new Map(rows.map((r) => [r.puzzle, r.rating]));
}

/**
 * Write down every title the record has met and the pirate has not yet earned, and return the newly
 * earned ones in content order. Safe to call any time and from two places at once: a title is
 * earned once, by whichever call writes it first.
 */
export async function awardTitles(db: Db, content: Content, pirateId: string): Promise<{ fresh: string[]; earned: Set<string>; progress: TitleProgress[]; record: PirateRecord } | null> {
  const [record, ratings, rows] = await Promise.all([
    pirateRecord(db, pirateId),
    ratingsOf(db, pirateId),
    db.select({ titleId: schema.pirateTitle.titleId }).from(schema.pirateTitle).where(eq(schema.pirateTitle.pirateId, pirateId)),
  ]);
  if (!record) return null;
  const earned = new Set(rows.map((r) => r.titleId));
  const titles = content.world.pirates.titles;
  const measured = titles.map((t) => ({ title: t, ...titleProgress(content, t, record, ratings) }));
  const due = measured.filter((m) => m.met && m.title.requires.kind !== "start" && !earned.has(m.title.id)).map((m) => m.title.id);
  let fresh: string[] = [];
  if (due.length) {
    const written = await db
      .insert(schema.pirateTitle)
      .values(due.map((titleId) => ({ pirateId, titleId })))
      .onConflictDoNothing()
      .returning({ titleId: schema.pirateTitle.titleId });
    const got = new Set(written.map((w) => w.titleId));
    fresh = due.filter((id) => got.has(id));
    for (const id of due) earned.add(id);
    if (fresh.length) await recordEvent(db, pirateId, "pirate.titles_earned", { titles: fresh });
  }
  const progress = measured.map((m) => ({ id: m.title.id, earned: m.title.requires.kind === "start" || earned.has(m.title.id), have: m.have, need: m.need }));
  return { fresh, earned, progress, record };
}

/** The pirate's own sheet: their record and every title's progress, with anything newly earned written down first. */
export async function pirateSheet(db: Db, content: Content, pirateId: string): Promise<{ sheet: PirateSheet; fresh: string[] } | null> {
  const awarded = await awardTitles(db, content, pirateId);
  if (!awarded) return null;
  return { sheet: { record: awarded.record, titles: awarded.progress }, fresh: awarded.fresh };
}

/** Wear this look on deck. Refused with `look_bad` for anything content does not offer. */
export async function setLook(db: Db, content: Content, pirateId: string, look: PirateLook): Promise<PirateLook> {
  if (pirateLookProblem(content.world.pirates, look)) throw new PirateError("look_bad");
  const picked = { coat: look.coat, hat: look.hat };
  await db.update(schema.pirate).set({ look: picked }).where(eq(schema.pirate.id, pirateId));
  await recordEvent(db, pirateId, "pirate.look", picked);
  return picked;
}

/** Show this title after the name, or none. Refused with `title_locked` unless the pirate has earned it. */
export async function setTitle(db: Db, content: Content, pirateId: string, titleId: string | null): Promise<string[]> {
  let fresh: string[] = [];
  if (titleId !== null) {
    const title = content.world.pirates.titles.find((t) => t.id === titleId);
    if (!title) throw new PirateError("title_locked");
    if (title.requires.kind !== "start") {
      // The record may have met it a moment ago; write that down before deciding.
      const awarded = await awardTitles(db, content, pirateId);
      if (!awarded?.earned.has(titleId)) throw new PirateError("title_locked");
      fresh = awarded.fresh;
    }
  }
  await db.update(schema.pirate).set({ title: titleId }).where(eq(schema.pirate.id, pirateId));
  return fresh;
}
