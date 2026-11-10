# Deflectors

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/deflectors`. Ticked
(ADR 0015): beams charge and fire on the engine's clock. A 120 second round.

## The puzzle

A six by six deflector grid. About half its cells hold a mirror, set as `/` or `\`. A tap on a
mirror flips it. Empty cells let a beam pass straight through.

Beams come in from ports on the edge. Each is announced before it fires: its entry port lights and
counts down, and its exit port is marked with the same sign. When the count ends the beam fires,
runs straight, turns at every mirror, and leaves by some port. Out through its own exit, it scores
by how many mirrors it turned at: (bounces + 1) squared. Out anywhere else, it hits the hull: a
penalty, and the streak is gone.

While a beam waits, the board draws the route it would take right now: its colour when it reaches
its exit, red when it does not. So the first job is to flip mirrors until the route comes good, and
the real job is to make it long, with two or three beams waiting at once and sharing mirrors.

A waiting beam can be fired early by tapping its entry port. Finishing early brings the next beam
sooner, so a quick hand sees more beams in a round.

Mirrors wear. Each takes three turns of a beam and then burns out; a fresh mirror appears on a
random empty cell. A long route spends mirrors, and the grid shifts under the player all round.

Every beam is dealt an exit it can reach by flipping mirrors alone (the engine searches the routes
when it deals the beam), and the board says how long the longest route is, so a player can see what
was left on the table.

## Luck and skill

- **Luck:** where beams enter and must leave, and where a fresh mirror lands.
- **Skill:** first, any route. Then, the long route. Then, one layout that serves two beams. Then,
  spending mirrors: a twelve-bounce route that burns three mirrors may cost the next beam its exit.

## Input

- Tap a mirror to flip it; tap a lit entry port to fire that beam now.
- Keyboard: arrows move a cursor, space or enter flips, F fires the beam with the least time left.
- A fired beam draws its whole path at once, a spark at every turn, and its points at the exit.

## Engine sketch

Moves `{ type: "flip", cell, tick }`, `{ type: "fire", beam, tick }`, `{ type: "wait", tick }`,
`{ type: "end", tick }`. The reducer advances to the move's tick first: beams whose count has ended
fire, in order, and new beams are dealt. Tracing a beam and searching its reachable exits are pure
functions the board also calls for the live route. The search is bounded (a node budget) and its
order fixed, so the server and the client agree. A beam cannot loop: a path through two-sided
mirrors is reversible, so one that entered from outside leaves.

When a mirror burns out and another appears, routes change: recompute each waiting beam's longest
route, and give a beam whose exit became unreachable a new one, with an event the board can show.

## To settle by simulation

- Mirror density and wear, so most beams have routes of 3 to 8 bounces and a long one of 10 or more
  is there for the finding.
- The count-down and the pace of beams across the round (it should quicken, as Navigation's stars
  do), and the hull penalty.
- Whether wear earns its complexity. If it only confuses, drop it and say so here.
