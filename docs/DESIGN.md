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
replay needs nothing else; from M3 the ship injects water events into the log instead. Below the
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

As built (M2): a round chart of three rings and eight octants. Stars come in three shapes (spark,
star, comet) and three colors, so shape alone tells kinds apart; marks add the color's symbol. The
constellation is a set of hollow markers fixed to the chart, each wanting a kind in a slot. Stars
arrive one at a time at an octant the deal chooses; the navigator turns any ring a step either way
(stars ride with their ring, markers stay put) and then lets the star fall to the innermost empty
slot of its octant. A marker is filled while a matching star sits on it, and a turn can fill one as
well as a drop. When every marker is filled the constellation is charted: those stars go, points
are `n * n * starPoints` times the chain of constellations charted without a booch, plus an
efficiency bonus when it took at most `2n` drops, and a new constellation is dealt, larger as the
round goes on and drawing half its kinds from stars already on the chart so strays stay useful.
Dropping into a full octant is a booch: that octant is swept clear, `boochPenalty` is lost and the
chain breaks. Turns are logged but free; the round ends after `maxDrops` drops or the clock. Touch
drags or taps a ring to turn it and taps the star or the center to drop; keyboard picks a ring
with up and down, turns with left and right, drops with enter. A toggle hides the markers for
players who want to chart from memory; a meter shows filled markers. Numbers live in
`content/data/puzzles/navigation.json`.

**Sea Battle.** Square grid with rocks and wind arrows. Per-turn move token pool from Sailing
(left, forward, right). Up to four moves queued per turn. Simultaneous resolution with collision
and wind rules. Cannon fire placed left or right per move segment. Damage from hits. The captain
plays it on a landscape board. Brigand AI chooses moves from a scripted policy with difficulty
tiers. The ruleset is a pure reducer shared by server, client preview, and AI.

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
  captain is prompted to engage or evade. Evading always succeeds in v1.
- **Booty and loss.** Winning a sea battle and boarding yields currency split among everyone
  aboard, weighted by duty performance during the fight, with an extra share for the captain.
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
| `client` | Vite, React, PixiJS v8 | Renders; never authoritative |

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

PixiJS v8 for every game surface (puzzle boards, sea battle, island). React with Vite for UI
(menus, chat, panels, lobbies, settings) overlaid on the canvas.

### 4.5 Data

Postgres via Drizzle ORM with generated migrations. Better Auth with its anonymous plugin for
guests and account linking to Discord and Google.

### 4.6 Hosting and operations

- Server and Postgres on Railway, deployed from `main`.
- Client as a static build on Vercel, deployed from `main`.
- Merging is releasing. After CI is green on `main`, one Actions pipeline deploys the server to
  Railway, waits for it to be healthy on the new commit, then deploys the client to Vercel
  (ADR 0014, `docs/DEPLOY.md`).
- Every pull request that touches the client gets a Vercel preview on the production project,
  built and deployed from CI (ADR 0016).
- Structured logs via pino. Sentry for client and server errors. A Postgres event table for
  gameplay analytics (puzzle starts and completions, voyage outcomes). No third-party analytics.

## 5. Process

### 5.1 Build order

Puzzles first, each playable solo on a practice page before the next starts, because the puzzles
have to be fun or nothing else matters. Order: Bilging, Sailing, Carpentry, Gunnery, Navigation,
Sea Battle, Swordfighting. Bilging goes first because it is the simplest and stress-tests the
deterministic engine and replay pipeline on the easiest case.

### 5.2 Milestones

| Milestone | Definition of done |
|---|---|
| M1 | Bilging practice page live with guest accounts and ratings |
| M2 | All five duty puzzles live on practice pages |
| M3 | One ship with real-time crew duty and a voyage between two islands, no combat |
| M4 | Sea Battle versus AI brigands, boarding stubbed |
| M5 | Swordfighting boarding and the walkable island |
| M6 | OAuth upgrade, crews, polish pass |

