# openseas — Design Document

`openseas` is a working codename. The real name is decided when art direction lands.

This document records every product and architecture decision made before the first line of
code. It is the source of truth for scope. When code and this document disagree, fix one of them
in the same PR. Rationale for the major technical choices lives in [`adr/`](./adr/).

**The setting moved from the sea to space** in milestone M7 (5.2, ADR 0034), and this document
describes the space game throughout. Only history still shows the sea: it keeps its own words (ADRs 0001 to
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

Eight puzzles of the game's own design are prototypes on the harness (3.12, ADR 0036). None is in
v1, and none has a role in the game until it is chosen for one.

### 3.2 Default stance on rules

Rule-faithful scoring and mechanics, with modern feedback, onboarding, and input affordances
layered on top. Redesign only when a puzzle is demonstrably broken in playtesting, decided case by
case. Gunnery is the puzzle most likely to invoke this clause.

### 3.3 Puzzle designs

Each puzzle below lists its faithful core and the quality-of-life additions agreed for v1. No duty
puzzle has undo. How each was built, how it scores and how it is played is in its design file in
[`puzzles/`](./puzzles/README.md), one file a puzzle, which changes in the same commit as its rules or
numbers.

**Cooling.** A 6 wide by 12 tall board of pieces. Swap two horizontally adjacent pieces. Matches of
3 or more clear; the pieces below rise and new pieces enter from the bottom. Combos and
multi-clears score higher. The heat line rises as
the ship runs hot. Special pieces (equivalents of the original's crab, pufferfish, and
jellyfish, renamed) ship in v1 because they define the skill ceiling. QoL: match preview on hover
or touch-hold, a combo meter, tap-then-tap or drag-swap on touch; on desktop a click swaps the
hovered pair outright.

Design as built: [`puzzles/cooling.md`](./puzzles/cooling.md).

**Engines.** Falling pieces you steer and rotate into a board, clearing by forming groups and
chaining through the board's structure. Performance feeds movement tokens per turn. QoL: ghost
piece showing landing position, next-piece preview, swipe-to-move and tap-to-rotate on touch.

Design as built: [`puzzles/engines.md`](./puzzles/engines.md).

**Plating.** Polyomino pieces offered from a queue, placed to seal breaches in the hull plating. Tighter
fills with fewer gaps score higher and feed repair output. QoL: drag-and-drop with snap and a
rotate button, valid-placement highlight, swap between offered pieces.

Design as built: [`puzzles/plating.md`](./puzzles/plating.md).

**Gunnery.** Route cells, sabots and slugs through a column board into turrets in the
right order to load them. Correct loads feed turret readiness. QoL: per-turret load-order
indicator, highlight of which drop completes a load. Flagged for possible redesign after
playtesting.

Design as built: [`puzzles/gunnery.md`](./puzzles/gunnery.md).

**Navigation.** Arrange and shift pieces to reproduce a target constellation. Completed patterns
grant token bonuses and space battle advantages. QoL: target overlay toggle, progress meter.

Design as built: [`puzzles/navigation.md`](./puzzles/navigation.md).

**Space Battle.** Square grid with asteroids and solar current arrows. Per-turn move token pool from Engines
(left, forward, right). Up to four moves queued per turn. Simultaneous resolution with collision
and current rules. Turret fire placed left or right per move segment. Damage from hits. The captain
plays it on a landscape board. Raider AI chooses moves from a scripted policy with difficulty
tiers. The ruleset is a pure reducer shared by server, client preview, and AI.

Design as built: [`puzzles/battle.md`](./puzzles/battle.md).

**Swordfighting.** Puyo-style falling colored pairs on each pirate's board. Groups clear; cleared
groups send breaker blocks to opponents' boards. Team mode distributes each side's attacks. QoL:
incoming-attack preview, swipe controls. Ships after the duty puzzles; the first playable pillage
resolves boarding with a stub.

Design as built: [`puzzles/swordfight.md`](./puzzles/swordfight.md).

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
  see display tiers only; raw numbers are hidden. There are five (ADR 0039), each an
  adjective so it reads in a sentence ("a Sharp round"): Green, Steady, Sharp, Masterful and
  Legendary.
- Standing is earned in the game only (ADR 0028): the captain's space battle, a melee board and a
  duty board that ran its full clock move it; a harness round never does. Every scored round also
  carries its own performance rating, its score read off the line through the thresholds, with the
  tier that falls in. It is stored with the round and leads every result card, above the score,
  never fed into standing.
- A score means nothing from one puzzle to the next, so every board's HUD also shows the tier
  being played at right now (ADR 0039): the points of the last `paceSeconds` of the round (content,
  per puzzle; longer where a puzzle scores in lumps) read as a whole round at that pace. It is five
  rising pips and the tier's name, on the harness and at every station, the captain's board and the
  melee. It is display only.

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
- No music in v1. Sound effects via WebAudio, voiced for space. A cue plays the puzzle's own
  generated sample where the owner has picked one (ADR 0041), and otherwise its minimal synthesized
  voice: a metal click for a quiet swap, steam for venting, an arc and a clank for a weld, a servo
  for lifting plates and tearing metal for a breach. The synthesized cues stay as the fallback.

### 3.10 Art

The seven puzzle boards use original generated 2D sprite atlases (ADR 0031): dark outlines,
restrained shading and distinct silhouettes, read at phone scale. Assets live in `boards`, so the
game and harness render the same pieces. The atlases and their frames carry the space names, and since
the owner's sprite pass the art inside is space too: Cooling uses machine parts, Engines keeps
round riveted discs, Plating uses four brushed metals with engine-defined footprints and grain,
Navigation keeps its three star silhouettes, Swordfighting keeps square armour blocks, and Space
Battle uses overhead starfighters, asteroids and gravity wells. The boards around them match: every frame
is riveted gunmetal with cream trim and orange hazard paint from one shared module
(`boards/src/hull.ts`), Cooling's heat glows, Engines' shelves are lit metal ledges, Plating's hull
is riveted panels whose breaches open onto stars, Gunnery's deck is steel plate with vents to
space, and Space Battle's chart is deep space with nebulae and solar currents. Optional marks stay code-drawn; geometry, hit areas and scores stay in
code. Arbitrarily sized Swordfight slabs, extra lab colors, board backgrounds, targets and effects
retain procedural drawing. When an atlas cannot load, every piece falls back to a vector version of
its sprite from one shared module (`boards/src/parts.ts`), in the same contours and silhouettes, so
play never waits on an image; Engines' extra lab kind always uses it. The world is not sprites at all: it is drawn in code from primitives (3.11), and it was
redrawn for space in M7. A frame is redrawn or added alone from a brief kept in `boards/briefs`,
through the OpenAI Images API, and sounds are made the same way through ElevenLabs; the owner picks
every take that lands (ADR 0040), and a board plays its picked sounds (ADR 0041).

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

**The puzzle studio** is a separate application for testing and tuning the puzzles themselves, at
`test.openseas.online` (ADR 0018, ADR 0019, ADR 0042). It began as the puzzle harness, a bench of
lab rounds, an inspector and log review around each practice page; M9 is turning it into the studio
that section 3.14 describes, and the bench's tools are gone. What stands today:

- **One page a puzzle**, the game's seven and the prototypes alike, around the same board the game
  draws: the board in the middle with its HUD, start card and result card, and the tuning panel
  beside it (3.14). On a phone the page is the puzzle alone.
- **Every round is local.** It runs in the browser on a seed and a set of numbers, and nothing is
  sent to the game's server: no round here is recorded or rated. Each result leads with the round's
  tier, and the HUD shows the tier being played at (3.6).
- **A draft is a link.** Seed, config overrides, length, pace and thresholds live in the page's
  query string. The numbers must pass the checks the server applies to content (the wire schema
  and the engine's validator), so a round is always one the server could have issued.
- **Replay is proven, not assumed.** When a round ends the page replays its log from the seed and
  compares every hash, and says so only when they differ.
- **`/play/<puzzle>`** is the puzzle with nothing around it, on the numbers its link carries: what
  a tester is sent.

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

### 3.12 Prototype puzzles

Eight new puzzles are built to be played and judged before any of them is given a place in the game
(ADR 0036). They are the game's own: each takes the original's feel (a verb learned in a minute, a
round that is never the same twice, a score that pays planned compound moves far more than lucky
ones) and none ports one of the original's puzzles. Each puzzle's rules, scoring and tuning notes
are in [`prototypes/`](./prototypes/README.md), one file a puzzle, kept true as it is tuned.

| Puzzle | The verb | The compound move it pays for |
|---|---|---|
| Salvage | Drag a tether through touching debris of one kind | Close the line into a net and haul every crate adrift at once |
| Overload | Tap a capacitor to charge it | Prime the bank so one tap bursts across it |
| Deflectors | Flip mirrors | One layout that sends a whole volley of beams home, each the long way round |
| Reactor | Swipe the whole core | Hot rods stacked at one port and sent out together as a salvo |
| Scanner | Ping the fog | A sector cleared under par with no contact pinged and no wrong lock |
| Tug | Flick a pod in zero gravity | A delivery at par, using another pod as the stop |
| Racks | Move the top of a stack | Racks shipped on back-to-back actions, the crate called down as a link |
| Cutting | Slice a slab along its grid | The slab's exact best taken with too few cuts for everything |

What holds for all eight:

- **Whole engines, dealt on the harness only.** Each is a pure engine in the registry with its wire
  schemas, content file and thresholds, so the server could replay and score a round as it does
  any other. Since M9 the studio sends it none (ADR 0042): a prototype is held to replay by its
  property tests and the studio's replay check. None is a station: no par, no place aboard, no standing (ADR 0028). The harness
  home page lists them apart from the game's puzzles.
- **A round is 120 seconds** on the clock, scored against thresholds set from bots playing the
  engine. They are guesses until testers have played.
- **Sprites over a code-drawn fallback** (ADR 0037). Boards are built from a shared kit. Each
  draws the owner's sprites from its own atlas, and falls back to vector pieces drawn in code (one
  silhouette and one color a kind) when the atlas is missing or a lab config goes past the sheet.
  The mark setting's pips and numerals are always drawn in code (rule 6).
- **Each owns its files**, so a puzzle is promoted or dropped without touching the others.
- **Promotion is its own decision:** a role in the game, an ADR, a milestone.

### 3.13 Puzzle guides

A separate site (ADR 0038, `packages/docs`) with one guide per puzzle, the game's seven and the
eight prototypes alike. It is where a player learns a puzzle properly; the start card in the game
stays a few lines.

- **One shape for every guide.** What the puzzle is in the world and what it does for the ship,
  the rules a first round needs, the controls for touch and for mouse and keys, how it scores,
  then **getting good**: four rungs (beginner, intermediate, advanced, expert), each a goal, two
  to four tips and one thing to practise, and last the common mistakes. One rung shows at a time.
  A guide is one sitting; a test holds each to a budget.
- **True by construction where it can be.** Numbers are read from `content`, never typed.
  Screenshots and clips are captured from the real boards by a script that plays lab rounds on
  the harness, on seeds it finds with the engine, so a picture shows a position the game deals and
  a move it allows. A guide's strategy is prose and is re-read when its puzzle's rules change.
- **Prototypes are marked as prototypes**, and their guides say what the puzzle is trying out
  instead of what it does for the ship, since none has a role yet (3.12).
- **Not linked yet.** The site stands alone. Where the game points a player at a guide (a station's
  start card, the result card) is decided when it is wanted.

### 3.14 The puzzle studio

Planned, and built as milestone M9 (5.2, ADR 0042). The harness becomes a studio: an application
for tuning one puzzle at a time, at `test.openseas.online`, for the owner. Until its steps land,
the harness is as sections 3.11 and 4.1 describe it. The voyage bench is not part of the studio and
stays at `/voyage` as it is.

**Built so far.** The package is renamed. Each puzzle plays alone at `/play/<puzzle>`: the board
full-screen with one bar of HUD, a start and a result card, and a details sheet with the seed,
restart, a new seed and each changed value beside the shipped one. The link's query string is the
overlay (`seed`, `seconds`, `c.<path>`, `pace`, `thresholds`); the tier shown, live and on the
result, is read against the link's own thresholds. The page signs in to nothing and sends nothing.
It holds the numbers to the server's checks and deals nothing when they fail, and it replays every
round from its seed and speaks only when the replay disagrees. The smoke plays every board there,
and the guides' capture takes its pictures there.

Each puzzle's own path is its studio page: that same column in the middle, and the tuning panel
beside it as **Tuning** below describes, built from the content file and the wire schema with no
code a puzzle. The seed is pinned, replayed or dealt afresh; a changed number deals the same seed
again unless that is pinned off; the compare button holds the shipped numbers up; a refused number
says why on its own control; a dot puts one number back and a button all of them; and a button
copies the draft's `/play` link, which is how a tuned round is shared until tester links by id
exist. The draft lives in the address bar. The bench is gone: the inspector, round files and their
review, the clock's controls, the seed finder, and recorded and unrated rounds. The studio asks
nothing of the game's server. Still to come in the shell: the home grid, and `studio-server` with
tester links by id.

The studio follows the puzzles skill (`.claude/skills/puzzles/SKILL.md`), which is also what its
agent reads:

| The skill asks | The studio answers with |
|---|---|
| Numbers live in content (rule 18) | The tuning panel is built from the puzzle's content file and bounded by its wire schema |
| Thresholds and a live pace (rules 16, 17) | `thresholds` and `paceSeconds` are controls, tuned by hand with the HUD's tier in view |
| Reads without color (rule 22) | The sprite panel previews every frame with the marks setting on and off |
| Its own sprites and sounds, the owner picking every take (rule 23) | The asset panels show each frame's and cue's takes, and a pick is one tap |
| Every string in the message table (rule 24) | The agent is held to it, and so is the studio itself |
| Three homes kept in step (rule 25) | Save runs the changed-puzzle checklist before the pull request is ready |
| Report every bar item as met or broken | The pull request's body is that report |

**Who and where.** The owner signs in with GitHub. Tester links are public. The studio is laid out
for a desktop: the board in the middle at a phone's proportions, tuning and assets to one side,
the chat to the other. On a phone there is no studio, only play.

**Home.** A grid of all fifteen puzzles, the game's and the prototypes treated alike, each with a
live thumbnail and a mark for an open draft or pull request. Each puzzle keeps its path
(`/cooling`, `/salvage`), and the old query string (`seed`, `c.<path>`) still opens a tuned round.

**Tuning.**

- A control for every key under `config`, for `roundSeconds`, for each threshold and for
  `paceSeconds`: a slider for a range, a stepper for a small whole number, a curve for a list.
  Each shows its key as the content file spells it, one line of description kept beside the wire
  schema (`.describe()` on the key in `protocol`), and a unit read from the name (permille,
  percent, points, moves). A small file a puzzle groups them into the same five sections (board,
  deal, pace, scoring, limits), and the round's length, pace and thresholds make a sixth. A key
  that is none of a number, a list of numbers, a switch or a choice (a deck's layout, a fight's
  line-up) is edited as its JSON. The old lab presets are named starting points.
- A change restarts the round on the same seed once the hand stops, unless that is pinned off.
  Holding the compare button deals the same seed with the shipped values. A seed can be pinned,
  replayed or dealt afresh.
- A config the server would refuse does not run, and the control that caused it says why. Every
  round is replayed when it ends; a mark appears only if the hashes differ.
- A changed control carries a dot that puts it back.
- Sizes and limits fixed in an engine's code are not controls. They are asked for in the chat.

**Sprites and sounds.**

- The sprite panel lists every frame in the puzzle's atlas; the sound panel every cue its board
  plays. A row shows the current pick and the takes kept for it. Sprites show at board size.
  Sounds play on a tap, and the synthesized cue is listed as a pick (ADR 0041).
- A pick changes the running board at once.
- Each row has two buttons that write the start of a chat message: new takes of this, and change
  this. New takes are made by the agent through the sprite and sound skills, from the brief, and
  appear in the row.
- Takes are kept in object storage across drafts. Only a pick is committed.

**The chat.**

- An agent session on the draft's own copy of the repository, with `CLAUDE.md` and the three
  puzzle skills loaded. Sonnet 5.5 unless Haiku 5.5 or Opus 5.5 is picked, changeable between
  messages.
- It knows the draft's numbers and picks and how the last few rounds went (seed, score, tier,
  length, moves), so "that felt too easy" has something behind it. It reads a whole move log only
  when asked about a round.
