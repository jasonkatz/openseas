import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---- Better Auth tables (core + anonymous plugin). Field names must match Better Auth's models.

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  isAnonymous: boolean().default(false),
});

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---- Game tables. Player-generated state only; world content is files (ADR 0009).

export const pirate = pgTable(
  "pirate",
  {
    id: text().primaryKey(),
    /** Restrict, not cascade: deleting an auth user must never silently delete a pirate (ADR 0007). */
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text().notNull(),
    /** Where the pirate stands when not aboard a ship. Null means the ocean's start island. */
    islandId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pirate_user_id_uidx").on(t.userId), uniqueIndex("pirate_name_uidx").on(t.name)],
);

export const ship = pgTable(
  "ship",
  {
    id: text().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    classId: text().notNull(),
    name: text().notNull(),
    /** The grant that produced this ship, or null for a paid purchase (ADR 0010). */
    grantId: text(),
    /** The island the ship is docked at, or was last docked at while at sea. Null means the start island. */
    islandId: text(),
    acquiredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ship_owner_id_idx").on(t.ownerId)],
);

/** Append-only. Balance is the latest balanceAfter; never update or delete rows. */
export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pirateId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    delta: integer().notNull(),
    balanceAfter: integer().notNull(),
    reason: text().notNull(),
    ref: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_pirate_id_id_idx").on(t.pirateId, t.id)],
);

export const rating = pgTable(
  "rating",
  {
    pirateId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    puzzle: text().notNull(),
    rating: doublePrecision().notNull(),
    deviation: doublePrecision().notNull(),
    volatility: doublePrecision().notNull(),
    rounds: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pirateId, t.puzzle] })],
);

export const puzzleRound = pgTable(
  "puzzle_round",
  {
    id: text().primaryKey(),
    pirateId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    puzzle: text().notNull(),
    seed: text().notNull(),
    score: integer().notNull(),
    moves: integer().notNull(),
    bestCombo: integer().notNull(),
    /** Null when the round counted; otherwise why the server threw it out. */
    rejectedReason: text(),
    /** Set for a duty board played aboard a ship; null for practice. */
    voyageId: text(),
    /** False for a board that counted but was not rated: a duty board cut short by docking. */
    rated: boolean().notNull().default(true),
    moveLog: jsonb().notNull().$type<unknown[]>(),
    metrics: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("puzzle_round_pirate_id_idx").on(t.pirateId, t.puzzle)],
);

/** One leg sailed by one ship (DESIGN.md 3.4, 3.6). Written when the ship sets sail, closed on arrival or abandonment. */
export const voyage = pgTable(
  "voyage",
  {
    id: text().primaryKey(),
    shipId: text()
      .notNull()
      .references(() => ship.id, { onDelete: "cascade" }),
    routeId: text().notNull(),
    captainId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
    /** "arrived" or "abandoned"; null while under way. A server restart leaves it null. */
    outcome: text(),
    turns: integer().notNull().default(0),
    /** The brigand tier rolled for the leg and whether it was evaded, or null for a clear leg. A fight adds its outcome and purse. */
    encounter: jsonb().$type<{ tierId: string; evaded: boolean; outcome?: string; booty?: number }>(),
  },
  (t) => [index("voyage_ship_id_idx").on(t.shipId)],
);

/** Who was aboard for a voyage, so a pirate has a voyage history and grants can count voyages. */
export const voyageCrew = pgTable(
  "voyage_crew",
  {
    voyageId: text()
      .notNull()
      .references(() => voyage.id, { onDelete: "cascade" }),
    pirateId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    boardedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.voyageId, t.pirateId] }), index("voyage_crew_pirate_id_idx").on(t.pirateId)],
);

/**
 * A crew (M6, ADR 0025): a lasting band of pirates with a name, a flag and ranks. Its tallies are
 * kept on the row as they happen, so the board of crews needs no aggregate over voyages.
 */
export const crew = pgTable(
  "crew",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    /** The name folded for uniqueness: lowercase, single spaces. */
    nameKey: text().notNull(),
    flag: jsonb().notNull().$type<{ field: string; accent: string; pattern: string; emblem: string }>(),
    /** Who paid the founding fee. Kept after they leave; the commodore is on crew_member. */
    founderId: text().references(() => pirate.id, { onDelete: "set null" }),
    foundedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Voyages that reached port with a member aboard. */
    voyages: integer().notNull().default(0),
    /** Brigands beaten with a member aboard. */
    victories: integer().notNull().default(0),
    /** Coins paid to members from those victories. */
    booty: integer().notNull().default(0),
  },
  (t) => [uniqueIndex("crew_name_key_uidx").on(t.nameKey)],
);

/** One crew per pirate: the pirate's id is the key. */
export const crewMember = pgTable(
  "crew_member",
  {
    pirateId: text()
      .primaryKey()
      .references(() => pirate.id, { onDelete: "cascade" }),
    crewId: text()
      .notNull()
      .references(() => crew.id, { onDelete: "cascade" }),
    /** "commodore", "officer" or "sailor". */
    rank: text().notNull(),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crew_member_crew_id_idx").on(t.crewId)],
);

/** An invitation waiting on a pirate. Answering or withdrawing it deletes the row. */
export const crewInvite = pgTable(
  "crew_invite",
  {
    crewId: text()
      .notNull()
      .references(() => crew.id, { onDelete: "cascade" }),
    pirateId: text()
      .notNull()
      .references(() => pirate.id, { onDelete: "cascade" }),
    /** Who sent it, by name as it was then: an inviter who leaves the crew still signed it. */
    byName: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.pirateId] }), index("crew_invite_pirate_id_idx").on(t.pirateId)],
);

/** Gameplay analytics (DESIGN.md 4.6). No third-party analytics. */
export const event = pgTable(
  "event",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pirateId: text(),
    type: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_type_at_idx").on(t.type, t.at)],
);

export const pirateRelations = relations(pirate, ({ many, one }) => ({
  user: one(user, { fields: [pirate.userId], references: [user.id] }),
  ships: many(ship),
  ratings: many(rating),
}));
export const shipRelations = relations(ship, ({ one, many }) => ({
  owner: one(pirate, { fields: [ship.ownerId], references: [pirate.id] }),
  voyages: many(voyage),
}));
export const voyageRelations = relations(voyage, ({ one, many }) => ({
  ship: one(ship, { fields: [voyage.shipId], references: [ship.id] }),
  crew: many(voyageCrew),
}));
export const voyageCrewRelations = relations(voyageCrew, ({ one }) => ({
  voyage: one(voyage, { fields: [voyageCrew.voyageId], references: [voyage.id] }),
  pirate: one(pirate, { fields: [voyageCrew.pirateId], references: [pirate.id] }),
}));
export const ratingRelations = relations(rating, ({ one }) => ({
  pirate: one(pirate, { fields: [rating.pirateId], references: [pirate.id] }),
}));
