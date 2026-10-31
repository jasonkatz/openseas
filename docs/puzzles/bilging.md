# Bilging

Status: shipped (M1, polished in #9 and #10). This is the reference spec: the other puzzles match
its rigor. It describes the puzzle as built; code lives in `packages/engine/src/bilging`,
`packages/client/src/bilging` and `content/data/puzzles/bilging.json`.

## 1. Identity

Fast, twitchy and bright. You are below decks pumping a flooding hold: the board is a well of
colored tiles, water climbs from the bottom, and every clear pushes it back. The pleasure is in
seeing a chain coming and setting it off. Motifs: water, foam, bubbles, brass rivets on planking,
pump strokes and glugs. Callouts are short and loud.

## 2. Faithful core

Swap two horizontally adjacent pieces. Any adjacent pair may be swapped; a swap need not make a
match. Runs of 3 or more of a kind, horizontal or vertical, clear. The pieces below float up into
the gaps and new pieces enter from the bottom. Cascades chain. Combos and multi-clears score
higher. Water rises as the bilge fills; working below the water line is slow.

## 3. Rules verified

Corrected against the original in review after the first build.

- [x] Pieces rise toward the top and new pieces enter from the bottom. (The first build had them
  falling; fixed in `8dd975c`.)
- [x] Any horizontal swap is legal, matching or not.
- [x] The barnacle-role special cannot be matched, rides up with the board and comes off by itself
  above the water line. It does not climb on its own. (Wrong in the first build.)
- [x] Swaps below the water line are slow and hold the board.

## 4. Board, pieces and specials

6 wide by 12 tall. `col` 0..5 left to right, `row` 0..11 **bottom to top**; renderers flip for
display. Seven ordinary kinds, each a colored square with a unique texture and a unique mark:

| Kind | Color | Texture | Mark |
|---|---|---|---|
| Cog | yellow | knurl | gear |
| Shell | cream | fan | circle |
| Anchor | blue | waves | triangle |
| Plank | orange | grain | square |
| Pearl | purple | nacre | diamond |
| Kelp | green | fronds | hexagon |
| Coral | red | pores | star |

Specials (original names for the original's three roles):

- **Powder Keg.** Swap it and it detonates, clearing the 3×3 around where it lands.
- **Ink Cloud.** Swap it with an ordinary piece and every piece of that kind clears, along with
  the cloud. Swapped with a special, only the cloud clears.
- **Barnacle.** Unmatchable. Rides up as pieces below it clear, and comes off for a bonus once at
  or above the water line, after the move's cascades settle; the board then settles again.

Spawn chance per spawned piece, per mille: keg 12, ink 8, barnacle 10.

## 5. Input

Tap a tile then a horizontal neighbor; or drag a tile sideways; touch-hold or mouse hover previews
the cells a swap would clear. Keyboard: arrows move a two-cell cursor, space or enter swaps it.

## 6. Scoring

A connected group of n same-kind pieces scores n(n−2). Clearing k groups in one step multiplies
the step by k; cascade step c multiplies by c. A keg scores 1 per cell, an ink cloud 2 per cell, a
surfaced barnacle 15. All integers.

## 7. Pressure and output

Water is a level in the state in units of 1/(6×40) row. Each move raises it 1/6 row; every 40
points drain a row. It never drops below 3 rows or rises above 12. Pumping at the floor is wasted,
so points cannot be banked. From M3 the ship injects water events into the move log and the
output is rows pumped per ship turn.

## 8. Time

Turn-based: the engine advances only on moves. The round's wall clock (150 s) and a move cap
(120) end it; the server enforces the deadline.

## 9. Client-only timing costs

- `underwaterSwapMs` (520): a swap below the water line takes this long and the board refuses
  other swaps until it lands. A refused pair flashes red. No score depends on it.

## 10. Moves and reports

Moves: `swap {col,row}` and `end`. A report carries every cascade step with its chain number,
groups (cells, piece ids, points, cause) and the settled board after that step.

## 11. Exploits

- Banking points against later water: closed by the floor.
- Stalling: the round clock runs regardless.

## 12. Feedback plan (as built)

Swap with a back-arc; each step clears with flash, debris and a ring in the kind's color, then
rises with landing squash. Popups per step; callouts for chains and for Double, Triple and Full
broadside. Big steps hold a beat and punch the board; kegs and ink clouds shake it. Streak
milestones at 3, 5, 8, 12 and every 5 after; a falling tone when a streak of 3+ breaks. Pumping
throws spray; rising water and the danger line have their own sounds. Submerged pieces sway, kegs
spark, specials breathe. A swap that clears nothing makes a softer knock. Idle hint in unrated
practice only.

## 13. Layout

Phone: top bar holds back, score with combo chip, time, moves, details and mute; the board takes
the rest; combo, water, connection and legend open in a panel. Desktop: board left, HUD and legend
in a sidebar.

## 14. Content

`bilging.json`: board size, piece kinds, special chances, initial and minimum water, rise per
moves, drain per points, max moves, round seconds, `underwaterSwapMs`, rating thresholds, piece
names, colors, textures and marks.

## 15. Tests

Same seed and log give the same state and hash; board always full after a move; previews agree
with the real clear; report steps end at the final board; a model-based water test and a
no-banking test; smoke test checks the drawn board equals the engine board after start and after
moves.

## 16. Open questions

None blocking. Rating thresholds are tuned from tester data.
