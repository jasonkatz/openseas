# 0097. A shipped board plays on the new engine through a mirror: the round is the new engine's, and the state the board draws is made from it

Status: Accepted. Builds on ADR 0042 (the studio, every round local), ADR 0092 to ADR 0096 (the puzzle
engine in rungs, and Cooling, Paths and Gunnery written on it), and ADR 0003 (a round is its seed and its
move log).

## Context

Cooling, Paths and Gunnery were each written on the new engine and held, in the engine's own tests, to
the board, score and streak of the hand-written engine the game ships. That is a claim about numbers. It
does not show a person the puzzle: only Swap had a page, on a small board of its own.

The question the owner asked is the one that matters before any engine is moved: can the new engine stand
behind the page a player already knows, with nothing about that page changed? A shipped page is a board,
a HUD, cues, a tuning panel and a round frame, and all of them read one thing: the state its hand-written
engine keeps, with a report of the last move.

## Decision

1. **A mirror is a `PuzzleDef` whose round is played by the new engine.** For each of the three puzzles,
   `studio/src/rungs/mirror/<id>.ts` gives the shipped page a definition with the shipped one's shape. Its
   `create` starts a round of the puzzle on `@openseas/puzzle`. Its `reduce` plays the move on that round.
   Both return the round shown as the state the shipped board draws: the board, the counts, and the last
   move's report built from the round's events.
2. **A mirror decides nothing.** It names things the old way and puts events in the order the board plays
   them. No rule, no draw and no point is worked out in a mirror: the deal, what a move does, what falls
   and comes in, what is paid and what the streak is all come from the round. A report wants a few
   numbers for show that no event carries as the old shape has them: what one group of a step was worth
   before the step multiplied it, the tick a full turret will fire on, and the streak a move was paid at
   when a mistake has since broken it. A mirror reads each from the events and the settings, says so in a
   comment where it does, and the test in decision 6 holds it to the shipped engine's.
3. **The round is held beside the state, never in it.** A state stays plain data in the shipped shape, so
   the engine's own hash and summary read it unchanged, and the studio's check that a round replays from
   its log holds a mirror as it holds any engine.
4. **The page, the board, the cues and the tuning panel are the shipped ones.** A page takes the puzzle it
   plays as a property and defaults to the game's own. Nothing is copied: `/rungs/cooling`, `/rungs/paths`
   and `/rungs/gunnery` are the shipped pages with another definition handed in, and `/play/rungs/<id>`
   is each alone. The start card says which engine is behind it, and nothing else differs.
5. **A seed deals the same round on both.** Paths and Gunnery are given their luck where the shipped engine
   takes its own, so the same seed opens on the same board and a round can be played side by side. Cooling
   deals its own opening board: the new puzzle's deal is its own, and what follows a board is held the same.
6. **A mirror is held to the shipped engine state for state.** `studio/test/mirror/` plays the same moves
   on both and asks for the same whole state and the same whole report after every move, every stretch of
   ticks and every wait, piece for piece. The studio's shipped smoke for each board runs on both engines.
7. **What differs is written down, not tuned away.**
   - Cooling aboard a ship takes its heat from the ship, as moves in the log. The new engine has no such
     signal yet, so the mirror plays the board with its own heat and refuses a heat move.
   - Paths rounds a move's points down once. Salvage rounds the path and then each prize taken at the
     floor, so a move with prizes at the floor can pay a point more on Paths (ADR 0093).
   - Paths counts as its best streak the streak a move was paid at. Salvage does not count a streak that a
     timer broke on the move that built it.
   - Paths cuts a stage by leaving layers out. Salvage switches a layer off with a number of nothing. A set
     of numbers that is none of the ladder's four cuts is refused by the mirror, with the reason. At the
     first stage Paths has no streak, where Salvage counts one that multiplies by nothing.
   - A board's previews (what a swap would clear, where a piece will roll, what a path is worth) still ask
     the hand-written engine's read-only helpers, on the mirrored state. They move nothing in the round.
8. **A mirror is the studio's, and temporary.** Nothing in the game or the server reads one. When a puzzle
   moves to the new engine for good, its board is driven from the round's events and its mirror is deleted.

## Consequences

- The three puzzles can be played on the new engine today, on the pages people know, and compared with
  the shipped ones by opening both on one seed.
- What the new engine cannot yet do for a shipped page is a short list with a reason on each line, and
  the first item on it, a signal from outside the board, is the next thing the engine needs.
- A mirror costs a file a puzzle and a test. It is the price of not touching a board to answer the
  question, and it is thrown away when the answer is acted on.
- The shipped pages gained one optional property each. With it left out they are what they were.
