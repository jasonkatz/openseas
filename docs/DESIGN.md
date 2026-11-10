# openseas — Design Document

`openseas` is a working codename. The real name is decided when art direction lands.

This document records every product and architecture decision made before the first line of
code. It is the source of truth for scope. When code and this document disagree, fix one of them
in the same PR. Rationale for the major technical choices lives in [`adr/`](./adr/).

**The setting moved from the sea to space** in milestone M7 (5.2, ADR 0034), and this document
describes the space game throughout. Two things still show the sea: the puzzle boards' backgrounds,
effects and sounds, which wait for their own pass (3.10), and history, which keeps its own words (ADRs 0001 to
0033, and the "Original" column of section 6). [`GLOSSARY.md`](./GLOSSARY.md) maps every former
word to its replacement.

## 1. Vision

A browser-native, touch-first space pirate puzzle MMO in the spirit of Puzzle Pirates. Crews of
pirates fly a ship together through one star system. Each pirate runs a duty puzzle whose output
drives the shared ship through a turn-based space battle against raiders; then the crew boards and
fights for plunder. The tone is a whimsical, scrappy frontier: duct-taped ships and cozy outposts.

**What it is**

- A spiritual successor. Mechanics are faithful where they are good. Names, art, text, and audio
  are original. Nothing is copied from the original game.
- Built for a small live community of friends first. Dozens to low hundreds of concurrent players
  is the design point.
- Strictly free. No currency purchases, no subscriptions. The architecture leaves room for
  cosmetics later but nothing is built for them now.

**What it is not**

- Not a rule-exact clone, and not a redesign. See "Default stance on rules" below.
- Not a persistent player economy in v1. Shoppes, commodities, and trade are a stated phase 3 goal.

## 2. Legal distance

Puzzle Pirates is a live trademarked product. The distance we keep:

- Original game name, original art, original text, original audio.
- Puzzle names are generic terms: Cooling, Engines, Plating, Gunnery, Navigation, Space Battle and
  Swordfighting (ADR 0034). Anything the original coined gets an original name.
- Special pieces and other coined terms are renamed.
- The space words also avoid terms coined by other well-known games and shows.
- Differences from the original are documented deliberately as they arise, in this document.

## 3. Scope

### 3.1 Puzzles in v1 (the pillage loop)

| Puzzle | Role | Rated against |
|---|---|---|
| Cooling | Duty: vents the ship's heat | The puzzle |
| Engines | Duty: generates movement tokens | The puzzle |
| Plating | Duty: repairs hull damage | The puzzle |
| Gunnery | Duty: loads turrets | The puzzle |
| Navigation | Duty: token bonuses and space battle advantages | The puzzle |
| Space Battle | Captain's game: ship versus ship on a grid | Head to head |
| Swordfighting | Boarding fight: team versus team | Head to head |

Explicitly later: Rigging, Treasure Haul, Rumble, all crafting puzzles, parlor games, Treasure Drop.

### 3.2 Default stance on rules

Rule-faithful scoring and mechanics, with modern feedback, onboarding, and input affordances
layered on top. Redesign only when a puzzle is demonstrably broken in playtesting, decided case by
case. Gunnery is the puzzle most likely to invoke this clause.

### 3.3 Puzzle designs

Each puzzle below lists its faithful core and the quality-of-life additions agreed for v1. No duty
puzzle has undo.

**Cooling.** A 6 wide by 12 tall board of pieces. Swap two horizontally adjacent pieces. Matches of
3 or more clear; the pieces below rise and new pieces enter from the bottom. Combos and
multi-clears score higher. The heat line rises as
the ship runs hot. Special pieces (equivalents of the original's crab, pufferfish, and
jellyfish, renamed) ship in v1 because they define the skill ceiling. QoL: match preview on hover
or touch-hold, a combo meter, tap-then-tap or drag-swap on touch; on desktop a click swaps the
hovered pair outright.

