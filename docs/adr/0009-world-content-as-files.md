# 0009. World content as versioned JSON files, not database rows

Status: Accepted

## Context

The owner wants adding islands, routes, brigand tiers, and ship classes to be convenient later.
Content could live in code, in the database, or in files.

## Decision

Static world content lives as JSON in the `content` package, validated against Zod schemas at
server start. Only player-generated state lives in Postgres.

## Consequences

- Adding an island is a PR that adds a file. Content changes are reviewed and versioned like code.
- Content schema changes require a matching server release; there is no live content editing.
- Server startup fails loudly on invalid content.
