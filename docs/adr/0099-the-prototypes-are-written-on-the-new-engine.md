# 0099. The prototypes are written on the new engine: thirteen join, each held to its own engine; a table may be read at a count the event carries

Status: Accepted. Builds on ADR 0092 to ADR 0098 (the puzzle engine in rungs, and every solo puzzle the game ships
written on it). Changes nothing about what the studio deals: every prototype still plays on its own engine
(ADR 0036).

## Context

ADR 0098 put every solo puzzle the game ships on `@openseas/puzzle`. The owner asked for the prototypes too.
Sixteen are in the studio. Salvage's successor is Paths, already written. Thirteen are puzzles one player plays,
alone or against computer rivals the reducer plays from the round's own luck: Tug, Racks, Reactor, Overload,
Scanner, Cutting, Tractor, Refining, Forging, Assembly, Deflectors, Freefall and Pouring. Two, Showdown and Pact,
are card tables of several seats, and wait for rung 5 with Swordfighting and Battle.

Most of the thirteen fit the engine as it was. Three did not, quite:

- Reactor pays a salvo by how many discharges it holds, and Deflectors multiplies a beam by the lenses in its
  recipe and by the targets its shot lit. Each is a table read at a count the event itself knows. A table could
  be read only at the streak or the cascade's step.
- `grid("size", "size")`, a square board with one setting for its side, declared that setting twice.
- Freefall's score is the player's lead over the rival, and Pouring's is the player's own points while the
  rivals score too. Neither is a sum of what every event pays.

## Decision

1. **The thirteen are puzzles on the new engine**, in `packages/puzzle/examples/<id>.puzzle.ts`, each with a
   test in `packages/puzzle/test/<id>.test.ts` that plays it beside its prototype engine from the same luck
   (the engine's own seed streams passed to `start` as `streams`) and holds the two to the same board, the
   part's state the engine also keeps (a clamp, a tray, a bag, hands, targets), the score, the streak and the
   stats after every move and every stretch of ticks. Every test counts the rules it reached and fails when a
   rule went unplayed. Forging's whole plate is reached by searching every strike, since no simple player
   sets one.
2. **A multiplier's table may be read at a field of the event**: `index: { field }` in a puzzle,
   `by: { table, index: "field", field }` in the document. A count of n reads the n-th entry, the last entry
   holds past the end, and a count below one is paid as it is. Every event the multiplier scales must carry
   the field as a number, or the puzzle is refused.
3. **One setting named twice by a board is one setting.** `grid(w, h)` with the same name for both declares it
   once, described as the cells on a side.
4. **A computer rival plays inside the move.** Freefall's rival and Pouring's are rules, not seats: they act in
   `onMove` after the player, from the round's own draw stream, so a round replays from the player's moves
   alone, as their engines do. Their events carry the seat that acted, and `pointsFor` pays only the player's
   (Pouring) or moves the score by what a landing moves the lead (Freefall).
5. **A setting may be reshaped to say the same number as data.** Where an engine computes a table from a
   number, the puzzle holds the table: Assembly's chain place becomes `chainPercent` (100, 200, ... to the
   cap), Deflectors' lens bonus becomes `lensPercent` (an entry for one, two and three lenses) and its turn cap
   `legCap` (legs are turns plus one, squared). Scanner's streak table drops its first entry, since the loop
   reads streak k at entry k - 1. Costs are negative points (Refining's foul, Scanner's misses), floored at
   zero through a `lost` field, as ADR 0098's puzzles do. Freefall's five legs' berths are five list settings.
   Each test maps the engine's config onto these settings in one place.
6. **What differs is written down, not tuned away.**
   - Tug, Reactor, Tractor and Deflectors' engines round down more than once a move (each delivery's two
     multipliers, each discharge then the salvo, each wave, each beam then the shot). The loop rounds once a
     move, so it is never behind and at most a point a rounding ahead. Their tests allow exactly that.
   - Forging's engine ends a round on a stall or a set plate, Freefall's after five legs, Pouring's at last
     call, Deflectors' when the supply is out and the grid lights nothing. On the new engine a round ends by
     its clock or its budget only; the first three are left with no move to make, and say so through
     `listMoves`.

## Consequences

- Every solo puzzle in the game and in the studio, but Showdown and Pact, is a definition on the new engine.
  Swordfighting, Battle, Showdown and Pact wait for seats.
- None of the thirteen has a page on the new engine. A mirror for each, as ADR 0097 gave three, puts them in
  the studio (ADR 0100).
- The puzzle package's tests take about a minute more: each new test runs twenty seeds or so of every config.
