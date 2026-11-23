# Tractor

Status: built. Prototype (ADR 0036, ADR 0078), in the studio at `/tractor`. Untimed moves; a 90
second round.

Tractor is a successor, not one of the game's own new designs: it follows the original's Treasure
Haul, the puzzle a crew plays to haul loot aboard after a won fight (DESIGN.md section 3 lists it
as explicitly later). It keeps that puzzle's mechanics and gives everything a player sees and hears
its own form. Where it departs from the original is listed in DESIGN.md section 6.

## The puzzle

The fight is won and the loser's hold has burst open. The field is the loot adrift, six wide and
nine tall, always full; the hatch is the top edge, and the tractor beam pulls everything up towards
it.

- **The verb is a swap up or down.** Any piece trades places with the piece directly under it (or,
  the same thing, over it). Pieces never swap sideways. A swap that makes no run is allowed and
  scores nothing: it is how a field is set up, and it spends the clock.
- **Runs.** Three or more of one kind in a row or a column are beamed aboard. A run of n scores
  `runPoints` × n × n: 45, 80, 125 for three, four, five. A piece in a row run and a column run at
  once counts in both.
- **The beam pulls up.** Everything below a gap rises to close it, and new loot drifts in at the
  bottom. New loot never completes a run as it arrives, so a swap's later waves come only from the
  pieces that rose, which the player could see.
- **Waves.** If what rises makes runs, they go too, one wave at a time. Each wave of one swap pays
  at the next `cascadePercent` entry, 100, 150, then 200 percent, and the last entry holds.
- **Caches.** A sealed cache cannot be swapped and is in no run. It rises as the pieces over it go.
  A cache that reaches the top row is hauled aboard. Every cache hauled in one swap counts
  together: k caches score `cachePoints` × k × k, so one is 150, two are 600 and three are 1,350.
  One cache opens the round in the lower half of the field (`startCaches`), and new loot drifting
  in is a cache 25 times in a thousand (`cachePermille`) while fewer than three are on the field
  (`maxCaches`).
- **Beacons.** After every five swaps that score (`beaconEvery`), one piece of the new loot is a
  beacon, its mark a cross or a saltire, drawn from the stream. A beacon matches as its kind. In a
  run it fires: a cross along its whole row and column, a saltire along both its diagonals. Every
  piece of loot on those lines is swept aboard for 10 (`sweepPoints`), a beacon swept fires in
  turn, and a cache on those lines is hauled at once, counting with any other cache that swap
  hauls.
- If no swap on the field would make a run, the loot is dealt again in place; caches and beacons
  stay where they are.

The compound move the puzzle pays most for: **caches lined up and brought aboard in one swap**,
best by one beacon fired along the row or column they share.

## Luck and skill

- **Luck:** the opening deal, what drifts in at the bottom, where caches drift in, which new piece
  is a beacon and its mark. None of it makes a run by itself: new loot is dealt so it completes
  none on arrival.
- **First skill:** seeing a run: two of a kind with the third one row off.
- **Second skill:** longer runs, and two runs from one swap (a swap moves two pieces, and each can
  complete a run).
- **Third skill:** reading what rises. A run's gap lifts everything under it the same distance, so
  a player who looks below the run sees the second wave coming, at half again the points.
- **Fourth skill:** caches. A run straight down a cache's column lifts it three rows. Two caches
  brought up together are worth four times one, so a good player slows the leader and lines the
  caches up on one row.
- **Fifth skill:** beacons. Fired at once a beacon sweeps a few pieces; held until its row or
  column runs through the caches it hauls them all. Firing every beacon the moment a swap can is
  the bait: it feels like the point of a beacon, and it loses to plain play (the bot table below).

## The ladder

A new player climbs two stages (ADR 0066), each passed with one Steady round. Only the whole
puzzle counts. Each stage is the whole puzzle with layers switched off in `stages` in the content
file; its name and one-line card are `tractor.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Runs | 60s | Runs and waves | Caches (`startCaches`, `maxCaches` and `cachePermille` 0), beacons (`beaconEvery: 0`) |
| Caches | 90s | Caches | Beacons |
| Full haul | 90s | Everything | |

Beacons come last because their best use is through caches.

## Input and feedback

- Pointer: drag a piece up or down onto its neighbour to swap the two. Or tap a piece (an amber
  ring picks it) and tap the piece above or below it.
- Keyboard: arrows or WASD move the pair the cursor holds (an amber frame round two cells, one over
  the other); space or enter swaps it. The strip over the field says what the pair is worth now,
  first wave and caches the sweeps haul, from the engine's `tractorSwapValue`, or that it makes no
  run.
- Unrated and lab rounds pulse a swap worth making after six seconds idle: the one worth most at
  once (`tractorHint`).

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/tractor/pieces.ts`) from `boards/data/pieces/tractor.json`, and loads no image.

- **Loot.** Each kind is one flat piece of treasure with an outline of its own and no cut-out: the
  coin a disc, the ingot a low trapezoid bar, the gem a diamond on its point, the chalice a bowl on
  a stem and foot, the crown three points over a band, and in a lab field of more kinds the idol a
  round head on a square body, the flask a bulb with a neck and the scroll a sheet between two
  rolls. Their colours are a second cue: sand, sky, rose, moss, lilac, then teal, slate and rust.
