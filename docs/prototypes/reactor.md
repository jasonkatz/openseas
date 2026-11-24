# Reactor

Status: built, deepened in M11 with core pressure (`docs/prototypes/m11-pitches.md`) and laddered
(ADR 0066). Prototype (ADR 0036), in the studio at `/reactor`. Untimed moves; a 120 second round.

## The puzzle

A four by four reactor core (`size`) holding fuel rods of grades 1, 2 and 3, and hot rods. One
verb: a swipe slides every rod as far as it will go that way. Two rods of one grade that meet fuse
into one of the next grade; a rod fuses once a swipe. After every swipe a new rod enters on the edge
the rods slid away from, in a lane that changed. Its grade is shown beforehand: grade 1, or grade 2
one time in five (`twoPermille`). A swipe that would change nothing is not a move.

A grade 4 rod (`hotGrade`) is hot. It fuses with nothing: it takes up room until it is pushed out.
Two ports (`ports`) are open on the core's rim, each at the end of one row or column. A swipe toward
a port's wall discharges a hot rod that is first in that lane, for 100 (`dischargePoints`). The port
then closes and another opens somewhere else on the rim. Fusing scores a little on the way: 2, 5 and
12 for making a grade 2, 3 and 4 (`fusePoints`).

Three things sit on top of that.

- **The core goes critical.** Four hot rods in the core at once (`criticalHot`) and it scrams: it is
  emptied, 150 is lost (`scramPenalty`), and it starts again with two rods. It also scrams when no
  swipe can change anything. The score never goes below zero. Lamps over the core count the hot rods.
- **The salvo.** Hot rods lined up nose to tail at the front of a port's lane all leave in the one
  swipe. Two together score two and a half times what they would apart, three score four times
  (`salvoPercent`). Two ports on one wall, each with a rod ready, make a salvo too. Holding a hot rod
  back to pair it is the compound move the puzzle pays for, and the lamps are what it costs.
- **The pipeline.** A discharge within eight swipes of the last one (`pipelineSwipes`) continues a
  run, and each rod in a run is worth more: 100, 125, 150, 175, then 200 percent (`pipelinePercent`).
  Eight swipes with no discharge and the run is lost. A bar under the core counts the swipes left.
- **Core pressure** (M11). A gauge under the lamps. Each swipe that ends with two or more hot rods in
  the core adds one pressure for each past the first; a swipe that ends with one or none lets one
  off, down to empty. At 13 (`pressureLimit`) the core scrams, for the same 150 as the lamps, and
  the gauge empties with it, as it does on any scram. The lamps cap how many hot rods a player
  holds; the gauge charges for how long. Off: `pressureLimit: 0`.

## Luck and skill

- **Luck:** the grade of the next rod, which changed lane it enters in, and where a port opens.
- **First skill:** fusing without filling the core, as in any sliding game.
- **Second skill:** delivery. A hot rod has to be in a port's lane with nothing between it and the
  wall. Ports on the corner lanes are easy to reach, since a rod slid to a wall is already in one;
  ports on the inner lanes need another rod to stop the hot one in the right row. A swipe that
  changes one lane only decides where the next rod enters.
- **Third skill:** tempo. A hot rod takes about seven swipes to cook, and the pipeline's window is
  eight, so the next rod has to be cooking while this one is delivered.
- **Fourth skill:** the salvo. Park a hot rod at its port, bring a second in behind it, and send both.
  It costs swipes, so it strains the pipeline, and it fills the lamps.
- **Fifth skill:** timing the hoard (core pressure). One hot rod parked is free; two cost a mark a
  swipe. The salvo stays the compound move, but it must be assembled fast: cook the second rod as
  grade 3s close to the port and turn it hot one or two swipes from going out, rather than park one,
  make the second anywhere and wait. A triple is taken only when it falls into line.

The compound move is still **the salvo**; pressure is what it now costs to set one up.

## The ladder