Every milestone ends with a tester session and a written retro before the next starts.

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
- Claude works on branches and opens PRs. CI on GitHub Actions runs typecheck, Vitest, and a
  Playwright smoke test. The owner reviews and merges.
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
| Island | Large walkable towns | Dock, tavern, notice board | Scope |
| Bilging specials | Crab, pufferfish, jellyfish | Barnacle, Powder Keg, Ink Cloud | Original names (ADR 0001); same roles |
| Tile art | Illustrated pieces | Colored squares with a distinct surface texture per kind, specials with icon and label, optional marks | Owner wants clarity first; textures and marks keep kinds apart without color |
| Bilging hints | None | Idle hint in unrated practice only | Teaches newcomers; rated rounds stay unaided |
| Bilging scoring | Original's table | n(n-2) per group, times groups, times cascade step | Published formula, tuned in playtests |
| Bilging water in practice | Driven by the ship | Rises with moves, drains with points, floor of 3 rows | No ship exists until M3; keeps replays self-contained |
| Divergent puzzle round | n/a (client-reported) | Rejected outright, unrated, logged | Engines are deterministic; any mismatch is a bug or a cheat |
| Sailing piece control | Free fall in real time | The move is the resting position; the engine checks it is reachable from the entry by sliding, turning and falling | One move per pair keeps the log small while steering under platforms stays possible (ADR 0015) |
| Sailing platforms | Targets on fixed structures | Platforms are shapes (bars, stacks, L's, squares) with outlined targets and blanks; shelves sit under their bottom cells; a cleared one is dealt again elsewhere | Same role, original layouts; shapes make tucking and stacking matter |
| Sailing scoring | Original's table | Run of n scores `runPoints * (n - 3)`, platform scores `platformPoints` per target, times groups, times chain step | Published formula, tuned in playtests |
| Sailing top-out | Board full ends the board | The rigging is cleared for `topOutPenalty` points and play continues to the clock | A filled board should cost, not stop, a two-minute practice round |
| Timed puzzle rounds | Real-time simulation | Integer ticks carried in every move; the server rejects ticks ahead of the wall clock | Keeps engines pure and replayable (ADR 0015) |
| Carpentry holes | Grow in real time when unattended | Dealt as unions of pentominoes; widen by one cell after `growAfterMoves` planks placed elsewhere | Move-driven growth keeps the engine pure; pentomino unions guarantee a masterpiece is possible |
| Carpentry patched hole | Planking stays visible | Planks come off and the hull is free again; a new hole is dealt | Keeps a practice round busy on a small board |
| Carpentry scoring | Original's table | Area times `basePerCell` times a rating multiplier, grain bonus, times masterpiece streak | Published formula, tuned in playtests |
| Gunnery firing | The captain fires loaded cannons in sea battle | A loaded cannon fires itself after `fireAfterTicks` and comes back clean | No ship until M3; a load should feel like a reward, not leave a mess |
| Gunnery broadside | The captain decides when and which guns fire | Every gun fired since the last broadside scores `broadsidePoints` | Playtest: nothing rewarded loading more than the nearest gun; a broadside also sets up what the captain wants from gunners in M4 |
| Gunnery supply | Pieces come into play around the board | One chute drops a previewed, bag-shuffled stream down the middle; unsteered pieces roll overboard | Playtest found random spawns unreadable; a single stream makes every arrow a clear decision |
| Gunnery collisions | Pieces bounce off each other | Pieces queue behind each other; only head-on meetings turn both back | Bouncing made routes impossible to predict |
| Gunnery fouled cannon | Takes pieces and wastes them | Turns everything but water away | A foul costs the load and the combo; it should not also eat the next pieces |
| Gunnery route preview | None | A piece headed into a cannon shows its route, green or red for what it will do there | Makes a busy deck readable; routes for every piece were noise in playtest |
| Gunnery deck | One board | A random pick from content maps each round, each checked for no built-in loop and every gun in reach | Playtest: on one board, players found the loop and worked off it all round; a new board keeps them reading routes |
| Gunnery arrows | Limited | No limit, one per plank | Playtest: the cap made routing around the crates a chore; the move log is still bounded by `maxMoves` |
| Gunnery time | Continuous rolling | One cell per tick of `tickMs`, carried in the move log | Pure engine; the client interpolates between ticks (ADR 0015) |
| Gunnery water | Cleans fired or misloaded cannons | Cleans a fouled cannon; splashes harmlessly in a clean one | Firing no longer fouls, so water is only for fouls |
| Navigation booch | Turns the ship around | Sweeps the full octant, costs `boochPenalty`, breaks the chain | No ship yet; the sweep keeps the chart playable |
| Navigation constellations | Fixed progression | Size grows with completions; half the kinds are drawn from stars already on the chart | Keeps stray stars useful on a small chart |
| Navigation scoring | Original's table | `n * n * starPoints`, times chain, plus an efficiency bonus within `2n` drops | Published formula, tuned in playtests |
