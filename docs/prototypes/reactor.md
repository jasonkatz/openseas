# Reactor

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/reactor`. Untimed
moves; a 120 second round.

## The puzzle

A four by four reactor core holding fuel rods of grades I, II, III and IV. A swipe slides every rod
as far as it will go that way. Two rods of one grade that meet fuse into one of the next grade (a
rod fuses once a swipe). After every swipe that moved anything, a new rod enters on the edge the
rods slid away from, in a row or column that moved; its grade is shown beforehand.

A grade IV rod is hot. It fuses with nothing: it only takes up room until it is pushed out through a
port. Two ports are open on the core's rim at any time, each at one end of one row or column. A hot
rod that a swipe carries to the wall at an open port is discharged for the big score, the port
closes, and another opens somewhere else on the rim.

A swipe that moves nothing is not a move. When no swipe can move anything, the core scrams: it is
emptied for a penalty and play goes on.

Layers:

1. **Pipeline.** Discharging again within a few swipes of the last discharge builds a multiplier.
   A core with the next hot rod already cooking keeps it; one that starts from nothing loses it.
2. **Double.** Two discharges in one swipe (one through each port) score well over twice one.

## Luck and skill

- **Luck:** the grade of the next rod, which lane on the trailing edge it takes, where a port opens.
- **Skill:** first, fusing without filling the core. Then, lining a hot rod up with a port and
  clearing its way to the wall. Then, building the next hot rod while delivering this one. Then,
  parking two hot rods for one swipe.

## Input

- Swipe anywhere on the core. Keyboard: arrows or WASD.
- Rods slide and fuse with a pop; a discharge is a flash out through the port. The next rod shows in
  the board's strip. Ports glow on the rim; a port in line with a hot rod glows brighter.
- Unrated and lab rounds may pulse an arrow after a pause when a swipe would discharge a rod.

## Engine sketch

Moves `{ type: "swipe", dir }` (0 up, 1 right, 2 down, 3 left) and `{ type: "end" }`. For each line
in the swipe's direction, working from the wall: a hot rod first in line at an open port is
discharged, then the rest slide and fuse. The report lists each rod's slide (id, from, to), fusions,
discharges, the rod that entered, and a scram, for the board to play.

## To settle by simulation

- The chance of a grade II entering, and whether the hot grade should be IV or V, so a bot that
  swipes sensibly discharges every 8 to 12 swipes and seldom scrams.
- The scores for fusing (small, they are the means) against discharging (the end), the pipeline's
  window, and the scram penalty.
- Whether the new rod should enter on the trailing edge or anywhere; the edge is the kinder rule.
