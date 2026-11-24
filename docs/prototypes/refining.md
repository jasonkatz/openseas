# Refining

Status: built. Prototype (ADR 0036, ADR 0080), in the studio at `/refining`. Ticked (ADR 0015): the
outlet is drawn on the engine's clock. A 120 second round.

Refining is a successor, not one of the game's own new designs: it follows the original's
Distilling, a crafting puzzle (DESIGN.md section 3 lists all crafting as explicitly later). It keeps
that puzzle's mechanics and gives everything a player sees and hears its own form. Where it departs
from the original is listed in DESIGN.md section 6.

## The puzzle

Out on a refinery rock, the feed comes up in three fractions and is sorted in a tower before the
burners draw it off. The tower is six columns wide and five tall, always full, and packed as a
honeycomb: every other column sits half a piece lower, so a piece touches two pieces in each column
beside it, one a half step up and one a half step down. Those four are its partners: swaps are
diagonal only. A column keeps its height as it moves towards the
outlet, so which columns sit low turns over with every draw (`refiningLowered`).

- **Three fractions in a cycle.** Vapour (light, a plume), oil (middling, a round drop) and tar
  (heavy, a square block) stand in a cycle: vapour, oil, tar, and back to vapour.
- **The verb is a diagonal swap along a link, one rule a fraction.** Each fraction rises past one
  partner and sinks past another, the same on either side of it:

  | Fraction | Rises past (swaps up with) | Sinks past (swaps down with) |
  |---|---|---|
  | Vapour (plume) | Oil (drop) | Tar (block) |
  | Oil (drop) | Tar (block) | Vapour (plume) |
  | Tar (block) | Vapour (plume) | Oil (drop) |

  As a pair, upper over lower: vapour over tar, tar over oil, oil over vapour (`refiningLinked`).
  The pair a swap leaves is the wrong way round, so no swap is undone straight away. Smoke swaps as
  vapour; a catalyst swaps with nothing. The board draws a dot on the edge between every pair that can swap.
