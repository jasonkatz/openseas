# 0008. Railway for server and database, Vercel for client

Status: Accepted

## Context

The game server is a long-lived WebSocket process, which fits serverless poorly. The client is a
static build. Options for the server: Fly.io, Railway, a VPS. Options for Postgres: Railway
managed, Neon, colocated.

## Decision

Railway for the server and its managed Postgres, in one project on one bill with private
networking. Vercel for the static client. Both deploy from `main`.

## Consequences

- Preview environments for the server are not free; the client gets Vercel previews.
- Region is single to start. Adding regions is a later concern tied to the sharding seam
  (ADR 0005).