A new player climbs four stages (ADR 0066), each passed with one Steady round. Only the whole
puzzle counts. Every stage is the whole puzzle with layers switched off in `stages` in the content
file; the names and one-line cards are `reactor.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| The core (`core`) | 60s | Fusing, ports and discharge, the lamps | The salvo (`salvoPercent: [100]`), the pipeline (`pipelinePercent: [100]`), pressure (`pressureLimit: 0`) |
| The pipeline (`pipeline`) | 90s | The pipeline | The salvo, pressure |
| Salvos (`salvo`) | 120s | The salvo | Pressure |
| Full pressure (`full`) | 120s | Core pressure | |

With the salvo off, hot rods stacked at a port still leave together, for no more than one by one,
and the board calls nothing; with the pipeline off, the bar under the core is not drawn and no run
is called. The `salvo` stage is the puzzle as it was before M11, so it keeps the old thresholds,
which were set on exactly those rules, and the whole puzzle keeps them too: pressure costs the best
bots about 4 percent, and every bot stays in its tier. The other two are first guesses from the
bots at 32 seeds (below): careless play Green, the one-move bot Sharp, the planners just into
Masterful, and Legendary about 1.4 times the best bot, the ratio the whole puzzle has. They want
setting by hand in the studio.

| Stage | Steady | Sharp | Masterful | Legendary |
|---|---|---|---|---|
| core | 220 | 550 | 850 | 1,300 |
| pipeline | 400 | 1,049 | 1,899 | 3,098 |
| salvo, full | 600 | 1,598 | 2,998 | 4,947 |

## Input and feedback

- Pointer: swipe anywhere on the board. The swipe is taken as soon as the finger has travelled a
  quarter of a cell, without lifting.
- Keyboard: arrows or WASD.
- A swipe the round refuses makes the rods lean that way and settle back.
- Unrated and lab rounds march cream chevrons across the core after five seconds idle when a swipe
  would discharge a rod (`reactorHint`). There is no hint for anything else.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/reactor/pieces.ts`), loads no atlas and has no marks setting.

- **A rod** is a fuel rod seen from its end: a rounded casing with its grade cut out of it as a bold
  mono numeral, so the grade reads with the colour taken away. The colour steps with the grade as a
  second cue: sky, teal, moss, sand, lilac, rose, rust, slate. No rod is amber.
- **A hot rod** has an outline of its own: a casing burst into eight blunt points, with its grade's
  numeral cut out. It is told from any cool rod by that outline alone, and it is the one rod drawn
  in danger.
- **The board.** Bare ground under the strip, the core and the bar. No frame and no grid. The one
  hairline is the core's wall, and an empty cell is a small dot.
- **A port** is a gap in the wall at the end of the lane it serves. A new port's gap opens in
  120ms. An idle port is the gap alone. When a hot rod is in its lane behind another rod, a dim bar
  sits across the gap. When a swipe that way would discharge now, cream chevrons point out through
  the gap, one a rod (`reactorPortStatus`, `reactorPortLoad`).
- **The strip** over the core shows the next rod and the heat lamps. A lamp is a ring when out and
  a danger dot when lit; the last lamp, a diamond, is the one that scrams the core. The label turns
  danger when one more hot rod would scram.
- **The gauge** is a second row of the strip, under the lamps: the word and a plain bar of marks, one
  a point of pressure (`reactorPressureHeld`, `reactorPressureWarning`). Pressure held is a filled
  block; what the next swipe adds if every hot rod stays is a hollow block after it; an empty mark is
  a dash on the baseline; the last mark, the limit, stands taller, a post when empty. Block, outline
  and dash differ in shape, so the count reads with the colour taken away. The board does not
  preview swipes, so the hollow marks are its preview: what holding costs. One swipe from the limit
  (holding these rods one more swipe scrams the core) the word turns to "Vent now", the bar turns
  danger, and the heat alarm (`alarm`) sounds once on the way in. A fusion that makes another hot
  rod can still jump the gauge past the warning. The studio's HUD shows the same reading in words.
  A stage without pressure has no gauge and a strip of one row.
