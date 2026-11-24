# Deflectors

Status: built. Prototype (ADR 0036), in the studio at `/deflectors`. Ticked (ADR 0015): the round
runs on the engine's clock, but a volley waits until it is fired. A 120 second round.

Version 1.0 (ADR 0079). History:

- **1.0:** no count and no ramp; lenses and recipes; mirrors a beam turned at are spent and the
  grid refills from the top. A routing puzzle of planning, after the owner asked for one more
  rigorous, in the spirit of the original's potion puzzle.
- **0.1:** beams in volleys on a count, a grid that never changed, one beam at first and two later.

## The puzzle

A six by six grid with fourteen mirrors (`mirrors`), each set as `/` or `\`, and three lenses
(`lenses`): a diamond, a hexagon and a cross. A tap on a mirror flips it. That is the one verb.
Empty cells and lenses let a beam pass straight through.

Beams come in from ports on the edge, two at a time (`beams`), in volleys. A volley is announced and
then waits for as long as the player likes: each beam's entry port wears its sign, its exit port
wears the same sign with its middle cut out, and outside the exit sit one or two small lenses
(`recipeLenses`), the beam's **recipe**. A tap on a lit entry fires the volley. Every beam runs
straight, turns at every mirror it meets, and leaves by some port.

- **Home.** Out through its own exit, having passed exactly the lenses of its recipe (every kind it
  asks for, and no other kind), a beam scores by the mirrors it turned at: (turns + 1) squared
  (`beamPoints`), and half as much again for each lens in its recipe (`lensPercent`). Three turns
  through one lens are 24; seven turns through two are 128.
- **Hull.** Any other beam costs 40 (`hullPenalty`): the wrong port, or its own port through the
  wrong lenses. The score never goes below zero.

A volley with every beam home is clean. Clean volleys build a streak that multiplies the next clean
one: 100, 110, 120 and so on to 200 percent at nine (`streakPercent`). One beam into the hull ends
the streak.

Every mirror a fired beam turned at, home or not, is **spent** (`spend`). It leaves the grid;
whatever stood above it in its column, mirror, lens or nothing, drops one cell; and a fresh mirror,
set at random, comes in at the top. There are always fourteen mirrors and three lenses, but every
volley moves them. The next volley is dealt 0.9 seconds after one fires (`respawnTicks`), once the
grid has settled.

Every volley is dealt exits and recipes that one setting of the mirrors reaches together; the engine
searches the settings when it deals. It keeps the most the volley can be worth as its `best`, and the
strip over the grid shows it beside what the volley is worth now. A clean volley worth its best is
perfect and scores double (`perfectPercent`). No beam is dealt a way home it already takes, so a
volley fired untouched goes into the hull.

## Luck and skill

- **Luck:** where the mirrors and lenses start, where beams enter and must leave, what they must
  pass, and how each fresh mirror is set. Where a fresh mirror lands is not luck: the column above a
  spent mirror drops, which the player can see before they fire.
- **First skill:** getting a beam to its exit. The board draws a broken line from its entry to
  where it would leave and dots running back from its exit; where the two cross at a mirror, a flip
  joins them.
- **Second skill:** the recipe. A joined route is only home through the right lenses and no
  others. The player plans a route as legs (entry to lens, lens to lens, lens to exit), keeps it off
  the other lenses, and does it for two beams on one setting. A bot that joins lines blind to the
  recipe scores under half of one that reads it at a careful pace.
- **Third skill:** the long way round. The first route through a recipe is worth about two thirds
  of the best on average, and is the best a third of the time. Seeing the longer one, round a loop
  before or after a lens, is what doubles a volley.
- **Fourth skill:** the next grid. The route fired decides which mirrors are spent and which
  columns drop: a long route reshapes most of the grid, a short one little of it. A lens can be
  dropped into a better place, or cut off. Nothing in the engine plans this; it is the top of the
  ceiling, and an open question for play.

## Input and feedback

- Tap a mirror to flip it. Tap a lit entry port to fire the volley.
- Keyboard: arrows or WASD move a cursor, space or enter flips the mirror under it, F fires.
- Unrated and lab rounds pulse a cream ring on the next mirror to flip after five seconds idle: a
  flip towards the volley's best setting. Following it keeps it coming.

The board is restyled to the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces
in code (`boards/src/deflectors/pieces.ts`), loads no atlas and has no marks setting.

- **Pieces.** A mirror is a bar on a pivot. A `/` and a `\` are the same picture a quarter turn
  apart, so the way a mirror is set is its outline. Each beam has a sign with a silhouette of its
  own: a disc, a square, a triangle, in sand, rose and moss. An entry port wears the sign solid,
  with a small arrow into the grid; an exit port wears it with its middle cut out, and it fills
  when the beam is home. Each lens is a glass of its own outline, none a sign's: a diamond in lilac,
  a hexagon in teal, a cross in rust, each with one small window cut through.
- **The board.** Bare ground under the strip, the ports and the grid. The one hairline is round
  the grid, because a beam leaves across it. No frame and no grid lines: a small dot marks every
  cell, so an empty one a beam runs straight through is seen, and every port. The ring round the
  grid is wide enough for each exit's recipe outside it.
- **The recipe.** Its glasses sit small outside the exit, side by side along the edge. A glass is
  faint until the beam's route passes a lens of its kind, then solid. A lens on a beam's route that
  is not in its recipe is ringed in danger.
- **The strip** over the grid says, in mono, what the volley is worth now and the best it could
  be. There is no count.
- **A waiting beam's lines.** Home, its route is a solid line in its colour, beaded with its own
  sign so two routes that cross are told apart. Not home, it is a broken line to the port it would
  leave by, with a cross there in danger (at its own exit when only the lenses are wrong), and dots
  run back from its exit. When every beam is home the entries are ringed in amber: the thing to tap.
- **A flip** turns the mirror in 120ms. **A fired beam** draws its whole path as one flat line
  with a cream dot at its head and a rising note at each turn, and its points rise in cream at the
  port it leaves by. A beam into the hull leaves one ring in danger at that port, its cost, and
  the callout in danger. A streak of three or more is called out.
- **The settle.** Once every beam has landed, the spent mirrors shrink away with a soft rush of air
  and the columns above them drop in 200ms, fresh mirrors fading in as they cross the top edge. The
  next volley's signs appear after.
- **The beat**, one amber pulse of the whole board, is kept for two things: the long way round (a
  route of eight turns or more, stronger the longer it is) and a perfect volley (strongest when it
  also went the long way). There is no shake, no flash and no sparks.

## Engine

`packages/engine/src/deflectors/`. Moves: `{ type: "flip", cell, tick }`, `{ type: "fire", volley,
tick }`, `{ type: "wait", tick }`, `{ type: "end", tick }`. A cell is empty, a mirror either way,
or a lens (`DEFLECTORS_LENS + kind`). The reducer first carries the round to the move's tick: the
next volley is dealt when it is due. A fire names the volley it means, so a tap that lands after its
volley has gone fires nothing. A flip names a mirror; a lens cannot be flipped.

`trace` runs one beam through the grid as it stands and returns its port, its turns and the lens
kinds it passed, as a mask. `isHome` is the one rule for home. `resolve` is what a volley does fired
now: the board previews with it (`outlook`) and the reducer scores with it. `settle` is the grid
after mirrors are spent, and the fire event carries the spent cells and how far each cell's content
fell, so the board can play the drop. Events are `deal` and `fire`, numbered with a rising `seq`.

The search (`volleyOptions`, `volleyRoute`) walks the beams in order and tries both settings of
each mirror the first time a beam meets it, so it visits each thing one grid can do once, and
carries each beam's lens mask with it. `volleyRoute` aims at the best setting (the most points, then
the fewest flips) or the nearest (the fewest flips, then the most points). It is in a fixed order and
stops after 40,000 mirror meetings. On the content grid a deal takes 0.07 ms at the median and 1.5 ms
at worst over 1,000 deals; spending does not change that, because the grid always holds fourteen
mirrors.

## Tuning notes

Set from bots, not people (ADR 0036). `pnpm --filter @openseas/bots ladder deflectors --seeds 24`
on the content config:

| Bot | Score | Tier |
|---|---|---|
| careless | 3,436 | Sharp |
| one move | 7,998 | Legendary |
| rollout | 8,883 | Legendary |
| joiner, 0.8 s a flip, blind to recipes (the bait) | 1,504 | Steady |
| lengthener, the joiner trying three flips longer | 1,018 | Steady |
| nearest, 3 s a beam | 6,762 | Masterful |
| nearest, 5 s a beam | 3,789 | Sharp |
| longest, 6 s a beam | 7,053 | Masterful |
| longest, 10 s a beam | 3,250 | Sharp |

The joiner plays the rule the old board taught: it joins each beam's line to its exit and fires,
whatever lenses it passed. The nearest bot is handed the setting the fewest flips away that sends
every beam home through its recipe; the longest is handed the best. Both pay only for the time to
see it. One move and rollout weigh the same plans the bots are handed, at the fastest pace, so they
stand for a player who sees everything at once.

- **Recipes are what makes it rigorous.** Without them (`recipeLenses: 0`, the rest as content) the
  nearest bot at 5 s a beam scores 1,957 and the joiner 1,453: reading lines is most of the game.
  With them the joiner falls to two fifths of the nearest bot, and its bait check passes by 78
  percent. Exact recipes, not "at least these lenses", were chosen so a lens on the way is a thing to
  avoid as well as a thing to reach.
- **Spending widens the gap between seeing a route and seeing the best.** With mirrors never spent
  (`spend: false`) the nearest bot at 5 s scores 5,516 and the longest 6,130, eleven percent apart.
  With spending they are 3,789 and 7,053. A grid that keeps moving deals fewer easy volleys, and the
  best route is where the extra points are. The planning skill it opens (the fourth) no bot plays.
- **No count.** A count presses the player to fire the first route they find; with recipes to read,
  that would make the hull the common result rather than the long way round. The round clock is the only
  pressure, so pace is still a skill: firing a good route now beats a perfect one in twice the time.
  It also removes the ramp (more beams and a shorter count as the round went on), which rule 10 and
  ADR 0072 forbid.
- **A perfect volley doubles.** At 150 percent the nearest bot at 3 s outscored the longest at 6 s
  (5,660 to 5,384 on 16 seeds); the top skill must pay most (rule 5). At 200 percent the longest
  leads, 7,184 to 6,640.
- **The refill is the column dropping, not mirrors landing anywhere.** A refill at random cells
  would need its landing places shown in advance to be planned around (rule 7). A column that drops
  is seen before the fire; only the setting of each fresh mirror is luck, and the setting is what
  the player flips anyway.
- **Thresholds.** 300, 900, 1,800, 3,200, 5,000 and 7,000 for ratings 1100 to 2100. The joiner
  reads Steady, a careful reader of recipes (nearest or longest at 5 to 10 s a beam) Sharp, a fast
  one Masterful, and Legendary needs the search's own play at speed.
- **Careless is high.** A random choice among the bots' choices is often a searched plan, so the
  careless bot scores 3,436. It still lands a tier below one move. A person flipping at random would
  rarely fire a beam home.

The 0.1 notes, kept for the record: fourteen mirrors (sixteen made joins too slow, twelve too easy);
the way back drawn from the exit (without it, routing was trial and error); the hint goes to the
best setting, not the nearest; mirror wear mid-volley was dropped because it moved the grid under a
half-built route. Spending at the fire keeps that view: the grid never moves while a volley waits.

## Open questions for play

- Can a person read a two-lens recipe for two beams at once, or is a volley of two too much with
  recipes? `beams: 1` is a preset.
- Does anyone plan the next grid, or is the drop only noise? If noise, spending should go.
- Is exact the right recipe, or is a lens too many too harsh?
- Fresh mirrors come in at the top, so after a few long routes the top rows are crowded and the
  bottom rows bare. Is that a shape to play with, or should a fresh mirror come in elsewhere?
- Is the careless reading a sign that the deal makes volleys too forgiving?
- No ladder yet (rule 26): the obvious stages are recipes off, then one lens, then the whole
  puzzle.
