# Cutting

Status: built and deepened (M11): the order is its layer, and it is learned on a ladder of three
stages. Prototype (ADR 0036), in the studio at `/cutting`. Untimed moves; a 120 second round.

## The puzzle

A slab of salvage, six by six, made of blocks of four ores, with a flaw or two: single cells of the
wrong ore sitting in a block. Blocks of the same ore that touch run together, so the shapes on a slab
are not all rectangles.

The cutting torch makes straight cuts along the grid. A cut runs the whole way across the piece it is
made in and splits that piece in two, so every piece is always a rectangle. A piece that holds one
ore only is pure: it banks at once for its area squared (`cellPoints` × area × area) and leaves the
table. One pure piece of twelve cells is worth 144, four times two pieces of six, so the art is
freeing the big blocks whole.

Cuts are limited. Each slab comes with between three and six (`minCuts`, `maxCuts`): the fewest with
which the best plan banks 85 percent (`budgetPercent`) of what a torch with no limit could bank from
that slab. So there is always about one cut too few, and something has to be given up.

A slab ends when the table is bare, when the cuts are spent, or as soon as no cut that is left could
bank anything. What is still on the table is scrap and pays nothing. The slab is then graded against
the best any plan could have banked from it with its cuts, which the engine knows exactly:

- **Flawless:** all of the best. Pays 100 (`flawlessBonus`).
- **Clean:** at least 80 percent of it (`cleanPercent`). Pays 40 (`cleanBonus`).
- **Rough:** less. Pays nothing.

Clean and flawless slabs in a row build a streak that multiplies the bonus: 100, 125, 150, 175, then
200 percent (`streakPercent`). A rough slab breaks it. The next slab is dealt at once.

A slab can be given up for the next one at any time (the chip over the slab, or D). It is graded as
it stands.

