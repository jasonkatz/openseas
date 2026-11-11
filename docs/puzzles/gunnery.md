# Gunnery

Status: in the game. Built in M2, redesigned over several playtests under 3.2. On the harness at `/gunnery`.

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

Reading the deck is the point of the QoL: every piece carries a chevron for its heading. A piece
headed into a turret shows its route as dots, green when the piece is what the turret wants (or
coolant for a jammed one) and red when it will jam it, and that turret gets a matching ring (the
"highlight of which drop completes a load" above); pieces headed anywhere else show no route. The
preview accounts for full turrets firing before the piece arrives. Each turret
shows the piece it wants next as a badge, with cell, sabot and slug pips below for its load. A
mouse hovering a deck tile shows a ghost arrow pointing toward the nearest edge, and every trail
redraws as if it were laid; a click commits it, the same
click again lifts it, and right-click lifts. Touch taps the same way or swipes across a deck tile to
point an arrow. Keyboard moves a cursor, lays with W, A, S, D and lifts with Space or Backspace.
Gunnery has its own piece art rather than the coloured tiles of the other puzzles. The cell is an
upright canister with a glowing orange gauge, the sabot a cream split shell, the slug a pointed
round with a copper band and the coolant a square jug of blue coolant with a hose. Each has its own
silhouette (canister, open shell, pointed round, handled jug), so they read apart without colour, and the marks setting adds a
symbol badge to each. Loads pop their points, a full turret glows and sparks, firing recoils with a muzzle flash, smoke
and a shake, a jam puffs smoke. Numbers and the deck live in `content/data/puzzles/gunnery.json`.

## Engine

`packages/engine/src/gunnery/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/gunnery.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Gunnery". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
