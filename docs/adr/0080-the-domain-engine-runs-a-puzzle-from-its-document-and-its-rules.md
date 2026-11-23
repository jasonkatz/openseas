# 0080. The domain engine runs a puzzle from its document and its rules, and Swap is its first

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md), whose purity and replay it
keeps, [0072](./0072-a-round-keeps-one-difficulty-and-the-stage-sets-it.md) to
[0077](./0077-a-theme-is-a-document-its-skins-read.md), whose decisions about stages, motion, the deal
and themes it runs as written, and
[0079](./0079-a-puzzle-has-a-version-and-a-judged-round-is-final.md), whose versions, stored rounds and
witness rounds it implements. It replaces nothing: the game's puzzles and the prototypes keep the
engines they have ([0036](./0036-prototype-puzzles.md)).

## Context

The puzzle domain guide (`docs/puzzles/DOMAIN.md`) says what a puzzle is apart from any world: a
puzzle document, its rules, a skin and a theme. Until now it was only a target. Each of the game's
sixteen puzzles is an engine of its own in `engine`, with its own state, scoring, config schema, board
renderer and studio page, and each reads the guide's ideas its own way: one stream for the whole deal,
stages that change numbers, scores a board helps compute. Nothing ran a puzzle written the way the
guide describes one, so nothing showed whether the guide is enough to build from.

## Decision

1. **A new package, `puzzle`, is the domain engine.** It is pure as `engine` is (ADR 0003): no
   runtime dependency, no I/O, clock or random number, and CI lints it for that. It is written from
   the guide, not from the engines that exist, and where they differ it follows the guide.
2. **One engine runs any puzzle.** `engine(doc, rules)` gives `start(seed, settings)`,
   `play(round, entry)`, `mark(round, time)` and `read(round)`. The engine owns everything the guide
   gives one meaning for every puzzle: tempo and the endings, the log and its cap, settings with their
   bounds and relations, layers and stages, a stream for each draw from the seed and the draw's id,
   the board and its changes, points from payouts and multipliers settled once an event, the streak,
   pace, tiers and performance.
3. **The rules are the only part of a puzzle that is code,** and they reach a round through a context
   alone. They cannot change the board without a board change on an event, pay a point that is not a
   declared payout's, read a setting the round does not have, or draw from a stream that is not a
   declared draw's. `checkRules` holds what the rules know equal to what the document declares, and
   `checkPuzzle` holds the document to the guide, before any round runs.
4. **A stage only switches layers.** A round's settings are a value for each setting and the layers
   on, which must be those of one stage. A setting a layer brings does not exist while that layer is
   off.
5. **The host's part is in the package too:** replaying a stored round, judging it, holding a puzzle
   to its witness rounds, and saying when a stage is cleared. `checkSkin` and `checkTheme` say when a
   skin and a theme are ready.
6. **Swap is the first puzzle: the game's Cooling, written again.** It is a puzzle document
   (`packages/puzzle/src/puzzles/swap/puzzle.json`), its rules and seven witness rounds, at version
   0.1. It holds nothing of the game's world: its words and drawings are its skin's. It is a second
   puzzle beside Cooling, not a change to it: the game still deals Cooling from `engine`. Its design
   file is `docs/puzzles/swap.md`, which lists where it differs from Cooling.
7. **One board draws any grid puzzle from its events.** `boards/src/play` holds the domain board. It
   starts from a round's opening board and from then on changes only by the board changes events
   carry, and it holds the board it drew against the round's own. Drawings, motion, cues, marks,
   points, callouts and the beat come from the skin (`boards/data/skins/space/<puzzle>.json`) and the
   game's theme, which is built from the tokens, the cue limits and the message table. A skin's texts
   live in the message table, keyed `<puzzle>.<text key>` (CLAUDE.md rule 5).
8. **Swap is shown in the studio's grid, alone at `/play/swap`.** Its round is local: the page stamps
   moves with its clock, the engine plays them, and when the round ends its log is replayed from the
   seed and the two scores are held against each other. It has no tuning panel, draft, Save, guide or
   bot table, and the server does not deal it.
9. **What the engine does not run yet, it refuses by name.** `unsupported(doc)` lists opponents, turns,
   a rings board, a rim, terrain and maps, secrets, tasks and pieces of more than one cell. A document
   that needs one is still checked, and no round of it is dealt.

## What the guide could not say

Writing Swap from the guide alone found these. None is settled here; each needs a line in the guide.

- **A multiplier by a count.** Cooling multiplies a step's points by the number of groups cleared in
  it. A multiplier in the guide reads a percent or a table by streak or step, so Swap pays a stepped
  bonus (`together`) instead.
- **A payout that takes points away** has no place in the document.
- **A rule that costs time.** Cooling slows a swap under the heat line on the client's clock. The
  guide has moves and time marks and nothing between, so Swap drops it.
- **A gauge on the board.** The skin can name no way to draw a gauge or terrain on the board itself.
  Swap's skin carries a small `board.gauges` part of its own for the heat line.
- **"Average of the last few" rounds** names no count, and wins over a stand-in need versus, so
  `clears` judges only best round and rounds played.
- **Events in one step that touch the same piece or cell.** The guide says a step plays together. The
  board reads that as: together, except that an event waits for whatever was last done to a piece or
  a cell it touches.

## Alternatives considered

- **Refactor the sixteen engines toward the guide.** It would move every puzzle a little and prove
  nothing whole, and each step would risk rounds the server already verifies.
- **Put the domain engine in `engine`.** The two would share a package and a purity lint, but the
  domain engine would then sit beside per-puzzle code it must not reach for, and `PuzzleId`, the
  config schemas and the studio's panels would all have to learn a puzzle that is none of theirs.
- **Add Swap to `PuzzleId`.** The grid, the tuning panel, the guides, the cue files and the bots all
  list every `PuzzleId`, and each would need a place for a puzzle that has no config. Swap has its own
  short list until the studio's tools are built for documents.

## Consequences

- There are two ways to write a puzzle. New puzzles should wait for the choice between them, which is
  its own decision once more than one puzzle runs on the domain engine.
- Swap's tier starts, ladder thresholds and its own heat line (`riseMoves`, `ventPoints`) are untuned
  guesses. No bot has measured them.
- The server does not know the domain engine. Dealing a domain puzzle for standing needs the server
  to keep stored rounds as ADR 0079 describes them.
