# 0072. A round keeps one difficulty, and the stage sets it

Status: Accepted. Supersedes the line of [0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md)
decision 1 that rounds within a stage keep whatever ramp the puzzle already has, and the sentence of
the `puzzles` skill's rule 10 that a round ramps itself where it suits the puzzle. Builds on
[0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md)'s ladder of stages.

## Context

Several puzzles make a round harder as it goes. Scanner adds a contact every few sectors, Cutting adds
blocks and flaws, Navigation's constellations grow, Deflectors adds a beam and shortens its count,
Gunnery's feed quickens, and Tug's par rises with clean deliveries and falls with slow ones. Bar rule
10 allowed it ("the round ramps itself where it suits the puzzle"), and ADR 0066 kept it inside every
stage.

Since ADR 0066 a puzzle already has one place for difficulty: its ladder. A stage is the puzzle with
some of its layers on, and the whole puzzle is all of them. A ramp inside a round blurs that. The same
stage plays easier in its first minute than in its last, a round's opening says little about the rest
of it, and a score depends on how far the ramp got as much as on how well the round was played. The
owner wants a round's difficulty to hold still.

## Decision

1. **Difficulty holds for a whole round.** Every task in a round is dealt from the same settings, from
   the first second to the last. Nothing in a round grows harder by itself as time passes or tasks
   are done: no quicker feed, no extra contact, no larger constellation, no par that climbs with clean
   play.
2. **The stage sets difficulty.** A round's difficulty is its stage's: the layers that are on. The
   whole puzzle, with every layer on, is the puzzle at its hardest.
3. **A rule that answers play is not a ramp.** Heat that rises with moves and falls with points, or a
   breach that widens when it is left alone, responds to how the round is played, and stays.

## Consequences

- Rule 10 of the `puzzles` skill says that difficulty holds for a whole round and the stage sets it.
- The puzzles that ramp today (Scanner, Cutting, Navigation, Deflectors, Gunnery and Tug) keep doing
  so until a change of their own removes the ramp. Each is a change to a puzzle by the `puzzles`
  skill, with its design file, guide, numbers and thresholds in step, since every threshold was set
  on rounds that ramp.
- Settings that only drive a ramp go with it, such as Scanner's and Cutting's `growEvery`, Tug's
  `cleanPerStep`, Deflectors' `rampTicks` and `chargeTicksMin`, and Gunnery's `spawnEveryTicksMin`.
- Rule 10 still has a board against an opponent scale by the opponent's tier (`scorePercent`). The
  puzzle domain guide judges a versus round by its outcome against the opponent's standing instead;
  moving the game there is a change of its own.
