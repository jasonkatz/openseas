# @openseas/puzzle

The puzzle engine, written in rungs (ADR 0092, ADR 0093). It is pure: no clock, no random number, no I/O, and
no dependency. `pnpm --filter @openseas/puzzle lint` holds it to that.

What is built: rungs 0 to 3, for one seat on a still grid.

| File | Holds |
|---|---|
| `src/loop.ts` | Rung 0: `start`, `play`, `read`, `hint`, `listMoves`, `replay`. The loop runs a whole document and a flat rules object, holds the deal to its check, pays every event from the document's payouts and multipliers, keeps the streak and the rules' state, and banks each move once |
| `src/puzzle.ts` | Rungs 1 to 3: `puzzle()` with a default for every key, settings, payouts, multipliers and a streak as data, `part()`, and how parts merge and keep their state |
| `src/when.ts` | A condition: one comparison over an event's fields and the settings |
| `src/stock.ts` | The stock parts (`swap`, `lines`, `refill`), `grid`, `budget`, `clock`, and the plain board helpers they are built from |
| `src/expand.ts` | `expand` prints the document. `explain` prints which part answers each hook |
| `src/seen.ts` | A board drawn from events alone: what a screen holds, held to the loop by the tests |
| `src/types.ts` | The document, the rules and a round's events |
| `src/prng.ts` | The same generator `engine` uses. Each draw has a stream seeded from `<seed>/<draw id>` |
| `examples/` | Swap in seven lines, the same rules written flat by hand, Swap with a part of an author's own, and Cooling: its numbers as data and two parts of its own |

Swap plays in the studio at `/rungs/swap`, on a board drawn through `seen.ts` in the stock skin.

The tests start with determinism, then the deal's check, then that the rules written flat report
the same events as the parts. `test/cooling.test.ts` plays Cooling beside the engine the game ships,
from the same boards, and holds the two to the same board, score, streak and heat after every move:
`@openseas/engine` is a dependency of the tests alone. `test/rungs.test.ts` runs the samples the docs
site teaches rungs 2 and 3 with. The docs site's tests hold the expanded Swap to the typed reference.

Not built yet: ticks, stages, tasks, gauges and stats (rung 4), seats (rung 5), and promotion.
`docs/adr/0092-a-puzzle-is-written-in-rungs.md` gives the order.
