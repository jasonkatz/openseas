# Salvage

Status: built. Prototype (ADR 0036), in the studio at `/salvage`. Untimed moves; a 120 second round.

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

An **order** names one kind of debris. One line of that kind, seven pieces or more (`orderLength`),
fills it for 200 (`orderBonus`), and the next order names a different kind. A line of seven of one
named kind is rarely lying there; it is built, by hauling what lies between two clumps of the kind
so they fall together.

Every eight hauls (`volatileEvery`) one piece of the debris drifting in is a **volatile**: a piece
of its kind with a fuse of six (`fuse`). It links as its kind. Every haul that leaves it on the
field burns one off its fuse. Hauled on a line, or caught inside a net, it is defused, and it pays
60 (`volatilePoints`) for every haul it burned and one more: 60 fresh, 360 with one left. When the
fuse runs out it blows: it and every piece of debris round it, diagonals too, turn to **rubble**,
and the streak breaks. Rubble cannot be tethered. A net clears it as debris inside the loop, and the
floor takes it for nothing once it sinks there. Crates are not harmed.

A line of five or more (`streakMin`) builds a streak that multiplies the whole haul: 100, 115, 130,
145, 160, 180, then 200 percent (`streakPercent`). One shorter line is forgiven; a second in a row
breaks the streak. Crates off the floor take the streak too.

If no line of three is left, the debris is dealt again in place and the crates stay where they are.

## Luck and skill

- **Luck:** what drifts in, where the crates appear, the kind each order names, and which piece is
  volatile.
- **First skill:** finding a line of three, then a longer one. With five kinds and diagonals a line
  of five is usually there for anyone who looks, and a line of eight for anyone who looks hard.
- **Second skill:** the streak. Short lines are still useful (they dig, and they shape the field),
  but two in a row cost the multiplier.
- **Third skill:** the order. Seven of the named kind in one line is a shape to build: the pieces
  between two clumps hauled out, with long lines of other kinds, so the clumps fall together.
- **Fourth skill:** the volatile. Defusing at once is safe and pays a sixth of what it pays at the
  last haul, but keeping a line to it open while it burns takes planning, and a blast costs the
  streak. Hauling every volatile the moment it lands is the bait: it feels careful, and it is the
  cheapest way to play it.
- **Fifth skill:** the net. A loop can be drawn on about half of all fields without setting one up,
  so the question is when: netting one crate at a time is worth a quarter of waiting for two, and
  waiting means not hauling the debris under the crates you are saving.

## The ladder

A new player climbs four stages (ADR 0065), each passed with one Steady round. Only the whole
puzzle counts. Every stage is the whole puzzle with layers switched off in `stages` in the content
file; the names and one-line cards are `salvage.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Lines | 60s | Lines, n × n | The streak (`streakPercent: [100]`), crates, nets (`loopMin: 0`), orders, volatiles |
| Streak and crates | 90s | The streak, crates taken off the floor | Nets, orders, volatiles |
| Nets and orders | 120s | Nets, orders | Volatiles |
| Full salvage | 120s | Everything | |

Volatiles come last because rubble is cleared by a net, so nets want to be second nature first.
Orders come with nets because both ask which line to draw, not only how long. Each stage's
thresholds are the whole puzzle's scaled by what a one-move bot scores at that stage in that time
(lines 15 percent of the whole, streak and crates 33, nets and orders 93), and want setting by hand.

## Input and feedback

- Pointer: drag from a piece through its neighbours. Dragging back over the previous piece undoes a
  step. A ring pulses round the first piece when the line could close onto it. Releasing hauls a
  line of three or more and drops a shorter one.
- Keyboard: arrows or WASD move the cursor, Q E Z C move it diagonally. Space starts a line, the
  cursor then draws it, space or enter hauls it, escape drops it.
- While a line is drawn the strip over the field shows its length and what it will score, streak,
  order and volatiles included: the engine's own sum (`salvageLineValue`). A line that fills the
  order says so.
- The order stands beside the board, the named kind's own piece and the length it asks for.
- Unrated and lab rounds pulse a line worth drawing after six seconds idle: a loop when crates are
  adrift, the longest line found otherwise.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/salvage/pieces.ts`), loads no atlas and has no marks setting.

- **Debris.** Each kind is one flat piece of wreckage with an outline of its own and no cut-out: the
  ingot a trapezoid bar, the panel a hull plate with a corner torn out, the shard a leaning sliver,
  the crystal a cut gem, the cell an upright capsule, and in a lab field of more kinds the spark a
  four pointed star, the strut a rod with a knuckle at each end and the droplet a tear. Their
  colours are a second cue: sand, sky, rose, moss, lilac, then teal, slate and rust.
