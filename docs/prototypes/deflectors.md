# Deflectors

Status: built. Prototype (ADR 0036), in the studio at `/deflectors`. Ticked (ADR 0015): pieces come
on the engine's clock, and a shot waits until it is fired. A 120 second round.

Version 1.0 (ADR 0079). History:

- **1.0:** pieces from a queue, placed anywhere; three emitters that all fire at once; targets with
  lens recipes; a shot multiplied by the targets it lights; what a shot used is spent. An open
  building puzzle with no right move, after the owner asked for one in the spirit of the original's
  potion puzzle: strategy and decisions, not finding the one answer. An earlier draft of 1.0 (never
  merged) kept a fixed grid of mirrors to flip, each volley dealt with one best setting the engine
  searched for. It was rigorous, but it was a puzzle with a solution, and it was replaced.
- **0.1:** beams in volleys on a count, a grid that never changed, one beam at first and two later.

## The puzzle

A six by six grid (`size`) that starts with a few mirrors (`mirrors`) and lenses (`lenses`). Three
**emitters** (`emitters`) sit on the left edge, each with a sign: a disc, a square, a triangle.
Five **targets** (`targets`) sit at ports on the other three edges.

**Pieces.** A piece comes into the **queue** under the grid every 1.5 seconds (`pieceTicks`): a
mirror set as `/` or `\`, or now and then a lens of one of three kinds (`lensChance`, 22 percent):
a diamond, a hexagon, a cross. The player puts the next piece on any cell, empty or not; it replaces
what was there. A mirror can be turned before it goes down. The queue holds four (`queueSize`): when
a piece comes to a full queue, the oldest **drops** on a cell of the engine's choosing (an empty
one if there is any), a cost the player sees coming because the queue is ringed in danger when full.

**Recipes.** Each target asks for a set of lens kinds, drawn small outside it: none, one or two
(`recipeWeights`, 25, 45 and 30). A beam that leaves by a target **lights** it if it passed exactly
those kinds: every one, and no other.

**The shot.** Tapping the emitters fires all three. Each beam runs straight, turns at every mirror,
passes straight through a lens, and leaves by some port. Each target lights at most once a shot,
claimed by the emitters in order.

- A beam that lights a target scores (turns + 1) squared (`bouncePoints`, turns capped at 16 by
  `bounceCap`), and half as much again for each lens in the recipe (`lensPercent`). Three turns
  through no lens are 16, through one are 24; seven turns through two are 128.
- The shot's total is multiplied by the targets it lit: 100, 200 or 400 percent for one, two or
  three (`litPercent`).
- A beam that lights nothing scores nothing and costs nothing.

**Spending.** Every mirror any beam turned at, lit or not, and every lens a lighting beam passed,
leave the grid (`spend`). Each lit target is dealt a new recipe. The emitters then recharge for one
second (`fireTicks`).

There is no hull, no count and no best. Nothing tells the player what the right shot is; the strip
says only what a shot now would be worth.

## Luck and skill

- **Luck:** the starting grid, the order of pieces (mirror or lens, which lens, which way a mirror
  comes), the recipes dealt, and where a dropped piece lands. A mirror's way is not much luck, since
  the player can turn it.
- **First skill:** placing a piece so a beam reaches a target through its recipe. The board draws
  every beam's route as the grid stands, so this is reading, not search.
- **Second skill:** when to fire. A shot that lights one target is worth the least it can be; two is
  double and three is four times. Each piece placed while holding can break a lit route, and the
  queue will not wait. The ladder below shows the best threshold is in the middle: holding for 800
  beats firing at 150 or at 1,500.
- **Third skill:** length. Turns are squared, so lengthening a lit route with one more mirror is
  often worth more than lighting another target.
- **Fourth skill:** the next shot. What a shot spends is what clears the grid. A player who keeps the
  next build off this shot's routes, and keeps a lens no shot spends until a recipe wants it, starts
  the next shot half built. No bot plays this; it is the top of the ceiling.

## Input and feedback

- Tap a cell to put the next piece there. Tap the next piece in the queue to turn it. Tap the
  emitters to fire.
- Keyboard: arrows or WASD move a cursor, space or enter puts the piece at the cursor, R turns it,
  F fires.
- Unrated and lab rounds pulse a cream ring after six seconds idle on a cell where the next piece
  would make the shot worth more (`deflectorsHint`, one ply). It is a suggestion, not the answer.

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/deflectors/pieces.ts`) and loads no atlas.

