# Assembly

Status: built. Prototype (ADR 0036, ADR 0082), in the studio at `/assembly`. Untimed moves; a 120
second round.

Assembly is a successor, not one of the game's own new designs: it follows the original's
Shipwrightry, the crafting puzzle a shipyard runs to build a ship (DESIGN.md section 3 lists every
crafting puzzle as explicitly later). It keeps that puzzle's mechanics and gives everything a player
sees and hears its own form: its parts, its shapes, its words, its sounds and its numbers. Where it
departs from the original is listed in DESIGN.md section 6.

## The puzzle

A shipyard's parts bay, six wide and eight tall, always full. Under it, the tray holds six
blueprints for the next sections of hull.

- **Each kind of part moves its own way.** A **girder** swaps sideways, a **strut** up or down, a
  **cable** corner to corner. A **panel** has no way of its own: it moves only when a neighbour that
  has one swaps with it. A **core** never moves.
- **The verb is a swap.** Two neighbouring parts, side by side, one over the other or corner to
  corner, may swap when either one moves that way. Two parts of one kind never swap. A swap scores
  nothing: it sets the bay up, and it spends the clock.
- **Blueprints.** Each is a shape of three, four or five parts drawn on a grid no bigger than four by
  four, each square asking for one kind (never a core). A new blueprint has three parts five times in
  eleven, four parts four times, five parts twice (`sizeWeights`), its shape even among that size's,
  each square's kind by the same weights as the bay's (`kindWeights`: panels 22, the others 26).
  Blueprints never turn: a shape and its turn are two shapes.
- **A fit.** Drop a blueprint where the bay holds its parts in its shape, a core standing for any
  one. Those parts are taken, and a new part appears in each cell they left, in reading order.
  Nothing else in the bay moves. A new blueprint takes the used one's place in the tray.
- **Chains.** Fits made one after another with no swap between are a chain. A fit of n parts scores
  `fitPoints` × (n − 2) × its place in the chain: 10, 20, 30 for three, four, five parts at the first
  place, double at the second, and so on. The place counts up to `chainCap` (6) and holds there.
- **Cores.** Two cores open the round (`startCores`). A new part is a core 30 times in a
  thousand (`corePermille`) while fewer than three stand in the bay (`maxCores`). Each core a fit
  takes adds `corePoints` (10) × its place in the chain.
- The opening bay always holds a fit, or a fit one swap away; the deal tries again until it does,
  and after forty tries lays the first blueprint's parts into the top left so it fits by construction.

The compound move the puzzle pays most for: **several blueprints set up, then fitted one after
another as one chain, each on cells of its own.**

## Luck and skill

- **Luck:** the opening bay and its cores, the parts that appear after each fit, whether one is a
  core, and each new blueprint. Each is drawn from its own stream (ADR 0075): the parts, the cores
  and the blueprints, so playing differently never changes which blueprints come next. Everything a
  player plans around is shown: the whole bay and all six blueprints.
- **First skill:** the ways. Seeing that a girder can carry a panel sideways, a cable can carry a
  strut to a corner, and a panel is moved only by its neighbours.
- **Second skill:** finding the spot. A blueprint is quickest to make where most of its parts already
  sit, and around the panels it needs rather than by dragging panels across.
- **Third skill:** holding back. Fitting the moment something fits pays each fit at the first place.
  Setting two or three up and fitting them in a row pays the second double and the third triple.
  Fitting the moment one fits is the bait: it feels like steady work, and it loses to plain set-up
  play by about a third (the bot table below).
- **Fourth skill:** room. Two blueprints set up over the same cells cannot both be fitted, and a
  fit's new parts are drawn at random, so a player sets blueprints up side by side, each on cells of
  its own, and reads the new parts a fit leaves for a blueprint they already nearly make.
- **Fifth skill:** knowing when to stop. Only the clock limits a chain. Six blueprints set up take a
  long time; a round that ends mid-setup scores nothing for it.

## The ladder

A new player climbs two stages (ADR 0066), each passed with one Steady round. Only the whole puzzle
counts. Each stage is the whole puzzle with layers switched off in `stages` in the content file;
its name and one-line card are `assembly.stage.<id>` and `_intro`.

| Stage | Round | What is on | Switched off |
|---|---|---|---|
| Parts | 60s | Swaps and fits | Chains (`chainCap: 1`), cores (`startCores`, `corePermille` and `maxCores` 0) |
| Chains | 90s | Chains | Cores |
| Full build | 120s | Everything | |

## Input and feedback

- Pointer: drag a part onto any of its eight neighbours to swap the two (the drag's angle picks the
  neighbour), or tap a part (an amber ring holds it) and then a neighbour. Drag a blueprint from the
  tray onto the bay, or tap it (an amber ring round its slot) and then tap the bay; its box centres on
  the pointer, and amber frames show the cells it would cover, grey where it does not fit. The strip
  over the bay says what it would score there (`assemblyFitPoints`), or that it does not fit.
