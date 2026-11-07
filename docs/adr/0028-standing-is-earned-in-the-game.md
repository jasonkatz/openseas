# 0028. Standing is earned in the game; the harness records rounds and rates each one's performance

Status: Accepted. Supersedes the standing consequence of [0018](./0018-one-experience-and-a-puzzle-harness.md)
("until then they do") and of [0019](./0019-boards-package-and-harness-bench.md) ("Rated rounds from
the harness still count toward a pirate's standing"). Builds on [0003](./0003-pure-engine-replay-verification.md).

## Context

ADR 0018 moved the practice pages out of the game into the harness and left one question open:
whether a harness round keeps counting toward a pirate's standing. It said they would until the
game had in-world practice, and ADR 0019 carried that forward.

The owner has since settled it the other way. The harness is a development tool for testing and
tuning puzzles. Its rounds are played on whatever the bench is checking that day, and the scoring is
about to be retuned puzzle by puzzle. Standing earned there would mix tuning sessions with play, and
a tester could raise their standing on a page the game never links to.

Tuning still needs two things from those rounds: a score the server has verified, and a quick read
of how good the round was. Glicko-2 standing is the wrong tool for the second. It moves slowly by
design, depends on everything a pirate played before, and is hidden from players.

## Decision

1. **Only the game moves standing.** The captain's sea battle, a melee board, and a duty board that
   ran its full clock (or that its engine ended) update the pirate's rating, as before. In-world
   practice will too, once it exists (DESIGN.md 3.11). A round with no ship behind it never does,
   which today means every harness round.
2. **A harness round through the server is a recorded round.** It is verified by replay and kept in
   `puzzle_round` with `rated = false`, exactly as before apart from the rating. The harness calls it
   *recorded*, not *rated*. Old links with `start=rated` still start one.
3. **Every scored round carries its own performance rating.** `performanceRating` in the engine reads
   the score off the line through the puzzle's thresholds, and `tierFor` names the tier it falls in.
   - Below the first threshold, the line runs down to a score of 0 at one step under it.
   - Above the last threshold, it carries on at the last step's slope. A score far over the top then
     shows how far over, a sign the thresholds want raising.

   The server sends the rating and tier as `performance` in `puzzle.result` and stores the number
   in `puzzle_round.performance`, for game rounds too. Unrated and lab rounds compute the same
   number in the browser, against the content thresholds.
4. **Performance never feeds standing.** It describes one round. Glicko-2 stays the only thing that
   moves a rating.

## Consequences

- Testers' standing now comes from voyages only. Standing already earned on the harness is kept: no
  migration resets it, and later voyages move it as usual.
- The harness's result card shows a performance number and tier in place of a standing line. The
  game shows players tiers only (DESIGN.md 3.6); raw numbers stay in the harness, a developer tool.
- Calibration reads `puzzle_round.score` and `performance` across recorded rounds, so a threshold
  change can be checked against the rounds testers already played.
- A lab round's performance is read against the content thresholds even when its config differs.
  That is the point: it shows what a tuned config would rate at against today's ladder.