- Asked for a number, it moves the control. Asked for more, it edits the puzzle's files, and the
  board switches to a build of the draft, with a mark saying so.
- It is held to the open puzzle's files. For anything else it asks, and the owner allows that
  path with a click.
- Its replies are shown whole, its work as one line a step that opens to the diff or the output.
  There is a stop button, and a message sent while it works steers it. The draft's cost so far
  sits by the model picker, against a cap.

**Drafts and reset.** One draft a puzzle, kept by the studio service so it follows the owner from
machine to machine: numbers, picks, code changes, chat. Four ways back: one control to its
shipped value; all numbers and picks cleared; one chat turn's edits reverted; the draft discarded
after a confirmation.

**Save.**

1. A tester link, at once.
2. The numbers written into the content file and the picks placed, committed, pushed, and a draft
   pull request opened in the studio's name with the owner credited.
3. The agent works the skill's checklist (design file, guide, capture, strings) and marks the
   pull request ready.

Later Saves add to the same pull request until it is merged or closed, and then the draft clears.
If `main` has moved, the studio says so and offers to update the draft.

**Tester links.** `/play/<id>` is the puzzle full-screen: no sign-in, restart, a new seed, and a
details sheet with the draft's name, who made it and each changed value beside the shipped one. A
link is a frozen copy and does not expire. The puzzle's studio page lists its links and can
withdraw one. A link the current build would refuse says so and deals nothing. A draft that
changes code is shared from its pull request's preview once that has deployed.

