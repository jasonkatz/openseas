# Cooling

Status: in the game. Built in M1, sprite art pass ADR 0031. On the harness at `/cooling`.

## The puzzle

A 6 wide by 12 tall board of pieces. Swap two horizontally adjacent pieces. Matches of
3 or more clear; the pieces below rise and new pieces enter from the bottom. Combos and
multi-clears score higher. The heat line rises as
the ship runs hot. Special pieces (equivalents of the original's crab, pufferfish, and
jellyfish, renamed) ship in v1 because they define the skill ceiling. QoL: match preview on hover
or touch-hold, a combo meter, tap-then-tap or drag-swap on touch; on desktop a click swaps the
hovered pair outright.

## Role

A duty station: the heat sinks. Its output vents the ship's heat each turn (DESIGN.md 3.4), as a percent of `parScore`, capped by the station's `outputCapPercent` in `star-system.json`. The board's heat line is the ship's own heat (ADR 0029).

## Luck and skill

- **Luck:** what rises from the bottom, and where the specials turn up.
- **First skill:** finding a match at once, every time, and staying out of the slow overheated rows.
- **Second skill:** long runs and two runs in one swap. A group of n scores n(n-2) and k groups multiply by k, so two threes are worth a great deal more than one after the other.
- **Third skill:** reading how the board will rise, and aiming the Spark Charge and the Magnet.
- **Fourth skill:** banking slag under the heat line and lifting it together (15 × k × k), without dropping the streak.

## Rules and scoring

Seven ordinary piece kinds (cog, valve, bolt, fuse,
crystal, coil, chip), each with its own silhouette and surface texture and its own optional mark.
Since the owner's sprite pass they are drawn as what they are named: a yellow cog, a cream valve
wheel, a blue hex bolt, an orange glowing fuse, a violet crystal, a green coil spring and a red
chip with pins. Specials are the Spark Charge (swap to clear a 3 by 3), the Magnet (swap with a piece to clear every piece of that kind),
and the Slag (unmatchable; it rides up with the board and comes off by itself, for a bonus,
once it is at or above the heat line). A connected cleared group of n pieces scores n(n-2); clearing k groups in
one step multiplies by k, with no cap, because a planned double is the skill; cascade step c
multiplies by `cascadeMultipliers` (×1, ×2, ×3, and ×3 past that), so a lucky refill cascade cannot
outweigh a setup. Slag that comes off together takes the group multiplier and no cascade's: k at
once score 15 × k × k, the biggest lift on the board, earned by holding them under the line and
lifting them together. A move's points are then multiplied by the streak: each scoring move in a
row adds `streakStepPercent` (10%) from the second on, up to `streakMaxPercent` (×1.5); one swap
that scores nothing (`streakGrace`, a setup) keeps the streak and a second in a row breaks it. The
round runs its clock: `maxMoves` only bounds the log, so a score is points in a round's 150
seconds, the same thing the ship pays per turn. Every board the server deals plays on a ship's heat (ADR 0029): content sets `shipHeat`, so
swaps neither raise nor vent the heat, and the ship injects heat events into the log instead, one
with the deal and one whenever a turn changes the depth. The board reads the heat as rows and never
below `minHeatRow`, three rows: a ship never runs cold, so even a sound, vented ship keeps the
bottom three rows overheated and the slag under them waiting to be lifted. Aboard a ship (M3)
the heat is the ship's. In the harness it is a lone ship's: a sound skiff with nobody else aboard,
whose heat each turn takes the class's intake and vents by this board's own output, as the ship's
turn would. The server turns it for a recorded round and pushes the depth as a ship does; the
harness turns it on the round's own clock for unrated and lab rounds. The client logs each depth as
a `heat` move; the server accepts a heat move only when it repeats the depth it last gave that
board, so the log stays the whole story and the client never sets its own heat. The board's own
heat stays in the engine for lab rounds that turn `shipHeat` off: every move raises it a sixth of
a row, every 40 points vent a row, and it never drops below the same floor. Venting while already
at the floor is wasted, so points cannot be banked to hold the heat down later. Either way the
heat is a pure function of the move log, so a replay needs nothing else. A heat
event is no move: it counts toward nothing and breaks no combo. Below the
heat line pieces swap slowly: the swap takes `overheatSwapMs` and the board takes no other swap
until it lands, so working overheated costs time against the clock. That cost is client timing
only, like the original's; scores never depend on it. All numbers live in
`content/data/puzzles/cooling.json` and are tuned in playtests.

## Input and feedback

Each move plays back step by step, swap then every cascade step clearing and
rising in turn, from the per-step boards the engine's move report carries. A new move
fast-forwards whatever is still animating, so input never waits, except behind an overheated
swap. Clears burst with debris, score
popups and a callout for chains; charges and magnets shake the board; the frame glows with the
combo; overheated pieces stay readable because the body of heat (a glowing orange
body with a hot rim and drifting embers, redder once it is half full) sits behind them. Sound and the
personal best are per device; the personal best is display only and never reaches the server.
Juice on top of that, all presentation only: clearing two or more runs in one step calls out
Double, Triple or Supernova; bigger steps hold a beat longer and punch the board; streak
milestones (3, 5, 8, 12, then every 5 scoring moves in a row) earn a callout and a fanfare, and
breaking a streak of 3+ sounds a fall; venting the heat puffs steam along the line with a hiss through a valve,
crossing into the danger half sounds an alarm; overheated pieces sway, charges spark and specials
breathe. Unrated practice only: after six seconds without input the board wiggles the swap that
clears the most pieces. Rated rounds never hint. The result card adds rows vented, counted on the
client for display. Tile sprites are baked once per layout from the shared atlas, with Canvas 2D overlays for labels and optional marks; the legend uses the same art.
On phones the top bar is the whole HUD (score, time, moves, a combo chip) and the board takes the
rest of the screen; combo, heat, connection and the piece legend open in a panel over the board.

## Engine

`packages/engine/src/cooling/`. Its header comment in `types.ts` states the rules; numbers are in
`packages/content/data/puzzles/cooling.json`.

## Tuning notes

What was changed from the original and why is in `DESIGN.md` section 6, in the rows that begin
"Cooling". New tuning is recorded here: what was tried, what the bots or testers scored, what was kept.

## Open questions for play

- None recorded yet. The tester sessions (DESIGN.md 5.2) are still to run.
