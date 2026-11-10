# Reactor

Status: built. Prototype (ADR 0036), on the harness at `/reactor`. Untimed moves; a 120 second round.

## The puzzle

A four by four reactor core (`size`) holding fuel rods of grades I, II and III, and hot rods. One
verb: a swipe slides every rod as far as it will go that way. Two rods of one grade that meet fuse
into one of the next grade; a rod fuses once a swipe. After every swipe a new rod enters on the edge
the rods slid away from, in a lane that changed. Its grade is shown beforehand: grade I, or grade II
one time in five (`twoPermille`). A swipe that would change nothing is not a move.

A grade IV rod (`hotGrade`) is hot. It fuses with nothing: it takes up room until it is pushed out.
Two ports (`ports`) are open on the core's rim, each at the end of one row or column. A swipe toward
a port's wall discharges a hot rod that is first in that lane, for 100 (`dischargePoints`). The port
then closes and another opens somewhere else on the rim. Fusing scores a little on the way: 2, 5 and
12 for making a grade II, III and IV (`fusePoints`).

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

## Input

- Pointer: swipe anywhere on the board. The swipe is taken as soon as the finger has travelled a
  quarter of a cell, without lifting.
- Keyboard: arrows or WASD.
- A swipe the round refuses makes the rods lean that way and settle back.
- A port is drawn as a gate in the wall, with a faint band along the lane it serves. A gate shows a
  dot when idle, a bar when a hot rod is in its lane behind another rod, and pulsing chevrons, one a
  rod, when a swipe that way would discharge now (`reactorPortStatus`, `reactorPortLoad`).
- The strip over the core shows the next rod and the heat lamps; the last lamp, a diamond, is the one
  that scrams the core.
- Unrated and lab rounds march chevrons across the core after five seconds idle when a swipe would
  discharge a rod (`reactorHint`). There is no hint for anything else.
- A rod's grade is one bar a grade on a casing; a hot rod is a toothed disc. The mark setting adds
  the grade as a numeral.

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
- **Hot at grade IV on a four by four core.** A hot rod every seven or eight swipes gives a strong
  player about fifteen discharges in a round, and a weak one two or three.
- **The new rod enters on the trailing edge, in a lane that changed.** Kept from the brief. It is the
  kinder rule, and it gives a player who moves one lane a say in where the rod lands.
- **A rod fused hot against a port waits a swipe.** Simpler to read: first it glows, then it goes.

## Open questions for play

- Is a scram at four hot rods too harsh for a first round? `criticalHot` at five is the gentler try;
  the lab preset "No holding" is the harsh one.
- Is two ports right? Three (a lab preset) makes delivery easy and two-port salvos common.
- Does the board say enough about where the next rod will enter, or should the trailing edge show it?
- The fusion scores are small on purpose. Do they read as progress, or as noise beside a discharge?