- **A loot crate** is the one full square on the field, in cream, with its latch cut out.
- **A volatile** keeps its kind's outline and colour, so it reads as the kind it links as, with a
  hole cut at its heart and one notch on its crown for each haul its fuse has left.
- **Rubble** is a heap of three broken stones, dim. No debris shares its outline or the crate's.
- **The board.** Bare ground, no frame and no grid; the field is always full, so no cell needs a
  dot. The one hairline is the floor under the bottom row, the edge a crate is taken at.
- **The tether** is one flat line through the pieces on it, amber because it is the line in the
  player's hand, and the pieces on it stand a little larger. The strip over the field says what it
  is worth, in mono: cream once it is long enough to haul, dim before.
- **A closed net** turns the line cream, and every crate it will bring in is ringed in cream. The
  first piece of a line that could close is ringed in cream too, pulsing. A hint is a cream ring on
  each piece of the line it suggests. The keyboard's cell is an amber ring.
- **A haul** shrinks its pieces to nothing where they are, one after another in the order drawn,
  each pop a step higher. The points rise from the last piece in cream. The pieces above fall in
  120ms and new debris drifts in from behind the top edge. A net draws one cream line from the loop
  to each crate before the crate shrinks. A crate on the floor shrinks there, with its points.
- **A blast** rings the volatile in danger red and turns it and its neighbours to rubble where they
  stand, before anything falls, with the low crack.
- **Callouts** name a net and its crates, a loop with nothing to net, a mighty line (twelve), a
  filled order (with the rising cue), a volatile defused, a long line (eight) and the streak, one
  a haul in that order; a blast has its own; a field dealt again is said in dim.
- **The beat**, one amber pulse of the whole board, is kept for two things: a net that brings crates
  in, stronger for each crate, and a mighty line. There is no shake, no flash, no particles and no
  glow.

## Engine

`packages/engine/src/salvage/`. Moves: `{ type: "tether", cells, loop }` and `{ type: "end" }`. A
move's report lists the line, the netted crates and enclosed debris, the volatiles defused, whether
the order was filled, the blasts, then one round per settling: crates and rubble taken off the
floor, the falls, the pieces that drifted in, and the field after. Volatiles burn and blow after the
haul is taken and before anything falls; the volatile that is due drifts in with the first
settling's new debris. The board
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

- **Orders, not contracts.** The first version of this layer was a contract: lines of a named kind
  paid double, and fifteen pieces of it paid a bonus. Every bot got its worth without trying, and
  one that played for it scored no more (a rollout bot scored 7 percent less). An order asks for one
  line of seven of the kind, which is built, not found: a rollout bot that plans fills 8.7 a round
  to a one-move bot's 6.4, and scores 8.5 percent more than one that ignores orders, where on the
  field without orders planning gains nothing. Orders of nine were too rare to plan for (+6 percent).
- **Volatiles on a beat, and late pays most.** Drawn at random with a cap of one, defusing at once
  freed the slot and brought the next volatile sooner, and with a flat payment the bait (defuse at
  once) beat holding. On a beat of eight hauls, paying 60 for every haul burned and one more, and
  breaking the streak on a blast, the bait scores 4 percent under the rollout bot that holds.
- **Couplers cut.** A third special piece crowded the field, and a line that changes kind muddied
  the order.

The bots of this pass, 32 seeds, 45 hauls. One-move bots weigh each line by what it scores now; the
rollout bot takes the eight best lines, plays each three times five hauls on with a fresh random
stream (so it never sees what will drift in), and keeps the best.

| Bot | Field without orders or volatiles | With orders | Full |
|---|---|---|---|
| Patient netter, blind to orders and volatiles | 7,289 | 9,460 | 9,499 |
| One move, sees everything | 7,289 | 9,634 | 10,412 |
| Rollout, defuses every volatile at once (the bait) | | | 10,903 |
| Rollout | 6,871 | 10,267 | 11,370 |

Planning gains nothing on the old field and 20 percent on the full one. These bots are stronger
than the ones the thresholds were first set from; the thresholds were raised a fifth for the points
orders and volatiles add (a blind bot gains about that much) and want setting again by hand.

## Open questions for play

- Is the streak's grace the right size, or should a net never break the streak?
- Does the field want gravity at all, or should hauled debris drift in from the side it left by?
- Is seven the right order length for people? Bots found seven worth building toward and nine too
  rare to plan for; a person's longest lines are shorter than a bot's.
- Does the volatile's notch count read at a glance on a phone?