**The order.** Each slab names an order: a plate size, two by two, two by three, two by four, three
by three or three by four (`CUTTING_ORDER_SIZES` in the engine). A pure piece of exactly that size,
either way round, banks `orderBonus` (50) on top of its area squared, every time one is banked on
that slab. The order is drawn after the slab, from the slab's own stream, among the sizes the slab
holds pure somewhere (any size on the rare slab that holds none), so an order can always be filled
by some plan. The slab's best, its budget of cuts and its grade all count the order. Off is
`orderBonus: 0`: no order is dealt and nothing is drawn for one, so every seed deals the slabs it
dealt before the layer was built (a test pins six rounds' hashes from before it).

Slabs grow as they are finished: five blocks and one flaw at first (`partsStart`, `flawsStart`), one
more block every two slabs (`growEvery`) up to seven (`partsMax`), and a second flaw from the fifth
slab on (`flawsMax`).

## Luck and skill

- **Luck:** the slab. No slab holds a block bigger than 45 percent of it (`maxBlockPercent`), so no
  round is made by one windfall cut.
- **First skill:** seeing a pure rectangle and the cut that frees it.
- **Second skill:** the sequence of cuts. A cut runs across the whole piece, so a careless early cut goes straight
  through a block that was wanted whole. On a fresh slab about two of the ten possible first cuts
  keep the best in reach, and the right one often banks nothing by itself: it only sets the next
  two up.
- **Third skill:** the budget. With one cut too few, which block to leave as scrap, and whether to
  cut a flaw out of a big block or bank the smaller pure piece beside it.
- **Fourth skill:** the order. Is the plate worth carving out of a bigger block? Area squared
  punishes it hard: a three by three is 81 whole, and carved into a two by three plate and a strip
  it is 36 + 9 + the bonus, for one more cut. Sometimes the plate sits in a block for free,
  sometimes it costs the block. It meets the compound move head on, because a big block freed whole
  is exactly what the order tempts a player to break. The best plan that weighs it scores 22 percent
  more than the same plan blind to it, and 25 percent more than the one that chases it.
- **Fifth skill:** moving on. The round is the clock, not the slab: the last cut of a plan often
  banks a small piece, where a fresh slab pays more for its first. A cutter that gives a slab up
  once its next cut is worth less than a cut's share of a good round (about 90 points) beats the
  best plan followed to its last cut by 6 percent (128 seeds). It is the hardest to see, since the
  hint itself plays the plan to the end.
- **The compound move** is still a big block freed whole by a seam cut that banks nothing, now
  with the plate weighed against it.

## Input and feedback

- Pointer: swipe along a grid line inside a piece. A swipe across lines up a cut across, a swipe
  down a cut down; the line snaps to the nearest grid line and shows where it will run across the
  whole piece. A side that would be banked is ringed and shows what it pays (the engine's own sum,
  `cuttingCutPreview`); a side that would stay is dimmed. The cut is made on release.
- Or tap near a line to line the cut up, and tap the same line again to make it.
- Keyboard: left and right move a cut that runs down, up and down move one that runs across (the
  first press of the other pair turns the cut), tab or N takes the next piece, space or enter cuts,
  escape drops the cut, D gives the slab up.
- Unrated and lab rounds pulse the first cut of a best plan after seven seconds idle, as a cream
  line. The plan counts the order.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/cutting/pieces.ts`), loads no atlas and has no marks setting.

- **Ores.** A cell of ore is a square in the ore's colour that fills its cell. The rules fix that
  outline, so each ore carries one cut-out no other ore has, and the cut-out tells the ores apart
  with the colour taken away. The four in play are nickel (sand, one round hole), cobalt (sky, a
  slot), quartz (rose, a cross) and olivine (moss, a wedge). A lab's fifth to eighth ores are
  spinel (lilac, a lozenge), beryl (teal, two holes), iron (slate, a ring) and chalk (cream, two
  slots). No ore is amber, and none is rust, which would sit beside the danger of a rough slab.
- **The board.** Bare ground with one hairline round the strip and the slab. No frame and no grid
  lines: the thin gap between the cells of a piece is the slab's grid. A cut shows as a wider gap
  between two pieces. Where a piece has been banked the ground is bare.
- **The strip** over the slab shows a dot for each cut the slab came with, cream while it is still
  to be made; what has been banked against the slab's best, as numbers and as a cream bar with a
  notch where clean begins; and the chip that takes the next slab.
- **A cut being lined up** is the player's own, so it is the one amber thing: a line across the
  whole piece, steady under a finger and breathing while it waits for the second tap. A side that
  would be banked has a cream ring round it and what it pays on a scrim of the ground (the order's
  bonus included). A side that would stay is dimmed.
- **The order** stands in a row under the slab: a small plate of the order's size, long side
  across, in little dim cells, and `Order +50` beside it in mono. A side lined up that would fill the
  order is marked by its corners: a short cream stroke along each edge from every corner, just
  outside the ring, like a plate marked out for the torch. It reads with the colour taken away,
  and the plate under the slab turns cream while it is lined up. When such a piece banks it keeps
  its corners as it shrinks, the order is called out (`Order filled +50`) and the rising cue plays
  in place of the clear. The row is laid out only when orders are on; a stage without them has none.
- **A cut** is the line shown once more as it fades, and the two sides easing apart in 120ms.
- **A banked piece** shows its points rising in cream, bigger for a piece of nine cells or more,
  and shrinks to nothing in 160ms on a rising note. The bar grows.
- **Scrap** dims and shrinks away when the slab ends. The grade is called out: flawless and clean
  in cream with the bonus, rough in dim, and in danger when it breaks a streak. A streak of two or
  more is shown under it. The next slab eases in from just above where it rests.
- **The beat**, one amber pulse of the whole board, is kept for one thing: a flawless slab, and
  each one in a streak a little stronger. There is no shake, no flash and no glow.

## Engine

`packages/engine/src/cutting/`. Moves: `{ type: "cut", piece, vertical, at }`, `{ type: "done" }` and
`{ type: "end" }`. A cut's report gives the piece as it was, the two sides with what each banked,
and, when the move ended the slab, how it ended, its grade, bonus and scrap. The state then already
holds the next slab; the board plays the report and ends on the engine's table.

The best is a table over every rectangle of the slab and every number of cuts, in points: a pure
rectangle is worth what it banks (its area squared, and the order's bonus when it is the order's
size), and any other the best split over every cut line and every way to share the remaining cuts
between the two sides. A pure rectangle banks the moment it is made and is never cut again, so the
order changes one constant per rectangle and the table stays exact at the same cost.
`cuttingBestRemaining` and `cuttingBestCut` take an optional number of cuts to spend, for a plan
that stops short. The board asks `cuttingFillsOrder` and `cuttingPiecePoints`; a cut's report and its
preview mark each side that fills the order (`filled`), and the state counts `ordersFilled`. The same table sets the slab's budget, ends a slab when
nothing more can be banked, and gives the hint. A test tries every sequence of cuts on small slabs
and finds none that beats it.

A slab is dealt by splitting the rectangle at random into blocks (a bigger block is more likely to
be split, and more often across its longer side), giving each an ore, then turning cells into flaws.

## Tuning notes

Set from bots, not people (ADR 0036). Four cutters: random; greedy, which takes the cut that banks
most now; one cut ahead, which breaks greedy's ties by what the next cut could bank; and the exact
best plan. Shares are of the slab's best.

- **Flaws and a tight budget are what make a slab a question.** The brief gave a slab its blocks
  less one in cuts. On clean blocks with every cut they need, the cutter that only takes what banks
  most now is flawless on 77 percent of slabs: the best plan is just the grid lines, and there is
  nothing to see. With flaws, and cuts for 85 percent of what an unlimited torch could bank, that
  cutter banks 55 to 70 percent, one that looks a cut ahead 80 to 85, and random cuts 12 to 15.
- **The budget is set per slab, by the table.** A fixed number of cuts was too many on some slabs
  and hopeless on others. The fewest cuts that reach 85 percent come to 3.7 on a first slab and 4.6
  on a later one.
- **Slabs stop growing at seven blocks and two flaws.** At eight blocks and three flaws a slab's
  best fell to about 180 for five cuts spent fiddling with single cells. From the fifth slab on
  the best is about 215 for 4.6 cuts; on the first, about 290 for 3.7.
- **No block over 45 percent of the slab.** Without the cap one opening slab in five held a block
  over half its size, and a slab's best ran from 234 to 926: a twenty-four cell block is 576 from
  one obvious cut. With it the best runs 224 to 360 on a first slab (tenth to ninetieth percentile)
  and topped out at 459 in 1,200 deals.
- **By slab, as dealt now:** first slab, greedy banks 70 percent and is flawless on 34 percent of
  slabs, one cut ahead 86 and 51. Fifth slab, 54 and 10, then 78 and 25.
- **A round, by cuts made:** random 30 cuts scores about 230; greedy 1,080 at 24 cuts and 1,330 at
  32; one cut ahead 1,830 at 28 and 2,240 at 36; a cutter that finds the best cut six times in ten
  2,540 at 32; the best plan 2,830 at 30 and 3,690 at 40. The thresholds (350, 800, 1,300, 1,900,
  2,500, 3,300) sit on those.
- **Scrap pays nothing.** The grade is already a share of the best, so a near miss is a clean slab,
  not a zero.
- **The bonus is flat, not a share.** Flawless 100 and clean 40, times the streak, is easier to say
  than a percentage of the slab, and a slab's best varies little now that big blocks are capped.
  For a cutter on the best plan the bonuses are about two fifths of the round.

## The ladder

A new player climbs three stages (ADR 0066), each the whole puzzle with layers switched off in
`stages` in the content file; the names and one-line cards are `cutting.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Blocks | 60s | Pure blocks, grades | Flaws (`flawsStart`, `flawsMax`: 0), the tight budget (`budgetPercent: 100`), the streak (`streakPercent: [100]`), the order (`orderBonus: 0`) |
| Flaws | 90s | Flaws, the budget at 85, the streak | The order |
| Full cutting | 120s | The order at 50 | |

The stages' thresholds are first guesses from the bots: the whole puzzle's, scaled by what the best
plan scores at that stage in its time (blocks 55 percent of the whole, flaws 74). They want setting
by hand. On blocks, greedy is nearly the best plan (no flaws and every cut it needs: the first
tuning note), so most bots read Sharp or Masterful there; that is the stage's job, seeing
rectangles, and careless play still lands Green.

## Tuning notes: the order (M11)

Set from bots (ADR 0067), `pnpm --filter @openseas/bots ladder cutting --seeds 32`, the person's pace
modelled as 30 cuts in 120 s and a slab given up in 1 s. The new bots: **order blind** is the best
plan by area alone; **order chaser** (the bait) is the best plan with the order counted three times
over; **move on** weighs every number of cuts it could still spend by what the best plan banks with
them and the grade's bonus, less 90 points a cut, and gives the slab up when none is worth it.

32 seeds a cell (seeds `ladder-0` to `ladder-31`); each cell is the mean score and the tier it reads as on that stage.

| Bot | Blocks (60 s) | Flaws (90 s) | Full (120 s) |
|---|---|---|---|
| careless | 197 Green | 167 Green | 241 Green |
| one move | 1,290 Sharp | 1,057 Steady | 1,313 Steady |
| rollout | 1,402 Masterful | 1,618 Sharp | 2,123 Sharp |
| greedy | 1,277 Sharp | 984 Steady | 1,335 Steady |
| one cut ahead | 1,547 Masterful | 1,626 Sharp | 1,976 Sharp |
| best plan | 1,628 Masterful | 2,207 Masterful | 2,971 Masterful |
| order blind | 1,628 Masterful | 2,207 Masterful | 2,444 Sharp |
| order chaser (bait) | 1,628 Masterful | 2,207 Masterful | 2,369 Sharp |
| move on | 1,732 Masterful | 2,336 Masterful | 3,108 Masterful |
| *Steady from* | *450* | *600* | *799* |
| *Sharp from* | *875* | *1,174* | *1,599* |
| *Masterful from* | *1,350* | *1,849* | *2,499* |
| *Legendary from* | *2,024* | *2,749* | *3,698* |

The checks: careless lands a tier below one move on every stage; the order chaser loses to the
best plan by 20 percent; the best plan, followed to its last cut, loses to moving on by 4.4 percent
(5.8 at 128 seeds: best plan 2,934, move on 3,116, order blind 2,448, chaser 2,325).

- **The bonus at 50, picked from 40 to 60** (the owner's band). Over 32 seeds:

  | Bot (full) | No order | 40 | 50 | 60 |
  |---|---|---|---|---|
  | greedy | 1,203 | 1,362 | 1,335 | 1,338 |
  | best plan, plays it | 2,912 | 2,946 | 2,971 | 2,977 |
  | best plan, blind to it | 2,912 | 2,589 (−12%) | 2,444 (−18%) | 2,303 (−23%) |
  | order chaser (the bait) | 2,912 | 2,273 (−23%) | 2,369 (−20%) | 2,468 (−17%) |
  | move on | 3,097 | 3,114 | 3,108 | 3,139 |

  At 50 both the blind plan and the chaser lose about a fifth: weighing the plate is worth as much
  as seeing it at all. Below 40 the blind plan loses little; above 60 chasing drifts toward right.
- **The blind plan falls under its own score without orders** (2,912 to 2,444): the slab's best
  and its grade count the order, so a cutter that ignores it is graded against plans it does not
  make and loses flawless slabs and the streak with them. That is the layer's teeth, not a tax:
  the best plan, which plays it, gains 2 percent.
- **The order's share of a good score** (rule 14): 14 percent of the best plan's, 8.4 plates a
  round over 6.3 slabs; 28 percent of the chaser's (13.1 plates). Grade bonuses are now about a
  third of the best plan's round, down from two fifths.
- **Free to a bot that does not plan for it:** greedy gains 11 percent, because it sees the bonus in
  what a cut banks now. It is no contracts trap: the plan that ignores the order loses, and the bait
  that chases it loses more.
- **The order is drawn among the sizes the slab holds.** The pitch drew it from every size, so on
  some slabs no plan could fill it. Drawn among sizes held somewhere, the numbers barely move (at 40:
  blind −12 against −10, chaser −23 against −23) and a player is never shown an order that cannot
  be filled.
- **Moving on is the second bait, already in the rules.** Following the hint to the last cut
  loses 4 to 6 percent to a cutter that gives the slab up once its next cut is worth under about
  90 points of round time. It gives up 19 slabs a round to the plan's 6, so part of the gain may be
  the pace model's: it charges nothing for reading a fresh slab.
- **Tried and failed: spare cuts** (unused cuts carry to the next slab, `spareMax`). No bot that keeps
  cuts beat the one that ignores them, at any cap (`docs/prototypes/m11-pitches.md`). Not built.
- **The whole puzzle's thresholds stay** (350, 800, 1,300, 1,900, 2,500, 3,300; the owner's). Every
  bot reads the tier it read before the order: greedy Steady, one cut ahead Sharp, the best plan
  Masterful. They do not want moving on this evidence; play may say otherwise.

## Open questions for play

- Is a slab five to fifteen seconds of looking, as intended, or does the opening slab go too fast?
- Should the slab's best be shown from the start, as it is, or only when the slab is graded?
- Later slabs are harder and worth less before the streak. Does that feel like progress or a tax?
- Is the swipe's choice of direction clear on a phone, or should a cut follow the nearest line
  whichever way the finger moves?
- Does the order's small plate read at a glance on a phone, and do the marked corners say "this
  fills it" without the legend?
- Do people weigh a plate against its block, or only fill plates that sit free? The bots' gap is
  a fifth either way; a person may chase or ignore it by habit.
- Is moving on a skill people find, or a bot's arithmetic? A person pays for reading each fresh
  slab, which the pace model does not charge; the hint should perhaps stop at a plan's worthwhile cuts.
- The plate sizes are a guess: two by two is often free in a block, three by four rarely held.
