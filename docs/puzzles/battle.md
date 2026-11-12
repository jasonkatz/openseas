# Space Battle

Status: in the game. Built in M4, ADR 0021. On the harness at `/battle`.

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
true and grapples the moment it can. The harness practice page fights the content raider with
presets per tier, per board and for faster or slower turns.

## Engine

`packages/engine/src/battle/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/battle.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Space battle". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
