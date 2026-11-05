# openseas — Design Document

`openseas` is a working codename. The real name is decided when art direction lands.

This document records every product and architecture decision made before the first line of
code. It is the source of truth for scope. When code and this document disagree, fix one of them
in the same PR. Rationale for the major technical choices lives in [`adr/`](./adr/).

## 1. Vision

A browser-native, touch-first pirate puzzle MMO in the spirit of Puzzle Pirates: crews of pirates
sail a ship together, each running a duty puzzle whose output drives the shared ship through a
turn-based sea battle against brigands, then board and fight for booty.

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
- Puzzle names that are generic nautical terms are kept: Bilging, Sailing, Carpentry, Gunnery,
  Navigation, Swordfighting, Sea Battle. Anything the original coined gets an original name.
- Special pieces and other coined terms are renamed.
- Differences from the original are documented deliberately as they arise, in this document.

## 3. Scope

### 3.1 Puzzles in v1 (the pillage loop)

| Puzzle | Role | Rated against |
|---|---|---|
| Bilging | Duty: lowers bilge water | The puzzle |
| Sailing | Duty: generates movement tokens | The puzzle |
| Carpentry | Duty: repairs hull damage | The puzzle |
| Gunnery | Duty: loads cannons | The puzzle |
| Navigation | Duty: token bonuses and sea battle advantages | The puzzle |
| Sea Battle | Captain's game: ship versus ship on a grid | Head to head |
| Swordfighting | Boarding fight: team versus team | Head to head |

Explicitly later: Rigging, Treasure Haul, Rumble, all crafting puzzles, parlor games, Treasure Drop.

### 3.2 Default stance on rules

Rule-faithful scoring and mechanics, with modern feedback, onboarding, and input affordances
layered on top. Redesign only when a puzzle is demonstrably broken in playtesting, decided case by
case. Gunnery is the puzzle most likely to invoke this clause.

### 3.3 Puzzle designs

Each puzzle below lists its faithful core and the quality-of-life additions agreed for v1. No duty
puzzle has undo.

**Bilging.** A 6 wide by 12 tall board of pieces. Swap two horizontally adjacent pieces. Matches of
3 or more clear; the pieces below float up and new pieces enter from the bottom. Combos and
multi-clears score higher. The water line rises as
the ship's bilge fills. Special pieces (equivalents of the original's crab, pufferfish, and
jellyfish, renamed) ship in v1 because they define the skill ceiling. QoL: match preview on hover
or touch-hold, a combo meter, tap-then-tap or drag-swap on touch; on desktop a click swaps the
hovered pair outright.

As built (M1): seven ordinary piece kinds, colored squares, each with its own surface texture
(knurled brass, ribbed shell, waves, wood grain, nacre rings, kelp fronds, coral pores) and its own
optional mark. Specials are the Powder
Keg (swap to clear a 3 by 3), the Ink Cloud (swap with a piece to clear every piece of that kind),
and the Barnacle (unmatchable; it rides up with the board and comes off by itself, for a bonus,
once it is at or above the water line). A connected cleared group of n pieces scores n(n-2); clearing k groups in
one step multiplies by k; cascade step c multiplies by c. On the practice page the water is a level
carried in the game state: every move raises it a sixth of a row, every 40 points drain a row, and
it never drops below a floor of 3 rows. Pumping while already at the floor is wasted, so points
cannot be banked to hold the water down later. It is still a pure function of the move log, so a
replay needs nothing else. Aboard a ship (M3) the board's config carries `shipWater` and the water
is the ship's bilge: swaps neither raise nor drain it, and the ship injects water events into the
log instead, one with the deal and one whenever a turn changes the depth. The client logs each as a
`water` move; the server accepts a water move only when it repeats the depth the ship last gave
that board, so the log stays the whole story and the client never sets its own water. A water
event is no move: it counts toward nothing and breaks no combo. Below the
water line pieces swap slowly: the swap takes `underwaterSwapMs` and the board takes no other swap
until it lands, so working underwater costs time against the clock. That cost is client timing
only, like the original's; scores never depend on it. All numbers live in
`content/data/puzzles/bilging.json` and are tuned in playtests.

Feedback as built: each move plays back step by step, swap then every cascade step clearing and
rising in turn, from the per-step boards the engine's move report carries. A new move
fast-forwards whatever is still animating, so input never waits, except behind an underwater
swap. Clears burst with debris, score
popups and a callout for chains; kegs and ink clouds shake the board; the frame glows with the
combo; submerged pieces stay readable because the water body sits behind them. Sound and the
personal best are per device; the personal best is display only and never reaches the server.
Juice on top of that, all presentation only: clearing two or more runs in one step calls out
Double, Triple or Full broadside; bigger steps hold a beat longer and punch the board; streak
milestones (3, 5, 8, 12, then every 5 scoring moves in a row) earn a callout and a fanfare, and
breaking a streak of 3+ sounds a fall; pumping the water down throws spray and a pump sound,
crossing into the danger half sounds an alarm; submerged pieces sway, kegs spark and specials
breathe. Unrated practice only: after six seconds without input the board wiggles the swap that
clears the most pieces. Rated rounds never hint. The result card adds rows pumped, counted on the
client for display. Tile art is painted once per layout with Canvas 2D and shared with the legend.
On phones the top bar is the whole HUD (score, time, moves, a combo chip) and the board takes the
rest of the screen; combo, water, connection and the piece legend open in a panel over the board.