- **Pieces.** A mirror is a bar on a pivot; `/` and `\` are the same picture a quarter turn apart,
  so the way it is set is its outline. Each emitter wears its sign: a disc, a square, a triangle, in
  sand, rose and moss. A target is a bullseye in ice, a silhouette no sign or lens shares. Each lens
  is a glass of its own outline: a diamond in lilac, a hexagon in teal, a cross in rust.
- **The board.** Bare ground; one hairline round the grid; a dot in every cell. The ring round the
  grid holds the emitters, the targets and the recipe glasses outside them.
- **Routes.** Every beam's route is drawn as the grid stands. One that would light a target is a
  solid line in its emitter's colour, beaded with its sign, and the target is ringed in that colour.
  Any other is thin and broken to where it leaves. A lens ringed in danger is spoiling a beam on its
  way to a target. A recipe glass is faint until the route into that target passes it.
- **The strip** over the grid says, in mono, what a shot now is worth and how many it lights.
- **The emitters** dim while recharging, and are ringed in amber when a shot would light something.
- **The queue** sits under the grid, the next piece large on the left. When full it is ringed in
  danger; a drop rings the landing cell in danger and calls out "Queue full!".
- **A shot** draws each beam as one flat line with a cream dot at its head and a rising note at each
  turn; points rise in cream at a lit target, and two or three lit are called out with the
  multiplier. Then the spent cells shrink away with a soft rush of air.
- **The beat**, one amber pulse of the whole board, is kept for a shot that lights two or more
  (stronger for three) and a long route (eight turns or more).

## Engine

`packages/engine/src/deflectors/`. Moves: `{ type: "place", cell, tick }`, `{ type: "turn", tick }`,
`{ type: "fire", tick }`, `{ type: "wait", tick }`, `{ type: "end", tick }`. A cell is empty (0), a
mirror (1 for `/`, 2 for `\`) or a lens (3 + kind). Ports are numbered side by side, top, right,
bottom, left, `side × size + i`; the emitters sit on rows spread evenly down the left.

The reducer first carries the round to the move's tick (`simulate`): pieces arrive, and a full queue
drops its oldest. `trace` runs one beam and returns its port, turns and lens mask. `resolve` is what
a shot does fired now, each target lit once in emitter order; the board previews with it
(`deflectorsOutlook`) and the reducer scores with it. `fire` spends, deals new recipes to lit
targets and starts the recharge. Events are `piece`, `drop` and `fire`, numbered with a rising `seq`.

There is no search. The engine never knows a best shot, and nothing is scored against one.

## Tuning notes

Set from bots, not people (ADR 0036). `pnpm --filter @openseas/bots ladder deflectors --seeds 24`
on the content config, a person's pace modelled as 1 s a piece and 0.5 s to fire:

| Bot | Score | Tier |
|---|---|---|
| careless | 18 | Green |
| one move | 280 | Steady |
| rollout | 337 | Steady |
| eager, fires at the first light (the bait) | 232 | Green |
| builder, fires at 1 | 751 | Steady |
| builder, fires at 150 | 1,931 | Sharp |
| builder, fires at 800 | 2,840 | Sharp |
| builder, fires at 1,500 | 1,687 | Sharp |

The eager bot puts each piece where the shot is worth most now and fires as soon as anything lights.
A builder puts each piece where the grid is worth most counting one mirror more, and fires when a
shot reaches its threshold, or near the end. One move and rollout play the generic choice list,
which fires too early.

- **There is no right threshold, but there is a better one.** Holding too little and holding too
  much both lose: 1,931 at 150, 2,840 at 800, 1,687 at 1,500. That interior optimum is what the
  owner asked for: a choice that matters, with no answer handed over.
- **The multiplier makes holding pay.** With every shot at ×1 (`litPercent` 100, 100, 100, 12
  seeds) the builders top out at 1,387 at 150, and holding for 800 falls to 633. Without the
  multiplier the game is fire-early, and the decision is gone.
- **Spending keeps it hard.** With nothing spent (`spend: false`, 12 seeds) a built grid keeps
  scoring: builders reach 9,393 and the eager bot 324, a thirtyfold gap that would make the round
  one long build. Spending turns each shot into a trade between this shot and the next.
- **Thresholds.** 100, 260, 1,000, 2,000, 3,000 and 4,200 for ratings 1100 to 2100. The bait reads
  Green, a player who builds before firing Steady to Sharp, a well-timed builder high Sharp, and
  Masterful and above wait for planning the next shot, which no bot does.
- **The queue is a clock.** At 1.5 s a piece a person has time to read every route; faster
  (`fast_pieces`) the drop starts to decide shots. Both are presets.

## Open questions for play

- Is three targets lit ever reached by a person, or does the ×4 only tempt? If never, ×3 may read
  better.
- Does a dropped piece feel fair? It lands on an empty cell if any, but a crowded grid makes it a
  route-breaker.
- Are three emitters too many routes to read at once? `two_emitters` is a preset.
- Do players plan the next shot through what this one spends, or does it feel like noise?
- No ladder yet (rule 26): the obvious stages are recipes off (`no_recipes`), one lens, then the
  whole puzzle.
