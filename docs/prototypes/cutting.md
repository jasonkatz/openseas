# Cutting

Status: built. Prototype (ADR 0036), on the harness at `/cutting`. Untimed moves; a 120 second round.

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

Slabs grow as they are finished: five blocks and one flaw at first (`partsStart`, `flawsStart`), one
more block every two slabs (`growEvery`) up to seven (`partsMax`), and a second flaw from the fifth
slab on (`flawsMax`).

## Luck and skill

- **Luck:** the slab. No slab holds a block bigger than 45 percent of it (`maxBlockPercent`), so no
  round is made by one windfall cut.
- **First skill:** seeing a pure rectangle and the cut that frees it.
- **Second skill:** order. A cut runs across the whole piece, so a careless early cut goes straight
  through a block that was wanted whole. On a fresh slab about two of the ten possible first cuts
  keep the best in reach, and the right one often banks nothing by itself: it only sets the next
  two up.
- **Third skill:** the budget. With one cut too few, which block to leave as scrap, and whether to
  cut a flaw out of a big block or bank the smaller pure piece beside it.

## Input

- Pointer: swipe along a grid line inside a piece. A swipe across lines up a cut across, a swipe
  down a cut down; the line snaps to the nearest grid line and shows where it will run across the
  whole piece. A side that would be banked lights up with what it pays (the engine's own sum,
  `cuttingCutPreview`); a side that would stay is dimmed. The cut is made on release.
- Or tap near a line to line the cut up, and tap the same line again to make it.
- Keyboard: left and right move a cut that runs down, up and down move one that runs across (the
  first press of the other pair turns the cut), tab or N takes the next piece, space or enter cuts,
  escape drops the cut, D gives the slab up.
- The strip over the slab shows a lamp for each cut left, what has been banked against the slab's
  best with a notch where clean begins, and the chip that takes the next slab.
- Unrated and lab rounds pulse the first cut of a best plan after seven seconds idle.

## Engine

`packages/engine/src/cutting/`. Moves: `{ type: "cut", piece, vertical, at }`, `{ type: "done" }` and
`{ type: "end" }`. A cut's report gives the piece as it was, the two sides with what each banked,
and, when the move ended the slab, how it ended, its grade, bonus and scrap. The state then already
holds the next slab; the board plays the report and ends on the engine's table.

The best is a table over every rectangle of the slab and every number of cuts: a pure rectangle is
worth its area squared, and any other the best split over every cut line and every way to share the
remaining cuts between the two sides. The same table sets the slab's budget, ends a slab when
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

## Open questions for play

- Is a slab five to fifteen seconds of looking, as intended, or does the opening slab go too fast?
- Should the slab's best be shown from the start, as it is, or only when the slab is graded?
- Later slabs are harder and worth less before the streak. Does that feel like progress or a tax?
- Is the swipe's choice of direction clear on a phone, or should a cut follow the nearest line
  whichever way the finger moves?
