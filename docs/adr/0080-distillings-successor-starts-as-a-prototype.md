# 0080. Distilling's successor starts as a prototype: Refining

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md),
[0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md), [0075](./0075-a-puzzle-declares-its-deal.md)
and [0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

## Context

DESIGN.md section 3 lists all crafting puzzles as explicitly later. The owner asked for a
successor to the original's Distilling now, the crafting puzzle in which pieces of three weights
are swapped along links that follow a cycle, a column is drawn off on a clock and rises or sinks by
its weight, and unbroken runs of pure light columns pay most. Like Tractor (ADR 0078), it is to be
played before the game has the crafting it would serve.

## Decision

1. **It is built as a prototype.** Refining (`refining`) is a tenth entry in
   `PROTOTYPE_PUZZLE_IDS`, with every file ADR 0036 lists: a pure engine the server can verify, its
   wire schemas, content and thresholds, a board on the kit, a studio page, a smoke, bots, a guide
   and a design file. It is dealt only in the studio and has no role. Nothing in the game links to
   it until it is promoted, which stays its own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Distilling as what it follows and keeps
   the original's mechanics: three fractions whose swaps follow a cycle and cannot be undone straight
   away, a fixed piece that pays, a column drawn on a clock or early, up or down by weight, runs of
   pure columns paying more and more, and spilled light pieces coming back to spoil the board. Its
   words, art, sounds and numbers are its own, and its departures are rows in DESIGN.md section 6.
3. **It is ticked** (ADR 0015). The clock's draws are engine events made at fixed ticks, each move
   draws whatever is due before it, and the page shows the tower between moves with
   `advanceRefining`. An early draw is a move.
4. **Its departures put the score on planning.** A round is points on a 120 second clock, not an
   average over a batch; a column that sinks with no vapour in it (a dump) leaves the run alone, so
   sorting the feed into clear columns and dumps is the skill the run rewards; a column that rises
   with tar or smoke in it costs points, so drawing early on luck does not pay.
5. **Its deal is on streams of its own** (ADR 0075): the opening, the fresh feed and the catalysts
   each read their own stream, so the n-th column of feed is the same however the round is played.
6. **Crafting stays on the later list as a game role.** What a tier of refining does for a ship or
   an outpost is decided when crafting is built, with the promotion.

## Consequences

- The prototype count is ten. Documents that said nine (CLAUDE.md, DESIGN.md 3.12, the prototypes
  README, the glossary) say ten, and count Tractor and Refining apart as successors.
- Its thresholds are set from bots, like every prototype's, until people have played it.