**What is gone.** The inspector, round files and their review, the stepping clock, and rounds
recorded through the server from this site. The guides' capture still holds a round's clock and
steps it a tick at a time (3.13), through a handle the page gives a script
(`window.openseasRoundClock`) and no control on screen.

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
| `studio` | The puzzle studio (sections 3.11 and 3.14), once the harness: a page a puzzle with the shared board and the tuning panel built from content and the wire schema; each puzzle alone at `/play/<puzzle>` on the numbers its link carries; every round local and replayed from its seed; and the voyage bench for the ship and crew | A developer and tester tool; never linked from the game; renders, never authoritative |

| `docs` | The puzzle guides (section 3.13, ADR 0038): one page per puzzle from first round to expert play, the capture files that take its pictures from the harness, and those pictures | A static site: no server, no boards. Reads `content` for every number; types none |

In M9 the harness becomes the studio (3.14, ADR 0042): `harness` has been renamed `studio`, and a
`studio-server` package will hold the service its chat, Save and tester links run on. The table above
says what is built today.

Prototype puzzles (3.12, ADR 0036) live in the same packages, each in files of its own: an engine
folder, a protocol file, a content file and message file, a board folder built on `boards/src/kit`,
and a harness page. `docs/prototypes/README.md` lists them.

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
- Client as a static build on Vercel, deployed from `main`. The harness and the puzzle guides are
  static builds on Vercel too, each its own project (ADR 0019, ADR 0038).
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
| M8 | Prototype puzzles (3.12, ADR 0036): eight new puzzles of the game's own, each a whole engine playable on the harness, in the owner's sprites (ADR 0037). Done when the owner has played all eight and chosen which, if any, go on |
| M9 | The puzzle studio (3.14, ADR 0042), in three steps, each usable alone. **The shell:** the harness renamed and redrawn, the tuning panel, seed control, the validity and replay guards, tester links on a first studio service, the smoke driving every board through its studio page and `/play`, the guides' capture repointed, the bench tools removed. **Chat and Save:** the agent on a worktree with a live build of it, the model picker, per-turn revert, reset, Save and the pull request from a GitHub App. **Assets:** takes in object storage, the sprite and sound panels, new takes through the chat |

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

What M7 leaves for later: the tester sessions and retros; and the codename. No mechanic
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
  Playwright smoke tests: the studio's per-puzzle smoke (which drives every board on `/play`, each
  puzzle's studio page and its tuning panel, and the voyage bench), a smoke of the game's shell, from the chart to a board and back
  once M3 lands, and a smoke of the puzzle guides (every guide renders and its pictures load). The owner reviews and merges.
- Private repository through the placeholder-art phase. Open-sourcing and license are decided
  when art direction lands.

## 6. Deliberate differences from the original

Maintained as they arise.

| Area | Original | openseas | Why |
|---|---|---|---|
| Setting | Pirates on the sea | Space pirates in one star system: asteroid outposts joined by lanes, a skiff, raiders, plunder paid in credits. Every mechanic is unchanged | The owner's choice of look and feel; it also puts the game further from the original (ADR 0034) |
| New puzzles | None of these | Eight prototypes on the harness (3.12): Salvage, Overload, Deflectors, Reactor, Scanner, Tug, Racks, Cutting. None is a port of an original puzzle | The owner wants puzzles that are the game's own; they are tried on the harness before any gets a role (ADR 0036) |
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