- **The clock draws the outlet.** Every eight seconds (`pulseTicks`) the outlet, the rightmost
  column, leaves the tower. Every other column moves one place right and a fresh column of feed
  enters on the left. The player may draw early (a tap on the outlet's lamp, or enter); the clock
  starts again from there.
- **Up or down by weight.** A drawn column with more tar than vapour and smoke sinks to the sump.
  Anything else rises to the tank.
- **Grades.** A rising column is **clear** (vapour and catalysts only), **smooth** (no tar or smoke,
  more vapour than oil), **plain** (no tar or smoke, but not smooth) or **foul** (tar or smoke in
  it). A sinking column is a **dump** (no vapour) or a **spill** (vapour lost to the sump).
- **The clear run.** The k-th clear column in a row pays `clearPoints` × k, k capped at `runCap`:
  100, 200, 300, 400, then 500 a column. A dump leaves the run alone; any other column ends it. A
  smooth column pays `smoothPoints` (20), a foul one costs `foulPoints` (10) for each tar or smoke in
  it, and the score never goes below zero.
- **Smoke.** Every second vapour spilled (`smokeEvery`) comes back as smoke, in place of the top
  vapour in the column nearest the outlet that holds any. Smoke weighs and swaps as vapour, and
  spoils a clear column.
- **Catalysts.** A piece of fresh feed is a catalyst 30 times in a thousand (`catalystPermille`). It
  never moves and swaps with nothing, weighs nothing, and pays `catalystPoints` (50) in a clear or
  smooth column. A column with a catalyst needs one vapour fewer to be clear.

The compound move the puzzle pays most for: **a run of clear columns kept going through dumps**, the
feed sorted into vapour one way and oil and tar the other, until the run pays at its cap.

## Luck and skill

- **Luck:** the opening tower, the fresh feed and where catalysts fall. Each is on a stream of its
  own (ADR 0075), so the n-th column of feed is the same however the round is played. The feed is
  shown a column at a time as it enters, and every column crosses the whole tower before it is
  drawn, so a player sees it for five draws first.
- **First skill:** reading the links. The dots show every swap, and the outlet's strip and lamp say
  how it would go if drawn now.
- **Second skill:** routes. Vapour reaches the outlet only past oil, and tar leaves it only past
  oil, so a column is fixed with a short chain: a swap down to line a piece up, then the swap across.
- **Third skill:** pace. A clear outlet or a dump will not get better; drawing it at once buys more
  columns in the round. A plain sorting bot that only adds early draws gains about a sixth.
- **Fourth skill:** working the tower, not the outlet. The column beside the outlet is the next one
  drawn, and has twice the time if started now. Working only the two columns about to be drawn is
  the bait: it feels like the point, and it loses to sorting the whole tower by a quarter.
- **Fifth skill:** the run. Sorting the feed into clear columns and dumps keeps the run going, and
  smoke from a careless spill lands on the column you were about to make clear.

## The ladder

A new player climbs two stages (ADR 0066), each passed with one Steady round. Only the whole puzzle
counts. Each stage is the whole puzzle with layers switched off in `stages` in the content file; its
name and one-line card are `refining.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Clears | 90s | Swaps, draws, grades | The run (`runCap: 1`), smoke (`smokeEvery: 0`), catalysts (`catalystPermille: 0`) |
| Runs | 120s | The clear run, dumps that keep it | Smoke, catalysts |
| Full tower | 120s | Everything | |

## Input and feedback

- Pointer: drag a piece onto a neighbour to swap the two along their link, and keep dragging: the
  piece goes on swapping with each neighbour it is dragged over that it links with, one swap a
  neighbour. A neighbour it cannot swap with bumps once and the piece stays. Or tap a piece (an
  amber ring picks it) and tap its neighbour. Tap the lamp over the outlet to draw now.
- Keyboard: arrows move the cursor (an amber frame), up and down a column and left and right to the
  same row of the next; Q, E, A and D step up-left, up-right, down-left and down-right across the
  honeycomb, W and S up and down. Space picks the piece under the cursor and the next diagonal step
  swaps it that way (a step up or down bumps); enter draws now.
- The strip over the tower says how the outlet would go if drawn now and what it would score, from
  the engine's `refiningDrawValue`: clear (with its place in the run), smooth, plain, foul, dump or
  spill.
- Unrated and lab rounds frame a swap worth making after six seconds idle: the one that sorts the
  tower most (`refiningHint`).

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/refining/pieces.ts`) from `boards/data/pieces/refining.json`, and loads no image.

- **Pieces.** Each fraction is drawn by how it behaves: vapour a plume pointing up (ice), oil a round
  drop (sand), tar a heavy square block (rust), smoke a cloud (slate), and a catalyst a hexagonal
  crystal with its core cut out (lilac). Five outlines, so they read apart in one colour.
- **Links.** A small dim dot on the edge between every two pieces that can swap.
- **The board.** Bare ground, no frame and no grid; the pieces nest as a honeycomb. The outlet is a
  `raised` panel from its lamp down the whole rightmost column, so the column about to be drawn
  stands apart, with the one hairline down its far edge, where columns leave.
- **The lamp** over the outlet is a ring that fills in cream as the clock comes round to its draw.
  Its heart lights cream when the outlet is clear.
- **A swap** slides the two pieces past each other in 120ms, with the swap cue.
- **A draw** carries the outlet up off the tower and fading (to the tank) or down (to the sump),
  slides every other column right and the fresh feed in from the left. Its points rise from the
  outlet, cream when they pay and in danger when they cost. A smoke grows in place of the vapour it
  takes.
- **Callouts**, one a draw: the clear (with its place in the run), smooth, plain, foul, dump or
  spill, or "Run lost" when a column ends a run that was going. Smoke is said in dim.
- **The beat**, one amber pulse of the whole board, is kept for one thing: a clear run of three or
  more, stronger the longer it is. A second clear in a row plays the streak cue; a first, the clear
  cue.

## Engine

