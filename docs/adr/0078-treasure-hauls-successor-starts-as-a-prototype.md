# 0078. Treasure Haul's successor starts as a prototype: Tractor

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md)
and [0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md).

## Context

DESIGN.md section 3 lists Treasure Haul as explicitly later: the original's puzzle for hauling
loot aboard after a won fight, played by swapping pieces up and down to line up three, with chests
that are taken when they reach the top and gems that clear lines. The owner asked for a successor
to it now, to play before the game has the haul after a fight that would give it a role.

The eight prototypes (ADR 0036) are the game's own designs, ported from nothing. A successor is
the other kind of puzzle (ADR 0001): faithful to the original's mechanics, original in everything
a player sees and hears. No successor has been built outside the milestone ladder before.

## Decision

1. **It is built as a prototype.** Tractor (`tractor`) is a ninth entry in
   `PROTOTYPE_PUZZLE_IDS`, with every file ADR 0036 lists: a pure engine the server can verify, its
   wire schemas, content and thresholds, a board on the kit, a studio page, a smoke, bots, a guide
   and a design file. It is dealt only in the studio and has no role. Nothing in the game links to
   it until it is promoted, which stays its own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Treasure Haul as what it follows,
   keeps the original's mechanics (a swap up or down, runs of three in rows and columns, sealed
   crates taken at the top, pieces that clear a cross or a diagonal), and gives its own words, art,
   sounds and numbers. Where it departs from the original, the departure is a row in DESIGN.md
   section 6, as for the seven.
3. **Its departures are about luck.** New loot never completes a run as it arrives, so every wave
   after the first comes from pieces the player could see; caches brought aboard in one swap pay
   by their number squared; beacons arrive on a schedule of scoring swaps rather than at random.
   Each puts more of the score on planning (rules 7 and 13 of the `puzzles` skill).
4. **Treasure Haul stays on the later list as a game role.** What a tier of a haul does for a ship's
   plunder is decided when the haul after a fight is built, with the promotion.

## Consequences

- The prototype count is nine. Documents that say eight (CLAUDE.md, DESIGN.md 3.12, the
  prototypes README) say nine, and count Tractor apart as a successor.
- Its thresholds are set from bots, like every prototype's, until people have played it.
