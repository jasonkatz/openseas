# 0005. Node with plain `ws` for realtime, no game framework

Status: Accepted

## Context

Ships, islands, and swordfights are rooms with a handful of participants exchanging low-bandwidth
events: puzzle results, ship state per turn, chat. Options: hand-rolled rooms on `ws`, Colyseus,
Bun or Deno runtimes.

## Decision

Node 22 with the `ws` library and a hand-rolled room abstraction. Messages are JSON validated by
Zod schemas in `protocol`. A single process serves the whole ocean in v1.

## Consequences

- No continuous entity interpolation is needed, so a framework's state diffing buys little and
  its opinions would fight the replay-verification model.
- The room abstraction is the seam for sharding across processes later.
- Binary encoding can be adopted behind the same schemas if message volume ever warrants it.
