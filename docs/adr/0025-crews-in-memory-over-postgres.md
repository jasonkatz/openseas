# 0025. Crews: a lasting band with a flag, held in memory over Postgres

Status: Accepted. Builds on [0005](./0005-node-ws-realtime.md), [0006](./0006-postgres-drizzle.md),
[0009](./0009-world-content-as-files.md) and [0010](./0010-single-ship-acquisition-path.md).

## Context

DESIGN.md has said from the start that crews are the social unit and the invite list (3.4), that a
pirate's crew and rank persist (3.6), and that chat has a crew channel (3.7). Until M6 "crew" only
meant whoever was aboard a ship. Testers sail in a small group of friends; what they need from a
crew is to find each other, talk wherever they are, sail on each other's ships without strangers
taking the berths, and have something that is theirs: a name and a flag, and a record of what
they did together.

Three questions needed answers: where crew state lives, how much hierarchy a crew has, and how a
crew changes the ships it sails.

## Decision

1. **Crews are player state in Postgres: `crew`, `crew_member`, `crew_invite`.** One crew per
   pirate (the member row is keyed by pirate). A crew's tallies (voyages, victories, booty) are
   columns bumped as they happen, so the board of crews is one sorted read, not an aggregate.
   Invitations are rows, so an offline pirate finds them on their next visit.
2. **The crew service keeps every crew in memory too, loaded at start and written through.**
   Every mutation writes Postgres first and memory after, one at a time (a serial queue). The
   ship service and the social service ask it synchronously who shares a crew and whose colors a
   ship flies, so a ship snapshot, a notice board or an island's presence never waits on a query.
   One process serves the ocean in v1 (DESIGN.md 4.3); sharding would move this behind the room
   seam like everything else.
3. **Three ranks: commodore, officer, sailor.** The commodore leads (ranks, flag, hand-over) and
   may put anyone out; officers recruit and may put out sailors; sailors sail and chat. Making
   someone commodore hands over the crew. A commodore who leaves is succeeded by the next in rank,
   longest in the crew first; the last one out disbands the crew and its invitations go with it.
4. **Founding costs coins, set in content.** `content/data/world/crews.json` holds the fee, the
   size limits, the name length and the flag parts (colors, patterns, emblems), validated at
   start like all content (ADR 0009). The fee goes through the ledger as `crew_founded`; it is the
   economy's first sink and a goal for a first purse.
5. **A crew changes ships only through who may board and the colors they fly.** Ships stay owned
   by pirates (DESIGN.md 3.4, ADR 0010). The existing invite-only toggle becomes "crew only": the
   owner and the owner's crew may board. A ship flies its owner's crew flag: the snapshot and the
   notice board carry it, the world paints it at the masthead and on the mainsail.
6. **What happens to a crew is pushed, not polled.** `crew.state` goes to a member on connect and
   whenever membership, rank, flag or invitations change; `crew.notice` carries events with names
   attached (invited, joined, sailed, victory, ...). Where each member is right now (ashore, aboard
   and bound where, and whether the viewer could join them) is computed per viewer when the state
   is built; the client asks again every few seconds while the crew card is open.

## Consequences

- `PirateSummary` gains `crew` (tag and rank); ship snapshots gain `colors` and each crew view a
  `crewId`; the notice board gains `colors` and `crewmate`; presence carries each pirate's tag.
  New wire fields default on parse, so a client older or newer than the server still reads it.
- The ship service gains hooks (`onSailed`, `onArrived`, `onVictory`) that the crew service
  turns into tallies and notices; ships know nothing of crews beyond the lookup.
- Flags are drawn once, on the client, from content ids: every emblem and pattern is a distinct
  shape outlined in the field color, so flags tell apart without color (rule 6).
- A restart loses nothing: memory is rebuilt from the tables at start.
- Crew-owned ships, alliances of crews and crew treasuries are not built; each would extend these
  tables rather than replace them.
