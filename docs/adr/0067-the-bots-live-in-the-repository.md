# 0067. The bots live in the repository, and play any prototype through one seam

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md), [0036](./0036-prototype-puzzles.md)
and [0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md). The second step of M11.

## Context

Every prototype's thresholds and tuning notes were set from bots (ADR 0036), and ADR 0066 asks
each new layer to earn its place with bots: a bot that plays the layer beats one that ignores it,
and a bait loses to plain good play. Until now those bots lived in a session's scratch files and
went with it. Salvage's pilot showed why that is not enough. A one-move bot could not tell a layer
that rewards planning from one that pays for anything (contracts), and it took a rollout bot to
see it. The other seven puzzles are about to be deepened one after another, each needing the same
bots and the same table, run again whenever a number moves.

## Decision

1. **A package of its own, `bots`.** It depends on `engine` and `content` and nothing depends on
   it. It is a tool: nothing in it is deployed, and no part of the game or the studio imports it.
   `pnpm --filter @openseas/bots ladder <puzzle|all>` prints the ladder table as Markdown, ready
   for a design file's tuning notes.
2. **One seam a puzzle, `BotGame`.** A puzzle teaches the runner three things in a file of its own,
   `bots/src/games/<id>.ts`: the choices a player has from a state (each a short run of engine
   moves played as one decision, so a volley's flips and its fire are one choice), how much of the
   round a state has used, and how a round ends. Untimed puzzles model a person's pace as seconds
   a move, taken from the puzzle's tuning notes and printed with the table; ticked puzzles use
   their own ticks. Rules are never restated: a game asks the engine's own queries.
3. **Three bots every puzzle gets, and its own beside them.** Careless takes any choice at random:
   the floor, and the stand-in for spam that rule 17 of the `puzzles` skill wants a tier below plain play.
   One move takes the choice worth most now. Rollout tries the one-move bot's best few choices,
   plays each a few decisions on with the engine's random stream replaced, several times, and
   takes the best on average: it plans and never sees what will be dealt. A puzzle adds the bots
   its tuning notes were set with, and names its baits.
4. **Hidden information is respected.** A puzzle whose state holds what the player cannot see
   (Scanner) says so, and the bots that try a move to see what it scores are not run on it; its own
   bots decide from what the board shows.
5. **The table is the content file's.** Every stage and the whole puzzle, read from `content` with
   `stageNumbers`, each bot over the same seeds, the mean read as a tier against that stage's
   thresholds, the score each tier starts at, and two checks: careless lands a tier below plain
   play on every stage, and each bait loses on the whole puzzle. `--set key=value` lays a number
   over every stage to try it before it is written into content.
6. **Deterministic and honest.** A bot's coin flips come from a seeded stream, so a table printed
   twice is the same. Every bot plays through `reduce`, and the tests replay each log as the server
   would and compare the state, so no bot can score by anything a player could not do.

## Consequences

- A design file's tuning notes keep the table the runner printed, with its seeds and pace, so a
  number can be checked again by anyone.
- The bots are not people: their pace is a model, and a rollout bot plans in ways a person may
  not. Thresholds stay the owner's to set by hand (rule 17); the table is a first guess and a
  check on the rules, never the last word.
- Adding a prototype adds its bot file, and the tests fail until it has one. The seven puzzles in
  the game get bots by the same seam when their ladders are cut.
