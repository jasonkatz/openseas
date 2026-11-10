# Glossary

The game's words, and the words they replaced. ADR 0034 moved the game from the sea to space in M7
(DESIGN.md 5.2). Every table pairs a former word with the word that replaces it and, where code
carries it, the identifier.

- **M7 is built.** This was the spec its rename, words and world PRs worked from, and each of them
  added here whatever it had to choose (naming rule 6). The game, the code and the three.js world
  now use the "Now" columns throughout; only the puzzle boards' art still shows the sea.
- **The world was redrawn once more after M7** (ADR 0035), so that nothing in it keeps the outline
  of the sea thing it replaced. The ship and the outposts tables below say what stands there now.
  Where M7 had put something else in between, the row says so.
- **The "Former" columns stay**, so ADRs 0001 to 0033, the git history and old PRs, which are
  written in nautical words, stay readable. History is never rewritten into the new words.
- **Changing a word** is a PR to this file first, and then to the code and strings.

## Naming rules

1. **Rename only what belongs to the sea or the age of sail.** A word that works as well in space
   stays: ship, crew, captain, commodore, officer, voyage, deck, hull, dock, shipyard, notice
   board, port and starboard, broadside, grapple, melee, slab, breaker, ripen, constellation,
   marker. Fewer renames make a smaller, safer diff.
2. **Identifiers follow the player-facing word.** Content ids and file names are kebab-case, code is
   camelCase and the database is snake_case. Puzzle ids are the puzzle's name in one lowercase
   word.
3. **Nothing from Puzzle Pirates** (CLAUDE.md rule 3). New words also avoid terms other well-known
   games and shows coined (no "Reavers", no "Star Wolf").
4. **Rule 6 still holds.** Every kind, look, emblem and figure reads apart without color.
5. **Piece names follow the art.** The owner's sprite pass drew each piece as what it is named, so
   the names stand. New art that draws a piece as something else renames it here.
6. **Anything not listed** follows these rules. The PR that renames it adds it here.

## The setting

| Former | Now | Identifier |
|---|---|---|
| the ocean | the Lantern Reach, a star system | `ocean.json` → `star-system.json`; `startIslandId` → `startOutpostId` |
| island | outpost | `island` → `outpost`; `islands.json` → `outposts.json`; `/island/:id` → `/outpost/:id` |
| route, sea lane | lane | `route` → `lane`; `routes.json` → `lanes.json`; `routeId` → `laneId` |
| Saltwick, under its lighthouse | Tinwick, under its beacon tower | `saltwick` → `tinwick` |
| Gullhaven, under its windmill | Echo Rock, under its radar dish | `gullhaven` → `echo-rock` |
| Ember Reef, around its volcano | Frostvent, around its ice geyser | `emberreef` → `frostvent` |
| lighthouse (sweeps) | beacon tower (sweeps) | `lighthouse` → `beacon` |
| windmill (turns) | radar dish (turns) | `windmill` → `dish` |
| volcano (smokes) | ice geyser (vents) | `volcano` → `geyser` |

Outpost blurbs:

- **Tinwick**: "A tin-roofed outpost under a beacon tower, with a dry sense of humour. Every pirate
  starts here."
- **Echo Rock**: "A listening post under a turning dish, all signal and gossip. The cantinas pour
  late."
- **Frostvent**: "An ice geyser ringed by black dust. Raiders favour the lanes around it."

## Puzzles and stations

| Former puzzle | Now | Puzzle id | Former station | Station now |
|---|---|---|---|---|
| Bilging | Cooling | `bilging` → `cooling` | Bilge pump | Heat sinks |
| Sailing | Engines | `sailing` → `engines` | Sails | Drive |
| Carpentry | Plating | `carpentry` → `plating` | Carpentry | Patch bay |
| Gunnery | Gunnery | `gunnery` | Guns | Turrets |
| Navigation | Navigation | `navigation` | Chart table | Nav console |
| Sea Battle | Space Battle | `battle` | The wheel | The helm |
| Swordfighting | Swordfighting | `swordfight` | The rail | The airlock |

