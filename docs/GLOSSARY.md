# Glossary

The game's words, and the words they replaced. ADR 0034 moved the game from the sea to space in M7
(DESIGN.md 5.2). Every table pairs a former word with the word that replaces it and, where code
carries it, the identifier.

- **During M7** this is the spec the rename and words PRs work from. ADR 0034 records the
  vocabulary settled when the plan was made. Everything else here was drafted for the owner's
  review in the PR that added this file, and is accepted when that PR merges.
- **After M7** the "Former" columns stay, so ADRs 0001 to 0033, the git history and old PRs, which
  are written in nautical words, stay readable. History is never rewritten into the new words.
- **Changing a word** later is a PR to this file first, and then to the code and strings.

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
5. **Piece names are placeholders** until the owner's sprite pass, named for what they are on the
   board. The sprite pass may rename them here.
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

"Double!", "Triple!" and the streak callouts stay.

### Engines (formerly Sailing)

| Former | Now | Identifier |
|---|---|---|
| rigging | drive core | `rigging` → `core` |
| disc | fuel pellet | `disc` → `pellet` |
| platform, "Platform!", platforms cleared | injector, "Injector!", injectors fired | `platform` → `injector`; `platformPoints` → `injectorPoints` |
| top-out, "Rigging fouled" | flameout, "Flameout!" | `topOut` → `flameout`; `topOutPenalty` → `flameoutPenalty` |
| Sailcloth, Rope, Sea, Salt | Plasma, Ion, Fusion, Nova | `canvas`, `rope`, `sea`, `salt` → `plasma`, `ion`, `fusion`, `nova` |

### Plating (formerly Carpentry)

| Former | Now | Identifier |
|---|---|---|
| hole, holes patched, "A hole widened" | breach, breaches sealed, "A breach widened" | `hole` → `breach` |
| plank | plate | `plank` → `plate` |
| nail, hammer | weld, welder | `nail` → `weld` |
| grain, "With the grain!" | brushing, "Brushed true!" | `grain` → `brush` |
| oak, teak, pine, mahogany | tin, copper, steel, brass | `oak`, `teak`, `pine`, `mahogany` → `tin`, `copper`, `steel`, `brass` |
| Masterpiece, masterpiece streak | Flawless, flawless streak | `masterpiece` → `flawless` |
| Craftsmanship | Solid work | `craftsmanship` → `solid` |
| A fair job | It'll hold | `fair` → `holds` |
| Sloppy work | Duct tape | `sloppy` → `tape` |
| A pig's breakfast | Chewing gum and hope | `pig` → `gum` |

### Gunnery

| Former | Now | Identifier |
|---|---|---|
| cannon | turret | `cannon` → `turret` |
| powder, wad, shot, water | cell, sabot, slug, coolant | `powder`, `wad`, `shot`, `water` → `cell`, `sabot`, `slug`, `coolant` |
| fouled, "Fouled!" | jammed, "Jammed!" | `foul` → `jam` |
| chute | feeder | `chute` → `feeder` |

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
| "They're over the rail!" | "They're through the airlock!" | |
| open water with a reef, the narrows, the maelstrom | an open rock field, the Narrows, the Whirl | |

### Swordfighting

| Former | Now | Identifier |
|---|---|---|
| wrack | scrap | `wrack` → `scrap`; `wrackMatchPermille` → `scrapMatchPermille` |
| cutlass, sabre, dirk | plasma cutlass, arc sabre, vibro-dirk | ids stay `cutlass`, `sabre`, `dirk` |
| Sea, Kelp (block colors) | Cobalt, Lime | `sea` → `cobalt`; `kelp` → `lime` |
| at the rail, "To the rail" | at the airlock, "To the airlock" | |

## The ship

| Former | Now | Identifier |
|---|---|---|
| sloop | skiff | `sloop` → `skiff` |
| bilge (the meter) | heat | `waterIntakePerTurn` → `heatIntakePerTurn`; `waterIntakeAtFullDamage` → `heatIntakeAtFullDamage`; `pumpPerTurn` → `ventPerTurn`; `waterSlow` → `heatSlow` |
| sails (speed) | drive | `sailSpeed` → `driveSpeed` |
| cannons (the meter, the class) | turrets | `cannons` → `turrets` |
| wheel, "At the wheel", "Hand over the wheel" | helm, "At the helm", "Hand over the helm" | `wheel` → `helm` |
| set sail | launch | `setSail` → `launch` |
| at sea | out in the black (under way stays) | `atSea` → `inFlight` |
| ashore, go ashore | on the outpost, disembark | `ashore` → `onOutpost` |
| "lost overboard" | "drifted off" | |
| "Land ho!", made port | "Touchdown!", docked | |
| quarterdeck | bridge | |
| fife rail at the mast | drive console | |
| the pump (port side) | heat sinks | |
| carpenter's bench | patch bay | |
| guns run out at the rails | turrets | |
| gangway port | airlock | |
| gangplank | boarding tube | |
| mast; flag at the masthead | antenna mast; flag on the antenna | |
| mainsail, with the crew emblem | tail fin, with the crew emblem | |
| wake | engine glow | |
| — | canopy (clear, drawn only zoomed out) | |

### Bots (formerly deckhands)

| Former | Now | Identifier |
|---|---|---|
| deckhand, mate, ship's hand | bot | `mate` → `bot`; `mateOutput` → `botOutput`; `mateStations` → `botStations`; `mateRestTurns` → `botRestTurns` |
| signed on | booted up | |
| paid off | powered down | |
| smock, kerchief and a coil of rope | a small round robot with one lamp eye and a tool arm | |
| names from the pirate lists | a bot name and a unit number: Gasket-7 | |

Bot names: Sprocket, Widget, Gizmo, Gasket, Dynamo, Flange, Piston, Tinker, Doohickey, Whirligig,
Spindle, Grommet.

## The outposts

| Former | Now |
|---|---|
| the sea, the sea shader | the void: a starfield and a nebula |
| clouds | drifting dust |
| gulls | drones |
| the beach ring, sloping under the sea | the crater rim, dropping into the void |
| golden grass, black sand | ochre regolith, black dust |
| shipwright's (the dock's room) | shipyard |
| tavern (`tavern` → `cantina`) | cantina |
| well | water tank |
| fruit stall | noodle stall |
| cottages, vegetable patches | hab pods, hydroponic beds |
| palms | antenna palms |
| a boat drawn up | a shuttle up on blocks |
| a net on its rack, a heap of net drying | a solar sail on its rack, coils of cable |
| driftwood | space junk |
| a fire ring with logs | a heater ring |
| shells and crabs | rock mites |
| a buoy at a lane's midpoint | a nav buoy |

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
| captain's plume | captain's crest | `plume` → `crest` |

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
- **Ship rules**: the keys of `outputCapPercent` follow the puzzle ids. Every key not listed above
  stays (`turnSeconds`, `wearPerTurn`, `repairPerTurn`, `loadPerTurn`, `navTokens`, ...).
- **Database**: every table is emptied, sign-ins included (ADR 0034). With nothing to keep,
  columns and stored values take their new names directly (`voyage.route_id` → `lane_id`, the
  ledger's `booty` kind → `plunder`, the look's `coat` and `hat` → `jacket` and `headgear`), and no
  data is mapped.
- **Kept for now**: `openseas`, the package scope `@openseas/*`, the domains and the hosting
  projects keep their names until the game's real name is chosen.
