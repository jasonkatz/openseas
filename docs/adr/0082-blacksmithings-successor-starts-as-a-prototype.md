# 0082. Blacksmithing's successor starts as a prototype: Forging

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md),
[0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md) and
[0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

## Context

DESIGN.md section 3 lists every crafting puzzle as explicitly later. The owner asked for a successor
to the original's Blacksmithing now, to play before the game has crafting that would give it a role.
Blacksmithing is a tour of a grid: every square is struck three times, each square's symbol says
where the next strike may land, symbols are dealt afresh as squares are struck, and a session ends
the moment no strike is left, scored mostly by how much of the piece was struck before then.

ADR 0078 built Treasure Haul's successor, Tractor, early as a prototype. The same path fits here.

## Decision

1. **It is built as a prototype.** Forging (`forging`) is a tenth entry in `PROTOTYPE_PUZZLE_IDS`
   with every file ADR 0036 lists. It is dealt only in the studio and has no role. Nothing in the
   game links to it until it is promoted, which stays its own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Blacksmithing as what it follows and
   keeps its mechanics: a grid struck three times a square, a symbol on each square saying where the
   next strike lands (steps of one to four, two kinds of edge line and both at once, a knight's
   move, a wild), new symbols as squares are struck, a wild earned when the piece has all been
   struck once and again when twice, chains of one symbol and sets of the numbers or the moves,
   and alternating sets as the compound move. Its names, marks, drawings, sounds and numbers are
   its own. Where it departs from the original, the departure is a row in DESIGN.md section 6.
3. **A stall ends the round, and there is no clock.** As in the original, the round ends when the
   press has nowhere to land, and every blow left on the plate is score never made. This is the
   owner's call against rule 8 of the `puzzles` skill (a mistake costs and does not end the
   round): a first build charged a stall points and played on, and the owner chose the original's
   rule. With the board deciding when a round ends, there is no clock to play against either. The
   page shows no time and no pace; the round's `roundSeconds` is only the server's cap on a round
   left open, at the most content allows (1800).
4. **The deal is shown.** New marks come from one stream in an order play cannot change, and the
   next three are shown (rule 7). The original shows none.
5. **Its ladder is the original's difficulty levels.** Steps, then jumps, then the far marks with
   sets, then sparks: each a layer with an off value in config (ADR 0066).

## Consequences

- The prototype count is twelve, with Refining (ADR 0080) and Freefall (ADR 0081). Documents that say eleven (CLAUDE.md, DESIGN.md 3.12, the glossary, the
  prototypes README) say twelve, and count Forging with Tractor, Refining and Freefall as successors.
- Its thresholds are set from bots, like every prototype's, until people have played it.
- Crafting stays on the later list as a game role: what a tier of a forged plate makes for a ship
  is decided when crafting is built, with the promotion.
- Freefall merged first as ADR 0081, so this one is 0082.
