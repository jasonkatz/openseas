# Navigation

Status: in the game. Built in M2, reworked after a first pass that let a star hover until the navigator dropped it and
let it pass through stars already on the chart. In the studio at `/navigation`.

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
comet) and three colors, and a kind is one of each: the shape is the star's outline and the color
carries a cut-out of its own, so any two kinds are told apart with the color taken away. The
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
drops with enter or space. On a phone held upright the height left over holds a row of turn
buttons per ring, outermost first, and a button to bring the star down, so a turn is one tap
rather than a drag on a narrow ring. In unrated rounds, after a pause, chevrons point at the ring
to turn and which way, from a search over the rings' turns. A toggle hides the markers for players
who want to chart from memory; a meter shows filled markers.

The board follows the brand book (`docs/BRAND.md`): flat colours from the one palette, no frame, no
spokes, no textures.

- **The chart** is as wide as the screen: bare ground with one hairline round it. Each ring is a
  flat band, every other one a shade nearer the ground, so a ring reads as a thing that turns. The
  top octant, the lane stars fall down, is a shade lighter. Every empty slot has a small dot. The
  hub is bare ground.
- **The stars** are pictograms drawn in code (`boards/src/navigation/stars.ts`). A star is two
  things at once, a shape and a colour, and both matter to play. The shape is the outline: the
  spark has four points set on the diagonals, the star five with one up, the comet a round head low
  on the right with its tail drawn out to the upper left. A colour cannot have an outline of its
  own, so each carries one cut-out, the same on every shape: sand a round hole, sky a band across
  that cuts the star in two, rose a cut down the middle. Any two stars that differ in shape or in
  colour are told apart in one flat colour. Content names each colour's palette colour and its
  cut-out, and checks no two colours share one. There is no marks setting on this board.
- **A marker** is the same star hollow: its outline as a line in its colour, with the colour's
  cut-out drawn solid inside it, a little larger than a star so the outline shows round the star
  that fills it. The constellation's markers are joined in order round the chart by hairlines,
  which turn cream where both ends hold their stars.
- **The falling star** runs a dotted cream path down to where it will rest. **Amber is the
  player's own:** the ring round that resting place, bold when the slot is the star's own marker,
  and the two circles round the ring the keyboard or a turn button picked. Markers that want the
  falling star's kind are ringed in a cream hairline. Red is only the shut column: the path's dots,
  a cross on the outer slot at the top and the chart's edge.
- **The next star** waits beside the lane under its label.

A turn is the ring swinging a step, and a landing or a slide is the star gliding to its slot, each
in the brand's one move, eased and never past its place. A star that is charted, cleared in a run
or swept by a lost heading shrinks to nothing. A charted constellation is named in a callout with
its points in the mono face; a run's points rise from where it cleared; a lost heading is named in
red with what it cost. Nothing shakes, bursts, sparkles or glows (`docs/BRAND.md` section 6).
**The beat**, one amber pulse of the whole board, is kept for two things: swift charting (the
compound move: a constellation charted in fewer than 2n landings), stronger the more landings it
saved, and the charting that takes the chain to its top multiplier. Reduced motion turns the turns
and glides into cuts and keeps the beat as a still flash. Numbers live in
`content/data/puzzles/navigation.json`.

## Engine

`packages/engine/src/navigation/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/navigation.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Navigation". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
