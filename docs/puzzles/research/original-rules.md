# Puzzle Pirates duty-puzzle rules: research notes (mechanics only)

Collected 2026-10-31 for a checklist check. These are facts about mechanics, written in our own words.
Nothing here is wiki text to copy.

## Method and big caveat

- Direct page fetches **failed**: `yppedia.puzzlepirates.com` and `puzzlepirates.fandom.com` do not
  resolve from this cloud session, so they would need to be allowed in the session's network settings.
  Every claim below therefore comes from **WebSearch result extracts** of those pages, plus a few forum
  and blog pages. Those extracts are summaries of the pages, not the pages themselves.
- YPPedia and the Fandom wiki share a lot of text, so a claim "on both" is weaker than two independent
  sources would be. I still count it as two sources, but treat it with that in mind.
- Confidence tags:
  - **[C]** confirmed by 2 or more sources
  - **[1]** one source
  - **[I]** inferred, or from my background knowledge and not verified this session

Main URLs (shortened in the claims below):
- YS = https://yppedia.puzzlepirates.com/Sailing
- YOS = https://yppedia.puzzlepirates.com/Official:Sailing
- FS = https://puzzlepirates.fandom.com/wiki/Sailing , FOS = https://puzzlepirates.fandom.com/wiki/Official:Sailing
- SFT = https://forums.puzzlepirates.com/community/mvnforum/viewthread?thread=1089 (Sailing Puzzle Tips)
- YC = https://yppedia.puzzlepirates.com/Carpentry , YOC = https://yppedia.puzzlepirates.com/Official:Carpentry ,
  YOCT = https://yppedia.puzzlepirates.com/Official:Carpentry_tablet , YCT = https://yppedia.puzzlepirates.com/Carpentry_tutorial , FC = https://puzzlepirates.fandom.com/wiki/Carpentry
- YOG = https://yppedia.puzzlepirates.com/Official:Gunnery , YG = https://yppedia.puzzlepirates.com/Gunnery ,
  FG = https://puzzlepirates.fandom.com/wiki/Gunnery , GWM = http://yppedia.puzzlepirates.com/Gunnery_Water_Method
- YON = https://yppedia.puzzlepirates.com/Official:Navigation , YONT = https://yppedia.puzzlepirates.com/Official:Navigation_tablet ,
  YNT = https://yppedia.puzzlepirates.com/Duty_navigation_tutorial , YN = https://yppedia.puzzlepirates.com/Navigation , FN = https://puzzlepirates.fandom.com/wiki/Navigation
- YSF = https://yppedia.puzzlepirates.com/Swordfight , YOSF = https://yppedia.puzzlepirates.com/Official:Swordfighting ,
  YDP = https://yppedia.puzzlepirates.com/Swordfighting_drop_pattern , FSF = https://puzzlepirates.fandom.com/wiki/Swordfight ,
  SFS = http://forums.puzzlepirates.com/community/mvnforum/viewthread?p=797573 (Swordfighting Strategy forum thread)
- YSB = https://yppedia.puzzlepirates.com/Sea_battle , YOSB = https://yppedia.puzzlepirates.com/Official:Seabattles ,
  YCM = https://yppedia.puzzlepirates.com/Collision_mechanics , FCM = https://puzzlepirates.fandom.com/wiki/Collision_mechanics ,
  YW = https://yppedia.puzzlepirates.com/Whirlpool , YBT = https://yppedia.puzzlepirates.com/Bnav_tutorial ,
  FSB = https://puzzlepirates.fandom.com/wiki/Sea_battle , SBG = https://forums.puzzlepirates.com/community/mvnforum/viewthread?p=23812

---

## 1. Sailing

