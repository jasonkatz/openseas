# Salvage

Status: built. Prototype (ADR 0036), on the harness at `/salvage`. Untimed moves; a 120 second round.

## The puzzle

A field of drifting debris, seven wide and eight tall, always full. Drag a line through touching
pieces of one kind and let go to haul them in. Touching includes diagonals. A line needs three
pieces (`minLine`), and a line of n scores n × n (`linePoints`). Hauled pieces leave gaps: the
pieces above fall into them and new debris drifts in at the top.

Two or three loot crates are adrift on the field. A crate cannot be tethered. There are two ways to
take one:

- **Off the floor.** Haul the debris under a crate and it sinks. A crate that reaches the bottom row
  is taken for 30 (`crateFloorPoints`).
- **In a net.** Bring the line back onto its first piece (four pieces or more, `loopMin`, with the
  ends touching) and the line closes into a net. A net hauls every crate on the field at once, and
  crates are worth far more together than apart: k crates score 50 × k × k (`crateLoopPoints`), so
  one is 50, two are 200 and three are 450. Closing also doubles the line's own points
  (`loopPercent`) and hauls any debris inside the loop for 10 a piece (`enclosedPoints`).

A coupler is a rare piece that joins any line, and the line may change kind across it.

A line of five or more (`streakMin`) builds a streak that multiplies the whole haul: 100, 115, 130,
145, 160, 180, then 200 percent (`streakPercent`). One shorter line is forgiven; a second in a row
breaks the streak. Crates off the floor take the streak too.

If no line of three is left, the debris is dealt again in place and the crates stay where they are.

## Luck and skill

- **Luck:** what drifts in, and where the crates appear.
- **First skill:** finding a line of three, then a longer one. With five kinds and diagonals a line
  of five is usually there for anyone who looks, and a line of eight for anyone who looks hard.
- **Second skill:** the streak. Short lines are still useful (they dig, and they shape the field),
  but two in a row cost the multiplier.
- **Third skill:** the net. A loop can be drawn on about half of all fields without setting one up,
  so the question is when: netting one crate at a time is worth a quarter of waiting for two, and
  waiting means not hauling the debris under the crates you are saving.

## Input

- Pointer: drag from a piece through its neighbours. Dragging back over the previous piece undoes a
  step. The first piece pulses when the line could close onto it. Releasing hauls a line of three or
  more and drops a shorter one.
- Keyboard: arrows or WASD move the cursor, Q E Z C move it diagonally. Space starts a line, the
  cursor then draws it, space or enter hauls it, escape drops it.
- While a line is drawn the strip over the field shows its length and what it will score, streak
  included: the engine's own sum (`salvageLineValue`).
- Unrated and lab rounds pulse a line worth drawing after six seconds idle: a loop when crates are
  adrift, the longest line found otherwise.

## Engine

`packages/engine/src/salvage/`. Moves: `{ type: "tether", cells, loop }` and `{ type: "end" }`. A
move's report lists the line, the netted crates and enclosed debris, then one round per settling:
crates taken off the floor, the falls, the pieces that drifted in, and the field after. The board
plays the report and ends on the engine's field.

Whether a cell is inside a loop is the even-odd rule on the polygon through the line's cell centres,
in integers.

## Tuning notes

Set from bots, not people (ADR 0036). All at 45 hauls a round.

- **Five kinds, not four.** With four, a bot that takes the longest line it finds averages eleven
  pieces a haul, and a line of five is always there: there is nothing to look for. With six, the
  longest line averages five and a half and the streak rarely starts. Five gives a range: three for
  a beginner, five with a glance, seven with care.
- **The net, not the lasso.** The first design hauled only what was inside a loop, so a crate needed
  a ring of one kind round it. Bots found such a ring round a crate on about one field in a
  thousand. The net keeps the gesture and makes it reachable: any closed line of four nets the
  crates, and a field offers one about half the time.
- **Crates at 50 × k × k.** At 150 the net was three quarters of every score and lines did not
  matter. At 50 a bot that never nets scores about 1,900, one that nets each crate as it appears
  about 2,900, and one that waits for three about 3,600: crates are worth a third to a half of a
  good round, and patience pays without being the only thing that does.

## Open questions for play

- Is the streak's grace the right size, or should a net never break the streak?
- Does the field want gravity at all, or should hauled debris drift in from the side it left by?
- Are couplers worth their rule?