Station blurbs:

- **Heat sinks**: "Keep her cool and the ship stays quick."
- **Drive**: "Feed the drive and the ship makes way."
- **Patch bay**: "Seal the hull before the vacuum gets in."
- **Turrets**: "Load the turrets for the fight to come."
- **Nav console**: "Read the stars for a faster passage."

## Puzzle words

### Cooling (formerly Bilging)

| Former | Now | Identifier |
|---|---|---|
| the bilge, bilge water | the ship's heat | `water` → `heat`; `shipWater` → `shipHeat`; the `water` move → `heat` |
| water line | heat line | `minWaterRow` → `minHeatRow` |
| underwater (swaps slowly) | overheated | `underwaterSwapMs` → `overheatSwapMs` |
| pump, rows pumped | vent, rows vented | `pumped` → `vented` |
| "Bilge rising" | "Running hot" | |
| Barnacle (tile label RISE) | Slag (RISE) | `barnacle` → `slag` |
| Powder Keg (KEG) | Spark Charge (ZAP) | `keg` → `charge` |
| Ink Cloud (INK) | Magnet (MAG) | `ink` → `magnet` |
| "Full broadside!" (four groups at once) | "Supernova!" | |
| Cog, Shell, Anchor, Plank, Pearl, Kelp, Coral | Cog, Valve, Bolt, Fuse, Crystal, Coil, Chip | `cog`, `valve`, `bolt`, `fuse`, `crystal`, `coil`, `chip` |