**Sailing.** Falling pieces you steer and rotate into a board, clearing by forming groups and
chaining through the board's structure. Performance feeds movement tokens per turn. QoL: ghost
piece showing landing position, next-piece preview, swipe-to-move and tap-to-rotate on touch.

As built (M2): a 12 wide by 20 tall rigging; the cells are small because nothing is tapped
individually, so the whole board fits a phone screen with room to work in. Pieces are discs, not tiles, so Sailing
never reads as Bilging: conjoined pairs of two discs in three kinds (sailcloth with a canvas weave,
rope coiled in rings, sea with rolling ripples), each with an optional mark, and the two halves of
a pair stay visibly joined while both are on the board. Six platforms sit in the board at a time,
never touching. A platform is a connected shape of cells: a bar of two to four, a stack of two or
three, an L of three, or a two-by-two square; some cells are outlined round targets that want a
kind, the rest are blanks that hold anything. A platform cell has a shelf under it when no cell of
the same platform is directly beneath, so a disc rests in a bar's cells or a stack's bottom cell
and the cells above fill by falling in, while any cell can be entered from the side. When every
target on a platform holds its kind the platform clears, its target discs go, the shape is gone and
a new one is dealt elsewhere. Runs of
four or more of a kind, across or down, clear as well; crossing runs count as one group. Linked
halves fall together until one is cleared. Each step of a cascade multiplies by its chain number,
and several groups in one step multiply by their count, as in Bilging. A run of n scores
`runPoints * (n - 3)`; a platform scores `platformPoints` per target. If the rigging fills until
no pair can enter the top row, it is cleared: every disc is swept away, `topOutPenalty` points are
lost (never below zero), the combo breaks, fresh platforms are dealt and play goes on. The round
ends only after `maxMoves` pairs or when the clock runs out. Every pair enters at the middle of
the top row; the move the engine logs is the position it came to rest in (column, row, rotation),
and the engine accepts it only if that spot is reachable from the entry by sliding, turning with
the same kicks the client uses (either direction), and falling, and nothing holds the pair there. So a pair can be
steered under a platform, a vertical pair can never straddle a shelf, and a position that floats is
refused. The client's fall timer and steering are presentation: free fall takes `fallMs` a row, a
held downward swipe or holding space hurries it to `softDropMs` a row (ten times the pace), with
steering locked for the length of the swipe. There is no hard drop. A pair that comes to rest
locks after 350 ms; a slide or turn while resting restarts that timer at most three times, and
reaching a lower row restores the restarts. On the keyboard up turns the
pair clockwise and down turns it counter-clockwise; a tap turns it clockwise.
The next pair is under the player's control the moment the last one lands, while the board below
plays out its clears, each cascade step waiting for the pieces to land before the next clear; the
pair after it is previewed in a strip above the rigging on every layout. The landing ghost is a
thin ring so the target under it stays readable, and glows when the disc would fill a target of
its own kind. Sliding into a spot that rests (a shelf or a stack beneath) mid-fall sits the pair up
on it rather than letting it sink past.
Numbers live in `content/data/puzzles/sailing.json`.

**Carpentry.** Polyomino pieces offered from a queue, placed to fill holes in planking. Tighter
fills with fewer gaps score higher and feed repair output. QoL: drag-and-drop with snap and a
rotate button, valid-placement highlight, swap between offered pieces.

As built (M2): a 9 wide by 12 tall stretch of hull with up to three holes open at once. A hole is
dealt as one to three pentominoes laid edge to edge, so its area is a multiple of five and a
perfect fill exists; holes never touch. Three planks wait in a tray, each one of the twelve
pentominoes with a wood kind (cosmetic) and a grain that turns with it. A plank goes down anywhere
it covers at least one open cell of exactly one hole; cells it lays over hull or over another plank
are waste. When every cell of a hole is covered it is patched, its planks come off and a new hole
is dealt elsewhere. The patch is rated by extra planks beyond the minimum (area over five):
none is a masterpiece (which also demands no waste), one craftsmanship, two a fair job, three
sloppy work, four or more a pig's breakfast. Points are area times `basePerCell` times the
rating's multiplier, plus a quarter more when every plank's grain runs across, times the current
masterpiece streak; the streak is the combo and a lesser patch resets it. A hole left alone while
`growAfterMoves` planks go elsewhere widens by one cell, and a widened hole can no longer be a
masterpiece. The round ends after `maxMoves` planks or the clock. A round starts with no plank in
hand; the player picks one from the tray. Control is built around the
plank's centre: it sits under the pointer (lifted above a finger), and a spot that will not take it
snaps to a neighbouring one that will, so dropping near a hole is enough. A mouse carries the plank
by hovering and nails it with a click; right-click or the wheel turns it. Touch drags the plank
and sets it down by letting go over the hull, where an icon toolbar follows it (turn either way,
flip, and a hammer to nail; the ghost visibly turns over on a flip, so a symmetric plank that lands
looking the same still answers the press);
letting go or dragging off the hull sends it back to its slot, and a tap on bare hull brings it
there. Turning pivots about the
centre so the ghost stays put. The keyboard picks a slot, moves, turns either way, flips, and jumps
through the placements with the least waste. Planks drop in and knock; a patched hole's planks lift
away; new holes crack open through the planking; a hole two idle planks from widening pulses amber,
then red. Numbers live in `content/data/puzzles/carpentry.json`.

