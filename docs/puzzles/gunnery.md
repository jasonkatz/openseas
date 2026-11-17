# Gunnery

Status: in the game. Built in M2, redesigned over several playtests under 3.2; restyled to the brand book in M10 (ADR 0061, ADR 0062). In the studio at `/gunnery`.

## The puzzle

Route cells, sabots and slugs through a column board into turrets in the
right order to load them. Correct loads feed turret readiness. QoL: per-turret load-order
indicator, highlight of which drop completes a load. Flagged for possible redesign after
playtesting.

## Role

A duty station: the turrets. Its output loads the ship's turrets each turn (DESIGN.md 3.4), as a percent of `parScore`, capped by `outputCapPercent`; in a space battle the captain fires what the gunner loaded (ADR 0021).

## Luck and skill

- **Luck:** which deck the seed picks, and the order within each shuffled bag. The bag bounds it: every seven pieces hold the same seven.
- **First skill:** filling one turret, again and again, without a jam.
- **Second skill:** guarding the combo, and opening a second turret for the pieces the first cannot take.
- **Third skill:** running all four turrets and firing them in turn for broadsides.
- **Fourth skill:** wasting nothing: a loop that holds the piece with no home yet, and a full combo when the feeder quickens.

## Rules and scoring

A 9 wide by 15 tall deck (tall, to fill
a phone held upright), drawn at random from a set of content maps at the start of each round (the
seed picks it, so replays agree). Each map has its own crates, hatches and turret rows, and the engine
refuses any map that is not fit to play: with no arrows, a piece starting anywhere must leave by a
hatch (no loop built in), the stream from the feeder must leave without running into a turret, and
every turret must be reachable from the feeder with at most three arrows on a route of at most 30 ticks.
The maps were found by searching for layouts that pass, then picked by hand for variety. A feeder in
the top rail drops one piece at a time onto the deck, heading down the middle until crates turn it;
whatever is not steered rolls out through a hatch within a few seconds. The feeder draws
from a shuffled bag (two cells, two sabots, two slugs, one coolant), shows the next three in the rail
beside it, holds back while `maxOnDeck` pieces are out, and quickens from one drop every
`spawnEveryTicks` to every `spawnEveryTicksMin` over the round. Four turrets sit in the side rails,
two a side; each takes a route of one to three arrows from the stream. Pieces roll a
cell per tick until something turns them: an arrow under a piece turns it to follow it; a wall
turns it right, else left, else back. Pieces roll together: one behind a stopped piece waits, two
after the same cell let the older go, and two meeting head on both turn back. The gunner lays as
many arrows as they like, one per deck tile; a loop has to be built out of them, and a new deck every
round means building it anew. A turret takes a cell, then a sabot, then a slug; a full one fires itself
after `fireAfterTicks` (the captain's job from M4) and comes back clear, turning pieces away until
then. A wrong piece jams a turret and loses its load; a jammed turret turns away everything but
coolant, which flushes it clear; coolant in a clear turret splashes harmlessly. A cell and a sabot score
`stepPoints`, a full load `loadPoints` plus `comboStep` for each load already in the combo, up to
`comboCap`; the combo is full loads in a row without a jam. Every turret carries a lamp that lights
when it fires; once all four are lit, the ship fires a broadside worth `broadsidePoints` and the
lamps go out, so feeding one handy turret all round leaves the biggest points on the table. Time is integer ticks of `tickMs`; every
move carries its tick, the client advances its copy once per tick for display and logs a wait now
and then so loads in flight count, and the server refuses a tick ahead of the wall clock (ADR 0015).
The round ends on the clock, `maxMoves` or `maxTick`.

## Input and feedback

Reading the deck is the point of the QoL: every piece carries a small cream chevron on its leading
edge for the way it will roll next, so a turn at a rail or an arrow shows before it happens. A
piece headed into a turret shows its route: cream dots when the piece is what the turret wants (or
coolant for a jammed one) and red crosses when it will jam it, so the two differ by shape as well as
colour, and that turret's port gets a ring of the same colour (the "highlight of which drop
completes a load" above); pieces headed anywhere else show no route. The preview accounts for full
turrets firing before the piece arrives. A mouse hovering a deck tile shows a faint arrow pointing
toward the nearest edge, and every route redraws as if it were laid; a click commits it, the same
click again lifts it, and right-click lifts. Touch taps the same way or swipes across a deck tile to
point an arrow, and a double tap lifts. Keyboard moves a cursor, lays with W, A, S, D and lifts with
Space or Backspace.

The board follows the brand book (`docs/BRAND.md`): flat colours from the one palette, no frame, no
grid, no textures.

- **The deck** is bare ground with one hairline round it. The rails and the crates, the things that
  turn a piece, are flat blocks a shade lighter. Every tile an arrow can lie on has a small dot. A
  hatch is a gap in the rail where the hairline breaks, with a chevron pointing out. The feeder is a
  port in the top rail with a chevron for the way pieces drop, and the next pieces wait in a row
  above it, soonest largest.
- **The pieces** are pictograms drawn in code (`boards/src/gunnery/pieces.ts`), each a silhouette of
  its own, so they read apart with the colour taken away: the cell is a battery on its side with a
  charge window, in sand; the sabot an open cup, in moss; the slug an upright pointed round with its
  driving band cut out, in lilac; the coolant a six-armed frost crystal, in sky. Content names each
  kind's shape and its palette colour. There is no marks setting on this board.
- **A turret** is a port in a side rail with a short barrel poking out through it. The port shows the
  piece the turret wants next. A bar of three beside it fills as it loads, and a full turret holds a
  cream block, its charge, until it fires. A jammed turret's port is tinted red, its barrel is red,
  and the piece it shows is coolant. Its broadside lamp is a ring on the rail, and a cream dot once
  the turret has fired.
- **Amber is the player's own:** the arrows they laid, the faint one the pointer would lay, the
  keyboard's cursor. Red is only the route that will jam and the jammed turret.

A piece that goes into a turret or out a hatch slides there and shrinks to nothing. Points rise
from beside the turret that scored them, in the mono face; a jam and a flush are named in a word.
A shot is the turret's charge shrinking to nothing and its barrel kicking back once; its lamp
lights. Nothing shakes, smokes, sparks or glows (`docs/BRAND.md` section 6). **The beat**, one amber
pulse of the whole board, is kept for two things: a broadside (the compound move), which is also
named in a callout with its points, and the load that fills the combo meter. Reduced motion turns
the rolls into steps and keeps the beat as a still flash. Numbers and the decks live in
`content/data/puzzles/gunnery.json`.

## Engine

`packages/engine/src/gunnery/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/gunnery.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Gunnery". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