- Keyboard: arrows or WASD move the cursor. Space or enter holds the part under it; then an arrow,
  or Q, E, Z or C for a corner, swaps it that way. A number key picks that blueprint, its box's top
  left at the cursor; space or enter fits it. Escape lets go.
- Unrated and lab rounds pulse a move worth making after six seconds idle: the fit worth most now,
  else the swap that readies the most fits (`assemblyHint`).

The board follows the brand book (`docs/BRAND.md`, ADR 0061, ADR 0062): it draws its pieces in code
(`boards/src/assembly/pieces.ts`) from `boards/data/pieces/assembly.json`, and loads no image.

- **Parts.** Each kind's outline is the way it moves. The girder is a long beam lying flat, pointed
  at both ends, with a slot cut along it; the strut the same beam standing up; the cable a beam laid
  corner to corner with three strands cut through it; the panel a square plate with four rivets cut
  at its corners. Their colours are a second cue: sand, sky, moss and lilac.
- **The core** is a hex nut in cream with its eye cut through: the only cream piece, and the only
  piece that never moves.
- **The tray** is two rows of raised slots under the bay, each blueprint drawn small in its own
  parts, centred in its slot.
- **A swap** slides the two parts past each other in 120ms with the swap cue.
- **A fit** shrinks its parts to nothing where they stood, with a pop a step higher for each place
  in the chain and the clear cue from the second place on; its points rise from where it was, in
  cream. New parts grow in where they stood in 120ms; nothing else moves.
- **Callouts**, one a fit, in this order: the chain from its second fit ("Chain x2"), five parts,
  a core. A swap that ends a chain of two or more says so in dim.
- **The beat**, one amber pulse of the whole board, is the chain's: from its fourth fit, stronger for
  each place after.

## Engine

`packages/engine/src/assembly/`. Moves: `{ type: "swap", a, b }`, `{ type: "fit", slot, cell }`
(`cell` is where the top left of the blueprint's box goes) and `{ type: "end" }`. A swap's report
gives its two cells and the chain it ended. A fit's report gives the blueprint, the parts it took,
its place, its cores and points, the new part in each cell it took, and the blueprint that took its
slot. The board plays the report and ends on the
engine's bay and tray.

## Tuning notes

Set from bots, not people (ADR 0036). A person's pace is modelled as a swap every 1.2 seconds and a
fit every 2 (pick the blueprint, then the spot).

The bots of this pass, 24 seeds a cell (`pnpm --filter @openseas/bots ladder assembly`):

| Bot | Parts (60 s) | Chains (90 s) | Full (120 s) |
|---|---|---|---|
| careless | 13 Green | 18 Green | 41 Green |
| one move | 327 Sharp | 765 Sharp | 1,106 Sharp |
| rollout | 327 Sharp | 1,193 Masterful | 1,684 Masterful |
| fit at once | 332 Sharp | 770 Sharp | 1,215 Sharp |
| chain builder | 315 Sharp | 1,093 Masterful | 1,909 Masterful |
| builder of 3 | 312 Sharp | 1,059 Masterful | 1,734 Masterful |
| *Steady from* | *100* | *200* | *300* |
| *Sharp from* | *250* | *550* | *799* |
| *Masterful from* | *400* | *1,000* | *1,499* |
| *Legendary from* | *625* | *1,599* | *2,399* |

- **careless**: any legal move at random.
- **one move**: the move worth most now, and no further look.
- **rollout**: the eight best moves, each played five moves on, three times, on a fresh random stream.
- **fit at once** (the bait): fits the moment a blueprint fits, the one worth most; else the swap
  that sets the bay up best.
- **chain builder**: swaps while a swap readies another blueprint, then fits every ready one as a
  chain, keeping the rest ready.
- **builder of 3**: the chain builder, but it starts a chain only once three blueprints are ready.

Checks: careless lands a tier below one move on every stage, and the bait loses to the chain builder
on the whole puzzle by 36.4 percent.

- **Chains are earned, not given.** On the Chains stage the planning bots score about two fifths
  more than one move does; on Parts, with chains off, every thinking bot scores the same. The chain is the
  layer that sorts players.
- **Cores earn their place.** With cores off on the whole puzzle the chain builder scores 1,396
  and the bait 968; cores add about 37 percent to the planner.
- **No bot reaches Legendary.** The bots read the whole bay in the time a person reads one
  blueprint, so the top tier is left for play that sets up longer chains than these bots do. It
  wants setting by hand once people have played.

Open questions for play:

- **The pace.** A fit is a pick and a drop, a swap a drag, and the model gives them 2 and 1.2
  seconds. Reading the bay for a blueprint's spot likely takes a person longer than either.
- **Panels.** At 22 in a hundred they are about a fifth of the bay. A stiffer bay (more panels)
  makes the ways matter more and the chains harder; the "Stiff bay" preset tries half.
- **The tide.** The original's rising water is left out (DESIGN.md section 6). If long setups
  feel free of pressure, a layer that ends a chain after a time without a fit is the place to add it.
