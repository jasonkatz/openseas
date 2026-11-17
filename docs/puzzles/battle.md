# Space Battle

Status: in the game. Built in M4, ADR 0021; restyled to the brand book in M10 (ADR 0061, ADR 0062). In the studio at `/battle`.

## The puzzle

Square grid with asteroids and solar current arrows. Per-turn move token pool from Engines
(left, forward, right). Up to four moves queued per turn. Simultaneous resolution with collision
and current rules. Turret fire placed left or right per move segment. Damage from hits. The captain
plays it on a landscape board. Raider AI chooses moves from a scripted policy with difficulty
tiers. The ruleset is a pure reducer shared by server, client preview, and AI.

## Role

The captain's board, dealt when the captain engages a hail (ADR 0021). It is the one board the whole crew feeds: every station's output reaches it each turn as tokens, loaded turrets and hull. Winning it opens the boarding fight. It is rated against AI raiders, scaled by the raider's tier.

## Luck and skill

- **Luck:** which board the seed picks, and the raider's rolls (its accuracy and its choices come from the fight's PRNG).
- **First skill:** flying a clean course, bringing a broadside to bear, and finishing by boarding.
- **Second skill:** winning sooner: every turn to spare pays `turnBonus`.
- **Third skill:** reading where the raider can reach, and letting currents and wells move the ship for free.
- **Fourth skill:** taking the hit and the boarding in one plot, and counting the fight in turns.

## Rules and scoring

A board from `content/data/puzzles/battle.json` (the seed picks one of
three: an open rock field, the Narrows, the Whirl), 18 by 14 cells of open space, asteroids, solar currents
(`^ > v <`) and gravity wells (`@`), the captain starting at the bottom facing north and the raider at
the top facing south. A turn is a plot of up to `segments` moves, each a token (left, forward,
right) or a hold, with port and starboard turrets per move and a grapple flag; the board shows the
course as numbered ghosts, held segments and currents included, rings a segment that would cost hull, shades the cells each plotted broadside
reaches, and outlines the raider's reach. A token goes in the picked slot and the pick moves to the next slot without a move, to none when all are
plotted, so a stray token never overwrites a move; a plot the ship can no longer pay for flies what it can. A turn carries the ship one cell forward and then swings her, so nothing turns
in place. The raider plots at the same time (its mind is in the reducer, so it replays), and both
plots fly segment by segment: moves first, with an asteroid or an edge stopping a ship (asteroids cost
`asteroidDamage`) and two ships bound for one cell, or one flying into a ship that holds, stopping
both for `ramDamage`; then solar currents, which carry a ship one cell every segment it sits on one, and
gravity wells, which spin her a quarter turn clockwise; then the turrets, a shot reaching `turretRange`
cells to its side and stopping at an asteroid, each costing a load and dealing `shotDamage`; then the
hulls. A ship at `grappleDamage` or worse can be boarded from the cell alongside by a ship that
wants to, which ends the fight (the boarding stub); when both could, the sounder hull boards. A
wrecked hull ends it too; `maxTurns` without either and the raider breaks off; the captain can
break off at any time. Score is `hitPoints` a hit landed less `hitTakenPoints` a hit taken, so hits
score as the margin (never below zero), and `winPoints` plus `turnBonus` per turn to spare on a win;
every turn's points are scaled by `scorePercent`, 100 in practice and aboard the tier's (junker
×0.5, marauder ×1, corsair ×2), so a harder raider rates higher. The combo is turns in a row with a hit. Tokens are dealt every turn in practice
(`supply`) and aboard by the ship: half the turn's tokens forward, the rest split between the
turns, plus the loaded turrets and the hull. Raider tiers differ by tokens, reloads, accuracy and
aggression (`raider-tiers.json`): the junker is slow and sloppy, the corsair closes fast, fires
true and grapples the moment it can. The studio's page fights the content raider with
presets per tier, per board and for faster or slower turns.

## Look and feedback

Everything on the board is drawn in code as a flat pictogram on the shared palette
(`boards/src/battle/art.ts`, `docs/BRAND.md` section 3), and every kind has an outline of its own, so
any two are told apart with the colour taken away. The captain's ship is a dart with one point
forward and a canopy cut out, in amber. The raider is a broad hull with two prongs forward and a
square stern with a slot, in lilac: friend and foe differ by outline, and a ship's facing reads
from her outline alone. An asteroid is a lump in quietened slate, a gravity well a teal ring
broken by an arrowhead that shows which way it turns a ship, a solar current a dim chevron
pointing the way it carries, and a slug a small capsule flying nose first. Nothing on the chart
moves unless the rules move it.

The chart is bare ground inside one hairline: no frame, no grid lines, no nebula and no stars. A
ship is flown by counting cells, so every open cell carries a small dot.

Amber is the captain's own: the ship, her hull bar and loaded turrets, the plot and the selected
slot. The plot is drawn as three dots along each move, the dart hollow where the move leaves the
ship (small along the way, nearly full size where the turn ends), the move's number beside it,
and the cells each armed broadside reaches as a flat amber tint of the ground. The raider's reach
from where she stands is outlined in her lilac. Red is kept for what is bad for the captain: a
plotted move that would cost hull or be stopped is ringed and its number turns red, a cell of the
raider's reach the captain's ship is standing in is outlined red, a raider's slug that is going to
strike flies red, the ring round the captain's ship when she is struck and the words that name it
are red, the captain's hull bar turns red once she can be boarded, the raider's grapple line is
red, the turn clock's last quarter is red, and a lost fight is named in red. Good news is cream: a
hit landed, a knock the raider takes, the raider's hull bar once she can be boarded (the Grapple
button's edge turns cream with it), and a fight won.

The hulls are plain bars and each turret is a dot, lit when it is loaded. In the plot strip a slot
is a ground field on the panel, a plotted move an amber arrow, and each gun a turret pictogram: an
armed one is amber, sits in an amber edge and has a slug leaving its barrel, so it reads armed
without colour. Fly is the one amber button. Grapple, once set, is ground inside an amber ring.
Type is Atkinson Hyperlegible, numbers in its mono face, bold. On a wide board too short for the
strip (a phone on its side) the strip's rows are squeezed so Fly stays on it.

A turn plays back segment by segment, at the same pace as before the restyle: moves, then
currents, then wells, then the guns. Ships ease out to where they are going and never overshoot.
A slug flies straight down its line, which is the shot's path; a hit rings the ship it struck, a
miss shrinks to nothing in 160ms where it stopped. A grapple is a line between the two hulls. A
wrecked ship shrinks to nothing in 160ms. Words rise a little and fade: Hit, Hit taken, Miss,
Carried, Spun, Asteroids, Rammed, and the outcome in the middle of the chart. Nothing shakes,
sparks, smokes, trails or glows, and the ships do not bob (`docs/BRAND.md` section 6).

**The beat**, one amber pulse of the whole chart, is kept for three things: a fight won (boarded
or crippled), at its strongest when the hit and the boarding were flown in one plot (the compound
move), and the third hit landed in one turn. Reduced motion cuts the playback and keeps the beat
as a still flash. Every sound is as it was. There is no marks setting on this board.

## Engine

`packages/engine/src/battle/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/battle.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Space battle". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