- **A cache** is the one wide box on the field, in cream, its lid's seam and its lock cut out.
- **A beacon** keeps its kind's outline and colour, so it reads as the kind it matches as, with its
  mark cut through its heart: a plus for a cross, an X for a saltire.
- **The board.** Bare ground, no frame and no grid; the field is always full, so no cell needs a
  dot. The one hairline is the hatch over the top row, the edge a cache is hauled at.
- **A swap** slides the two pieces past each other in 120ms, with the swap cue, or the quiet one if
  it makes no run.
- **A wave** shrinks its runs to nothing where they are, with a pop a step higher each wave and the
  clear cue from the second wave on; its points rise from the runs in cream. A beacon fires a cream
  line from its centre to the field's edge along each of its lines, with the zap, and what it
  sweeps shrinks after it. Then everything rises in 120ms and new loot rises in from under the
  bottom edge. A cache that reaches the top row shrinks there with the thud.
- **Callouts**, one a swap, in this order: caches (with their points over the hatch), a mighty run
  of six, a chain of beacons, a cross or a saltire, a long run of five, waves from three. A field
  dealt again is said in dim.
- **The beat**, one amber pulse of the whole board, is kept for two things: caches brought aboard
  together, stronger for each, and a mighty run. A single cache plays the rising cue instead.

## Engine

`packages/engine/src/tractor/`. Moves: `{ type: "swap", cell }` (the piece at `cell` and the one
under it) and `{ type: "end" }`. A move's report gives the two cells and the field just after the
swap, then each wave: its runs, the beacons fired and what each swept, the loot that went, the
caches the sweeps hauled, its percent and points, and one settling per round of caches taken off
the top row (the rise, the new loot, the field after). The caches of the whole swap and what they
scored come last. The board plays the report and ends on the engine's field.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a swap every 1.5 seconds, 60 in
the full round.

- **New loot completes no run.** The first build dealt new loot at random, and a plain one-move bot
  got more from later waves than from the swaps it chose (3,500 points of first waves, 4,300 of
  later ones a round). Dealing new loot so it completes no run on arrival cut the later waves to
  about a quarter of a plain player's score, and every one of them can now be seen coming. After the
  change the rollout bot, which plans a few swaps ahead, beats the one-move bot; before it, it did
  not.
- **Caches at 150.** At 60 a cache was 6 percent of a plain player's score, too little for the
  puzzle's compound move. At 150 a single cache is worth about three runs of three, and a pair 600.
- **Waves at 100, 150, 200.** Since every wave is now one the player could see, they pay more as
  they go, and the cap at double keeps a long lucky chain from deciding a round.
- **Thresholds** sit so that random swapping is Green, a player who finds any run is about
  Masterful at a bot's pace (Sharp at half that pace), and plain best-swap play is Legendary. Bots
  see every swap on the field in the time a person finds one, so the upper tiers want setting by
  hand.

The bots of this pass, 24 seeds a cell (`pnpm --filter @openseas/bots ladder tractor`):

| Bot | Runs (60 s) | Caches (90 s) | Full (90 s) |
|---|---|---|---|
| careless | 478 Steady | 583 Green | 673 Green |
| one move | 5,715 Legendary | 6,877 Legendary | 9,370 Legendary |
| rollout | 7,269 Legendary | 7,095 Legendary | 10,494 Legendary |
| any run | 3,160 Masterful | 4,313 Masterful | 6,530 Masterful |
| cache lifter | 5,670 Legendary | 6,813 Legendary | 9,398 Legendary |
| beacon at once | 6,877 Legendary | 7,019 Legendary | 8,759 Legendary |
| *Steady from* | *400* | *699* | *999* |
| *Sharp from* | *1,199* | *1,998* | *2,897* |
| *Masterful from* | *2,199* | *3,598* | *4,997* |
| *Legendary from* | *3,398* | *5,547* | *7,696* |

- **careless**: any legal swap at random, runs or not.
- **one move**: the swap worth most now.
- **rollout**: the eight best swaps, each played five swaps on, three times, on a fresh random stream.
- **any run**: any swap that makes a run, at random.
- **cache lifter**: points now plus 15 a row for every row it lifts the caches.
- **beacon at once** (the bait): the rollout bot, but a beacon is fired by the first swap that can.

Checks: careless lands a tier below one move on every stage, and the bait loses to rollout on the
whole puzzle by 16.5 percent.

Open questions for play:

- **The caches layer earns little with these bots.** The cache lifter scores the same as one move,
  and the Caches stage scores only a little over Runs at a longer round. No bot here plans caches
  together, so the table cannot yet show whether lining them up pays; that wants a bot that does,
  or people.
- **Runs are most of a score.** First waves are about half of a plain player's points, under the
  limit of rule 14 but close to it.
- **The pace.** A swap every 1.5 seconds is a guess. A person who reads the field before every swap
  is likely slower, and the thresholds above assume a bot's eyes.
