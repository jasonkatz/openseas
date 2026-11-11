# Navigation

Status: in the game. Built in M2, reworked after a first pass that let a star hover until the navigator dropped it and
let it pass through stars already on the chart. On the harness at `/navigation`.

## The puzzle

Arrange and shift pieces to reproduce a target constellation. Completed patterns
grant token bonuses and space battle advantages. QoL: target overlay toggle, progress meter.

## Role

A duty station: the nav console, the one station no bot works. Its output grants the ship token bonuses and space battle advantages each turn (DESIGN.md 3.4), as a percent of `parScore`, capped by `outputCapPercent`.

## Luck and skill

- **Luck:** the kind of each falling star, and the constellation dealt. Half a new constellation's kinds are drawn from stars already on the chart, so strays are less luck than they look.
- **First skill:** filling the markers of the inner ring, one star at a time, without losing the heading.
- **Second skill:** filling markers on the outer rings, and bringing stars down instead of waiting for them.
- **Third skill:** keeping a chart where outer stars can travel: a turn that opens a slot moves everything above it.
- **Fourth skill:** charting each constellation in fewer than 2n landings for the bonus, and carrying the chain to the end of the round.

## Rules and scoring

A round star chart of three rings and eight octants,
with time carried in the move log as in Gunnery (ADR 0015). Stars come in three shapes (spark, star,
comet) and three colors, so shape alone tells kinds apart; marks add the color's symbol. The
constellation is a set of hollow markers fixed to the chart, each wanting a kind in a slot, joined
by faint lines so it reads as a figure. Stars fall one at a time from the sky into the top octant,
taking `fallTicks` at the start of the round and quickening to `fallTicksMin` by the end; the
navigator turns any ring a step either way while it falls (stars ride with their ring, markers stay
put), or taps to bring it down at once. A star falls inward until it meets another and rests in the
ring outside it, or at the center of an empty column, and every column stays packed toward the
center: a turn that opens a slot under an outer star lets the stars above it slide in, which can
fill a marker, make a run, or unmake one. A star in the outer slot at the top shuts the column. A
marker is filled while a
matching star sits on it, and a turn can fill one as well as a landing. When every marker is filled
the constellation is charted: those stars go, points are `n * n * starPoints` times the chain of
constellations charted without a lost heading (`chainPercent`: ×1, ×1.25, ×1.5, ×1.75, then ×2), plus
`n * starPoints` for every landing under `2n` it took since it was dealt, so one charted in its
minimum n landings earns as much again as its stars; then a new constellation is dealt, larger as the round goes on and drawing half its kinds
from stars already on the chart so strays stay useful. Three or more loose stars of one kind in a
row, around a ring or down a column, clear for `runPoints` per star beyond two; a star on its marker
is charted, not loose, and never clears this way. A star arriving while the top outer slot is taken
is a lost heading: the top column is swept, `lostHeadingPenalty` is lost and the chain breaks. Every move
carries its tick; the client advances its copy once per tick and logs a wait now and then so
landings count, and the server refuses a tick ahead of the wall clock. The round ends on the clock,
`maxTick` or `maxMoves`.

## Input and feedback

Touch drags or taps a ring to turn it and taps the sky, the falling star or
the center to bring it down; keyboard picks a ring with up and down, turns with left and right,
drops with enter or space. Reading aids: a dotted path from the star to the ring where it will rest,
gold when that spot is its own marker, a red cross and a red outer band when the column is shut;
markers wanting the falling star's kind beckon; in unrated rounds, after a pause, chevrons point at
the ring to turn and which way, from a search over the rings' turns. A toggle hides the markers for
players who want to chart from memory; a meter shows filled markers. The chart is as wide as the
screen, with a small hub and a thin rim so the rings get the width; the top octant is tinted as
the lane stars fall down. On a phone held upright the height left over holds a row of turn
buttons per ring, outermost first, and a button to bring the star down, so a turn is one tap
rather than a drag on a narrow ring. Landings glow, a charted
constellation flashes its lines and bursts, a run clears with a popup, a lost heading shakes the chart.
Numbers live in `content/data/puzzles/navigation.json`.

## Engine

`packages/engine/src/navigation/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/navigation.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Navigation". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
