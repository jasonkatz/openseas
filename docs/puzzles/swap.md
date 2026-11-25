# Swap

Version 0.1. The first puzzle on the domain engine (ADR 0089): the game's Cooling written again as a
puzzle document and its rules, by `docs/puzzles/DOMAIN.md`. It is shown in the studio's grid and played
alone at `/play/swap`. The game does not deal it, and Cooling is unchanged.

## The puzzle

A grid of pieces, six wide and twelve tall. Swap two pieces side by side. Three or more of one kind in
a row or a column clear, the pieces below rise to fill the gap, and new pieces come in from below. A
clear that sets off another is a cascade. In the space skin it is called Cooling and its pieces are
Cooling's.

## Role

None yet. A round reads one signal in, `level`: a host that has a ship's heat sets the line with it,
and from then on the puzzle stops moving the line itself. With no signal the puzzle runs a line of its
own, so the puzzle is whole when played alone.

## Luck and skill

The deal decides the kind of every new piece, evenly, and whether it is a special. The opening board
holds no run (the check `no_run`). Each draw has a stream of its own from the seed and its id, so the
kinds a seed deals are the same at every stage.

The ladder, each stage adding layers and changing no number:

| Stage | Adds | A player learns | Clears at a best round of |
|---|---|---|---|
| `runs` | `runs` | to see a swap that makes a run, and longer runs | 120 |
| `chains` | `chains`, `streak` | to set up a cascade, clear groups together, and never waste a swap | 300 |
| `specials` | `specials` | when a burst or a sweep is worth more than a run | 450 |
| `full` | `line` | to walk floats above the line and lift several at once | |

## Rules and scoring

Every number is a setting in `packages/puzzle/src/puzzles/swap/puzzle.json`.

- **A swap** trades a piece with its left or right neighbour. Any pair may be swapped, whether or not
  it scores.
- **A run** of three or more of one kind clears. Runs of one kind that touch are one group. A run pays
  by its length from `runPoints`: 3, 8, 15, 24 for three to six, the square of the length less twice
  the length.
- **Together.** Two or more groups cleared in one step pay a bonus from `togetherPoints`: 10, 25, 45
  (layer `chains`).
- **Cascade.** Each later step multiplies what clears in it by `cascadePercent`: 100, 200, 300 (layer
  `chains`).
- **Streak.** Scoring swaps in a row multiply everything by `streakPercent`, 100 up to 150 in steps of
  ten, and one swap that scores nothing is forgiven (layer `streak`).
- **A burst** (`burstPermille` 12) clears the pieces round where it lands when swapped, for
  `burstPoints` 1 each. **A sweep** (`sweepPermille` 8) clears itself and every piece of the kind it is
  swapped with, for `sweepPoints` 2 each (layer `specials`).
- **The line** (layer `line`) is counted in rows from the bottom, `startRows` 3 at the start. A
  **float** (`floatPermille` 10) cannot be matched. Once nothing clears, every float above the line
  lifts off together and pays `liftPoints` 15 times the square of how many. Lifting two or more is the
  puzzle's moment, sized out of four. On its own, the line rises a row every `riseMoves` 10 swaps and
  falls a row for every `ventPoints` 40 points, never below `minRows` 3; `dangerRows` 6 is where the
  gauge reads danger.
- **Points** are settled once an event: its payout, times its multipliers together, rounded down once.
- **The round** is 150 seconds on the clock (`roundSeconds`). The log holds 2000 entries at most.
- **Tier starts:** Steady 220, Sharp 580, Masterful 1150, Legendary 2000. The pace reads the last 10
  seconds.

## Where it differs from Cooling

Each is a place the guide has no way to say what Cooling does, or says it differently.

| Cooling | Swap | Why |
|---|---|---|
| A step's points are multiplied by the groups cleared in it | A stepped bonus, `together` | A multiplier reads a percent or a table by streak or step, never a count |
| Run points are computed, n(n-2) | The same numbers as a table, `runPoints` | A payout that grows faster than its count is linear, superlinear (the square) or stepped |
| A move's points are rounded once | Each event's points are rounded once | The guide settles points an event at a time |
| A run cut by a charge clears its leftovers | Only what the burst reached clears | Each event clears its own places |
| A swap under the heat line is slow, timed by the client | No slow swap | The guide has no rule that costs time |
| One stream for the whole deal | A stream for each draw | The guide's deal |
| Stages change numbers | Stages only switch layers | ADR 0074 |
| Seven kinds | Up to eight (`kinds` 3 to 8), with an eighth drawing | A family's drawings cover its setting's bounds |

## Input and feedback

Swipe a piece left or right. Or tap a piece to pick it up, then tap the one beside it. On keys, the
arrows (or WASD) move the cursor, Space or Enter picks the piece up, left or right swaps it, and
Escape lets it go. A swipe up or down does nothing. While a swap's events are still playing the board
takes no touch, and they play for a second at most.

The board is drawn by the domain board (`packages/boards/src/play`) from the round's events: pieces
travel, leave by shrinking, and rise in from below in the order they queue. A run plays a cue that
climbs with the cascade's step, points rise from where they were made, `together` and `lift` say so in
a callout, and a lift of two or more plays the beat. The rows under the line are washed in the danger
colour, stronger once the gauge reads danger.

## Engine

- `packages/puzzle/src/puzzles/swap/puzzle.json`: the puzzle document.
- `packages/puzzle/src/puzzles/swap/rules.ts`: what a swap does.
- `packages/puzzle/src/puzzles/swap/witness.json`: seven witness rounds. A change that alters one
  without raising the major fails `packages/puzzle/test/witness.test.ts`; `pnpm --filter
  @openseas/puzzle witness` records them again.
- `packages/boards/data/skins/space/swap.json`: its skin in the game's theme. Its texts are the
  `swap.*` keys in `packages/content/data/messages/domain/swap.json`.

## Tuning notes

Nothing here is tuned. The tier starts, the ladder's thresholds and the line's own numbers are first
guesses. A test bot that takes the best swap every 1.2 seconds reaches Legendary on one seed, so the
tier starts are low for a careful player. `riseMoves` was raised from 6 to 10 after the line pinned
itself at the top under careless play.

## Open questions for play

- Does a swap that scores nothing belong in the puzzle? Cooling allows it too, and the line punishes it.
- Is the `together` bonus felt, next to the multiplier it replaced?
- Does a second of untouchable board after a long cascade read as weight or as lag?
- The line never ends a round. Should a full board?
