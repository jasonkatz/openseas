# 0095. A ticking puzzle runs its ticks from the log: ticks, terrain, maps and a bag

Status: Accepted. Builds on ADR 0088 (the rules are hooks on one loop), ADR 0092 (a puzzle is written in
rungs), whose rung 4 it finishes, ADR 0093 (the loop pays from data and banks once a move) and ADR 0094
(depth is said on events). It changes the guide in the places named below.

## Context

ADR 0094 built rung 4 for a still puzzle and left three things for a puzzle that moves by itself: a
ticking tempo, terrain, and a draw from a bag. They are proved by Gunnery. Pieces roll across a deck
drawn by hand, a feeder drops the next one from a shuffled bag, the player lays arrows that turn them,
and a turret that fills fires itself a few ticks later.

The engine the game ships for Gunnery fixed the test, as Salvage did for Paths: the same deck and the
same bag must give the same pieces, turrets, feed, score and streak, tick for tick and move for move.
The guide had already said most of the shape: a tempo, terrain with states, maps in a setting, a bag
among the ways to draw, `onTick`. Writing it showed what was still unsaid: when a tick falls, what a
move made between ticks does to them, how a streak counts when successes come without a move, and how
a board drawn from events alone comes to hold a map.

## Decision

1. **Ticks are counted from 1, and tick `n` falls at `n` times the tick's length.** Nothing happens at
   the round's start but Start. The last tick is the one on or before a clock's end. `onTick` is handed
   the count and the time, and the time is the only clock a rules file has.
2. **A tick is never in the log.** A move carries the time it was made. Before the loop checks a move it
   plays every tick due by that time, so a move follows the tick it was made on. A round played again
   from its log runs the same ticks, however the time between moves was cut up. `replay` takes the time
   to run on to once the log is done.
3. **A tick is closed as a move is.** Every part with `onTick` is asked, in the order the puzzle lists
   them. Then the cascade and Move end run, points are paid and banked once, and the endings are
   checked. An event carries the tick it happened on.
4. **A refused move leaves the ticks unplayed.** A round is a value: a refusal hands back the round it
   was given. The ticks due by then are played by whatever comes next.
5. **`advance(round, { at })` lets time pass with no move.** It plays the ticks due and logs nothing. A
   host calls it to show a round between moves, and at a round's end.
6. **Terrain is changed on an event, like a piece.** `e.change(place, { terrain, state? })` makes a cell
   that terrain, in the state named or else the first it declares. `board.terrain` reads the id and
   `board.terrainState` the state. A cell off the board reads `off`, so rules that look a step ahead of
   a piece need no check for the edge. A part declares terrain as it declares pieces.
7. **The rules lay a map on an event.** A setting of type `maps` holds every map, each a row of terrain
   ids for each row of the board. The loop refuses one that does not fit the board or names terrain the
   puzzle does not declare, before a round starts. A draw picks the map, and the rules report an event
   whose changes lay it, with the stock `layMap`. So a screen draws the map from events, as it draws
   everything else, and the loop lays nothing out by itself.
8. **The loop keeps a bag.** A draw whose `by` is `bag` reads a list of counts, one for each item. The
   bag is filled from it, shuffled on the draw's own stream, and dealt out to the last item before it is
   filled again. `next()` gives an item's number. The bag is part of the round's state.
9. **A streak may count events.** `counts: "events"` is for a puzzle where successes come by
   themselves, two in a tick or none for many. Every event that builds the streak counts and is paid at
   the streak it leaves, and a mistake breaks it there and then. Nothing is a miss, so such a streak
   takes no grace. A streak counts moves unless it says so, and for one that does, a tick that builds
   nothing is no miss.
10. **Within one event, pieces travel before they change.** An event that moves a piece and changes it
    changes it where it lands. Gunnery turns a piece as it rolls.
11. **A puzzle with no check deals straight onto the round.** A deal is tried on a copy only where there
    is a check to hold it to.
12. **What the feeder shows next is kept in the part's state for now.** It belongs in a zone, which
    arrives with seats on rung 5.

## Consequences

- `packages/puzzle` runs Gunnery as five parts in about 280 lines. Its test plays 13,920 ticks and 2,719
  moves beside the shipped engine, on four sets of numbers and six seeds each, and holds the two to the
  same pieces, terrain, score, streak, counts, feed, bag and luck after every one. Between them the
  rounds drop, load, fill, jam, clean, splash, fire and fire broadsides, and run a streak past its cap.
- A puzzle's document gains one key, the streak's `counts`. An event may carry a direction. The rules
  SDK gains `board.terrainState`, a state on a terrain change, and `off` from `board.terrain`. The docs
  site's reference and its rung page say the same, and its tests hold the expanded Gunnery to the
  reference.
- Laying the map on an event costs a puzzle with maps a small part of its own. In return nothing about
  a board is known to a screen that the events did not say.
- Every still puzzle and every ticking puzzle for one player can now be written on rung 4 or below.
  Tiers and a task's par wait for the rung that judges a round, and seats for rung 5.