The fan wiki describes it as close kin to Dr. Mario: falling pairs, colour matching, and fixed targets. [1] SFT/YS

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| Board | Rectangle 8 columns wide by 16 rows tall. | [C] | YS, FS |
| Spawn | Pairs enter from the two centre columns. | [C] | YS, YOS |
| Pieces | Joined **pairs** (dominoes). There are 3 colours, themed water (blue), rope (yellow) and wind (white). | [C] | YS, FS |
| Pair linkage | After landing, the two halves of a pair stay stuck together. If one half clears, the link breaks and the other half falls under gravity. This is the main way chains are built. | [1] | YS |
| Fixed structure | **Platforms**: rectangular shelves that hold **target** cells (outlined, colour-coded slots). An active platform acts as a solid shelf across its full width, so pieces cannot fall through the gaps between its targets. | [1] (detail) / [C] (platforms exist) | YS, YOS |
| Fixed obstacles | Pre-placed **fixed square** pieces sit on the board and get in the way. The objective text says to clear them. Exactly how they clear (likely by being part of a 4-line) was not confirmed. | [C] exist / [I] how | YOS, FOS |
| Clear rule A (lines) | 4 or more same-coloured pieces in a straight **row or column** clear. This scores, but it often hurts, because it can strip pieces you needed for targets. Clearing is by straight line only, not by connected group. | [C] | YS, YOS, search extracts |
| Clear rule B (platforms) | When **every target on a platform is filled with the matching colour**, the pieces in its targets clear and the platform itself disappears. All completed platforms clear at the same time. | [1] (detail) / [C] (goal = fill targets) | YS, YOS, FOS |
| Gravity / chains | After any clear, unsupported pieces fall and the board resolves again. Each non-empty platform-clear step or line-clear step adds one to the chain. Chains drive performance. | [C] | YS, FOS |
| Board reset | Removing every platform on screen gives a fresh board. No extra bonus for clearing it. | [C] | YS, search extract |
| Difficulty | Boards get harder the longer you go without a top-out. | [1] | SFT/YS extract |
| Controls | Left/right moves the pair, up/down rotates it, space speeds the fall. Sources differ on whether space is a fast soft drop or a hard drop, but you can still move or rotate after pressing it. | [1] | YS/SFT extract |
| Top-out | The top-out (the game's own word for it is in the "Coined names" section) happens when, after clears and gravity settle, either top cell of the two centre spawn columns is still occupied. Result: a message, a **flat 20-point penalty**, and a new board. Another page calls it only a small speed penalty. | [1] (20 pts) | YS (vs. FOS) |
| Special pieces | None found beyond fixed squares and platforms. | [I] | none |
| Scoring | Scored mainly **per pair dropped**, not per second. Value comes from platform clears (worth more than plain pieces), with fixed squares worth the most, plus chain size. Idling still costs performance. See also https://yppedia.puzzlepirates.com/Sail_scoring (not read). | [1] | YS |
| Output | A ship-and-sail gauge shows contribution, from a droopy blue sail up to a full gold sail. Sailing (and rigging) generate **movement tokens** for sea battle. | [C] | search extract, YOSB/YSB |

## 2. Carpentry

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| Board | Holes in a hull, not planks. **Up to 4 holes active at once**, and each is targeted with its own key. A size-n hole starts with **5n squares** (e.g. size 6 = 30 squares). | [1] (4 holes, 5n) / [C] (holes) | YC, YOC |
| Pieces | **Pentominoes** (5 cells each). Count is 12 per one source and 13 per an older tutorial, which may include an extra shape. | [C] pentomino / conflict on count | FC, YCT, search |
| Pieces offered | A beginner starts with 1 hole and 3 pieces. The pieces are kept in a holding area, but the exact queue size was not confirmed. | [1] | YCT extract |
| Discard | Not confirmed. | — | Unresolved |
| **Rotation / flip** | **YES, both.** Desktop: one key each for counter-clockwise and clockwise rotation, one key to flip horizontally, and the mouse wheel/middle button also rotate. Tablet: tap rotates clockwise, two-finger tap rotates counter-clockwise, swipes flip horizontally or vertically. A strategy tip (rotate 180 then flip equals a 90-degree counter-clockwise turn) confirms flipping. | **[C]** | YOC, YOCT, FC |
| Placement | **Overlap is allowed** (pieces over each other or over existing hull) but lowers the score. | [C] | YOC, YC |
| Neglect | An empty hole that sits too long flashes and then **grows by one square**. In a partly filled hole a piece can start shaking and **fly off** if left alone. | [1] | YOC extract |
| Finish | A hole finishes when it is fully covered. | [I] | none |
| Scoring | Each hole is rated by **pieces used compared with the minimum (n)**, from a top tier (exactly n pieces, no overlaps) down to lower tiers (e.g. n+2 pieces). The top tier is worth **2n - 4** points per one source. | [C] tiers / [1] formula | YOC, YC |

## 3. Gunnery

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| Board | A deck board with **4 cannons** and a central barrel that releases pieces. It also has side holes/hatches for dumping unwanted pieces. | [C] | YOG, FG, GWM |
| Items | **Powder, wad, cannonball, water bucket**. No other piece types found. | [C] | YOG, FG |
| Order | Each cannon needs powder, then wad, then ball. The loaded cannon becomes one gun token for the ship. | [C] | YOG, YOSB |
| Wrong order | A wrong piece fouls the cannon, which must be **flushed with a water bucket** before reloading. The bucket also clears a cannon after it fires. A bucket only has to be the last piece in before you start filling, not the only one. | [C] | YOG, FG, forum 11804 |
| Movement | **Real time.** Pieces roll in straight lines. At a fixed obstacle a piece turns right if it can, else left, else reverses. When two pieces collide, both reverse. | [C] | YOG, search |
| Player input | Place **direction arrows**, max **3 on the board** (a 4th removes the oldest). A piece crossing an arrow takes its direction. Arrows also steer pieces into cannon mouths. | [C] | YOG, FG |
| Speed | Piece speed is set on entry from the player's skill standing, with in-session adjustments that build up over time. | [1] | YG extract |
| Hazards | No separate hazards found. The only "hazard" is a wrong piece or your own clutter. Balls dumped overboard are **not** lost from the hold now; they used to be. | [C] | YOG, YG |
| Scoring | Speed first, then efficiency (fewest arrows). Per one source: time on board divided by guns loaded, so 4 guns in 40 s equals 2 in 20 s. | [C] speed/efficiency / [1] formula | YOG, FG; https://yppedia.puzzlepirates.com/Gunning_scoring (not read) |

## 4. Navigation (duty navigation, the puzzle; not sea battle)

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| Board | Circular: **3 concentric rings, each with 8 positions** (8 octants). | [C] | YNT, YON, search |
| Pieces | **Stars** with a colour and a shape fall inward from 8 points around the edge. Gravity pulls every star toward the centre, so a star with an empty cell inward of it keeps sinking. | [C] | YON, FN |
| Player action | **Rotate one ring at a time.** Select a ring, then turn it clockwise or counter-clockwise. Space/tap fast-drops the falling star. As of 2026-10-16, number keys jump straight to a ring. | [C] | YON, YONT, https://yppedia.puzzlepirates.com/Release/all |
| Targets | **Constellations**: coloured ring regions with hollow outline markers matching star shapes and colours. You line up stars so they fill the outlines. | [C] | YON, FN |
| Completion | Filling a constellation's markers completes it. That it then clears/scores and the stars are removed is inferred. | [I] removal / [C] completion | YON |
| Failure | Dropping a star onto another star in the outermost ring is a top-out-style failure that turns the ship around (bad for the voyage). | [1] | FN |
| Scoring | **Weighted heavily toward constellation size.** Big constellations pay much more, and efficiency counts. See https://yppedia.puzzlepirates.com/Duty_nav_scoring (not read). | [C] | YON, FN |
| Ship effect | Duty nav keeps the ship on course. The exact mechanic was not confirmed. | [I] | none |

## 5. Swordfighting

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| **Clearing style** | **Breaker style (Puzzle Fighter), not connect-4.** Pieces are solid blocks or cut-out **breakers**. A breaker shatters every connected block of its colour and sends an attack scaled to the size of the shatter. A breaker that becomes adjacent to more same-coloured blocks after things fall also breaks them, which keeps the chain going. | **[C]** | YSF, YOSF, FSF |
| Board | **6 columns wide**. Height not confirmed (12-13 rows is a guess). | [C] width / [I] height | YDP, search |
| Lose condition | You lose when the spawn column (**4th column**) fills completely, so nothing can enter. | [1] | YSF/FSF extract |
| Fused blocks | Same-coloured blocks in a **2x2 or larger rectangle** fuse into one big block. | [C] | YOSF, FSF |
| Attack size | A shattered 2x2 fused block sends a **1x4 sword**. Chains enlarge it: 2x4 on a double, 2x6 on a triple, and so on, with named tiers above that. One extract said a 3x3 sends a 2x4 (unclear). Loose (unfused) shattered blocks send **sprinkles**: 1 per 2 loose blocks shattered, breakers included, landing as single pieces on the first drop. | [C] chain scaling / [1] sprinkle ratio | YSF, FSF |
| Attack lifecycle | An incoming strike lands as a solid metallic sword shape. Over the next few drops it turns into grey blocks, then translucent ones, then ordinary coloured blocks (about 3-4 turns). Incoming attacks never contain breakers. | [C] | YSF, FSF, YOSF |
| Sword / weapon effect | The weapon's only effect is its **drop pattern**: a fixed colour grid, 6 wide and 3-6 rows tall. Arriving attack blocks take their colours from it. Vertical strikes copy columns from the bottom up; horizontal strikes use the pattern rotated 90 degrees. The pattern wraps if the strike is longer than it. Patterns are mirrored depending on the sword's first colour. Strikes can't be wider than the 6-column board. | [C] | YDP, YSF |
| Counter / cancel | **No official counter rule found.** Forum advice (2006) says overbuilding can make attacks cancel each other out. Unconfirmed. | [1] forum | SFS |
| Ship damage | Damage from the sea battle adds pre-filled rows to the boarding board, max 6 rows (36 blocks). | [C] | YDP extract, FCM |
| Team mode | Team fights with 3+ players exist, and a team wins when all opponents are eliminated. How attacks are split between targets was **not found**. | [1] | YSF |

## 6. Sea Battle (battle navigation)

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| Grid | Square tiles, 24 by 24 (from an extract of FSB). Includes rocks, wind tiles and whirlpools. | [1] | FSB |
| Turn length | **35 s** of planning, then the plan runs. | [1] | FSB |
| Turn structure | **4 phases (moves) per turn.** Each phase runs: (1) movement tokens, (2) wind/whirlpool, (3) cannon shots/grapples. | [C] | YSB, YOSB, YBT |
| Move tokens | Forward, left turn, right turn, generated by sailing/rigging. Generation slows as bilge water rises. At most 1 move token per phase. Unused tokens persist but **expire after 5 turns** unused. | [C] | YSB, YOSB, FSB |
| Turn geometry | A turn moves the ship forward then sideways (a diagonal-ish arc ending in the new heading). | [I] | none |
| Collision | Each moving ship claims the tile ahead. If a stationary ship is there, it is **pushed** (ram) if it is not bigger than the rammer and the rammer is moving straight. If two movers claim the same tile, both stop and both are damaged. Ram damage is defined in cannonball-hit units per ship class. | [C] | YCM, FCM |
| Rocks / edge | Can't enter. The ship stays put and takes fixed damage (equal to 3 boarding-board blocks). The map edge acts like rocks. **Tall rocks block shots; short rocks can be shot over.** | [C] | YSB, YCM, FCM |
| Wind | A wind tile pushes the ship 1 tile in the wind's direction, whatever the ship's heading, and is resolved like a forward move for collisions. | [C] | YCM, SBG |
| Whirlpool | A 2x2 area. Each phase it moves the ship clockwise to the diagonally opposite cell **and** turns it 90 degrees clockwise. Resolved like a turn for collisions. You turn on the same phase you enter, and you shoot after the turn. | [C] | YW, YCM, YBT |
| Cannon | Fires **broadside only** (port/starboard, straight out). Range **3 tiles** for all cannons. Fires in step 3 of a phase, after movement and wind. Large ships can fire 2 shots per side per phase. | [C] | YOSB, FSB |
| Gun tokens | One per loaded cannon. They **do not expire** (they carry over). | [C] | YOSB, FSB |
| Grapple | **Range 1 tile**, unlimited tokens. Only one side per phase, and that phase allows **no cannon fire from either side**. Older fan text says the restriction is only on the same side. A hit ends the sea battle and starts boarding (swordfight). Before the 2004-04-28 release, boarding happened when ships shared a tile. | [C] (conflict noted) | YSB, YCM, FCM |
| Damage to boarding | Damage carries into boarding as a smaller play area or pre-filled rows on the swordfight board. | [C] | YCM, FCM |

## Bilging (reference only)

Known from background knowledge, not verified this session [I]: swap two horizontally adjacent pieces (a cursor 2 wide). 3+ in a row clears. Special pieces include crab, pufferfish and jellyfish. Water level rises over time. The trophy table uses "pump" terms. https://puzzlepirates.fandom.com/wiki/Bilging

---

## Coined names to avoid (rename all of these)

- **Game/studio:** Puzzle Pirates, Yohoho!, Three Rings, Grey Havens, YPPedia, "pieces of eight".
- **Universal failure word:** "booch" / "booched" (sailing top-out, nav outer-ring failure, also used elsewhere).
- **Swordfighting combo-tier words:** "bingo", "donkey", and the other chain-tier labels such as "vegas" (from memory). "double/triple" are generic.
- **Swordfighting:** the "breaker" term is generic (Puzzle Fighter), but avoid the game's own cut-out styling. "Sprinkles" for attack singles is probably coined. Named sword items: Sanguine Blade, Black Death Sword, "coffin" pieces, the rum-jug block. Real-world sword names (saber, falchion, scimitar, dadao) are generic, but **their drop-pattern grids are original content: do not copy them.**
- **Carpentry rating labels:** e.g. "Masterpiece", "A Fair Job." Use our own tier names.
- **Sailing:** the water/rope/wind colour theming, plus "platform" and "fixed square" as used there. These are generic words; renaming is safer.
- **Navigation:** "duty navigation", "duty nav". "Constellation" is generic.
- **Sea battle:** "bnav", "battle navigation", "cade" and "cade sim" (cadet-sim community term), "gold token" (a special token used in a whirlpool trick, meaning unverified), and the ship class names (sloop, cutter and brig are generic; "merchant brig", "war frig", "grand frigate" and similar are product names). Brigand names.
- **Gunnery:** no coined piece names found. Powder, wad, ball and bucket are generic.

## Unresolved

1. Wiki fetches were blocked. Allow `yppedia.puzzlepirates.com` / `puzzlepirates.fandom.com` in the session's network settings to verify all [1] items against the full pages.
2. **Sailing:** how fixed squares clear (line clears only?); whether diagonals count (assumed no); whether space is a hard drop; exact scoring weights (Sail_scoring page); how output maps to movement-token rate.
3. **Carpentry:** how many pieces are offered at once, whether you can discard or skip a piece, the exact piece set (12 vs 13), the 2n-4 formula, and when a hole counts as finished if overlaps are allowed.
4. **Gunnery:** does washing an empty cannon waste anything; exact board layout/size; how the barrel chooses its next piece (RNG weighting).
5. **Navigation:** what happens on completion (do stars clear?); exact scoring formula; precise ship effect.
6. **Swordfighting:** board height; whether a counter/offset mechanic exists (forum only); how attacks are split across targets in team fights; the 3x3 sizing rule; full chain-tier table; how ships spawn into the board.
7. **Sea battle:** grid size (24 by 24 from one extract, and probably map-dependent); maximum number of queued move tokens; exact turn geometry; whether ships block cannon fire (line of sight past ships); per-class shots per side; how shots split between port and starboard per phase; how hits are timed against simultaneous movement.