- **The bar** under the core is the pipeline: a segment a swipe left, cream while the run is safe
  and danger for the last two, with what the next discharge is multiplied by.
- **A swipe** is every rod sliding to its place in 120ms. The new rod comes in through the wall the
  rods slid away from.
- **A fusion** is the fused rod taking its new numeral and settling to size, the points rising in
  cream, and a pop that climbs with the grade. Making a hot rod is called out.
- **A discharge** is the rod going out through its port and shrinking away in 160ms, with its
  points in cream. A pipeline run is called out with its count.
- **A scram** is every rod shrinking away, the cause and the points lost said in danger, and the
  fresh rods growing in. Each cause has its own word: "Core critical" for the lamps, "Core
  overpressure" for the gauge, "Core jammed" for a core that cannot move. An overpressure scram is
  heard as the core venting (`vent`), the others as a charge, each with the low `bad`.
- **The beat**, one amber pulse of the whole board, is kept for two things: a salvo, a little
  stronger for a third rod, and a pipeline brought to its top percent. There is no shake, no flash,
  no glow and no particles.

## Engine

`packages/engine/src/reactor/`. Moves: `{ type: "swipe", dir }` (0 up, 1 right, 2 down, 3 left) and
`{ type: "end" }`. For each lane, working from the wall the swipe is toward: hot rods at the front
leave if a port is open there, then the rest pack toward the wall and fuse. Only rods that were hot
before the swipe leave: a rod made hot against a port needs another swipe. The dice are rolled in a
fixed order after the slide: a new port for each one used, the lane the next rod enters, the grade of
the rod after it, then the fresh rods of a scram.

A move's report lists every rod's slide (its cell before and after, whether it fused away or left),
the fusions, the discharges with the pipeline each was scored at, the ports that opened, the rod that
entered, whether the pipeline lapsed, what the swipe did to pressure (`pressureChange`, before any
scram), and a scram with its cause: `critical` (the lamps), `pressure` (the gauge) or `jammed`, named
in that order when more than one holds. The board plays the report and ends on the engine's core.

Pressure is read on the core the swipe leaves; the rod that enters is never hot, so what a swipe
does to the gauge is known before the dice (`reactorSwipeOutcome` carries `pressure` and
`overpressure`). The state holds `pressure` and `pressureScrams`, and hashes them only when the
layer is on: with `pressureLimit: 0` a seed deals, plays and hashes as it did before the layer,
which a test pins with hashes taken from the engine before it.

## Tuning notes

Set from bots, not people (ADR 0036). Averages over 30 seeds at 110 swipes, about a swipe a second.

| Bot | Score | Discharges | Salvos | Scrams |
|---|---|---|---|---|
| Random legal swipes | 580 (median 390) | 2.7 | 0.5 | 1.9 |
| Corner habit (down, left, right, up last) | 490 | 2.8 | 0.1 | 1.9 |
| Greedy: best swipe now | 1,210 | 6.2 | 0.8 | 1.5 |
| Planner: looks three swipes ahead | 3,240 | 15.2 | 0.6 | 0.0 |
| Stacker: a planner that holds a rod to pair it | 4,490 | 14.2 | 4.3 | 0.0 |

The planner discharges every seven swipes (the middle half of its gaps is six to eight) and never
scrams. The thresholds are set from these: 250, 600, 1,200, 2,000, 3,000 and 4,300.

What changed from the brief, and why:

- **The salvo replaces the double.** The brief's double was two rods through two ports in one swipe.
  Bots managed it once in ten rounds: it needs both ports on one wall, which is one deal in five,
  and is nothing a player can set up. Letting stacked hot rods leave together through one port keeps
  the idea (two at once is worth far more) and makes it a plan: the stacker bot makes four a round
  and scores 38 percent more than the planner for it.
- **The core goes critical.** With salvos and no limit, the best thing a careless player could do
  was hoard: the corner habit piled up eight hot rods, and whenever a port opened in line with a pile
  it scored a jackpot. It averaged 2,000 against the planner's 3,200, with a tenth of its rounds
  near 5,000. A cap of four hot rods makes a hoard a scram: the same bot now averages under 500, and
  holding one rod to pair it is a risk a player can see on the lamps.
