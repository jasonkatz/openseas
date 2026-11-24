# 0082. Shipwrightry's successor starts as a prototype: Assembly

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md),
[0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md), [0075](./0075-a-puzzle-declares-its-deal.md)
and [0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

Numbered 0082 because two open pull requests (Freefall and Refining) each take 0080 for a prototype of
their own; whichever lands second takes 0081.

## Context

DESIGN.md section 3 lists every crafting puzzle as explicitly later. Shipwrightry is the original's
shipyard puzzle: a full board of pieces of a few kinds, each kind swapping only in its own direction
(one sideways, one up and down, one on the diagonals, one not at all, and a fixed wildcard), and a
box of patterns to place over matching pieces. Patterns placed one after another with no swap
between are a chain, and each pays by its place in it. The owner asked for a successor to it now.

Tractor (ADR 0078) set the way a successor is built before its role exists: as a prototype, dealt
only in the studio.

## Decision

1. **It is built as a prototype.** Assembly (`assembly`) is an eleventh entry in `PROTOTYPE_PUZZLE_IDS`,
   with every file ADR 0036 lists. It is dealt only in the studio and has no role; promoting it is its
   own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Shipwrightry as what it follows and keeps
   its mechanics: parts that each swap their own way, a swap allowed when either part moves that way,
   a fixed wildcard, a tray of shaped blueprints that never turn, a fit taking the parts under it, and
   a chain of fits with no swap between, each paying (parts − 2) × its place. Its words, art, sounds,
   shapes and numbers are its own. Its departures are rows in DESIGN.md section 6.
3. **The round clock replaces the tide.** The original's rising water closes the chain window and ends
   the job after a set number of patterns. Here a round is a clock like every prototype's, and a
   chain ends only on a swap. The clock is the pressure: setting up a long chain costs time a player
   could have spent fitting.
4. **Its draws are on streams of their own** (ADR 0075): the parts dropping in, the cores and the
   blueprints each have one, so playing differently never changes which blueprints come next.
5. **The bot runner learns to reseed an engine with several streams.** A `BotGame` may give its own
   `reseed`; the rollout bot uses it, and falls back to replacing `rng` as before. Every other game is
   unchanged.

## Consequences

- The prototype count is ten. CLAUDE.md, DESIGN.md 3.12, the glossary and the prototypes README say
  ten, and count Tractor and Assembly apart as successors.
- Its thresholds are set from bots until people have played it.
- Shipwrightry stays on the later list as a game role: what a tier of a build does for a ship is
  decided when the shipyard is built, with the promotion.