| "Pump!" (the round's start) | "Vent!" | |
| floats up (pieces rising to fill a gap) | rises | |

"Double!", "Triple!" and the streak callouts stay.

### Engines (formerly Sailing)

| Former | Now | Identifier |
|---|---|---|
| rigging | drive core | `rigging` → `core` |
| disc | fuel pellet | `disc` → `pellet` |
| platform, "Platform!", platforms cleared | injector, "Injector!", injectors fired | `platform` → `injector`; `platformPoints` → `injectorPoints` |
| top-out, "Rigging fouled" | flameout, "Flameout!" | `topOut` → `flameout`; `topOutPenalty` → `flameoutPenalty` |
| Sailcloth, Rope, Sea, Salt | Plasma, Ion, Fusion, Nova | `canvas`, `rope`, `sea`, `salt` → `plasma`, `ion`, `fusion`, `nova` |
| "Haul away!" (the round's start) | "Ignition!" | |
| platforms cleared, a platform clears | injectors fired, an injector fires | |
| the planks a disc rests on | an injector's shelves | |

### Plating (formerly Carpentry)

| Former | Now | Identifier |
|---|---|---|
| hole, holes patched, "A hole widened" | breach, breaches sealed, "A breach widened" | `hole` → `breach`; `patched` → `sealed` |
| plank | plate | `plank` → `plate` |
| nail, hammer | weld, welder | `nail` → `weld`; `hammer` → `welder` |
| wood (what a plank is made of) | metal | `wood` → `metal` (`plating.metal.<id>`) |
| grain, "With the grain!" | brushing, "Brushed true!" | `grain` → `brush` |
| oak, teak, pine, mahogany | tin, copper, steel, brass | `oak`, `teak`, `pine`, `mahogany` → `tin`, `copper`, `steel`, `brass` |
| Masterpiece, masterpiece streak | Flawless, flawless streak | `masterpiece` → `flawless` |
| Craftsmanship | Solid work | `craftsmanship` → `solid` |
| A fair job | It'll hold | `fair` → `holds` |
| Sloppy work | Duct tape | `sloppy` → `tape` |
| A pig's breakfast | Chewing gum and hope | `pig` → `gum` |
| "Planks up!" (the round's start) | "Plates up!" | |
| patch, patched (a hole) | seal, sealed (a breach) | |

### Gunnery

| Former | Now | Identifier |
|---|---|---|
| cannon | turret | `cannon` → `turret` |
| powder, wad, shot, water | cell, sabot, slug, coolant | `powder`, `wad`, `shot`, `water` → `cell`, `sabot`, `slug`, `coolant` |
| fouled, "Fouled!" | jammed, "Jammed!" | `foul` → `jam` |
| chute | feeder | `chute` → `feeder` |
| gun, guns (on the Gunnery board) | turret, turrets | |
| plank (a cell of the deck an arrow is laid on) | deck tile | |
| washes clean, "Clean" | flushes clear, "Clear" | |
| "Run out the guns!" (the round's start) | "Turrets hot!" | |

The crates, hatches, arrows, lamps, broadside and the deck all keep their names.

### Navigation

| Former | Now | Identifier |
|---|---|---|
| chart (the board) | star chart | |
| booch, headings lost | lost heading, headings lost | `booch` → `lostHeading`; `boochPenalty` → `lostHeadingPenalty` |

The sparks, stars, comets, rings, markers, constellations and the gold, ice and ember colors all stay.

### Space Battle (formerly Sea Battle)

| Former | Now | Identifier |
|---|---|---|
| water (an open cell) | open space | `water` → `space` |
| rock, "Rocks!" | asteroid, "Asteroid!" | `rock` → `asteroid`; `rockDamage` → `asteroidDamage` |
| wind, "Blown off course" | solar current, "Caught a current" | `wind` → `current` |
| eddy | gravity well | `eddy` → `well` |
| "Splash" (a miss) | "Wide!" | |
| cannonball (a shot in flight) | slug | `cannonball` → `slug` |
| "Sail the plot" | "Fly the plot" | `battle.sail_now` → `battle.fly_now` |
| "Sails in {seconds}s" | "Flies in {seconds}s" | |
| guns (a ship's, on the battle board) | turrets | |
| the message key for "Caught a current" | | `battle.blown` → `battle.carried` |
| "They're over the rail!" | "They're through the airlock!" | |
| open water with a reef, the narrows, the maelstrom | an open rock field, the Narrows, the Whirl | |

### Swordfighting

| Former | Now | Identifier |
|---|---|---|
| wrack | scrap | `wrack` → `scrap`; `wrackMatchPermille` → `scrapMatchPermille` |
| cutlass, sabre, dirk | plasma cutlass, arc sabre, vibro-dirk | ids stay `cutlass`, `sabre`, `dirk` |
| Sea, Kelp (block colors) | Cobalt, Lime | `sea` → `cobalt`; `kelp` → `lime` |
| at the rail, "To the rail" | at the airlock, "To the airlock" | `wasAtRail` → `wasAtAirlock` |
| grey stone (what wrack is) | dead metal | |
| "Mate {n}" (an ally's board) | "Crewmate {n}" | |
| "Drawing steel...", "Steel out" | "Drawing blades...", "Blades out" | |

## The ship

| Former | Now | Identifier |
|---|---|---|
| sloop | skiff | `sloop` → `skiff` |
| bilge (the meter) | heat | `waterIntakePerTurn` → `heatIntakePerTurn`; `waterIntakeAtFullDamage` → `heatIntakeAtFullDamage`; `pumpPerTurn` → `ventPerTurn`; `waterSlow` → `heatSlow` |
| sails (speed) | drive | `sailSpeed` → `driveSpeed`; `atSails` → `atDrive` |
| cannons (the meter, the class) | turrets | `cannons` → `turrets` |
| wheel, "At the wheel", "Hand over the wheel" | helm, "At the helm", "Hand over the helm" | `wheel` → `helm` |
| set sail | launch | `setSail` → `launch`; the `sail` move and `ship.sail` message → `launch`; the `sailed` event → `launched` |
| sail, sailing (a ship travelling) | fly, flying | `sailVoyage` → `flyVoyage`; `phase_sailing` → `phase_flying`; `ship.sail_minutes` → `ship.flight_minutes` |
| at sea | out in the black; "in flight" where a label needs it short ("Join in flight", "In flight") | `atSea` → `inFlight` |
| ashore, go ashore | on the outpost, disembark | `ashore` → `onOutpost` (`on-outpost` as a kind); go ashore → `disembark` |
| "lost overboard" | "drifted off" | |
| "Land ho!", made port | "Touchdown!", docked | |
| voyages to port, reach port | voyages flown, complete a voyage | |
| "Step ashore", "Rowing you ashore..." (the landing) | "Touch down", "Shuttling you down..." | |
| "Rowing out to the ship..." (connecting) | "Shuttling up to the ship..." | |
| "Hoisting the sails..." (loading) | "Warming up the drive..." | |
| "The ocean is out of reach" | "The Lantern Reach is out of range" | |
| harbormaster | dockmaster | |
| "Slow down, sailor." | "Slow down, spacer." | |
| the message key for a station waiting on the launch | | `ship.duty_waits_for_sea` → `ship.duty_waits_for_launch` |
| quarterdeck, aft | bridge, forward, two steps up under the canopy | |
| fife rail at the mast | drive console at the drive core, aft | |
| the pump (port side) | heat sinks | |
| carpenter's bench | patch bay | |
| guns run out at the rails | turrets, a ball in each wall with its barrels outside | |
| gangway port | airlock | `gangway` → `airlock` |
| gangplank | boarding tube | `gangplank` → `boardingTube` |
| the open deck and its rails | one long room inside a closed hull: the walls stand where the rails did | `deck.ts`, `skiffDeck` |
| mast; flag at the masthead | gone (M7: an antenna mast with the flag on it). The crew's flag is painted on each slope of the roof | `flags` |
| mainsail, with the crew emblem | tail fin on the roof aft, with the crew emblem | `fin` |
| sails going to glass on deck | the roof, the canopy and the side wall nearest the camera not drawn aboard, the far wall left standing as the room's back (M7: a canopy hidden on deck, the tail fin going to glass) | `cutaway` |
| wake | engine glow | `wake` → `engineGlow` |
| bowsprit and figurehead | nose cone and probe | |
| rudder | two engine bells in the stern | |
| stern lanterns | running lights: red to port, green to starboard | |
| shot rack, barrels | slug rack, canisters | |
| rigging | gone (M7: stays from the antenna mast) | |
| the keel | skids under the belly | |
| the hull bobbing on the swell | the hull drifting | |

### Bots (formerly deckhands)

| Former | Now | Identifier |
|---|---|---|
| deckhand, mate, ship's hand | bot | `mate` → `bot`; `mateOutput` → `botOutput`; `mateStations` → `botStations`; `mateRestTurns` → `botRestTurns`; ids `mate:<n>` → `bot:<n>` |
| signed on | booted up | the `hired` event → `booted_up` |
| paid off | powered down | the `paid_off` event → `powered_down` |
| smock, kerchief and a coil of rope | a small round robot with one lamp eye and a tool arm | |
| names from the pirate lists | a bot name and a unit number: Gasket-7 | `names.json` `bots`; `randomBotName`; the number is 1 to 99 |
| the deckhand's figure | a ball of a body on one wheel, a band of paint, one lamp eye, an aerial, a tool arm | `buildBot` |

Bot names: Sprocket, Widget, Gizmo, Gasket, Dynamo, Flange, Piston, Tinker, Doohickey, Whirligig,
Spindle, Grommet.

## The outposts

ADR 0035 redrew these. Where the "Now" column is not what M7 first drew, M7's version is given in
brackets.

| Former | Now |
|---|---|
| the sea, the sea shader | the void: a starfield and a nebula |
| clouds | drifting dust |
| gulls | drones |
| the island's rise | a flat floor of regolith, pocked with craters |
| the beach ring, sloping under the sea | a raised crater rim, darker than the floor, dropping sheer into the void and cut through where the dock comes in (M7: a ring of pale dust) |
| golden grass, black sand | burnt-ochre regolith in a rim of rust; frozen ground in a rim of black rock |
| lighthouse | beacon tower: a lattice mast with a gallery round its lamp (M7: a banded tin tower) |
| windmill | radar dish, turning on a column over a squat drum of a station |
| the pier of planks, with bollards | the dock: an arm run out over the void, a box girder with a deck on it, a gate at its root and clamps at the berths (M7: a gantry of deck plates) |
| pilings under the dock | struts back to the rock and a lift pod under its end |
| a ladder down to the water, a rowing boat under the dock | gone |
| crates, barrels and a coil of rope on the dock | cargo boxes, a drum and a power cell |
| the lantern at the dock's end | a beacon that blinks |
| shipwright's (the dock's room) | shipyard: a flat-roofed workshop with a shutter, a hull in frame under its crane |
| tavern (`tavern` → `cantina`) | cantina |
| the paved plaza | the pad: a round deck of plates with a ring painted on it |
| well | holo-globe: a chart of the Reach turning over the pad (M7: a water tank) |
| footpaths with cobbles | walkways of plate, a stud of light either side |
| fruit stall | noodle stall |
| cottages, vegetable patches | hab pods, grow tunnels |
| palms | light masts, dishes and solar panels round the rim (M7: antenna palms) |
| round trees, pines | the outpost's plant on the floor: tanks, cargo and vent stacks; stands of crystal (M7: potted trees) |
| a boat drawn up | a shuttle up on blocks |
| a net on its rack, a heap of net drying | a solar sail on its rack, coils of cable |
| driftwood | space junk |
| a fire ring with logs | a telescope on its tripod, a crate to sit on (M7: a heater ring) |
| shells and crabs | survey rovers, trundling along the rim (M7: rock mites) |
| a buoy at a lane's midpoint | a nav buoy |
| tufts, flowers and bushes on the grass | pebbles, glints of crystal and boulders on the floor |
| dune grass on the sand | gone (M7: mineral needles in the dust) |
| fields of grain by the windmill | solar panels by the dish |
| a model ship over the shipwright's door, timber stacked beside it | a little rocket over the shipyard's door, hull plates stacked beside it |
| the tavern's timber frame, gabled roof and chimney smoke | the cantina's ribbed panels, barrel roof of tin, round ports and vent stack steam |
| the flag on its pole that marks where you are on the chart | a brass diamond turning over a pylon |
| — | warning lamps along the rim's lip |
| — | the rock's underside, hanging below the rim |

Code names the world PRs chose, for scenery the tables above had no identifier for: the sea →
`void.ts` and `buildVoid`; clouds → `buildDust`; gulls → `buildDrone`; coast → rim (`rimR`,
`RIM_R`); quarterdeck → bridge (`BRIDGE_X`, `BRIDGE_Y`); cottages → pods; the shipwright's stall →
the yard; crabs → rovers; palm → `lightMast`, `dishPost` and `solarStand`; round tree →
`tankCluster`, `cargoStack` and `ventStack`; pine → `crystalSpire`; the well → the globe; the
plaza → the pad (still `plaza` in the layout code); chimney smoke → steam.

## People

### Pirates and their looks

| Former | Now | Identifier |
|---|---|---|
| coat | jacket | `coat` → `jacket`; `coats` → `jackets`; color ids stay |
| hat | headgear | `hat` → `headgear`; `hats` → `headgear` |
| tricorne | bubble helmet | `tricorne` → `bubble-helmet` |
| bicorne | goggles | `bicorne` → `goggles` |
| wide brim | wide brim | `wide-brim` |
| round cap | flight cap | `round-cap` → `flight-cap` |
| stocking cap | beanie | `stocking-cap` → `beanie` |
| captain's plume | captain's crest: a brass band and a red blade standing fore and aft | `plume` → `crest` |
| a coat flaring at the hem, with a belt and buckle | a short jacket with a stand collar, a waistband and a zip | |

How each headgear is drawn, on deck and on the likeness: the bubble helmet is a clear globe on a
collar ring; goggles are pushed up on the forehead over spiked hair; the wide brim is as it was;
the flight cap is leather with a flap over each ear and fleece across the brow; the beanie is a
knitted dome with a rolled brim and a bobble.

### Crews

| Former | Now | Identifier |
|---|---|---|
| sailor (rank) | spacer | `sailor` → `spacer` |
| Deep sea, Kelp (colors) | Deep space, Moss | `deep` stays; `kelp` → `moss` |
| anchor, compass rose, kraken, gull, ship's wheel (emblems) | rocket, ringed planet, satellite, crescent moon, gear | `anchor`, `compass`, `kraken`, `gull`, `wheel` → `rocket`, `planet`, `satellite`, `moon`, `gear` |

The skull, star, crossed swords, crown and flame emblems and every pattern (heraldic) stay.

### Raiders (formerly brigands)

| Former | Now | Identifier |
|---|---|---|
| brigand | raider | `brigand` → `raider`; `brigand-tiers.json` → `raider-tiers.json` |
| Cutpurse | Junker | `cutpurse` → `junker` |
| Marauder | Marauder | `marauder` |
| Reaver | Corsair | `reaver` → `corsair` |

### Money

| Former | Now | Identifier |
|---|---|---|
| coins | credits | `coins` → `credits` |
| booty | plunder | `booty` → `plunder` (the ledger kind, the title requirement and the tiers' purse) |

### Standing tiers

| Former | Now | Identifier |
|---|---|---|
| Seaworthy | Spaceworthy | `seaworthy` → `spaceworthy` |

Greenhorn, Steady, Sharp, Expert, Elite and Legend stay.

### Titles

| Former | Now | Identifier |
|---|---|---|
| Landlubber | Dirtsider | `landlubber` → `dirtsider` |
| Wave Rider | Lane Rider | `wave-rider` → `lane-rider` |
| Sea Dog | Void Hound | `sea-dog` → `void-hound` |
| Old Salt | Old Stardust | `old-salt` → `old-stardust` |
| Skipper | Skipper | `skipper` |
| Wheelmaster | Helmmaster | `wheelmaster` → `helmmaster` |
| Rail Fighter | Boarder | `rail-fighter` → `boarder` |
| Brigand's Bane | Raiders' Bane | `brigands-bane` → `raiders-bane` |
| Terror of the Lanes | Terror of the Lanes | `terror-of-the-lanes` |
| Plunderer | Plunderer | `plunderer` |
| Hoard Keeper | Hoard Keeper | `hoard-keeper` |
| Pumpmaster (Bilging) | Coolhand (Cooling) | `pumpmaster` → `coolhand` |
| Sailmaster (Sailing) | Drive Chief (Engines) | `sailmaster` → `drive-chief` |
| Shipwright (Carpentry) | Hullsmith (Plating) | `shipwright` → `hullsmith` |
| Master Gunner | Master Gunner | `master-gunner` |
| Stargazer | Stargazer | `stargazer` |
| Sea Wolf (Sea Battle) | Ace (Space Battle) | `sea-wolf` → `ace` |
| Blademaster | Blademaster | `blademaster` |

## Random names

A pirate's name and a ship's name ("The {adjective} {noun}") draw from `names.json`.

- **Adjectives**: Salty, Brackish, Windward, Leeward, Barnacled, Sunburnt and Soggy become Static,
  Fizzy, Orbital, Lunar, Dented, Starburnt and Frosty. The other 25 stay.
- **Nouns**: every noun is replaced: Comet, Spanner, Nebula, Quasar, Tadpole, Rivet, Asteroid,
  Lantern, Compass, Thruster, Pickle, Biscuit, Antenna, Booster, Nozzle, Wrench, Ration, Noodle,
  Flare, Orbit, Parsec, Crater, Pulsar, Bolt, Magnet, Meteor, Satellite, Rocket, Moth, Moonbeam,
  Starling, Gecko.

## Code, content and database

The tables above give the identifier for each word. Beyond them:

- **Folders and files**: each renamed puzzle's folders and files move with its id. That covers
  `engine/src/bilging` → `engine/src/cooling`, the boards and harness pages,
  `content/data/puzzles/bilging.json` → `cooling.json`, and the same for Sailing and Carpentry.
  The harness routes move with them.
- **Message keys** move with their prefix or id:
  - `bilging.`, `sailing.`, `carpentry.` → `cooling.`, `engines.`, `plating.`
  - `island.` → `outpost.`
  - `brigand.` → `raider.`
  - `pirate.coat.`, `pirate.hat.` → `pirate.jacket.`, `pirate.headgear.`
  - `ship.mate` → `ship.bot`
  - title, tier and emblem keys follow their ids
  - placeholders in a message follow the variable they name (`{island}` → `{outpost}`,
    `{brigand}` → `{raider}`, `{coins}` → `{credits}`, ...); the text around them waits for the
    words PR
- **Ship rules**: the keys of `outputCapPercent` follow the puzzle ids. Every key not listed above
  stays (`turnSeconds`, `wearPerTurn`, `repairPerTurn`, `loadPerTurn`, `navTokens`, ...).
- **Database**: every table is emptied, sign-ins included (ADR 0034). With nothing to keep,
  columns and stored values take their new names directly (`voyage.route_id` → `lane_id`, the
  ledger's `booty` kind → `plunder`, the look's `coat` and `hat` → `jacket` and `headgear`), and no
  data is mapped.
- **Sprites**: each atlas is named by its puzzle id (`cooling.webp`, ...) and each frame by the
  piece's identifier (`bolt`, `turret-jammed`, `tin-h`, ...), and since the owner's sprite pass
  each frame looks like the piece it names.
- **Tests**: where a test's `mate` was a second pirate rather than a deckhand, it is `crewmate`.
  Fixtures use names the game could deal ("Static Comet", "Gasket-7", "The Rust Comets").
- **Harness presets**: the message key is the preset's id (`harness.preset.one_injector`,
  `no_injectors`, `single_plates`, `big_breaches`, `one_breach`, `five_plates`, `no_coolant`), and a
  test holds every preset to one. `harness.voyage.to_port` → `to_end`; `harness.voyage.helm` (who
  plots the battle) → `battle_plots`.
- **Kept on purpose**:
  - Three puzzle engines' PRNG salts keep their old strings (`bilging:`, `sailing:` and
    `carpentry:` in each `reduce.ts`). A new salt would deal a different board from the same
    seed, and the rename changes no behaviour.
  - Content `texture` keys (`knurl`, `weave`, `facet`, ...) keep their names: they are data keys,
    never shown, and each now picks a space part (`knurl` → the cog) in `boards/src/parts.ts`.
  - `SHIP_SINK` keeps its name: how far the hull hangs below the lane plane, so the deck meets the
    boarding tube.
- **Kept for now**: `openseas`, the package scope `@openseas/*`, the domains and the hosting
  projects keep their names until the game's real name is chosen.

## Prototype puzzles

Eight puzzles with no former word: they are new (DESIGN.md 3.12, ADR 0036), on the harness only.
Their words follow the naming rules above. Each puzzle's own words (its pieces, its callouts) are in
its design file under `docs/prototypes/` and its message file under
`content/data/messages/prototypes/`; the sprite pass may rename them if the puzzle is kept.

| Puzzle | Puzzle id | What the player does |
|---|---|---|
| Salvage | `salvage` | Tethers a line of debris and hauls it; a closed line is a net that brings in every crate |
| Overload | `overload` | Charges capacitors with taps; a full one bursts into its neighbours |
| Deflectors | `deflectors` | Flips mirrors so each beam leaves by its own exit port |
| Reactor | `reactor` | Swipes fuel rods together to fuse them and pushes hot rods out through ports |
| Scanner | `scanner` | Pings a fogged sector and locks the contacts the pings give away |
| Tug | `tug` | Flicks cargo pods, which slide until stopped, onto the lit clamp |
| Racks | `racks` | Sorts fuel cells between racks and ships a rack of one kind |
| Cutting | `cutting` | Cuts a slab of salvage into pieces and banks the ones that hold one ore |

Words shared by all of them: a **prototype** is one of these puzzles; the **kit** is the shared
board code they are drawn with (`boards/src/kit`), which every board runs through (ADR 0040); a
**kind** is one of the kit's eight placeholder pieces (`gold`, `ice`, `ember`, `moss`, `violet`,
`amber`, `bone`, `rose`), each a silhouette and a color.

