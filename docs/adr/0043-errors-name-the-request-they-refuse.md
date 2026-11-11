# 0043. A server error names the request it refuses, and the client routes it by that

Status: Accepted. Builds on [0005](./0005-node-ws-realtime.md) and
[0014](./0014-cd-pipeline-in-actions.md).

## Context

The wire's `error` message carried a code and nothing else. Each part of the client that sends
requests (the ship's actions, a station's board, the crew card, the pirate's sheet) claimed errors by
a set of codes, and the sets overlapped: `short_of_credits` belonged to the shipyard and to founding a
crew, and `in_battle`, `not_in_flight`, `no_station` and `not_aboard` to both the ship's actions and a
station's own `duty.start`. A station asks for its board by itself and asks again a few seconds after
a refusal. While its pirate is in a fight the server refuses it with `in_battle`, so the ship's toast
"The ship is in a fight." came back about once a turn for something the player never did.

## Decision

1. **An error names the request it refuses.** The `error` message gains an optional `for`: the `type`
   of the client message being handled, a closed enum derived from the client message union. The
   server sets it in one place, the catch around its dispatch of a parsed message. A refusal the
   socket makes itself (an unknown round, the shipyard's price) is thrown like a service's, to the
   same catch. Errors sent before a message is understood (rate limited, not the protocol) and the one
   sent on connecting (no pirate) name nothing.
2. **The client gives a named refusal to whatever sent the request.** One table maps every client
   message type to the requester that sends it, or to none where the scene asks by itself (walking,
   who is about, the melee's board) or a board's session settles it. A requester takes every code of
   its own requests. A refused line of chat goes to the card that holds its channel, told apart by the
   code.
3. **A refusal that names nothing is routed by its code, as before**, in one function, so a client
   that meets a server older than the field behaves as it did. It is deleted once no such server can
   be deployed.

## Consequences

- A station's refusal no longer shows as a toast or on the deck card. A ship action the player took
  still does, now whatever its code, `internal` included.
- Either side of a split deploy (ADR 0014) may be the newer. An older client's Zod object strips the
  unknown `for`; a newer client reads an error without it through the fallback. `for` is always the
  type of a message the client itself sent and the server parsed, so it is never a value the client's
  enum lacks.
- A handler follows the convention by throwing a coded error; it never sets `for` itself. A new client
  message type fails the client's typecheck until the table names its requester.

## Alternatives considered

- **A request id echoed back.** Exact even with two requests of one type in flight, but every send
  would carry an id and every requester would keep the ids it has out. Nothing in the client needs to
  tell two requests of the same type apart.
- **A code per request** (`duty_in_battle`). The message table and every service would grow a code
  for each request a refusal can answer, and the client would still route by reading codes.
