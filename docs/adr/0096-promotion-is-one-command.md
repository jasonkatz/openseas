# 0096. Promotion is one command: ready is checked, witness rounds are kept, and the document becomes the source

Status: Accepted. Builds on ADR 0036 (promoting a prototype into the game is its own ADR and milestone),
ADR 0088 (a puzzle is ready when), ADR 0092 (a puzzle is written in rungs), whose promotion it builds,
and ADR 0095. It changes the guide in the places named below.

## Context

ADR 0092 split valid from ready and said what promotion does: it writes the puzzle's document out
whole, once, and from then on the code holds its parts and no number. It left the step itself to be
built after rung 4. The guide lists what ready asks. Nothing checked any of it, nothing recorded a
witness round, and nothing could build a puzzle from a document and its parts, which is what a promoted
puzzle is.

Two of the things ready asks had no place in the engine yet: where a puzzle's tiers start, and its
moment. Both are data in the document, so both are added here, and with tier starts a round can be
judged.

## Decision

1. **`ready(puzzle, witnesses)` says what a puzzle still lacks, each as one plain line.** An empty list
   is a ready puzzle. It holds what a puzzle and its rules can be held to: a ladder of two to four stages
   ending in `full`, tier starts, a moment, a fallback for every check, a setting behind every payout, a
   history line for its version, and its witness rounds. A skin, a theme and their words are the host's
   to check and are not looked at.
2. **A puzzle says where its tiers start, and its moment, as data.** `puzzle()` takes `evaluation` and
   `moment` as the document writes them. A valid puzzle leaves them out. Where a puzzle has tier starts,
   `read` gives the tier a score stands in. Where it has none, the tier is null: scored, never judged.
3. **A moment's size is a number of the event, or its places, counted.** The guide asked for a number
   field. Paths' loop names its prizes as places, as a payout may count places, so a moment may too.
4. **A witness round is a seed, a stage, the settings it was played with, its log, the time it is run
   on to, and the read it gave.** A puzzle keeps them in `<id>.witness.json` beside its source, a round
   a line. Played again, each must give the same read, compared whole. Because a witness holds its
   settings, tuning a number later moves none: only a change to the rules or the scoring does, and
   that is what they are for.
5. **A witness round may be played out by the puzzle's own hint.** The `witness` command records one at
   each stage of the ladder that way, a move every second and a half, run on to the end of the clock. It
   is a round to hold the puzzle to, not a good one. A puzzle needs one on the whole puzzle to be ready.
   Rounds people played can be kept beside them in the same file.
6. **`promote` is one command, and it writes once.** It refuses a puzzle that is not ready and prints
   what it lacks. For a ready one it writes `<id>.puzzle.json`, the document `expand` prints, with its
   witness rounds beside it, and prints the lines the puzzle's own file shrinks to. Where the document
   is already there it refuses: the document is the source now.
7. **`rules(document, parts)` is a promoted puzzle.** It takes the document as read from its file and
   the parts in the order they are asked in, and gives what `puzzle()` gives. There is nowhere in it to
   write a number. What a part declares for itself is not read: each part must only find in the document
   everything it works, and every layer of the document must have its part. The document is held to the
   same checks as one `puzzle()` builds.
8. **A number among a promoted puzzle's parts is refused.** `rules` refuses a part called with a number,
   as in `lines(3)`. A stock part that takes one takes none as well, and reads the setting.
9. **The commands live outside the engine.** `ready`, `promote` and the witness helpers are pure and are
   in `src`. Reading and writing files is one script, run through `tsx`, and the purity lint does not
   cover it.
10. **Promotion does not put a puzzle in the game.** It is the step that allows it. Wiring a promoted
    puzzle to the server and a station is still its own ADR and milestone.

## Consequences

- `pnpm --filter @openseas/puzzle ready | witness | promote <file>` work on any puzzle file. Paths is
  ready: it has tier starts, a moment, and four witness rounds in `examples/paths.witness.json`. Its test
  promotes it, builds it again from its document and its parts, and holds that to the same witness rounds.
  Swap, Cooling and Gunnery are valid and say what they lack.
- The examples stay code first. Nothing in the repository is promoted by this ADR.
- The package gains `tsx` as a development dependency. It still has no runtime dependency.
- The docs site's page on shipping teaches the three commands as built. The reference lets a moment's
  size name a places field.
- Ready is only as strong as what the engine can see. That a fallback passes, and that a hidden place
  has an event that reveals it, are not checked yet, and seats bring more with rung 5.
