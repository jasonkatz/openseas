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
    moveLog: jsonb().notNull().$type<unknown[]>(),
    metrics: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("puzzle_round_pirate_id_idx").on(t.pirateId, t.puzzle)],
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
export const shipRelations = relations(ship, ({ one }) => ({
  owner: one(pirate, { fields: [ship.ownerId], references: [pirate.id] }),
}));
export const ratingRelations = relations(rating, ({ one }) => ({
  pirate: one(pirate, { fields: [rating.pirateId], references: [pirate.id] }),
}));