- **The pipeline's window is eight.** It is just over the seven swipes a good player needs for a rod,
  so it rewards having the next rod cooking and is lost by one wasted stretch.
- **Hot at grade 4 on a four by four core.** A hot rod every seven or eight swipes gives a strong
  player about fifteen discharges in a round, and a weak one two or three.
- **The new rod enters on the trailing edge, in a lane that changed.** Kept from the brief. It is the
  kinder rule, and it gives a player who moves one lane a say in where the rod lands.
- **A rod fused hot against a port waits a swipe.** Simpler to read: first it turns hot, then it goes.

### M11: core pressure and the ladder

Planning already paid before M11 (128 seeds: one move 2,248, rollout 3,560, stacker 3,797). The
shallow spot was the hoard: only the count of hot rods limited it, so holding three cost nothing
until a fourth. Core pressure is the owner's pick from `docs/prototypes/m11-pitches.md`, with its
limit to be set between 12 and 14. Measured with the bot runner (`packages/bots`, ADR 0067, 110
swipes in 120 s), each bot on the same seeds at every setting:

- **Blind stacker**: the stacker planning as if the core had no pressure.
- **Gauge stacker**: the stacker, fearing each mark of pressure past half the limit (40 a mark).
- **Stacker**: reads the gauge only through a scram its three-swipe lookahead meets.
- **Planning hoarder** (the bait): the stacker's eyes, but it never sends a hot rod out alone while
  it has another swipe; it parks one at its port and waits for more.

| Bot, whole puzzle | Off | Limit 12 | Limit 13 | Limit 14 |
|---|---|---|---|---|
| one move (128 seeds) | 2,248 | 2,096 | 2,116 | 2,170 |
| rollout (128) | 3,560 | 3,530 | 3,528 | 3,529 |
| stacker (256) | 3,754 | 3,524 (128) | 3,466 | 3,478 |
| blind stacker (256) | 3,742 | 3,429 (128) | 3,496 | 3,519 |
| gauge stacker (256) | 3,801 | 3,666 (128) | 3,640 | 3,675 |
| planning hoarder (256) | 3,670 | 3,504 (128) | 3,450 | 3,548 |

The gaps, paired on the same seeds, with their standard error:

| | Off (256) | 12 (128) | 13 (256) | 14 (256) |
|---|---|---|---|---|
| gauge stacker over blind stacker | +1.6 ± 1.6% | +6.9 ± 2.6% | +4.1 ± 1.8% | +4.4 ± 1.8% |
| gauge stacker over stacker | +1.2 ± 1.5% | +4.0 ± 2.3% | +5.0 ± 1.8% | +5.7 ± 1.7% |
| planning hoarder under gauge stacker | 3.4 ± 2.9% | 4.4 ± 3.3% | 5.2 ± 2.4% | 3.5 ± 2.5% |
| gauge stacker against the layer off | | −4.5% | −4.2% | −3.3% |

**The limit is 13.** Every limit in the range makes reading the gauge pay by about the same margin,
four to six percent, and with the layer off the same weights gain nothing, so the gap is the
rule's, not the weights'. What tells them apart is the bait: at 13 the planning hoarder loses by
5.2 percent, two standard errors; at 14 by 3.5, under one and a half, which is too close to call
a loss. 12 taxes everyone most and its bait loss is no larger. The tax at 13 is about 4 percent
for the best bot.

**What a pressure scram costs:** the same as a lamp scram (`scramPenalty`, 150, and the core and
the pipeline with it). A scram is one thing to a player, whatever lit it. A cheaper one would need
a key of its own and would make running the gauge to its limit and eating the scram a play; it was
not tried.

