# Reactor

Status: built. Prototype (ADR 0036), in the studio at `/reactor`. Untimed moves; a 120 second round.

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
- **The bar** under the core is the pipeline: a segment a swipe left, cream while the run is safe
  and danger for the last two, with what the next discharge is multiplied by.
- **A swipe** is every rod sliding to its place in 120ms. The new rod comes in through the wall the
  rods slid away from.
- **A fusion** is the fused rod taking its new numeral and settling to size, the points rising in
  cream, and a pop that climbs with the grade. Making a hot rod is called out.
- **A discharge** is the rod going out through its port and shrinking away in 160ms, with its
  points in cream. A pipeline run is called out with its count.
- **A scram** is every rod shrinking away, the cause and the points lost said in danger, and the
  fresh rods growing in.
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
entered, whether the pipeline lapsed, and a scram with its cause. The board plays the report and ends
on the engine's core.

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

## Open questions for play

- Is a scram at four hot rods too harsh for a first round? `criticalHot` at five is the gentler try;
  the lab preset "No holding" is the harsh one.
- Is two ports right? Three (a lab preset) makes delivery easy and two-port salvos common.
- Does the board say enough about where the next rod will enter, or should the trailing edge show it?
- The fusion scores are small on purpose. Do they read as progress, or as noise beside a discharge?
