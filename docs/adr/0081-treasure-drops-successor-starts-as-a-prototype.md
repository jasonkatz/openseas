# 0081. Treasure Drop's successor starts as a prototype: Freefall

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0036](./0036-prototype-puzzles.md)
and [0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

## Context

DESIGN.md section 3 lists Treasure Drop as explicitly later: the original's parlor game in which two
players take turns dropping coins through a board of seesaws, a coin resting on one side of a
seesaw until another coin tips it, coins that fall together fusing, and each player racing to a
target in each of four rounds. The owner asked for a successor to it now, built the way Tractor was
(ADR 0078).

Treasure Drop is a game between two people. Every prototype so far is a round a player plays
alone and is rated on by its thresholds; Swordfighting's raiders are the precedent for an opponent
that lives inside the engine.

## Decision

1. **It is built as a prototype.** Freefall (`freefall`) is a tenth entry in
   `PROTOTYPE_PUZZLE_IDS`, with every file ADR 0036 lists. It is dealt only in the studio and has no
   role. Nothing in the game links to it until it is promoted, which stays its own ADR and milestone.
2. **It is a successor, and says so.** Its design file names Treasure Drop as what it follows,
   keeps the original's mechanics (a drop down a column, rockers whose cradle holds one pod and
   whose arm flips them, a pod tipped out on an odd number of flips, pods that meet fusing, four
   rounds with their own slot values and targets, the other side's one last drop), and gives its own
   words, art, sounds and numbers.
3. **The opponent is a rival inside the engine.** After each of the player's drops the reducer drops
   for the rival from the round's seeded stream, as Swordfighting's raiders act, so a round replays
   from its log and the server verifies it like any other. The rival takes the drop worth most at
   once `rivalSkill` percent of the time.
4. **A round is rated on the lead.** The score is the player's points less the rival's, never
   below zero, read against thresholds like every prototype's. A leg ends at a quota, so the
   player's own points say little about how well they played; the lead says who won and by how
   much.
5. **Its departures are about planning.** A cluster pays its berth by the square of its count, not
   its count; the berth values are its own. The shaft keeps the original's tree, a few drop lanes at the top widening row by row to a berth under every lane at the foot, with its widths and rows as tuning numbers. Each departure is a
   row in DESIGN.md section 6.
6. **Treasure Drop stays on the later list as a parlor game.** Two people at one shaft, with a
   wager, is decided with the parlors, with the promotion.

## Consequences

- The prototype count is ten. Documents that say nine (CLAUDE.md, DESIGN.md 3.12, the prototypes
  README, the glossary) say ten, and count Freefall apart as a successor beside Tractor.
- Its thresholds are set from bots until people have played it. It has no ladder yet: switching the
  rival off leaves a shaft that does not yet pay for planning.