How the bots scram at 13 (64 seeds, scrams a round, on pressure of all): careless 2.28 of 2.56; one
move 0.91 of 1.00; rollout none; stacker 0.14 of 0.17; blind stacker 0.30 of 0.30; gauge stacker
0.14 of 0.14; planning hoarder 1.06 of 1.09, with 4.9 salvos but only 10 discharges against the
gauge stacker's 2.6 and 14.4. Pressure now catches a careless hoard before the lamps do, and the
hoarder pays for its triples in scrams.

**The planning hoarder did not beat the stacker.** The pitch's first table said a planning hoarder
beat the stacker with the layer off; at 128 seeds it did not (3,604 against 3,797), nor at 256
(3,670 against 3,754). With pressure it falls further behind the gauge stacker.

The ladder at 32 seeds a cell (`pnpm --filter @openseas/bots ladder reactor`), each cell the mean
score and the tier it reads as. Both checks are met on every stage: careless play lands a tier
below the one-move bot, and both baits lose on the whole puzzle (the hoarder 32 percent under the
one-move bot, the planning hoarder 5.3 percent under the gauge stacker).

| Bot | Core (60 s) | Pipeline (90 s) | Salvo (120 s) | Full (120 s) |
|---|---|---|---|---|
| careless | 165 Green | 281 Green | 537 Green | 341 Green |
| one move | 708 Sharp | 1,279 Sharp | 2,221 Sharp | 1,894 Sharp |
| rollout | 928 Masterful | 2,183 Masterful | 3,548 Masterful | 3,562 Masterful |
| corner habit | 133 Green | 198 Green | 216 Green | 161 Green |
| planner | 907 Masterful | 2,122 Masterful | 3,240 Masterful | 3,240 Masterful |
| stacker | 711 Sharp | 1,790 Sharp | 3,459 Masterful | 3,226 Masterful |
| hoarder | 255 Steady | 434 Steady | 1,681 Sharp | 1,285 Steady |
| blind stacker | 664 Sharp | 1,853 Sharp | 3,939 Masterful | 3,732 Masterful |
| gauge stacker | 663 Sharp | 1,864 Sharp | 3,692 Masterful | 3,780 Masterful |
| planning hoarder | 350 Steady | 1,001 Steady | 3,803 Masterful | 3,581 Masterful |

The stackers read Sharp on the first two stages because they hold rods for a salvo that does not
pay there yet, which is the lesson those stages teach. Gaps under 10 percent at 32 seeds are noise
(the salvo stage's 3,939 and 3,692 are the same bot, blind and reading, on a layer that is off);
the 128 and 256 seed tables above are the ones to trust.

Rollout never holds a rod (1.4 salvos a round, no scram), so pressure costs it nothing, and it now
sits about 4 percent under the gauge stacker where it was 7 percent under the stacker. Part of the
salvo's edge is what pressure taxes.

## Open questions for play

- Is a scram at four hot rods too harsh for a first round? `criticalHot` at five is the gentler try;
  the lab preset "No holding" is the harsh one.
- Is two ports right? Three (a lab preset) makes delivery easy and two-port salvos common.
- Does the board say enough about where the next rod will enter, or should the trailing edge show it?
- The fusion scores are small on purpose. Do they read as progress, or as noise beside a discharge?
- **Is a second meter one too many?** The lamps count hot rods and the gauge counts how long they
  have been held, both over the core. A player may watch one and be scrammed by the other. If play
  says so, the lamps could become marks on the gauge's row, or the gauge could replace the lamps'
  warning.
- **Is pressure a tax?** It costs the best bot about 4 percent and pays the bot that reads it 4 to 6
  percent over one that does not: about the size of Salvage's orders. A person may feel only the
  tax. Play decides whether reading the gauge feels like a skill.
- Part of the gain may be the gauge stacker's weights rather than the rule; rollout, which never
  holds, does not move.
- The warning reads holding: a fusion that makes another hot rod can jump the gauge two marks past
  it. Does that feel fair, or should the warning read the worst swipe?
- Should a pressure scram cost less than a lamp scram? It costs the same now, untried otherwise.
- The core and pipeline stages' thresholds are first guesses from bots and want setting by hand.