As built (M1, sprite art pass ADR 0031): seven ordinary piece kinds (cog, valve, bolt, fuse,
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

Feedback as built: each move plays back step by step, swap then every cascade step clearing and
rising in turn, from the per-step boards the engine's move report carries. A new move
fast-forwards whatever is still animating, so input never waits, except behind an overheated
swap. Clears burst with debris, score
popups and a callout for chains; charges and magnets shake the board; the frame glows with the
combo; overheated pieces stay readable because the body of heat (drawn as water until the sprite
pass) sits behind them. Sound and the
personal best are per device; the personal best is display only and never reaches the server.
Juice on top of that, all presentation only: clearing two or more runs in one step calls out
Double, Triple or Supernova; bigger steps hold a beat longer and punch the board; streak
milestones (3, 5, 8, 12, then every 5 scoring moves in a row) earn a callout and a fanfare, and
breaking a streak of 3+ sounds a fall; venting the heat throws spray and a pump sound (both wait for the effects pass),
crossing into the danger half sounds an alarm; overheated pieces sway, charges spark and specials
breathe. Unrated practice only: after six seconds without input the board wiggles the swap that
clears the most pieces. Rated rounds never hint. The result card adds rows vented, counted on the
client for display. Tile sprites are baked once per layout from the shared atlas, with Canvas 2D overlays for labels and optional marks; the legend uses the same art.
On phones the top bar is the whole HUD (score, time, moves, a combo chip) and the board takes the
rest of the screen; combo, heat, connection and the piece legend open in a panel over the board.

**Engines.** Falling pieces you steer and rotate into a board, clearing by forming groups and
chaining through the board's structure. Performance feeds movement tokens per turn. QoL: ghost
piece showing landing position, next-piece preview, swipe-to-move and tap-to-rotate on touch.

As built (M2): a 12 wide by 20 tall drive core; the cells are small because nothing is tapped
individually, so the whole board fits a phone screen with room to work in. Pieces are fuel pellets, round discs rather than tiles, so Engines
never reads as Cooling: conjoined pairs of two pellets in three kinds (plasma, ion and fusion; drawn as riveted
discs: a red trefoil, a yellow three-spoke and cyan rings, each target ring in its piece's color),
each with an optional mark, and the two halves of
a pair stay visibly joined while both are on the board. Six injectors sit in the board at a time,
never touching. An injector is a connected shape of cells: a bar of two to four, a stack of two or
three, an L of three, or a two-by-two square; some cells are outlined round targets that want a
kind, the rest are blanks that hold anything. An injector cell has a shelf under it when no cell of
the same injector is directly beneath, so a pellet rests in a bar's cells or a stack's bottom cell
and the cells above fill by falling in, while any cell can be entered from the side. When every
target on an injector holds its kind the injector fires, its target pellets go, the shape is gone and
a new one is dealt elsewhere. Runs of
four or more of a kind, across or down, clear as well; crossing runs count as one group. Linked
halves fall together until one is cleared. Each step of a chain multiplies by `chainMultipliers`
(×1, ×3, ×6, ×10, and ×10 past that), steeply, because a chain through the core is the
skill of Engines; several groups in one step multiply by their count, as in Cooling. A run of n scores
`runPoints * (n - 3)`; an injector scores `injectorPoints` per target. If the core fills until
no pair can enter the top row, it flames out: every pellet is swept away, `flameoutPenalty` points are
lost (never below zero), the combo breaks, fresh injectors are dealt and play goes on. The round
ends on the clock; `maxMoves` only bounds the log. Every pair enters at the middle of
the top row; the move the engine logs is the position it came to rest in (column, row, rotation),
and the engine accepts it only if that spot is reachable from the entry by sliding, turning with
the same kicks the client uses (either direction), and falling, and nothing holds the pair there. So a pair can be
steered under an injector, a vertical pair can never straddle a shelf, and a position that floats is
refused. The client's fall timer and steering are presentation: free fall takes `fallMs` a row, a
held downward swipe or holding space hurries it to `softDropMs` a row (sixteen times the pace), with
steering locked for the length of the swipe. There is no hard drop. A pair that comes to rest
locks after 350 ms; a slide or turn while resting restarts that timer at most three times, and
reaching a lower row restores the restarts. On the keyboard up turns the
pair clockwise and down turns it counter-clockwise; a tap turns it clockwise.
The next pair is under the player's control the moment the last one lands, while the board below
plays out its clears, each cascade step waiting for the pieces to land before the next clear; the
pair after it is previewed in a strip above the core on every layout. The landing ghost is a
thin ring so the target under it stays readable, and glows when the pellet would fill a target of
its own kind. Sliding into a spot that rests (a shelf or a stack beneath) mid-fall sits the pair up
on it rather than letting it sink past.
Numbers live in `content/data/puzzles/engines.json`.

**Plating.** Polyomino pieces offered from a queue, placed to seal breaches in the hull plating. Tighter
fills with fewer gaps score higher and feed repair output. QoL: drag-and-drop with snap and a
rotate button, valid-placement highlight, swap between offered pieces.

As built (M2): a 9 wide by 12 tall stretch of hull with up to three breaches open at once. A breach is
dealt as one to three pentominoes laid edge to edge, so its area is a multiple of five and a
perfect fill exists; breaches never touch. Three plates wait in a tray, each one of the twelve
pentominoes with a metal (tin, copper, steel or brass; cosmetic) and a brushing that turns with it. A plate goes down anywhere
it covers at least one open cell; it works the breach it covers most of, and cells it lays over hull
or over another plate are waste. Parts that hang off the board, or lie over a second breach or over
plated hull, are not laid at all and are waste too, so any breach can be worked from any plate. When every cell of a breach is covered it is sealed, its plates come off and a new breach
is dealt elsewhere. The seal is rated by extra plates beyond the minimum (area over five):
none is flawless (which also demands no waste), one solid work, two it'll hold, three
duct tape, four or more chewing gum and hope. Points are area times `basePerCell` times the
rating's multiplier, plus a quarter more when every plate's brushing runs across, times the
flawless streak's multiplier: `streakPercent` gives ×1 for the first flawless seal in a row, then
×1.25, ×1.5, ×1.75, and ×2 from the fifth on; a lesser seal resets it. Per plate the rating
already slopes steeply (on a ten-cell breach a flawless seal is 60 a plate, one that will hold 15), so the
streak is a bonus on top, never the whole round. A breach left alone while
`growAfterMoves` plates go elsewhere widens by one cell, and a widened breach can no longer be
flawless. The round ends on the clock; `maxMoves` only bounds the log. A round starts with no plate in
hand; the player picks one from the tray. Control is built around the
plate's centre: it sits under the pointer (lifted above a finger), and a spot that will not take it
snaps to a neighbouring one that will, so dropping near a breach is enough. A mouse carries the plate
by hovering and welds it with a click; right-click or the scroll wheel turns it. Touch drags the plate
and sets it down by letting go over the hull, where an icon toolbar follows it (turn either way,
flip, and a welder to weld it down; the ghost visibly turns over on a flip, so a symmetric plate that lands
looking the same still answers the press);
letting go or dragging off the hull sends it back to its slot, and a tap on bare hull brings it
there. Turning pivots about the
centre so the ghost stays put. The keyboard picks a slot, moves, turns either way, flips, and jumps
through the placements with the least waste. Plates drop in and knock; a sealed breach's plates lift
away; new breaches crack open through the plating; a breach two idle plates from widening pulses amber,
then red. Numbers live in `content/data/puzzles/plating.json`.

**Gunnery.** Route cells, sabots and slugs through a column board into turrets in the
right order to load them. Correct loads feed turret readiness. QoL: per-turret load-order
indicator, highlight of which drop completes a load. Flagged for possible redesign after
playtesting.

As built (M2, redesigned over several playtests under 3.2): a 9 wide by 15 tall deck (tall, to fill
a phone held upright), drawn at random from a set of content maps at the start of each round (the
seed picks it, so replays agree). Each map has its own crates, hatches and turret rows, and the engine
refuses any map that is not fit to play: with no arrows, a piece starting anywhere must leave by a
hatch (no loop built in), the stream from the feeder must leave without running into a turret, and
every turret must be reachable from the feeder with at most three arrows on a route of at most 30 ticks.
The maps were found by searching for layouts that pass, then picked by hand for variety. A feeder in
the top rail drops one piece at a time onto the deck, heading down the middle until crates turn it;
whatever is not steered rolls out through a hatch within a few seconds. The feeder draws
from a shuffled bag (two cells, two sabots, two slugs, one coolant), shows the next three in the rail
beside it, holds back while `maxOnDeck` pieces are out, and quickens from one drop every
`spawnEveryTicks` to every `spawnEveryTicksMin` over the round. Four turrets sit in the side rails,
two a side; each takes a route of one to three arrows from the stream. Pieces roll a
cell per tick until something turns them: an arrow under a piece turns it to follow it; a wall
turns it right, else left, else back. Pieces roll together: one behind a stopped piece waits, two
after the same cell let the older go, and two meeting head on both turn back. The gunner lays as
many arrows as they like, one per deck tile; a loop has to be built out of them, and a new deck every
round means building it anew. A turret takes a cell, then a sabot, then a slug; a full one fires itself
after `fireAfterTicks` (the captain's job from M4) and comes back clear, turning pieces away until
then. A wrong piece jams a turret and loses its load; a jammed turret turns away everything but
coolant, which flushes it clear; coolant in a clear turret splashes harmlessly. A cell and a sabot score
`stepPoints`, a full load `loadPoints` plus `comboStep` for each load already in the combo, up to
`comboCap`; the combo is full loads in a row without a jam. Every turret carries a lamp that lights
when it fires; once all four are lit, the ship fires a broadside worth `broadsidePoints` and the
lamps go out, so feeding one handy turret all round leaves the biggest points on the table. Time is integer ticks of `tickMs`; every
move carries its tick, the client advances its copy once per tick for display and logs a wait now
and then so loads in flight count, and the server refuses a tick ahead of the wall clock (ADR 0015).
The round ends on the clock, `maxMoves` or `maxTick`.

Reading the deck is the point of the QoL: every piece carries a chevron for its heading. A piece
headed into a turret shows its route as dots, green when the piece is what the turret wants (or
coolant for a jammed one) and red when it will jam it, and that turret gets a matching ring (the
"highlight of which drop completes a load" above); pieces headed anywhere else show no route. The
preview accounts for full turrets firing before the piece arrives. Each turret
shows the piece it wants next as a badge, with cell, sabot and slug pips below for its load. A
mouse hovering a deck tile shows a ghost arrow pointing toward the nearest edge, and every trail
redraws as if it were laid; a click commits it, the same
click again lifts it, and right-click lifts. Touch taps the same way or swipes across a deck tile to
point an arrow. Keyboard moves a cursor, lays with W, A, S, D and lifts with Space or Backspace.
Gunnery has its own piece art rather than the coloured tiles of the other puzzles. The cell is an
upright canister with a glowing orange gauge, the sabot a cream split shell, the slug a pointed
round with a copper band and the coolant a square jug of blue coolant with a hose. Each has its own
silhouette (canister, open shell, pointed round, handled jug), so they read apart without colour, and the marks setting adds a
symbol badge to each. Loads pop their points, a full turret glows and sparks, firing recoils with a muzzle flash, smoke
and a shake, a jam puffs smoke. Numbers and the deck live in `content/data/puzzles/gunnery.json`.

**Navigation.** Arrange and shift pieces to reproduce a target constellation. Completed patterns
grant token bonuses and space battle advantages. QoL: target overlay toggle, progress meter.

As built (M2, reworked after a first pass that let a star hover until the navigator dropped it and
let it pass through stars already on the chart): a round star chart of three rings and eight octants,
with time carried in the move log as in Gunnery (ADR 0015). Stars come in three shapes (spark, star,
comet) and three colors, so shape alone tells kinds apart; marks add the color's symbol. The
constellation is a set of hollow markers fixed to the chart, each wanting a kind in a slot, joined
by faint lines so it reads as a figure. Stars fall one at a time from the sky into the top octant,
taking `fallTicks` at the start of the round and quickening to `fallTicksMin` by the end; the
navigator turns any ring a step either way while it falls (stars ride with their ring, markers stay
put), or taps to bring it down at once. A star falls inward until it meets another and rests in the
ring outside it, or at the center of an empty column, and every column stays packed toward the
center: a turn that opens a slot under an outer star lets the stars above it slide in, which can
fill a marker, make a run, or unmake one. A star in the outer slot at the top shuts the column. A
marker is filled while a
matching star sits on it, and a turn can fill one as well as a landing. When every marker is filled
the constellation is charted: those stars go, points are `n * n * starPoints` times the chain of
constellations charted without a lost heading (`chainPercent`: ×1, ×1.25, ×1.5, ×1.75, then ×2), plus
`n * starPoints` for every landing under `2n` it took since it was dealt, so one charted in its
minimum n landings earns as much again as its stars; then a new constellation is dealt, larger as the round goes on and drawing half its kinds
from stars already on the chart so strays stay useful. Three or more loose stars of one kind in a
row, around a ring or down a column, clear for `runPoints` per star beyond two; a star on its marker
is charted, not loose, and never clears this way. A star arriving while the top outer slot is taken
is a lost heading: the top column is swept, `lostHeadingPenalty` is lost and the chain breaks. Every move
carries its tick; the client advances its copy once per tick and logs a wait now and then so
landings count, and the server refuses a tick ahead of the wall clock. The round ends on the clock,
`maxTick` or `maxMoves`. Touch drags or taps a ring to turn it and taps the sky, the falling star or
the center to bring it down; keyboard picks a ring with up and down, turns with left and right,
drops with enter or space. Reading aids: a dotted path from the star to the ring where it will rest,
gold when that spot is its own marker, a red cross and a red outer band when the column is shut;
markers wanting the falling star's kind beckon; in unrated rounds, after a pause, chevrons point at
the ring to turn and which way, from a search over the rings' turns. A toggle hides the markers for
players who want to chart from memory; a meter shows filled markers. The chart is as wide as the
screen, with a small hub and a thin rim so the rings get the width; the top octant is tinted as
the lane stars fall down. On a phone held upright the height left over holds a row of turn
buttons per ring, outermost first, and a button to bring the star down, so a turn is one tap
rather than a drag on a narrow ring. Landings glow, a charted
constellation flashes its lines and bursts, a run clears with a popup, a lost heading shakes the chart.
Numbers live in `content/data/puzzles/navigation.json`.

**Space Battle.** Square grid with asteroids and solar current arrows. Per-turn move token pool from Engines
(left, forward, right). Up to four moves queued per turn. Simultaneous resolution with collision
and current rules. Turret fire placed left or right per move segment. Damage from hits. The captain
plays it on a landscape board. Raider AI chooses moves from a scripted policy with difficulty
tiers. The ruleset is a pure reducer shared by server, client preview, and AI.

As built (M4, ADR 0021): a board from `content/data/puzzles/battle.json` (the seed picks one of
three: an open rock field, the Narrows, the Whirl), 18 by 14 cells of open space, asteroids, solar currents
(`^ > v <`) and gravity wells (`@`), the captain starting at the bottom facing north and the raider at
the top facing south. A turn is a plot of up to `segments` moves, each a token (left, forward,
right) or a hold, with port and starboard turrets per move and a grapple flag; the board shows the
plotted path as numbered ghosts and shades the cells each plotted broadside reaches, and outlines
the raider's reach. A turn carries the ship one cell forward and then swings her, so nothing turns
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

**Swordfighting.** Puyo-style falling colored pairs on each pirate's board. Groups clear; cleared
groups send breaker blocks to opponents' boards. Team mode distributes each side's attacks. QoL:
incoming-attack preview, swipe controls. Ships after the duty puzzles; the first playable pillage
resolves boarding with a stub.

As built (M5, ADR 0022): every pirate in a fight has a 6 wide by 14 tall board. Pairs of blocks
in four colors (crimson, gold, cobalt, lime, each with its own surface and optional mark) slide in
from above the middle column, vertical; the player steers, turns (a turn that does not fit kicks
sideways, lifts a row, or, boxed into one column, turns twice so the halves swap ends) and hurries
them, and the move the
engine logs is the column and rotation the pair came to rest in, with the tick it happened at
(ADR 0015); the engine drops each half to the top of its column, so a sideways pair whose columns
differ lands at two heights. Blocks of one color that make a two-by-two fuse into a slab, and a
slab grows by a full strip along any side, loose blocks or a slab of the same span, so slabs can
hang over a hole. A breaker is a block of a color with a blade across it, dealt `breakerPermille`
of the time; when it comes to rest touching its color, everything of that color joined to it
shatters, slabs and all, and a breaker that touches nothing of its color waits where it lands
until its color falls against it. Each step of the cascade multiplies by its chain number, and
several breakers firing in one step multiply by their count, as in Cooling. A block scores
`cellPoints`; a slab of n blocks scores `cellPoints * n + slabBonus * n(n-1)/2`, so a big slab is
worth far more than its blocks. Points become scrap at `attackPoints` a block (the remainder
carries over); scrap first cancels scrap waiting to land on the sender's own board (`offset`,
which the lab can turn off), and the rest goes to the opposing board with the least on it. It
waits there, shown above the board as a count, and lands at that board's next drop or after
`landAfterTicks`, whichever comes first, at most `incomingCapRows` rows at a time, in the columns
of the sender's blade (content: each a list of columns taken in turn, every one weighted toward the
edges and away from the middle: the plasma cutlass the least, the vibro-dirk the most). Scrap is grey dead metal and unbreakable; each
block is dealt the color it will turn as it lands, and after `ripenMoves` of the board's drops it
turns into a block of that color (usually one seen around where it lands: the block under it counts
three times and each neighbour in its row once, `scrapMatchPermille` of the time in content, any
color otherwise, so an attack mostly turns into something the defender can clear), which fuses and shatters like any other. It carries no number:
it lands as solid scrap, and with one drop left (the second of two, in content) the scrap takes
on its color, so a player reads what is coming from the block itself. An upright pair whose column has one
free cell left rests its lower half there and the upper half falls away over the top. A board whose
entry (the top cell of the column pairs come in down) is covered is out; a side with no board
standing has lost. The score is the player's attack a minute: every point their board broke,
whether its scrap cancelled what was coming or went over, over the fight to its end (a board that
goes out early keeps its clock running), counted as at least `minRateSeconds`, and scaled by
`scorePercent` (the tier's, aboard). A win adds the band `winPoints` and any other end is kept
under it, so every win outranks every loss and the rate ranks fights within each. The board
shows attack a minute and blocks broken; a fight's result leads with won or lost. A pair may not come to rest sooner than `dropTicks` after it appeared; the fall
itself is client timing (`fallTicks` a row, `softDropMs` while hurried, a short lock on resting)
and never reaches the score. AI pirates (raiders in practice, allies in the lab's team fights)
play inside the reducer: each drops every `thinkTicks`, choosing from every drop it could make,
played out with the same rules, by what it broke, the slabs it left, blocks kept together and how
high it stands, taking the best `skill` percent of the time and one of the next best otherwise,
every roll from the fight's PRNG, so a practice fight replays from one log. Aboard a ship the
fight is a melee: each pirate's board is its own fight with the raider crew outside it, attacks
leave as events the server routes and arrive as `incoming` moves the server vouches for, the
raider crew's boards run on the server from the tier's `swordsmen`, and everyone sees every board.
Feedback: the pair's landing shows as outlines (bold for a breaker), slabs are darker than loose
blocks with a heavy light border, and fuse with a flash and a callout for big ones, breaks burst
and tally, chains and big shatters call out, scrap flies to the board it is sent to, waits as a
flashing count above the board, and rains in from above, ripening flashes, the
entry is outlined, and the
other boards sit beside the player's as small live boards with their names, waiting scrap and a
cross when they are out. Touch drags to steer, taps to turn and holds a downward swipe to hurry;
the keyboard steers with the arrows, turns with up, down, X and Z and hurries with space. Numbers
live in `content/data/puzzles/swordfight.json`.

### 3.4 Ship and voyage model

- **Turn clock.** The ship runs on a fixed turn, initially 10 seconds, tuned in playtests. Each
  turn: Engines output becomes movement tokens, Gunnery output loads turrets, Cooling output vents
  heat, Plating output repairs damage, Navigation output grants token bonuses and space battle
  advantages. Heat and damage degrade speed. The space battle board resolves once per turn.
- **Ownership.** Ships are owned by individual pirates. Crews are the social unit and the invite
  list. Every new pirate receives a starter skiff as a zero-cost grant through the single ship
  acquisition path (shipyard purchase). Future gating raises the grant's requirements or price via
  content config; it is never a code change.
- **Ship classes.** Skiff only in v1. Ship class is a content table.
- **Captaincy.** The owner is captain by default and can hand the helm to anyone aboard.
  Permissions for taking a ship out without its owner are a later feature.
- **Crew size.** A pirate can fly alone. Unstaffed stations produce nothing. Raider difficulty is
  a per-encounter tier, not scaled to crew size, in v1. The game is tuned for crews of 3 to 5.
- **Bots.** A ship that launches with fewer aboard than its class's `minCrew` (four on a
  skiff) boots up bots to make up the number: AI crew who take the open stations the class
  lists for them, in order (drive, heat sinks, patch bay, turrets; never the nav console). A bot plays
  no board: each turn its station's output is a passable roll between `botOutput.min` and `.max`
  percent of par from the ship's PRNG, so a replay reproduces it (ADR 0023). A pirate may take
  any bot's station at any time; the bot steps aside and, after `botRestTurns` turns so
  the pirate settles in, works the next open station it will, or waits on deck for one. The
  captain can also order a bot to any of those four stations, never the nav console, or
  stand it down; another bot there steps aside, a pirate there never does. A pirate
  boarding a full ship relieves a bot. Bots never have the helm, never drop, earn no
  plunder, and are powered down when the ship docks or the last pirate leaves. They are small
  maintenance robots with names of their own: a bot's name from `names.json` and a unit number
  ("Gasket-7"), which no pirate's name looks like. They are marked as bots wherever crew are
  shown: a chip in the crew list, the word on their station, and their own figure on deck (a
  round robot with one lamp eye and a tool arm, 3.11), so nobody mistakes one for a player.
- **Joining.** Ships in flight appear on the outpost notice board. Pirates can join mid-voyage and
  take a free station. The owner can set a ship to crew only: the owner and the owner's crew may
  board, nobody else (M6).
- **Disconnects.** A dropped pirate's station idles for a 2 minute grace period; their seat is
  held; their duty board is discarded, not resumed. The captain's space battle board and a melee
  board are handed back as the server holds them when the pirate reconnects, and also when one of
  their moves goes missing on the way (ADR 0024). If the captain drops, the ship holds position
  and any space battle pauses for the same grace period, then the longest-aboard pirate is offered
  the helm.
- **Encounters.** Raider encounters roll per lane leg with a content-defined probability. The
  captain is prompted to engage or evade. Evading always succeeds in v1. Engaging holds the ship
  in place for the fight; the stations keep producing, and what they make reaches the battle
  board every turn (M4).
- **Plunder and loss.** Winning a space battle and boarding yields currency split among everyone
  aboard, weighted by what each gave the ship during the fight, with an extra share for the
  captain: two base shares for the captain, one for everyone else, each scaled between half and
  full by the pirate's weight against the best aboard (ADR 0021, ADR 0030). The weight is the output
  the ship received from the pirate's station, turn by turn, in percent of par after that station's
  cap, so a pirate at par counts the same at any station; a melee counts as duty turns at the
  pirate's attack a minute against Swordfight's `parRatePerMinute`.
  Losing yields nothing. Damage is repaired free at the next dock. No permanent loss, cargo, or
  sinking in v1.

### 3.5 World

- One star system, the Lantern Reach. Three asteroid outposts on a fixed lane graph. Legs take roughly 3 to 5 minutes so a full
  pillage fits in 20 to 30 minutes.
- Each outpost is a tiny walkable top-down space: a dock (board ship, shipyard), a cantina (chat,
  crew), and a notice board (ships recruiting, ships in flight).
- Outposts, lanes, raider tiers, and ship classes are versioned JSON content files in the
  `content` package, validated against schemas at server start. Adding an outpost is a PR that adds
  a file. Only player-generated state lives in the database.
- AI raiders only in flight. No player-versus-player in flight in v1.

As built (M5, ADR 0032; redrawn for space in M7, ADR 0034, and again after it, ADR 0035): each
outpost is one small settlement bolted to an open-air rock with no dome. Nothing of an island is
left in it: no beach, no trees, no pier. The ground is a low-poly heightfield: a flat floor of
regolith pocked with craters, inside a raised crater rim that is darker than the floor and drops
sheer into the void, with the rock's underside hanging below to a ragged point. The rim is cut
through where the dock comes in. Laid out from the dock inland: the dock, an arm run out over the
void (a box girder with a deck on it, braced back to the rock, a gate at its root, lights down its
edges and clamps that reach out to hold a ship at the berth either side); the shipyard (the dock's
room: a flat-roofed workshop with a shutter, a hull in frame under its crane outside) and the
notice board (a pillar of bills and lit screens all round, so it reads from any side) at its foot;
a walkway of plate up to a round pad with a holo-globe turning over it, lamp posts and a noodle
stall; the cantina facing the pad under a barrel roof of tin, with round ports, its sign swinging
and its vent stack steaming; hab pods, each with a grow tunnel beside it, the only green on the
rock; and the landmark at the back on its own rise. Round the rim: light masts, dishes and solar
panels, a shuttle up on blocks, a solar sail folded over its rack with coils of cable, a telescope
on its tripod, space junk, survey rovers trundling along the edge, and warning lamps on the lip.
On the floor: the outpost's plant (tanks, cargo and vent stacks) and stands of crystal. Every
outpost is built from a PRNG seeded by its id and laid out the same way, mirrored or not, so they
are siblings that read apart by landmark and ground: lilac regolith in a slate rim under Tinwick's
beacon tower (a lattice mast), burnt-ochre regolith in a rust rim under Echo Rock's dish, frozen
ground in black rock round Frostvent's geyser. The order the dice are rolled in is part of the
layout. ADR 0035's redraw rolled them afresh, so props stand in new places; the dock, the
buildings, their doors, the landmark and the berths' order are where they were. What is built
never depends on the renderer, so every client walks the same grid, and a unit test walks each
outpost: every door and both boarding tubes can be reached from where a pirate arrives. The pirate walks it: a tap
on the ground walks there along a path round whatever is in the way, a tap on a building or its
spot walks to its door and opens its room; at the cantina and the shipyard the door swings open and
the pirate steps in out of sight, and leaving the room (the card's back, or a tap outside) walks
them out to stand at the door. A building is entered if it has a door; the notice board is read
standing. A tap on a ship walks down the dock to her boarding tube and aboard, and on a keyboard
the arrows or WASD walk. Up close a ship answers only to taps on her hull, so the rim and the dock
around her stay walkable. The page under the game never zooms (a pinch is the world's own zoom),
and text fields are at least 16px so iOS does not zoom in on them. The camera walks with the
pirate, close enough that a pirate stands a thumb tall on a phone, and a scroll wheel or a pinch
zooms between a close view and the whole town. Everyone else on the outpost walks there too, named
over their heads, and a name is a way to their card.

### 3.6 Persistence

Per pirate: name, look, earned titles and the one worn, per-puzzle rating, crew membership and
rank, currency balance, voyage history, owned ships. No inventory, clothing items, or housing in
v1: a look is a free choice, not something owned.

- Currency is an append-only ledger from day one so a later economy has an auditable base.
- Ratings use Glicko-2 per puzzle. Duty puzzles are rated against performance thresholds
  calibrated from the tester pool. Swordfighting and Space Battle are rated head to head. Players
  see display tiers only; raw numbers are hidden.
- Standing is earned in the game only (ADR 0028): the captain's space battle, a melee board and a
  duty board that ran its full clock move it; a harness round never does. Every scored round also
  carries its own performance rating, its score read off the line through the thresholds, with the
  tier that falls in. It is stored with the round and shown on the harness's result card, never
  fed into standing.

**The pirate's sheet** (ADR 0033). The player's own page about themselves. It opens over the
scene from their name and likeness in the top bar, the same everywhere, and has three tabs.

- **Pirate: the look and the title.** A look is a jacket color and headgear, chosen from
  `pirates.json` at no cost and changed any time. A "surprise me" die rolls one. Until a pirate
  picks, they wear a look drawn from their id, so new crews still look mixed. The look shows as
  the pirate's likeness (head and shoulders) on their sheet, their card and the top bar, and
  their walking figure wears it on the outpost and the deck (3.11), so others see it. The
  headgear are a bubble helmet, goggles pushed up into spiked hair, a wide brim, a flight cap with
  ear flaps and a beanie with a bobble: each has its own silhouette and every jacket is named in
  the picker, so a look reads without color (rule 6). A bot is a robot and wears no look, so bots stay distinct (3.4). A captain's headgear
  carries a crest, a red blade standing fore and aft, whatever its shape, and the player's own
  pirate still stands in the brass ring.
  The title is chosen from the ones the pirate has earned, or none, and shows under their name on
  their card.
- **Record: what they have done.** Pirate since, voyages flown, voyages as captain, raiders
  beaten, plunder earned, rated boards and ships. These come from the voyage tables and the
  ledger, never from a separate counter. Below that is their standing at each puzzle, as tiers
  with boards played.
- **Titles: what there is to earn.** Every title in content, with what it asks for and how far
  along the pirate is: a bar for counts, or their tier for standing titles. Titles ask for
  voyages flown, voyages as captain, raiders beaten, plunder, or Sharp standing at a puzzle.
  The first day brings "Dirtsider". A title is written down the first time the record meets
  it and is kept even if standing later falls. It arrives as a toast with a button to look.

### 3.7 Social

- Text chat with three channels: ship, crew, outpost-local. Voice is left to Discord.
- Moderation is mute and block only.

**Crews** (M6, ADR 0025). A crew is a lasting band of pirates with a name, a flag and ranks, the
social unit and the invite list; it is not the same thing as whoever is aboard a ship. A pirate is
in at most one crew.

- **Founding.** Any pirate in no crew founds one in the cantina: a name (3 to 24 letters, digits,
  spaces, apostrophes and hyphens; unique whatever the case) and a flag, for `foundingFee` credits
  through the ledger (150 to start, the economy's first sink). The founder is its commodore.
- **Flags.** A field color, an accent color, a pattern (plain, band, pale, cross, saltire,
  quarters, border, chevron) and an emblem (skull, rocket, ringed planet, satellite, star, crossed
  swords, crescent moon, gear, crown, flame), all content ids in `crews.json`. Field and accent must
  differ. Every pattern and emblem is its own shape and the emblem is outlined in the field color,
  so flags tell apart without color (rule 6). A "surprise me" die rolls one.
- **Ranks.** Commodore, officer, spacer, each with its own mark. The commodore sets ranks, changes
  the flag, hands over command (staying on as an officer) and may put anyone out; officers invite
  and may put out spacers; spacers fly and chat. A commodore who leaves is succeeded by the next
  in rank, longest in the crew first; the last one out disbands the crew.
- **Invitations.** Officers and up invite by name, or from a pirate's card. An invitation waits
  until it is answered or withdrawn, online or not, and arrives as a toast with a button to look.
  Accepting while in another crew leaves it (the card asks first). A crew holds `maxMembers`
  and has at most `maxInvites` waiting.
- **What a crew does.** Crew chat reaches every member wherever they are. The crew card lists
  every member with where they are right now (on an outpost, aboard a ship and where it is
  bound, or off watch), with a button to board or join in flight when the viewer could. When
  crewmates launch the ones on an outpost are told, with a button to catch them in flight; when a ship
  with crewmates aboard beats a raider, the rest hear it. A crew-only ship takes the owner's crew.
  Ships carry their owner's crew flag painted on each slope of the roof and its emblem on the tail
  fin, on the chart and at the dock; the notice board, the deck and the cantina show the flag beside the name.
- **Tallies and the board of crews.** A crew counts voyages that docked with a member
  aboard, raiders beaten, and the credits paid to its members from those wins. The cantina's board
  of crews ranks every crew by plunder, then victories.
- **Pirates' cards.** A name in the cantina, the deck's crew list, the crew card or a chat line
  opens that pirate's card: their likeness and the title they wear, on watch or not, their crew
  and rank, voyages flown and raiders beaten, their standing tiers, and an invitation to the
  viewer's crew when the viewer may send one. A pirate's own card offers to open their sheet
  (3.6).

### 3.8 Accounts and access

- Guest-first. A new visitor gets an instant random pirate name with zero friction.
- Guests can upgrade in place to a Discord or Google account. Pirate, ledger, ratings, and ships
  carry across. No email/password auth exists.
- During alpha an invite code is required to create a pirate. This is a config flag.

As built (M6, ADR 0026): the menu's account section tells a guest plainly what they risk and
offers "keep this pirate with Discord / Google", one button per provider the server has keys for
(none on a preview, which says linking is not set up). The provider sends the player back to the
same place with a toast: "Linked to Discord" when the guest's pirate moved onto the account,
"Welcome back" when the account already had a pirate of its own, which wins (the guest stays
behind, nothing is deleted). A linked pirate sees what is linked and may add the other provider.
After a guest's first voyage docks, a toast offers to keep the pirate, once per browser.
A guest's sign-out asks twice, since it loses the pirate. A browser that has held a linked
account opens on a "welcome back" card after sign-out (sign in, or start fresh as a guest)
instead of making a new guest; the invite-gated landing offers sign-in to returning players too.

### 3.9 Platform

- Browser only, no install. Phones are first-class.
- Portrait for all duty puzzles. Landscape for Space Battle and the outpost.
- Puzzle pieces use original illustrated sprites with clear silhouettes. Every piece type is also
  distinguishable without color: a player setting draws a distinct mark on each kind, and special
  tiles carry an icon and a label. Keyboard play for all puzzles on desktop. Screen-reader support for puzzle boards is out of scope.
- English only. All player-facing strings go through one message table.
- No music in v1. Minimal synthesized sound effects via WebAudio, replaced during the art pass.

### 3.10 Art

The seven puzzle boards use original generated 2D sprite atlases (ADR 0031): dark outlines,
restrained shading and distinct silhouettes, read at phone scale. Assets live in `boards`, so the
game and harness render the same pieces. The atlases and their frames carry the space names, and since
the owner's sprite pass the art inside is space too: Cooling uses machine parts, Engines keeps
round riveted discs, Plating uses four brushed metals with engine-defined footprints and grain,
Navigation keeps its three star silhouettes, Swordfighting keeps square armour blocks, and Space
Battle uses overhead starfighters, asteroids and gravity wells. Board backgrounds, the water body,
effects and sounds wait for a later pass. Optional marks stay code-drawn; geometry, hit areas and scores stay in
code. Arbitrarily sized Swordfight slabs, extra lab colors, board backgrounds, targets and effects
retain procedural drawing. The procedural pieces also remain a fallback when an atlas cannot
load. The world is not sprites at all: it is drawn in code from primitives (3.11), and it was
redrawn for space in M7.

### 3.11 One experience: the shell, navigation and embedded puzzles

The game is one continuous graphical experience, not a set of pages (ADR 0018). This section is
the desired approach; the parts marked open are decided as they are built.

- **The overworld is home.** A pirate opens the game and is on the star system's chart at their outpost,
  the isometric diorama: outposts with their buildings, lanes, ships at the docks and under
  way. Everything the pirate can do starts from something they can see and tap on it.
- **Outposts are places on the chart.** Tapping an outpost moves in on it; its buildings are the
  menus. The dock boards a ship or buys one at the shipyard. The notice board lists ships
  recruiting and ships in flight. The cantina is chat and crew. Leaving a building moves back out to
  the chart. The M5 walkable outpost grows out of this view rather than replacing it.
- **The ship is a view inside the same scene.** Boarding moves in on the ship: the hull, the
  stations, who is at each, the heat and the hull meters, the helm. The chart stays visible
  around it while under way, with the ship easing along its lane between turns. The captain picks
  a destination by tapping an outpost on the chart.
- **Puzzles play at the station.** Taking a station opens that puzzle's board inside the ship
  view, with a slim HUD that shows the ship (heat, hull, speed, the next turn) as well as the
  board, so a pirate venting sees the heat drop. Ending a board closes back into the ship. Space
  Battle (M4) is the captain's board in the same place; Swordfighting (M5) opens over the ship when
  boarding happens.
- **One menu, in the scene.** Settings, sound, the accessibility marks, account linking and
  leaving a ship live in a single menu that opens over the scene and looks the same everywhere.
  No page has a different frame, header or back button. The crew card (M6) opens the same way
  from a flag button in the top bar, which counts invitations and unread crew chat, and from the
  cantina's crew table; a pirate's card opens over either. The pirate's own sheet (3.6) opens the
  same way from their name and likeness at the left of the top bar.
- **Transitions are moves, not loads.** Moving in on an outpost, boarding, taking a station and
  opening a board animate within the scene; the pirate always knows where they are. A URL may
  deep-link to a place for sharing; opening it lands in the scene at that place.
- **Touch first, as everywhere.** Everything above is tappable at phone size; the boards keep the
  touch affordances built in M1 and M2.
- **In-world practice** (open): a cantina table where a pirate plays a duty puzzle alone, rated,
  may replace the harness as the public way to practice. Until it exists the harness is where
  testers practice and thresholds are calibrated.
- **Technical decisions**: the world is one three.js scene with the PixiJS boards opening in a
  layer over it (ADR 0020); the harness and the game share board code through `boards` (ADR 0019).

As built (M3; redrawn for space in M7, ADR 0034): the world is an isometric diorama of primitives
hanging in the void, filling the viewport from sign-in to sign-out. The void is a starfield and a
nebula drawn behind everything: one quad that covers the screen, so the stars stay round and far at
every zoom, sliding a little as the view moves and swings; its nebula is a small noise texture made
once, so it costs a phone almost nothing. Dust drifts over the chart and courier drones circle the
outposts. The three outposts each carry the landmark their content names (a beacon tower whose
beam sweeps, a radar dish that turns, an ice geyser that vents), a cantina, a dock with a lamp and
the notice board at its foot; lanes are dashed curves from rim to rim with a nav buoy turning at
the midpoint, so a leg's progress is progress across the gap; every ship with a crew is a skiff
model hovering at a dock or easing along its lane between turns, her engines lit under way. There
is no air, so no haze: one hard sun, a cool light from the far side, and starlight. The view is
the game: it takes the screen, and the camera glides between three kinds of focus: the outpost the
pirate stands on (home, filling the frame), the deck of the ship they are aboard (the hull itself
filling the frame as its own little place, cut away so her one room shows, dust kept off it,
followed along its lane; the chart is where the ship's position in the system is seen), and the
whole star system (the chart, behind a map button, where outposts are tapped to look closer). Places are `/` (home), `/chart`, `/outpost/:id` (with `/dock`, `/cantina`,
`/notice`), `/ship`, `/ship/:station` and `/ship/helm`. The card for the place is folded to a
thin strip at the bottom of a phone (the right of a wide screen) that is the card's one header: the
place's name, where the pirate is, one line saying the obvious next thing to do (board the ship at
the dock, launch, take a station) and, aboard, heat, hull and turn-clock bars with their labels
and numbers; it unfolds on a tap or when a room or the helm needs it, and folds again on every move
so the view stays clear. The same actions hang on the geometry as spots: a pin at the thing with a
label beside it and a leader between (a building on its outpost; on the deck, each station with who
is at it and the helm, the labels standing in two columns either side of the hull so no leader
crosses another, the helm lit as the next thing to do when the captain can launch), so a tap in the
world or on the card does the same thing. A raider's hail floats over the view. The dock lists
the pirate's ships here and the shipyard (every class with its price, bought with the one
acquisition path, ADR 0010); the notice board lists ships recruiting here and ships in flight, each
joinable; the cantina lists who is on the outpost, carries the outpost chat channel and shows the pirate's
standing. Boarding moves in on the deck: vitals (heat, hull, speed, turrets), the turn clock, the
stations with who holds each and last turn's output, the crew as pegs on the deck and as a list,
the helm (the captain picks a destination on the chart and launches; a hail asks them to evade),
the ship chat and the ship's log. Taking a station opens its board in a layer over the dimmed
world; the board gets the screen, with one thin bar above it (the way back, the station's name,
the board's score and clock, and the ship as labeled heat and hull bars with the turn clock) that
unfolds on a tap into the full ship status and last turn's output, kept unfolded in a rail beside
the board on a wide screen; a station taken while docked says it is waiting for the ship to launch
and hands the captain the helm; boards are dealt back to back while the ship is in flight, a
station standing down or the ship docking cuts the board short, and the board returns to the
deck. Docked ships tie up alongside the dock, the first on its near side and the next on its far. One menu holds sound, the
marks setting, the account and sign-out. Toasts carry what happens aboard. A software renderer draws
the same world more cheaply (no shadows, no antialiasing, a fixed budget of pixels whatever the
window's size) and a board one pixel per pixel; without WebGL the cards still carry every action.

As built (M5; redrawn for space in M7, ADR 0034): the outpost and the deck are walked, not only
tapped (3.5, ADR 0032). The pegs are figures: small jointed pirates that walk, idle and work, the
vent lever worked up and down at the heat sinks, a throttle in each hand at the drive console, a
welder run along a plate at the patch bay, a load rammed at a turret, the star chart traced, the
helm's yoke held. Each kind reads apart by shape before color, as rule 6 asks: the player's own
pirate stands in a brass ring drawn over everything (so they can be found behind a pod or a tail
fin), a pirate wears the jacket and headgear of their look (3.6), a captain's headgear carries the
crest, and a bot is not a person at all: a ball of a body on one wheel with a band of paint, one
lamp for an eye, an aerial and a tool arm, half a pirate's height. It rolls where a pirate walks,
works its station with the arm (the grip sparks when it welds) and blinks when it has nothing to
do. The skiff is larger and beamier in the world than the chart alone would need, so her deck is
roomy for a crew: about eleven pirates long and five across. Nothing of a boat is left in her (ADR
0035). From outside she is a closed hull of painted plate, patched where she has been holed, on
skids: the bridge forward under a canopy, a nose cone and a probe ahead of it, two engine bells in
the stern, a ball turret pair in each side, an airlock amidships and a tail fin on the roof that
carries the crew's emblem. Her crew's flag is painted on each slope of the roof, and running lights
burn red to port and green to starboard. Aboard she is cut away like a model with its lid off: the
roof, the canopy and the side wall nearest the camera are not drawn, the far wall stands as the
back of the room with its ports and panels, and the deck is the floor of one long room, so nothing
of her hull ever stands between the camera and a station. The gear stands against the walls and the
middle of the deck is clear: the bridge is two steps up, forward, with the helm (a console and a
yoke) behind a dash of screens and the nav console (a star chart glowing on its top); aft of the
steps is the main deck, with a turret at each wall either side of the airlocks, the heat sinks to
port, the patch bay to starboard, and the drive console at the core in its cage by the stern
bulkhead. The deck's layout is its own module with no drawing in it, and a unit test walks it:
every station, the helm and every place to stand can be reached from either airlock. Ships lie at a dock bow out to the lanes, named at
the stern nearest the rock, at the top of her side. Docked, a boarding tube (a walkway in a clear, hooped sleeve) runs up
to her airlock from the dock and the deck carries a Disembark spot there. Boarding starts in close
on the pirate, the view walking with them about the deck; a scroll wheel or a pinch zooms out to
the whole hull. Up close, or on a phone held upright where the hull fills the width and no column
fits, each station's label stands beside its pin rather than in the columns: just the station's
name (a bot's with a dashed dot), placed where it covers no other label or pin. A station off
screen waits at the edge nearest it with an arrow its way, as does the player's own ship to board
when she is out of view on the outpost. No label, pin, name tag or ship's name ever covers the
player's own pirate, and none goes under the card. The brass "your ship" marker shows on the chart
only. Boarding brings the pirate in through the airlock, and the captain walks straight to the
helm. A tap on a station walks the pirate to it and opens its board, and a tap on the deck walks
there. Every station, the helm and the airlock keep their spot and the card keeps its buttons,
which act at once. Shipmates are seen walking the deck, and a change of station walks a pirate to
the new one on every screen. Static scenery is merged into a few meshes, so the extra detail costs
a phone almost no draw calls, and the sun's shadows tighten on whatever is in focus. Dust drifts
over the chart only.

**The puzzle harness** is a separate application for testing the puzzles themselves, at
`test.openseas.online` (ADR 0018, ADR 0019). One page per engine carries the practice frame as
built in M1 and M2 (start card, HUD, legend, result card, settings) around the same board the game
draws, and a bench beside it:

- **Three kinds of round.** Recorded and unrated rounds play what the game deals, untouched:
  recorded through the server, verified and kept but moving no standing (ADR 0028), unrated local on
  a random seed. Each result shows the round's performance rating and its tier. A *lab* round is the harness's: it runs
  locally on a chosen seed, a config made of the content config plus overrides, a chosen length
  and a clock that can be slowed, paused and stepped a tick at a time. A lab config must pass the
  same two checks the server applies to content (the wire schema and the engine's validator), so a
  lab round is always one the server could have issued.
- **Scenarios are links.** Seed, overrides, length, clock and hints live in the page's query
  string; a condition worth testing is one URL, and a page opened with `start=lab` begins at once.
  Presets name the conditions worth reaching for (specials galore, a quiet Gunnery deck, an
  eight-star constellation, a one-minute round), and a seed finder searches for an opening board
  that satisfies a probe (a charge on the board, deck 3, a comet first).
- **The inspector** shows the engine's state, its hash, what differs from content, and the move log
  with the hash after every move, exactly what a rated round sends.
- **Replay is proven, not assumed.** When a round ends the bench replays its log from the seed and
  compares every hash. A round can be copied out as JSON and pasted back on any machine (a
  `puzzle_round` row from the database works too) and stepped through on the board, forward and
  back, to the move a rejected round failed on.

- **The voyage bench** (`/voyage`, ADR 0027) tests the ship and its crew rather than a puzzle. A
  scenario is a ship class, a lane and its raiders (as content rolls them, always a given tier, or
  clear lanes), the captain's answer to a hail (engage, evade or let it lapse), a crew in boarding
  order at their stations with how well each plays (a percent of par per turn, give or take a
  spread, and a sword hand for the melee), a script of what they do on the way (drop and come back,
  disembark, change station) and any of the world's numbers (ship rules, class, lane, raider
  tiers) changed within what content's own startup checks allow. Bots boot up as the reducer
  boots them up. It flies through the engine's ship, battle and swordfight reducers, wired by the
  same functions the server uses: one voyage turn by turn, the ship charted (leg, speed, heat,
  hull, turrets, tokens, each station's output) with the space battle on the real board, watched as
  the AI captain plots it or plotted by the tester, then the boarding melee; or a batch of voyages
  on derived seeds for the spread (turns to dock, how often hailed, fights won, plunder), each of
  which opens as a single voyage. Every voyage's logs replay hash for hash, and the scenario is the
  page's link. A pirate's board is a number here, not a game, and the melee is one team swordfight
  rather than the server's routed boards: the bench measures the ship, not the puzzles.

It is a developer and tester tool, never linked from the game, and talks to the same server. It
is where testers practice and thresholds are calibrated; standing is earned only in the game.

## 4. Architecture

Rationale lives in the ADRs. This section states what is decided.

### 4.1 Repository layout

pnpm monorepo. Packages:

| Package | Contents | Constraints |
|---|---|---|
| `engine` | Puzzle engines, ship simulation and how the boards aboard are wired to it, space battle reducer, raider AI | Pure TypeScript. Zero runtime dependencies. Deterministic. No I/O, no timers, no randomness except from an injected seeded PRNG. |
| `protocol` | Zod schemas for every client-server message | Shared by client and server |
| `content` | World content JSON and its schemas | Validated at server start |
| `server` | Node 22, `ws`, Drizzle, Better Auth | Owns all authority |
| `boards` | What both applications render with: the PixiJS boards and their art and sound, the round runner that streams move logs, the tick clock, the server connection, the shared stylesheet (ADR 0019) | Presentation and transport only; computes nothing the server does not recompute; no pages or routes |
| `client` | The game: one graphical experience (DESIGN.md 3.11). Vite, React, three.js, the boards through `boards` | Renders; never authoritative |
| `harness` | The puzzle test harness (section 3.11): the practice frame per engine around the shared boards, plus the bench: lab rounds, scenarios, inspector, replay review; and the voyage bench for the ship and crew | A developer and tester tool; never linked from the game; renders, never authoritative |

### 4.2 Puzzle authority: deterministic replay verification

Every puzzle board is generated from a seed the server issues. The client runs the engine locally
for instant feel and streams its move log to the server. The server replays the same engine with
the same seed and move log, derives the score, and rejects any divergence. Cheating is a replay
mismatch, not an arms race. This is why `engine` must be pure and deterministic.

### 4.3 Realtime

Node with plain `ws`. Rooms are an in-process abstraction (ship, outpost, swordfight). A single
server process serves the whole star system in v1; the room abstraction is the seam for sharding later.
Messages are JSON validated by Zod schemas from `protocol`. Encoding can change behind the same
schemas.

### 4.4 Client

Two applications on the same server (ADR 0018). The game is one scene: the overworld, outposts,
the ship, menus and the puzzle boards embedded in one frame (section 3.11). PixiJS v8 draws the
puzzle boards and (from M4) the space battle; the world is an isometric three.js scene that fills
the viewport for the whole session, and the boards open in a layer over it (ADR 0020). React with
Vite is the UI layer, used for in-scene cards, HUDs, menus and the spots hung on the geometry, not
for pages. The harness is React pages with the same PixiJS boards, from the shared `boards`
package (ADR 0019), with its bench beside them.

### 4.5 Data

Postgres via Drizzle ORM with generated migrations. Better Auth with its anonymous plugin for
guests and account linking to Discord and Google.

### 4.6 Hosting and operations

- Server and Postgres on Railway, deployed from `main`.
- Client as a static build on Vercel, deployed from `main`.
- Merging is releasing. After CI is green on `main`, one Actions pipeline deploys the server to
  Railway, waits for it to be healthy on the new commit, then deploys the client to Vercel
  (ADR 0014, `docs/DEPLOY.md`).
- Every pull request that touches code gets its own full stack from CI: a Railway environment
  duplicated from production with its own server and empty database, and a Vercel preview of the
  client built against it (ADR 0016, ADR 0017). Torn down when the PR closes.
- Structured logs via pino. Sentry for client and server errors. A Postgres event table for
  gameplay analytics (puzzle starts and completions, voyage outcomes). No third-party analytics.

## 5. Process

### 5.1 Build order

Puzzles first, each playable solo on a practice page before the next starts, because the puzzles
have to be fun or nothing else matters. Order: Cooling, Engines, Plating, Gunnery, Navigation,
Space Battle, Swordfighting. Cooling goes first because it is the simplest and stress-tests the
deterministic engine and replay pipeline on the easiest case.

The practice pages live on as the puzzle harness, a separate application (ADR 0018). A puzzle is
still proven there first, with its tester session, and only then embedded in the game.

### 5.2 Milestones

| Milestone | Definition of done |
|---|---|
| M1 | Cooling practice page live with guest accounts and ratings |
| M2 | All five duty puzzles live on practice pages |
| M3 | The one-experience shell (section 3.11): the overworld as home with in-world navigation and menus; one ship with embedded crew duty and a voyage between two outposts, no combat. The practice pages move to the harness |
| M4 | Space Battle versus AI raiders, boarding stubbed |
| M5 | Swordfighting boarding and the walkable outpost |
| M6 | OAuth upgrade (a guest links Discord or Google in place and keeps everything; returning players sign in), crews (found with a name and flag, invite, ranks, crew chat, crew-only ships, crews' colors on ships, tallies and the board of crews, pirates' cards), polish pass |
| M7 | The space reskin (ADR 0034): every word, the three.js world and the codebase move from the sea to space, with the mechanics unchanged and the database wiped. The puzzle boards' art waits for the owner's sprite pass, which has since landed for the sprites |

Every milestone ends with a tester session and a written retro before the next starts.

M3 was restarted. A first pass built the ship, a notice board and an isometric chart as pages on
the practice-page structure (pull requests #24 and #25, closed unmerged) and felt disjointed: the
test harness with ship pages bolted on (ADR 0018). The restart kept its ship reducer, duty
binding, server rooms and chart models as parts and built the one experience around them
(section 3.11, ADR 0020): the world as home, outposts and their buildings as the menus, the ship
and its stations in the scene, boards over it, chat and presence in the cantina and aboard. Its
tester session is next; the space battle (M4) opens as the captain's board in the same place.

M4 as built: engaging a hail deals the captain a battle board bound to the ship (ADR 0021); it
opens over the deck in the station layer, the ship's turn clock flies the plot, the crew's stations
feed it, and a win pays the tier's plunder through the ledger. Boarding is stubbed: a grapple that
lands ends the fight. The practice page and its presets are on the harness. Its tester session
follows M3's.

M6 as built: crews and the account upgrade are as described in 3.7 and 3.8 (ADR 0025, ADR 0026).
The polish pass that came with them: the top bar shows credits as a coin and a number and gains the
crew's flag; toasts can carry a button (look at an invitation, join crewmates in flight, keep the
pirate); every name is a way to that pirate's card; the ship lock reads as crew only and says who;
a few rough strings (an "M6 is coming" line in the menu) are gone. Launching from a docked station's board
brings the captain straight back to that station once she is under way. A raider's hail at a station no
longer pushes the board down or raises a toast over it: the station's bar turns red and pulses with
the hail, and for the captain Engage and Evade lie over the ship's bars until it passes, so nothing
above the board moves. Its tester session follows M4's.

M5 as built: the boarding melee (ADR 0022) and the walkable outpost, with the deck walkable too
(3.5, 3.11, ADR 0032). Walking is cosmetic: the server relays where each pirate walks to within their
place and no rule reads it. Its tester session follows M6's; with it every milestone has been built,
and the tester sessions and retros from M2 on are what remain. They run after M7, on the space
build.

M7 plan. The reskin was planned as six PRs, in this order (the last four landed as one, below). Each PR is green, each rewrites the parts of
this document it makes true, and `GLOSSARY.md` is the spec for every word and identifier.

1. **The plan.** ADR 0034, `GLOSSARY.md` with every word drafted, this plan, sections 1, 2 and 6,
   and CLAUDE.md.
2. **Rename and wipe.** Every identifier moves to the glossary's: code, folder and file names,
   content ids and content file names, message keys, protocol messages, routes, DB tables and
   columns. One ordinary migration empties every table, sign-ins included, so everyone returns as
   a new guest. No data is mapped, and old URLs do not redirect. The PR is behavior-neutral: no
   rule, number or message value changes, every engine, property and smoke test passes with only
   names changed, and the game still reads nautical. The identifiers in DESIGN.md and CLAUDE.md
   (file paths, config keys, rule 4's content files) follow the code.
3. **Words.** Every message value, content display name, the name lists, titles, flags and raider
   tiers take the glossary's words, in the game and the harness alike. Sections 3, 4 and 6 of this
   document are rewritten in the new words; section 6's "Original" column keeps the original
   game's words. The game now reads as space. The puzzle boards keep
   their nautical sprites, procedural fallbacks, backgrounds, water body, effects and sounds until
   the owner's sprite pass.
4. **The void and the outposts.** A starfield and a nebula for the sea, drifting dust for the
   clouds and drones for the gulls. Each outpost becomes an open-air rock: a crater rim dropping
   into the void, its props and its landmark (beacon tower, radar dish, ice geyser). The
   heightfield, the walking grid and the layout stay as built (3.5, 3.11, ADR 0032).
5. **The skiff and her deck.** The hull with a clear canopy that is drawn only when zoomed out, a
   tail fin carrying the crew emblem, the flag on an antenna mast, a boarding tube and an engine
   glow. The deck's layout stays as built, with each piece of gear replaced by its station (3.11).
6. **Pirates and bots.** Jackets, headgear and the captain's crest (3.6, ADR 0033). Bots take the
   deckhands' place, never mistaken for a player (3.4, ADR 0023).

The world PRs carry before-and-after screenshots for review. The shell smoke and the harness smoke
stay green throughout. If a mechanic reads wrong in space, it is noted for its own PR after M7, not
changed inside one of these.

M7 PR 2 as built: the code speaks space, and the game still reads nautical. Every identifier moved
to `GLOSSARY.md`'s, and every message key and placeholder moved with it while no message's text did.
Migration `0005_space_rename_and_wipe` empties every table, sign-ins included, and renames the four
columns that carried a nautical word. Three engines keep their old PRNG salt strings, so a seed
deals the same board as before. Scenery with no glossary identifier keeps its code names until the
world PR that redraws it, and comments in art files still describe what is drawn. `GLOSSARY.md`
records the identifiers this PR had to choose (a ship flies, a bot boots up and powers down).

M7 steps 3 to 6 as built. They landed together as one PR, a commit for each part, so the game was
never shown with space words over a sea world; with them M7 is built.

- **Words.** Every message value reads as space, in the game and the harness; `names.json` took
  its new adjectives and nouns, and a list of bot names. A bot is named as a bot ("Gasket-7"), no
  longer from the pirates' lists (3.4). The message table gained the keys the rename had dropped:
  seven harness presets had been showing their raw keys, and a test now holds every preset to a
  name. Four keys that still carried a sea word follow their text. `GLOSSARY.md` records every
  word this step had to choose.
- **The void and the outposts** (3.5, 3.11). The sea, its shader and the fog are gone; the void is
  one screen-covering quad. Each outpost is redrawn prop by prop on the heightfield it had, with a
  rock's underside added below the rim. The dice are rolled exactly as before, which a fingerprint
  taken before and after confirmed: the walking grids, doors, berths, label anchors, tap boxes and
  ground heights of all three outposts are identical, at both render qualities.
- **The skiff and her deck** (3.11). The code that lays out the deck (its grid, obstacles, posts,
  station spots and tap boxes) changed in five names and no number; everything drawn on and around
  it is new. The canopy
  is hidden on deck rather than faded, and the tail fin takes the glass the sails had.
- **Pirates and bots** (3.4, 3.6, 3.11). The five headgear and the jacket are redrawn on the
  walking figure and on the likeness, the plume became the crest, and bots are robots. The five
  flag emblems that changed name (rocket, ringed planet, satellite, crescent moon, gear) are
  redrawn as what they are called; until then a flag called a rocket still showed an anchor.
- **Around the world.** The landing page's waves became stars, and the page behind the world is
  the void's colors, so nothing flashes sea-blue before the scene draws.

After M7, as built (ADR 0035): the owner played the space build and found it still an island with
a boat tied up at it, because M7 had changed each thing's surface and kept its outline. The
outposts and the skiff are redrawn so no outline of the sea is left (3.5, 3.11).

- **The outposts.** A flat floor inside a raised crater rim takes the place of the rise and its
  pale ring, masts, dishes and panels the place of the antenna palms, tanks, cargo and vents the
  place of the potted trees, an arm with a gate and clamps the place of the gantry of planks, and a
  lattice mast the place of the banded tower. The dice are rolled afresh.
- **The skiff.** A closed hull that is cut away aboard takes the place of the open deck under a
  canopy. The bridge moved forward, and the mast, the stays and the flying flag are gone.
- **The same world on every renderer.** A software renderer used to lay out fewer boulders, which
  gave software and GPU clients different walking grids on the same outpost. Now it only draws the
  same world more cheaply, and so do the boards. A unit test in the client walks every outpost and
  the deck.

What M7 leaves for later: the puzzle boards' backgrounds, effects and sounds (3.10; the owner's
sprites have since landed); the tester sessions and retros; and the codename. No mechanic
was changed, and none was found that needs to be: a flag still flies and is sewn in a vacuum, and
pirates walk an open rock bareheaded, which is the tone, not a fault.

### 5.3 Testing and quality

- 3 to 5 named testers from the owner's Puzzle Pirates-playing friends, on a private Discord
  server with a feedback channel and a form link per milestone. The server doubles as voice chat
  during pillages.
- Hard metrics tracked from M1: input-to-render latency, server tick jitter, puzzle round
  completion rate.
- Every puzzle engine gets property-based tests for determinism (same seed and moves give the
  same state) before it is wired to the server.

### 5.4 Development workflow

- Node 22 LTS, pnpm, Docker Compose for local Postgres. One `pnpm dev` starts database, server,
  and client.
- Claude works on branches and opens PRs. CI on GitHub Actions runs typecheck, Vitest, and
  Playwright smoke tests: the harness's per-puzzle smoke (which drives every board, and the bench's
  lab, review and clock paths, and the voyage bench), and a smoke of the game's shell, from the chart to a board and back
  once M3 lands. The owner reviews and merges.
- Private repository through the placeholder-art phase. Open-sourcing and license are decided
  when art direction lands.

## 6. Deliberate differences from the original

Maintained as they arise.

| Area | Original | openseas | Why |
|---|---|---|---|
| Setting | Pirates on the sea | Space pirates in one star system: asteroid outposts joined by lanes, a skiff, raiders, plunder paid in credits. Every mechanic is unchanged | The owner's choice of look and feel; it also puts the game further from the original (ADR 0034) |
| Ship ownership | Individuals and crews | Individuals only in v1 | Simpler model; owner likes personal ships |
| Crew ranks | A long ladder of ranks with fine-grained permissions | Three: commodore, officer, spacer | A crew of friends needs a leader, recruiters and everyone else; more can be added to the enum |
| Flags | A flag is an alliance of crews | A flag is a crew's own banner; no alliances | Alliances need more crews than the design point has; the word reads naturally on a ship |
| Crew-only ships | Crew-owned ships, with who may sail one set by rank | The owner's toggle: crew only lets the owner's crew board | Ships are personal (3.4); the crew is the invite list |
| Crew records | Fame from deeds | Voyages, victories and plunder counted on the crew; the board of crews ranks by plunder | Plain numbers players can read and chase |
| AI crew | Hired at port for wages, with their own ratings, and sent to a station by the captain | Bots boot up by themselves when a ship launches short of `minCrew`, work the open stations the class lists in order, step aside for any pirate and come back after a rest; free; powered down at the dock | Short crews still fly a working ship; no economy yet; the pirate's choice of station always wins (ADR 0023) |
| Anti-cheat | Client-reported scores | Server replay verification | Cheap once engines are pure |
| Evading raiders | Can fail | Always succeeds in v1 | Nothing to lose yet |
| Loss consequences | Cargo and damage costs | None in v1 | No economy yet |
| Accounts | Username and password | Guest-first with OAuth upgrade | Zero first-session friction |
| Appearance | Clothing items bought from shoppes, owned and worn | A free look: a jacket color and headgear from content, changed any time; nothing to own | No economy yet; identity without inventory, and room to price some looks later (ADR 0033) |
| Outpost | Large walkable towns | One small walkable town per outpost: dock, shipyard, notice board, plaza and cantina, the same layout on every outpost and each its own by landmark and ground | Scope: a town a phone can show; the rooms are cards over the world, not interiors |
| Walking | Server-tracked positions, avatars bump into each other | A tap sets a walk target the server relays to the place; every client paths the same grid, and pirates pass through each other | Nothing reads a position in v1; one small message per tap (ADR 0032) |
| Ship in flight | Continuous movement | A turn every `turnSeconds`; each station's board points since the last turn become its output as a percentage of par, clamped to that station's own `outputCapPercent` | Pure engine on the server; the client eases the ship between snapshots (ADR 0020); a cap per station lets lumpy puzzles' seals and constellations reach the ship whole (ADR 0030) |
| Duty boards aboard | Continuous play at a station | Boards of the practice length dealt back to back; a board cut short by docking or standing down counts but moves no standing | Rated rounds stay whole rounds; the ship still gets every point |
| Raider encounters | A fight | Hailed in a window along the leg; the captain engages or evades, or the raider loses interest after `hailTurns` | One hail per leg keeps a leg readable |
| Space battle turn | Moves placed as tokens arrive, resolved on a timer | The whole plot is one `commit` move; the ship's turn clock (the practice clock in the harness) flies it as it stands | A pure engine with no clock; the log is the fight (ADR 0021) |
| Space battle raider | Server-side AI | A scripted policy inside the reducer, drawing on the fight's PRNG | The replay reproduces the raider, so a fight can be reviewed and verified like any round |
| Space battle ship size | Sloops, cutters and larger ships | Skiffs only: one cell, one shot a side per move | Skiff only in v1 (3.4) |
| Space battle solar currents and gravity wells | Winds push once on entry; whirlpools carry and spin | Solar currents carry a ship a cell every segment it sits on one; gravity wells spin her a quarter turn each segment | Simple rules that read on a phone grid; sitting on either is a choice |
| Space battle ramming | Damage by size | Both ships take `ramDamage` and neither moves | Equal ships |
| Space battle sinking | Ships do not sink against brigands | A wrecked hull ends the fight, won or lost; no ship is lost | No permanent loss (3.4) |
| Space battle boarding | A swordfight | A grapple from alongside against a hull at `grappleDamage` or worse ends the space battle at once; the sounder hull boards when both could, and the melee decides the plunder (M5) | Either boarding opens the melee; whoever boards, the crew that holds the airlock takes the purse |
| Swordfight deal | Each pirate is dealt their own pieces | Every board in a fight takes pairs from one shared stream, the nth pair the same for all, derived from the fight's seed; aboard, every pirate's own board is given the melee's seed as `dealSeed`, so the whole crew is dealt alike | An even fight: nobody gets better pieces by luck |
| Swordfight pairs | Fall in real time | The move is the column and rotation the pair rested in, at its tick; the engine drops the halves; a rest sooner than `dropTicks` after the pair appeared is refused | One move per pair keeps the log small; the tick bounds how fast a hand can be (ADR 0015) |
| Swordfight slabs | Rectangles of a color fuse into a big block | Same: a two-by-two fuses, a slab grows by a full strip along a side, and can hang over a gap | Faithful; the strip rule keeps fusing deterministic |
| Swordfight attacks | Sprinkles land on the opponent at once, in the sword's pattern | Scrap waits on the target board and lands at its next drop or after `landAfterTicks`; it first cancels scrap waiting on the sender's board | A beat to see an attack coming and answer it; the timer means stalling never dodges one |
| Swordfight scrap ripening | Grey until it turns, with no word of the color | Scrap is dealt its color as it lands and shows it the drop before it turns | Planning around what is coming is the skill; a hidden color is luck |
| Swordfight team targeting | Attacks spread over the opposing team | Each attack goes whole to the opposing board with the least on it | Reads on a phone: one board takes the hit, and the lightest one |
| Swordfight opponents | Other pirates, or brigands when boarding | Raiders (and lab allies) are a scripted hand inside the reducer; a melee aboard routes attacks between every pirate's own fight and the raider crew's | A practice fight replays from one log; each pirate's board aboard verifies on its own (ADR 0022) |
| Swordfight rating | Head to head | By attack a minute, with every win in a band above every loss, scaled by the raider tier, against content thresholds, in practice and aboard alike | No human opponent until duels; head-to-head rating comes with them (as Space Battle, ADR 0021) |
| Space battle rating | Head to head | By the hit margin and the win, scaled by the raider tier, against content thresholds, against AI raiders | No human opponent until player-versus-player in flight (ADR 0021) |
| Space battle tokens | Typed tokens from the sails | The ship's turn output as tokens: half forward, the rest split between the turns; Navigation adds `navTokens` | One number from the ship, split the same way every time |
| Cooling specials | Crab, pufferfish, jellyfish | Slag, Spark Charge, Magnet | Original names (ADR 0001, ADR 0034); same roles |
| Tile art | Illustrated pieces | Original illustrated sprite atlases, specials with labels, optional code-drawn marks; procedural fallback | Shared art between game and harness; silhouettes and marks keep kinds apart without color (ADR 0031) |
| Cooling hints | None | Idle hint in unrated practice only | Teaches newcomers; rated rounds stay unaided |
| Cooling scoring | Original's table | n(n-2) per group, times groups, times a capped cascade table; slag lifted together 15 × k²; a capped streak multiplier that survives one setup swap | Rewards planned multi-group swaps over refill luck (the owner's reward review); tuned in playtests |
| Cooling heat | Driven by the ship | The ship's heat, never read below 3 rows, injected into the move log as heat events the server vouches for; the harness plays a lone ship's heat the same way (ADR 0029) | Replays stay self-contained: the log is the whole story (ADR 0003). Heat that never reads cold keeps overheated swaps and slag setups on a sound ship's board |
| Divergent puzzle round | n/a (client-reported) | Rejected outright, unrated, logged | Engines are deterministic; any mismatch is a bug or a cheat |
| Engines piece control | Free fall in real time | The move is the resting position; the engine checks it is reachable from the entry by sliding, turning and falling | One move per pair keeps the log small while steering under injectors stays possible (ADR 0015) |
| Engines injectors | Targets on fixed structures | Injectors are shapes (bars, stacks, L's, squares) with outlined targets and blanks; shelves sit under their bottom cells; a cleared one is dealt again elsewhere | Same role, original layouts; shapes make tucking and stacking matter |
| Engines scoring | Original's table | Run of n scores `runPoints * (n - 3)`, injector scores `injectorPoints` per target, times groups, times a steep capped chain table | Chains through the core are the skill; tuned in playtests |
| Engines flameout | Board full ends the board | The core is cleared for `flameoutPenalty` points and play continues to the clock | A filled board should cost, not stop, a two-minute practice round |
| Duty round length | Real-time play at a station | Every round runs its clock; move limits only bound the move log, and no pace is checked | Scored per second, as the ship pays; quick players should feel quick |
| Timed puzzle rounds | Real-time simulation | Integer ticks carried in every move; the server rejects ticks ahead of the wall clock | Keeps engines pure and replayable (ADR 0015) |
| Plating breaches | Grow in real time when unattended | Dealt as unions of pentominoes; widen by one cell after `growAfterMoves` plates placed elsewhere | Move-driven growth keeps the engine pure; pentomino unions guarantee a flawless seal is possible |
| Plating placement | A plank must sit wholly on the hull and clear of other holes | A plate may hang off the board, or lie over other breaches or plated hull; it joins the breach it covers most of, and the parts that are not laid count as waste | Playtest: a breach near an edge or another breach could not be worked in the orientation on offer |
| Plating sealed breach | Planking stays visible | Plates come off and the hull is free again; a new breach is dealt | Keeps a practice round busy on a small board |
| Plating scoring | Original's table | Area times `basePerCell` times a rating multiplier, brushing bonus, times a flawless streak capped at ×2 | An uncapped streak let one late slip decide a round; tuned in playtests |
| Gunnery firing | The captain fires loaded cannons in sea battle | On the Gunnery board a loaded turret fires itself after `fireAfterTicks` and comes back clear, for the gunner's score; the ship keeps a count of loaded turrets from Gunnery output, and in a space battle the captain fires those | The board stays a whole puzzle of its own; the captain still decides when the ship's turrets speak (ADR 0021) |
| Gunnery broadside | The captain decides when and which guns fire | Every turret fired since the last broadside scores `broadsidePoints` | Playtest: nothing rewarded loading more than the nearest turret; a broadside also sets up what the captain wants from gunners in M4 |
| Gunnery supply | Pieces come into play around the board | One feeder drops a previewed, bag-shuffled stream down the middle; unsteered pieces roll out a hatch | Playtest found random spawns unreadable; a single stream makes every arrow a clear decision |
| Gunnery collisions | Pieces bounce off each other | Pieces queue behind each other; only head-on meetings turn both back | Bouncing made routes impossible to predict |
| Gunnery jammed turret | Takes pieces and wastes them | Turns everything but coolant away | A jam costs the load and the combo; it should not also eat the next pieces |
| Gunnery route preview | None | A piece headed into a turret shows its route, green or red for what it will do there | Makes a busy deck readable; routes for every piece were noise in playtest |
| Gunnery deck | One board | A random pick from content maps each round, each checked for no built-in loop and every turret in reach | Playtest: on one board, players found the loop and worked off it all round; a new board keeps them reading routes |
| Gunnery arrows | Limited | No limit, one per deck tile | Playtest: the cap made routing around the crates a chore; the move log is still bounded by `maxMoves` |
| Gunnery time | Continuous rolling | One cell per tick of `tickMs`, carried in the move log | Pure engine; the client interpolates between ticks (ADR 0015) |
| Gunnery coolant | Cleans fired or misloaded cannons | Clears a jammed turret; splashes harmlessly in a clear one | Firing no longer jams, so coolant is only for jams |
| Navigation time | Stars fall in real time | One star in the sky at a time, falling `fallTicks` to `fallTicksMin` on the engine clock, carried in the move log | Pure engine; the server can tell a stalled star from a quick one (ADR 0015) |
| Navigation entry | Stars fall into the top of the chart | Same: the top octant; a tap or enter brings the star down early | A fixed entry keeps the mental model stable: bring the right spot to the top |
| Navigation landing | A star stops against the first star it meets; stars slide inward when the ring under them opens | Same; the outer slot taken means no room | Columns stay packed, so turning an inner ring moves the rings outside it too |
| Navigation lost heading | Turns the ship around | Sweeps the top column, costs `lostHeadingPenalty`, breaks the chain | No ship yet; the sweep keeps the chart playable (as a flameout in Engines costs rather than stops) |
| Navigation runs | Rows of a kind clear | Three or more loose stars of a kind around a ring or down a column clear for `runPoints * (n - 2)`; stars on markers never do | Gives strays an outlet; charted stars must stay safe from it |
| Navigation constellations | Fixed progression | Size grows with completions; half the kinds are drawn from stars already on the chart | Keeps stray stars useful on a small chart |
| Navigation scoring | Original's table | `n * n * starPoints` times a chain capped at ×2, plus `n * starPoints` per landing saved under `2n` | Charting cleanly is the lever, not going long without a lost heading; tuned in playtests |
| Navigation hints | None | After a pause in unrated practice, chevrons on the ring to turn | Teaches newcomers, as in Cooling; rated rounds stay unaided |