`packages/engine/src/refining/`. Moves: `{ type: "swap", cell, dir, tick }` (the piece at `cell`
and the one below it, `down`, or one of the two in the column to its right, `upRight` and
`downRight`), `{ type: "draw", tick }`, `{ type: "wait", tick }` and
`{ type: "end" }`. Every move first makes the draws the clock owes by its tick. A draw event carries
the column that left, its grade and value, what the score moved by, the fresh feed and any smoke
placed. The state keeps the events since the last logged move began (`events`, numbered by a rising
`seq`); `advanceRefining` appends the clock's draws for the board to play between moves.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a swap a second.

- **Five tall, not six.** At six a clear column wanted every vapour of a column and a half of feed,
  and the best bot made two clear columns a round. At five, with vapour 45 percent of the feed, it
  makes about five.
- **Foul at 10 a piece.** At 30 nearly every round a bot played sat at zero for its first minute:
  most columns rise with a tar in them before a player can fix them. At 10 a foul column still costs
  more than a random early draw gains, so drawing on luck does not pay.
- **Smooth at 20.** At 40 drawing a smooth column early beat holding it; smooth is meant as the
  consolation, not a plan.
- **Thresholds** sit so that random play is Green, the one-move bot Steady and the best bots Sharp.
  The bots see two swaps ahead and none plans a run; a person who sorts into clear columns and dumps
  should reach the upper tiers, which want setting by hand.

The bots of this pass, 24 seeds a cell (`pnpm --filter @openseas/bots ladder refining`):

| Bot | Clears (90 s) | Runs (120 s) | Full (120 s) |
|---|---|---|---|
| careless | 10 Green | 7 Green | 16 Green |
| one move | 290 Steady | 408 Steady | 378 Steady |
| rollout | 558 Steady | 942 Sharp | 853 Sharp |
| sorter | 131 Green | 196 Green | 187 Green |
| early sorter | 198 Green | 323 Green | 290 Green |
| two ahead | 565 Steady | 1,126 Sharp | 1,098 Sharp |
| cash in | 600 Steady | 1,140 Sharp | 1,136 Sharp |
| outlet only | 191 Green | 320 Green | 266 Green |
| *Steady from* | *260* | *330* | *330* |
| *Sharp from* | *620* | *770* | *770* |
| *Masterful from* | *1,090* | *1,349* | *1,349* |
| *Legendary from* | *1,704* | *2,174* | *2,174* |

- **careless**: any choice at random, early draws included.
- **one move**: the choice worth most now, with how much better sorted it leaves the tower as a
  tiebreak.
- **rollout**: the eight best choices, each played five on, three times, on a fresh random stream.
- **sorter**: the swap that sorts the tower most (each column worth the square of its larger side,
  vapour or the rest, weighted towards the outlet), and the clock's draws.
- **early sorter**: the sorter, drawing early when the outlet is clear or a dump.
- **two ahead**: the first of the two swaps that sort the tower most, drawing early when the outlet
  is clear or a dump.
- **cash in**: two ahead, drawing early whenever the outlet would score, smooth columns too.
- **outlet only** (the bait): two ahead, working only the outlet and the column beside it.

Checks: careless lands a tier below one move on every stage, and the bait loses to two ahead on the
whole puzzle by 75.8 percent.

Open questions for play:

- **Clear columns are nearly the whole score.** About nine tenths of a good bot's points are clear
  columns, over the limit of rule 14. They are the puzzle's one way to score, as in the original;
  what should be checked with people is whether the run, the compound part, earns its share once a
  player sorts for it. No bot here plans a run (their longest averages under two).
- **The run and smoke layers are not yet proven by bots.** The Runs stage scores about what the full
  puzzle does, and no bot plays smoke or catalysts on purpose, so rule 26's margin for each layer is
  still to show; that wants a bot that sorts into dumps, or people.
- **The links.** Swaps are diagonal only, four partners a piece, by one rule a fraction (Jason's
  play notes: a block rises past a plume and sinks past a drop).
  Whether a person reads the dots fast enough at a draw every eight seconds is the first thing to
  watch. Thresholds were scaled with each change of the links: the six-neighbour honeycomb roughly
  doubled what bots scored on the square tower that came first, and diagonal swaps took a quarter
  back.
- **The pace.** A swap a second is a guess, and the bots see every link at once.
