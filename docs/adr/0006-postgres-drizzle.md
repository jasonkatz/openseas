# 0006. Postgres via Drizzle ORM

Status: Accepted

## Context

Persistence needs: pirates, ships, crews, an append-only currency ledger, Glicko-2 ratings,
voyage history, and a gameplay event table. Options: Drizzle, Prisma, Kysely.

## Decision

Postgres with Drizzle ORM and generated migrations.

## Consequences

- SQL-shaped TypeScript suits the ledger and rating queries, which want real SQL.
- Migrations are generated from the schema and committed. Hand-edited migrations are reviewed
  with care.
