# 0063. Stored sprite picks and sprite takes are kept, read and ignored

Status: Accepted. Builds on [0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md)
decision 3, and settles what it left open: what becomes of the sprite data the studio already
holds. It supersedes nothing: [0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md)
and [0052](./0052-a-pick-is-the-drafts-and-a-tester-link-carries-it.md) still stand for sounds.

## Context

ADR 0062 removes the sprite tooling once the last puzzle is restyled, and M10's fifth step did.
The studio's service still holds what the tooling made. A draft's numbers and a tester link's
frozen copy may carry `picks.sprites`, a take's hash for a frame. The takes table has rows of
kind `sprite`, with their bytes in the bucket. And a `/play` address someone bookmarked or sent
may carry `sprite.<frame>=<hash>`.

None of it does anything now: no board draws a frame. But all of it is somebody's draft, link or
address, and each is read through the wire schema, which until now named the `sprites` map.

## Decision

1. **Nothing stored is deleted or rewritten.** No migration removes sprite picks from a draft or
   a link, a sprite take's row, or its bytes in the bucket. The database's shape does not change.
2. **Sprite picks are read and dropped.** `PicksSchema` names only `sounds`. An object schema
   drops a key it does not name, so a draft or a link that still carries `picks.sprites` parses as
   it always did, without the map, and its numbers, its sound picks and its words are as they
   were. The schema is never made strict; a test in `protocol` holds it to that.
3. **Nothing writes a sprite pick.** The page keeps none in a draft, a link or an address, and
   the service's helpers (`picksOf`) read none, so the next save of a draft leaves the map out.
4. **An address with `sprite.<frame>=<hash>` still opens.** The parameter is read past, like any
   the page does not know, is counted and reported nowhere, and asks the service for nothing.
5. **A sprite take is never listed, picked or placed, and can still be read by its hash.**
   `TakeKindSchema` keeps `sprite` only so that stored rows and an older service's list still
   parse. The service lists sound takes only and its scan keeps no picture; the site passes over
   any other kind it is sent. A pick that names a sprite take is refused by Save as any pick of
   the wrong kind is.

## Consequences

An owner's old draft, a tester's old link and a bookmarked address all keep working, on the board
as it is now drawn. The sprite takes and stray `sprites` maps stay in storage, doing nothing and
costing a little; a later cleanup can delete them in a migration of its own, once nobody could
want one back. A service older than the site, or a site older than the service, still talks to
the other. The word `sprite` stays in the wire schema, as one enum value and two comments.

## Alternatives considered

- **A migration that strips `picks.sprites` and deletes sprite takes.** It tidies storage, and
  it destroys the owner's library of takes on the strength of a refactor. Deleting is easy to do
  later and impossible to undo.
- **Keep `sprites` in the schema as a validated map.** A stored map that no longer passed the
  check would make its whole draft unreadable, for a field nothing uses.
- **Refuse an address or a link that carries a sprite pick.** It breaks what testers were sent,
  to say something they cannot act on.
