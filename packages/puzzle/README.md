# @openseas/puzzle

The puzzle engine, written in rungs (ADR 0092 to ADR 0095). It is pure: no clock, no random number, no I/O, and
no dependency. `pnpm --filter @openseas/puzzle lint` holds it to that.

What is built: rungs 0 to 3, and rung 4 without its ticks, for one seat on a still grid.

| File | Holds |
|---|---|
| `src/loop.ts` | Rung 0: `start`, `play`, `read`, `hint`, `listMoves`, `replay`. The loop runs a whole document and a flat rules object, holds the deal to its check, pays every event from the document's payouts and multipliers, keeps the streak and the rules' state, and banks each move once. Rung 4: it plays a round at a stage and refuses what a layer that is off brings, keeps every gauge, stat and open task, and asks the rules for a task when one is needed. For a ticking puzzle it plays every tick due before a move, `advance` lets time pass with none, and it keeps the terrain and each bag |
| `src/puzzle.ts` | Rungs 1 to 3: `puzzle()` with a default for every key, settings, payouts, multipliers and a streak as data, `part()`, and how parts merge and keep their state. Rung 4: `stage()`, a part in a stage as a layer, and `order` |
| `src/when.ts` | A condition: one comparison over an event's fields and the settings |
| `src/stock.ts` | The stock parts (`swap`, `lines`, `refill`), `grid`, `budget`, `clock`, and the plain board helpers they are built from |
| `src/expand.ts` | `expand` prints the document. `explain` prints which part answers each hook |
| `src/seen.ts` | A board drawn from events alone: what a screen holds, held to the loop by the tests |
| `src/types.ts` | The document, the rules and a round's events |
| `src/prng.ts` | The same generator `engine` uses. Each draw has a stream seeded from `<seed>/<draw id>` |
| `examples/` | Swap in seven lines, the same rules written flat by hand, Swap with a part of an author's own, Cooling: its numbers as data and two parts of its own, Paths: six parts over a ladder of four stages, and Gunnery: five parts on a ticking tempo, with terrain, maps and a bag |

Swap plays in the studio at `/rungs/swap`, on a board drawn through `seen.ts` in the stock skin.

The tests start with determinism, then the deal's check, then that the rules written flat report
the same events as the parts. `test/cooling.test.ts` plays Cooling beside the engine the game ships,
from the same boards, and holds the two to the same board, score, streak and heat after every move:
`@openseas/engine` is a dependency of the tests alone. `test/paths.test.ts` does the same for Paths
beside Salvage, at each of its four stages, and holds the two to the same board, streak, bounty, counts
and luck. `test/gunnery.test.ts` does it for Gunnery, after every tick and every move, on the same
decks from the same bags. `test/rungs.test.ts` runs the samples the docs site teaches rungs 2 and 3 with. The docs
site's tests hold the expanded Swap, Paths and Gunnery to the typed reference.

Not built yet: a round's tiers, seats (rung 5), and promotion.
`docs/adr/0092-a-puzzle-is-written-in-rungs.md` gives the order.
