# 0084. Drinking's successor starts as a prototype: Pouring, with its rivals in the engine

Status: Accepted. Builds on [0001](./0001-spiritual-successor.md), [0003](./0003-pure-engine-replay-verification.md),
[0036](./0036-prototype-puzzles.md), [0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md) and
[0078](./0078-treasure-hauls-successor-starts-as-a-prototype.md).

## Context

DESIGN.md section 3 lists the parlor games as explicitly later. Drinking is one: the original's
tavern puzzle, where a few pirates take turns setting drinks down on a shared grid, each drink only
where it suits its neighbours by colour or shape, and a filled row or column scores for whoever
fills it. The owner asked for a successor to it now, next to Tractor (ADR 0078) and the other
successors being built as prototypes.

Drinking is played against other pirates, in turn, on one board. No prototype has had an opponent
before. A studio round is local and one player, and the server verifies a round by replaying the
player's moves (ADR 0003): an opponent whose moves came from anywhere else would need moves the
server vouches for, as a ship's crew needs for Swordfighting (ADR 0022).

## Decision

1. **It is built as a prototype.** Pouring (`pouring`) is a tenth entry in `PROTOTYPE_PUZZLE_IDS`,
   with every file ADR 0036 lists. It is dealt only in the studio and has no role. Promoting it,
   and giving it one (a game between pirates at an outpost's bar), stays its own ADR and milestone.
2. **Its rivals live in the engine.** The rivals are seats in the state, after the player's, and
   take their turns inside the reducer from the round's own random stream, as Swordfighting's AI
   boards do. A round still replays from the seed and the player's moves alone, so the server
   verifies it as it does any other. How well a rival plays is a number in config
   (`rivalSkill`), so a stage or a lab can set it, and every rival's hand is on show.
3. **The score is the player's own points, read against thresholds.** The rivals take lines from
   the player and so press the score down; their points are shown, and the result card says where
   the player placed, but the tier reads only the player's points, as every prototype's does.
4. **It is a successor, and says so.** Its design file names Drinking as what it follows and keeps
   its mechanics: a shared grid, drinks of two traits placed only where every neighbour shares one,
   a hand to choose from, lines served for whoever fills them, a doubled line on a never-used
   square, a stain left by every first placement, a drink taken instead of placed and too many
   drinks costing a turn, a wild piece and a piece that removes one. Its words, art, sounds and
   numbers are its own, and its departures are rows in DESIGN.md section 6.
5. **Its departures are about legibility.** A round is a fixed number of turns each, not a race
   to a score or to a fully stained board; lines served by one pour pay by their number squared,
   so the cross a player sets up is the move the puzzle pays most for; a rival's hand is shown, so a
   line given away is a mistake the player could see.

## Consequences

- The prototype count is ten. Documents that count them say ten, and count Tractor and Pouring
  apart as successors.
- A puzzle with opponents in the engine is now a shape the kit and the bots know: the board plays
  every seat's turn back from one report, and the bots play against the same rivals a person does.
- Its thresholds are set from bots until people have played it.