**Gunnery.** Route powder, wadding, and cannonballs through a column board into cannons in the
right order to load them. Correct loads feed cannon readiness. QoL: per-cannon load-order
indicator, highlight of which drop completes a load. Flagged for possible redesign after
playtesting.

As built (M2, redesigned over several playtests under 3.2): a 9 wide by 15 tall deck (tall, to fill
a phone held upright), drawn at random from a set of content maps at the start of each round (the
seed picks it, so replays agree). Each map has its own crates, hatches and gun rows, and the engine
refuses any map that is not fit to play: with no arrows, a piece starting anywhere must leave by a
hatch (no loop built in), the stream from the chute must leave without running into a gun, and
every gun must be reachable from the chute with at most three arrows on a route of at most 30 ticks.
The maps were found by searching for layouts that pass, then picked by hand for variety. A chute in
the top rail drops one piece at a time onto the deck, heading down the middle until crates turn it;
whatever is not steered rolls out through a hatch within a few seconds. The chute draws
from a shuffled bag (two powder, two wad, two shot, one water), shows the next three in the rail
beside it, holds back while `maxOnDeck` pieces are out, and quickens from one drop every
`spawnEveryTicks` to every `spawnEveryTicksMin` over the round. Four cannons sit in the side rails,
two a side; each takes a route of one to three arrows from the stream. Pieces roll a
cell per tick until something turns them: an arrow under a piece turns it to follow it; a wall
turns it right, else left, else back. Pieces roll together: one behind a stopped piece waits, two
after the same cell let the older go, and two meeting head on both turn back. The gunner lays as
many arrows as they like, one per plank; a loop has to be built out of them, and a new deck every
round means building it anew. A cannon takes powder, then wad, then shot; a full one fires itself
after `fireAfterTicks` (the captain's job from M4) and comes back clean, turning pieces away until
then. A wrong piece fouls a cannon and loses its load; a fouled cannon turns away everything but
water, which washes it clean; water in a clean cannon splashes harmlessly. Powder and wad score
`stepPoints`, a full load `loadPoints` plus `comboStep` for each load already in the combo, up to
`comboCap`; the combo is full loads in a row without a foul. Every gun carries a lamp that lights
when it fires; once all four are lit, the ship fires a broadside worth `broadsidePoints` and the
lamps go out, so feeding one handy gun all round leaves the biggest points on the table. Time is integer ticks of `tickMs`; every
move carries its tick, the client advances its copy once per tick for display and logs a wait now
and then so loads in flight count, and the server refuses a tick ahead of the wall clock (ADR 0015).
The round ends on the clock, `maxMoves` or `maxTick`.

Reading the deck is the point of the QoL: every piece carries a chevron for its heading. A piece
headed into a cannon shows its route as dots, green when the piece is what the cannon wants (or
water for a fouled one) and red when it will foul it, and that cannon gets a matching ring (the
"highlight of which drop completes a load" above); pieces headed anywhere else show no route. The
preview accounts for full cannons firing before the piece arrives. Each cannon
shows the piece it wants next as a badge, with powder, wad and shot pips below for its load. A
mouse hovering a plank shows a ghost arrow pointing toward the nearest edge, and every trail
redraws as if it were laid; a click commits it, the same
click again lifts it, and right-click lifts. Touch taps the same way or swipes across a plank to
point an arrow. Keyboard moves a cursor, lays with W, A, S, D and lifts with Space or Backspace.
Gunnery has its own piece art rather than the coloured tiles of the other puzzles: powder is a
charred keg with brass hoops, wad a cream bundle of sailcloth tied with twine, shot an iron
cannonball and water a wooden bucket brimming blue. Each has its own silhouette (barrel, square
bundle, ball, tapered bucket), so they read apart without colour, and the marks setting adds a
symbol badge to each. Loads pop their points, a full cannon glows and sparks, firing recoils with a muzzle flash, smoke
and a shake, fouling puffs smoke. Numbers and the deck live in `content/data/puzzles/gunnery.json`.

**Navigation.** Arrange and shift pieces to reproduce a target constellation. Completed patterns
grant token bonuses and sea battle advantages. QoL: target overlay toggle, progress meter.

As built (M2, reworked after a first pass that let a star hover until the navigator dropped it and
let it pass through stars already on the chart): a round chart of three rings and eight octants,
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
constellations charted without a booch, plus an efficiency bonus when it took at most `2n`
landings, and a new constellation is dealt, larger as the round goes on and drawing half its kinds
from stars already on the chart so strays stay useful. Three or more loose stars of one kind in a
row, around a ring or down a column, clear for `runPoints` per star beyond two; a star on its marker
is charted, not loose, and never clears this way. A star arriving while the top outer slot is taken
is a booch: the top column is swept, `boochPenalty` is lost and the chain breaks. Every move
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
constellation flashes its lines and bursts, a run clears with a popup, a booch shakes the chart.
Numbers live in `content/data/puzzles/navigation.json`.

**Sea Battle.** Square grid with rocks and wind arrows. Per-turn move token pool from Sailing
(left, forward, right). Up to four moves queued per turn. Simultaneous resolution with collision
and wind rules. Cannon fire placed left or right per move segment. Damage from hits. The captain
plays it on a landscape board. Brigand AI chooses moves from a scripted policy with difficulty
tiers. The ruleset is a pure reducer shared by server, client preview, and AI.

As built (M4, ADR 0021): a board from `content/data/puzzles/battle.json` (the seed picks one of
three: open water with a reef, the narrows, the maelstrom), 18 by 14 cells of water, rocks, winds
(`^ > v <`) and eddies (`@`), the captain starting at the bottom facing north and the brigand at
the top facing south. A turn is a plot of up to `segments` moves, each a token (left, forward,
right) or a hold, with port and starboard guns per move and a grapple flag; the board shows the
plotted path as numbered ghosts and shades the cells each plotted broadside reaches, and outlines
the brigand's reach. A turn carries the ship one cell forward and then swings her, so nothing turns
in place. The brigand plots at the same time (its mind is in the reducer, so it replays), and both
plots sail segment by segment: moves first, with a rock or an edge stopping a ship (rocks cost
`rockDamage`) and two ships bound for one cell, or one sailing into a ship that holds, stopping
both for `ramDamage`; then winds, which carry a ship one cell every segment it sits on one, and
eddies, which spin her a quarter turn clockwise; then the guns, a shot reaching `cannonRange`
cells to its side and stopping at a rock, each costing a load and dealing `shotDamage`; then the
hulls. A ship at `grappleDamage` or worse can be boarded from the cell alongside by a ship that
wants to, which ends the fight (the boarding stub); when both could, the sounder hull boards. A
wrecked hull ends it too; `maxTurns` without either and the brigand breaks off; the captain can
break off at any time. Score is `hitPoints` a hit, and `winPoints` plus `turnBonus` per turn to
spare on a win; the combo is turns in a row with a hit. Tokens are dealt every turn in practice
(`supply`) and aboard by the ship: half the turn's tokens forward, the rest split between the
turns, plus the loaded cannons and the hull. Brigand tiers differ by tokens, reloads, accuracy and
aggression (`brigand-tiers.json`): the cutpurse is slow and sloppy, the reaver closes fast, fires
true and grapples the moment it can. The harness practice page fights the content brigand with
presets per tier, per board and for faster or slower turns.

**Swordfighting.** Puyo-style falling colored pairs on each pirate's board. Groups clear; cleared
groups send breaker blocks to opponents' boards. Team mode distributes each side's attacks. QoL:
incoming-attack preview, swipe controls. Ships after the duty puzzles; the first playable pillage
resolves boarding with a stub.

### 3.4 Ship and voyage model

- **Turn clock.** The ship runs on a fixed turn, initially 10 seconds, tuned in playtests. Each
  turn: Sailing output becomes movement tokens, Gunnery output loads cannons, Bilging output lowers
  water, Carpentry output repairs damage, Navigation output grants token bonuses and sea battle
  advantages. Water and damage degrade speed. The sea battle board resolves once per turn.
- **Ownership.** Ships are owned by individual pirates. Crews are the social unit and the invite
  list. Every new pirate receives a starter sloop as a zero-cost grant through the single ship
  acquisition path (shipyard purchase). Future gating raises the grant's requirements or price via
  content config; it is never a code change.
- **Ship classes.** Sloop only in v1. Ship class is a content table.
- **Captaincy.** The owner is captain by default and can hand the wheel to anyone aboard.
  Permissions for taking a ship out without its owner are a later feature.
- **Crew size.** A pirate can sail alone. Unstaffed stations produce nothing. Brigand difficulty is
  a per-encounter tier, not scaled to crew size, in v1. The game is tuned for crews of 3 to 5.
- **Joining.** Ships at sea appear on the island notice board. Pirates can join mid-voyage and
  take a free station. The owner can set a ship to invite-only.
- **Disconnects.** A dropped pirate's station idles for a 2 minute grace period; their seat is
  held; their puzzle board is discarded, not resumed. If the captain drops, the ship holds position
  and any sea battle pauses for the same grace period, then the longest-aboard pirate is offered
  the wheel.
- **Encounters.** Brigand encounters roll per route leg with a content-defined probability. The
  captain is prompted to engage or evade. Evading always succeeds in v1. Engaging holds the ship
  in place for the fight; the stations keep producing, and what they make reaches the battle
  board every turn (M4).
- **Booty and loss.** Winning a sea battle and boarding yields currency split among everyone
  aboard, weighted by duty performance during the fight, with an extra share for the captain:
  two base shares for the captain, one for everyone else, each scaled between half and full by
  the pirate's duty points during the fight against the best aboard (ADR 0021).
  Losing yields nothing. Damage is repaired free at the next dock. No permanent loss, cargo, or
  sinking in v1.

### 3.5 World

- One ocean. Three islands on a fixed route graph. Legs take roughly 3 to 5 minutes so a full
  pillage fits in 20 to 30 minutes.
- Each island is a tiny walkable top-down space: a dock (board ship, shipyard), a tavern (chat,
  crew), and a notice board (ships recruiting, ships at sea).
- Islands, routes, brigand tiers, and ship classes are versioned JSON content files in the
  `content` package, validated against schemas at server start. Adding an island is a PR that adds
  a file. Only player-generated state lives in the database.
- AI brigands only at sea. No player-versus-player at sea in v1.

### 3.6 Persistence

Per pirate: name, per-puzzle rating, crew membership and rank, currency balance, voyage history,
owned ships. No inventory, clothing, or housing in v1.

- Currency is an append-only ledger from day one so a later economy has an auditable base.
- Ratings use Glicko-2 per puzzle. Duty puzzles are rated against performance thresholds
  calibrated from the tester pool. Swordfighting and Sea Battle are rated head to head. Players
  see display tiers only; raw numbers are hidden.

### 3.7 Social

- Text chat with three channels: ship, crew, island-local. Voice is left to Discord.
- Moderation is mute and block only.

### 3.8 Accounts and access

- Guest-first. A new visitor gets an instant random pirate name with zero friction.
- Guests can upgrade in place to a Discord or Google account. Pirate, ledger, ratings, and ships
  carry across. No email/password auth exists.
- During alpha an invite code is required to create a pirate. This is a config flag.

### 3.9 Platform

- Browser only, no install. Phones are first-class.
- Portrait for all duty puzzles. Landscape for Sea Battle and the island.
- Puzzle tiles are plain colored squares for legibility. Every piece type is also
  distinguishable without color: a player setting draws a distinct mark on each kind, and special
  tiles carry an icon and a label. Keyboard play for all puzzles on desktop. Screen-reader support for puzzle boards is out of scope.
- English only. All player-facing strings go through one message table.
- No music in v1. Minimal synthesized sound effects via WebAudio, replaced during the art pass.

### 3.10 Art

Deliberately stylish placeholder geometry until the puzzles are proven fun and the full set of
screens is known. The current intent is generated art under a strict style guide after that.

### 3.11 One experience: the shell, navigation and embedded puzzles

The game is one continuous graphical experience, not a set of pages (ADR 0018). This section is
the desired approach; the parts marked open are decided as they are built.

- **The overworld is home.** A pirate opens the game and is on the ocean chart at their island,
  the isometric diorama: islands with their buildings, sea lanes, ships at the docks and under
  way. Everything the pirate can do starts from something they can see and tap on it.
- **Islands are places on the chart.** Tapping an island moves in on it; its buildings are the
  menus. The dock boards a ship or buys one at the shipyard. The notice board lists ships
  recruiting and ships at sea. The tavern is chat and crew. Leaving a building moves back out to
  the chart. The M5 walkable island grows out of this view rather than replacing it.
- **The ship is a view inside the same scene.** Boarding moves in on the ship: the hull, the
  stations, who is at each, the bilge and the hull meters, the wheel. The chart stays visible
  around it while under way, with the ship easing along its lane between turns. The captain picks
  a destination by tapping an island on the chart.
- **Puzzles play at the station.** Taking a station opens that puzzle's board inside the ship
  view, with a slim HUD that shows the ship (bilge, hull, speed, the next turn) as well as the
  board, so a pirate pumping sees the water drop. Ending a board closes back into the ship. Sea
  Battle (M4) is the captain's board in the same place; Swordfighting (M5) opens over the ship when
  boarding happens.
- **One menu, in the scene.** Settings, sound, the accessibility marks, account linking and
  leaving a ship live in a single menu that opens over the scene and looks the same everywhere.
  No page has a different frame, header or back button.
- **Transitions are moves, not loads.** Moving in on an island, boarding, taking a station and
  opening a board animate within the scene; the pirate always knows where they are. A URL may
  deep-link to a place for sharing; opening it lands in the scene at that place.
- **Touch first, as everywhere.** Everything above is tappable at phone size; the boards keep the
  touch affordances built in M1 and M2.
- **In-world practice** (open): a tavern table where a pirate plays a duty puzzle alone, rated,
  may replace the harness as the public way to practice. Until it exists the harness is where
  testers practice and thresholds are calibrated.
- **Technical decisions**: the world is one three.js scene with the PixiJS boards opening in a
  layer over it (ADR 0020); the harness and the game share board code through `boards` (ADR 0019).

As built (M3): the world is an isometric diorama of primitives, sea shader, clouds and gulls,
filling the viewport from sign-in to sign-out. The three islands each carry the landmark their
content names (a lighthouse that sweeps, a windmill that turns, a volcano that smokes), a tavern,
a dock with a lantern and the notice board at its foot; sea lanes are dashed curves from coast to coast with a buoy at
the midpoint, so a leg's progress is progress across the water; every ship with a crew is a sloop model bobbing at a dock or easing along its lane
between turns, with a wake under way. The view is the game: it takes the screen, and the camera glides
between three kinds of focus: the island the pirate stands on (home, filling the frame), the deck
of the ship they are aboard (the hull itself filling the frame as its own little place, mast and
sea cropped away, clouds kept off it, followed along its lane; the chart is where the ship's
position in the ocean is seen), and the whole ocean (the chart, behind a map button, where islands are tapped to
look closer). Places are `/` (home), `/chart`, `/island/:id` (with `/dock`, `/tavern`,
`/notice`), `/ship`, `/ship/:station` and `/ship/helm`. The card for the place is folded to a
thin strip at the bottom of a phone (the right of a wide screen) that is the card's one header: the
place's name, where the pirate is, one line saying the obvious next thing to do (board the ship at
the dock, set sail, take a station) and, aboard, bilge, hull and turn-clock bars with their labels
and numbers; it unfolds on a tap or when a room or the helm needs it, and folds again on every move
so the view stays clear. The same actions hang on the geometry as spots: a pin at the thing with a
label beside it and a leader between (a building on its island; on the deck, each station with who
is at it and the wheel, the labels standing in two columns either side of the hull so no leader
crosses another, the wheel lit as the next thing to do when the captain can sail), so a tap in the
world or on the card does the same thing. A brigand's hail floats over the view. The dock lists
the pirate's ships here and the shipyard (every class with its price, bought with the one
acquisition path, ADR 0010); the notice board lists ships recruiting here and ships at sea, each
joinable; the tavern lists who is ashore, carries the island chat channel and shows the pirate's
standing. Boarding moves in on the deck: vitals (bilge, hull, speed, cannons), the turn clock, the
stations with who holds each and last turn's output, the crew as pegs on the deck and as a list,
the wheel (the captain picks a destination on the chart and sets sail; a hail asks them to evade),
the ship chat and the ship's log. Taking a station opens its board in a layer over the dimmed
world; the board gets the screen, with one thin bar above it (the way back, the station's name,
the board's score and clock, and the ship as labeled bilge and hull bars with the turn clock) that
unfolds on a tap into the full ship status and last turn's output, kept unfolded in a rail beside
the board on a wide screen; a station taken while docked says it is waiting for the ship to sail
and hands the captain the wheel; boards are dealt back to back while the ship is at sea, a
station standing down or the ship docking cuts the board short, and the board returns to the
deck. Docked ships tie up alongside the dock, the first on its near side and the next on its far. One menu holds sound, the
marks setting, the account and sign-out. Toasts carry what happens aboard. A software renderer gets
a lighter world; without WebGL the cards still carry every action.

**The puzzle harness** is a separate application for testing the puzzles themselves, at
`test.openseas.online` (ADR 0018, ADR 0019). One page per engine carries the practice frame as
built in M1 and M2 (start card, HUD, legend, result card, settings) around the same board the game
draws, and a bench beside it:

- **Three kinds of round.** Rated and unrated rounds are the game's own, untouched: rated through
  the server and counted, unrated local on a random seed. A *lab* round is the harness's: it runs
  locally on a chosen seed, a config made of the content config plus overrides, a chosen length
  and a clock that can be slowed, paused and stepped a tick at a time. A lab config must pass the
  same two checks the server applies to content (the wire schema and the engine's validator), so a
  lab round is always one the server could have issued.
- **Scenarios are links.** Seed, overrides, length, clock and hints live in the page's query
  string; a condition worth testing is one URL, and a page opened with `start=lab` begins at once.
  Presets name the conditions worth reaching for (specials galore, a quiet Gunnery deck, an
  eight-star constellation, a one-minute round), and a seed finder searches for an opening board
  that satisfies a probe (a keg on the board, deck 3, a comet first).
- **The inspector** shows the engine's state, its hash, what differs from content, and the move log
  with the hash after every move, exactly what a rated round sends.
- **Replay is proven, not assumed.** When a round ends the bench replays its log from the seed and
  compares every hash. A round can be copied out as JSON and pasted back on any machine (a
  `puzzle_round` row from the database works too) and stepped through on the board, forward and
  back, to the move a rejected round failed on.

It is a developer and tester tool, never linked from the game, and talks to the same server. It
is where testers practice and thresholds are calibrated until the game has in-world practice.

## 4. Architecture

Rationale lives in the ADRs. This section states what is decided.

### 4.1 Repository layout

pnpm monorepo. Packages:

| Package | Contents | Constraints |
|---|---|---|
| `engine` | Puzzle engines, ship simulation, sea battle reducer, brigand AI | Pure TypeScript. Zero runtime dependencies. Deterministic. No I/O, no timers, no randomness except from an injected seeded PRNG. |
| `protocol` | Zod schemas for every client-server message | Shared by client and server |
| `content` | World content JSON and its schemas | Validated at server start |
| `server` | Node 22, `ws`, Drizzle, Better Auth | Owns all authority |
| `boards` | What both applications render with: the PixiJS boards and their art and sound, the round runner that streams move logs, the tick clock, the server connection, the shared stylesheet (ADR 0019) | Presentation and transport only; computes nothing the server does not recompute; no pages or routes |
| `client` | The game: one graphical experience (DESIGN.md 3.11). Vite, React, three.js, the boards through `boards` | Renders; never authoritative |
| `harness` | The puzzle test harness (section 3.11): the practice frame per engine around the shared boards, plus the bench: lab rounds, scenarios, inspector, replay review | A developer and tester tool; never linked from the game; renders, never authoritative |

### 4.2 Puzzle authority: deterministic replay verification

Every puzzle board is generated from a seed the server issues. The client runs the engine locally
for instant feel and streams its move log to the server. The server replays the same engine with
the same seed and move log, derives the score, and rejects any divergence. Cheating is a replay
mismatch, not an arms race. This is why `engine` must be pure and deterministic.

### 4.3 Realtime

Node with plain `ws`. Rooms are an in-process abstraction (ship, island, swordfight). A single
server process serves the whole ocean in v1; the room abstraction is the seam for sharding later.
Messages are JSON validated by Zod schemas from `protocol`. Encoding can change behind the same
schemas.

### 4.4 Client

Two applications on the same server (ADR 0018). The game is one scene: the overworld, islands,
the ship, menus and the puzzle boards embedded in one frame (section 3.11). PixiJS v8 draws the
puzzle boards and (from M4) the sea battle; the world is an isometric three.js scene that fills
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
have to be fun or nothing else matters. Order: Bilging, Sailing, Carpentry, Gunnery, Navigation,
Sea Battle, Swordfighting. Bilging goes first because it is the simplest and stress-tests the
deterministic engine and replay pipeline on the easiest case.

The practice pages live on as the puzzle harness, a separate application (ADR 0018). A puzzle is
still proven there first, with its tester session, and only then embedded in the game.

### 5.2 Milestones

| Milestone | Definition of done |
|---|---|
| M1 | Bilging practice page live with guest accounts and ratings |
| M2 | All five duty puzzles live on practice pages |
| M3 | The one-experience shell (section 3.11): the overworld as home with in-world navigation and menus; one ship with embedded crew duty and a voyage between two islands, no combat. The practice pages move to the harness |
| M4 | Sea Battle versus AI brigands, boarding stubbed |
| M5 | Swordfighting boarding and the walkable island |
| M6 | OAuth upgrade, crews, polish pass |

Every milestone ends with a tester session and a written retro before the next starts.

M3 was restarted. A first pass built the ship, a notice board and an isometric chart as pages on
the practice-page structure (pull requests #24 and #25, closed unmerged) and felt disjointed: the
test harness with ship pages bolted on (ADR 0018). The restart kept its ship reducer, duty
binding, server rooms and chart models as parts and built the one experience around them
(section 3.11, ADR 0020): the world as home, islands and their buildings as the menus, the ship
and its stations in the scene, boards over it, chat and presence in the tavern and aboard. Its
tester session is next; the sea battle (M4) opens as the captain's board in the same place.

M4 as built: engaging a hail deals the captain a battle board bound to the ship (ADR 0021); it
opens over the deck in the station layer, the ship's turn clock sails the plot, the crew's stations
feed it, and a win pays the tier's booty through the ledger. Boarding is stubbed: a grapple that
lands ends the fight. The practice page and its presets are on the harness. Its tester session
follows M3's.

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
  lab, review and clock paths), and a smoke of the game's shell, from the chart to a board and back
  once M3 lands. The owner reviews and merges.
- Private repository through the placeholder-art phase. Open-sourcing and license are decided
  when art direction lands.

## 6. Deliberate differences from the original

Maintained as they arise.

| Area | Original | openseas | Why |
|---|---|---|---|
| Ship ownership | Individuals and crews | Individuals only in v1 | Simpler model; owner likes personal ships |
| Anti-cheat | Client-reported scores | Server replay verification | Cheap once engines are pure |
| Evading brigands | Can fail | Always succeeds in v1 | Nothing to lose yet |
| Loss consequences | Cargo and damage costs | None in v1 | No economy yet |
| Accounts | Username and password | Guest-first with OAuth upgrade | Zero first-session friction |
| Island | Large walkable towns | Dock, tavern, notice board, as spots on a diorama | Scope; the M5 walkable island grows out of this view |
| Ship at sea | Continuous movement | A turn every `turnSeconds`; each station's board points since the last turn become its output as a percentage of par | Pure engine on the server; the client eases the ship between snapshots (ADR 0020) |
| Duty boards aboard | Continuous play at a station | Boards of the practice length dealt back to back; a board cut short by docking or standing down counts but moves no standing | Rated rounds stay whole rounds; the ship still gets every point |
| Brigand encounters | A fight | Hailed in a window along the leg; the captain engages or evades, or the brigand loses interest after `hailTurns` | One hail per leg keeps a leg readable |
| Sea battle turn | Moves placed as tokens arrive, resolved on a timer | The whole plot is one `commit` move; the ship's turn clock (the practice clock in the harness) sails it as it stands | A pure engine with no clock; the log is the fight (ADR 0021) |
| Sea battle brigand | Server-side AI | A scripted policy inside the reducer, drawing on the fight's PRNG | The replay reproduces the brigand, so a fight can be reviewed and verified like any round |
| Sea battle ship size | Sloops, cutters and larger ships | Sloops only: one cell, one shot a side per move | Sloop only in v1 (3.4) |
| Sea battle winds and whirlpools | Winds push once on entry; whirlpools carry and spin | Winds carry a ship a cell every segment it sits on one; eddies spin her a quarter turn each segment | Simple rules that read on a phone grid; sitting on either is a choice |
| Sea battle ramming | Damage by size | Both ships take `ramDamage` and neither moves | Equal ships |
| Sea battle sinking | Ships do not sink against brigands | A wrecked hull ends the fight, won or lost; no ship is lost | No permanent loss (3.4) |
| Sea battle boarding | A swordfight | A grapple from alongside against a hull at `grappleDamage` or worse ends the fight at once; the sounder hull boards when both could | M5 opens Swordfighting where the stub resolves |
| Sea battle rating | Head to head | By score against content thresholds, against AI brigands | No human opponent until player-versus-player at sea (ADR 0021) |
| Sea battle tokens | Typed tokens from the sails | The ship's turn output as tokens: half forward, the rest split between the turns; Navigation adds `navTokens` | One number from the ship, split the same way every time |
| Bilging specials | Crab, pufferfish, jellyfish | Barnacle, Powder Keg, Ink Cloud | Original names (ADR 0001); same roles |
| Tile art | Illustrated pieces | Colored squares with a distinct surface texture per kind, specials with icon and label, optional marks | Owner wants clarity first; textures and marks keep kinds apart without color |
| Bilging hints | None | Idle hint in unrated practice only | Teaches newcomers; rated rounds stay unaided |
| Bilging scoring | Original's table | n(n-2) per group, times groups, times cascade step | Published formula, tuned in playtests |
| Bilging water | Driven by the ship | In practice: rises with moves, drains with points, floor of 3 rows. Aboard: the ship's bilge, injected into the move log as water events the server vouches for | Replays stay self-contained either way: the log is the whole story (ADR 0003) |
| Divergent puzzle round | n/a (client-reported) | Rejected outright, unrated, logged | Engines are deterministic; any mismatch is a bug or a cheat |
| Sailing piece control | Free fall in real time | The move is the resting position; the engine checks it is reachable from the entry by sliding, turning and falling | One move per pair keeps the log small while steering under platforms stays possible (ADR 0015) |
| Sailing platforms | Targets on fixed structures | Platforms are shapes (bars, stacks, L's, squares) with outlined targets and blanks; shelves sit under their bottom cells; a cleared one is dealt again elsewhere | Same role, original layouts; shapes make tucking and stacking matter |
| Sailing scoring | Original's table | Run of n scores `runPoints * (n - 3)`, platform scores `platformPoints` per target, times groups, times chain step | Published formula, tuned in playtests |
| Sailing top-out | Board full ends the board | The rigging is cleared for `topOutPenalty` points and play continues to the clock | A filled board should cost, not stop, a two-minute practice round |
| Timed puzzle rounds | Real-time simulation | Integer ticks carried in every move; the server rejects ticks ahead of the wall clock | Keeps engines pure and replayable (ADR 0015) |
| Carpentry holes | Grow in real time when unattended | Dealt as unions of pentominoes; widen by one cell after `growAfterMoves` planks placed elsewhere | Move-driven growth keeps the engine pure; pentomino unions guarantee a masterpiece is possible |
| Carpentry patched hole | Planking stays visible | Planks come off and the hull is free again; a new hole is dealt | Keeps a practice round busy on a small board |
| Carpentry scoring | Original's table | Area times `basePerCell` times a rating multiplier, grain bonus, times masterpiece streak | Published formula, tuned in playtests |
| Gunnery firing | The captain fires loaded cannons in sea battle | On the Gunnery board a loaded cannon fires itself after `fireAfterTicks` and comes back clean, for the gunner's score; the ship keeps a count of loaded cannons from Gunnery output, and in a sea battle the captain fires those | The board stays a whole puzzle of its own; the captain still decides when the ship's guns speak (ADR 0021) |
| Gunnery broadside | The captain decides when and which guns fire | Every gun fired since the last broadside scores `broadsidePoints` | Playtest: nothing rewarded loading more than the nearest gun; a broadside also sets up what the captain wants from gunners in M4 |
| Gunnery supply | Pieces come into play around the board | One chute drops a previewed, bag-shuffled stream down the middle; unsteered pieces roll overboard | Playtest found random spawns unreadable; a single stream makes every arrow a clear decision |
| Gunnery collisions | Pieces bounce off each other | Pieces queue behind each other; only head-on meetings turn both back | Bouncing made routes impossible to predict |
| Gunnery fouled cannon | Takes pieces and wastes them | Turns everything but water away | A foul costs the load and the combo; it should not also eat the next pieces |
| Gunnery route preview | None | A piece headed into a cannon shows its route, green or red for what it will do there | Makes a busy deck readable; routes for every piece were noise in playtest |
| Gunnery deck | One board | A random pick from content maps each round, each checked for no built-in loop and every gun in reach | Playtest: on one board, players found the loop and worked off it all round; a new board keeps them reading routes |
| Gunnery arrows | Limited | No limit, one per plank | Playtest: the cap made routing around the crates a chore; the move log is still bounded by `maxMoves` |
| Gunnery time | Continuous rolling | One cell per tick of `tickMs`, carried in the move log | Pure engine; the client interpolates between ticks (ADR 0015) |
| Gunnery water | Cleans fired or misloaded cannons | Cleans a fouled cannon; splashes harmlessly in a clean one | Firing no longer fouls, so water is only for fouls |
| Navigation time | Stars fall in real time | One star in the sky at a time, falling `fallTicks` to `fallTicksMin` on the engine clock, carried in the move log | Pure engine; the server can tell a stalled star from a quick one (ADR 0015) |
| Navigation entry | Stars fall into the top of the chart | Same: the top octant; a tap or enter brings the star down early | A fixed entry keeps the mental model stable: bring the right spot to the top |
| Navigation landing | A star stops against the first star it meets; stars slide inward when the ring under them opens | Same; the outer slot taken means no room | Columns stay packed, so turning an inner ring moves the rings outside it too |
| Navigation booch | Turns the ship around | Sweeps the top column, costs `boochPenalty`, breaks the chain | No ship yet; the sweep keeps the chart playable (as Sailing's top-out costs rather than stops) |
| Navigation runs | Rows of a kind clear | Three or more loose stars of a kind around a ring or down a column clear for `runPoints * (n - 2)`; stars on markers never do | Gives strays an outlet; charted stars must stay safe from it |
| Navigation constellations | Fixed progression | Size grows with completions; half the kinds are drawn from stars already on the chart | Keeps stray stars useful on a small chart |
| Navigation scoring | Original's table | `n * n * starPoints`, times chain, plus an efficiency bonus within `2n` landings | Published formula, tuned in playtests |
| Navigation hints | None | After a pause in unrated practice, chevrons on the ring to turn | Teaches newcomers, as in Bilging; rated rounds stay unaided |
