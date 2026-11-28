# @openseas/puzzle

The puzzle engine, written in rungs (ADR 0092). It is pure: no clock, no random number, no I/O, and
no dependency. `pnpm --filter @openseas/puzzle lint` holds it to that.

What is built: rungs 0 and 1, for one seat on a still grid.

| File | Holds |
|---|---|
| `src/loop.ts` | Rung 0: `start`, `play`, `read`, `hint`, `listMoves`, `replay`. The loop runs a whole document and a flat rules object, and holds the deal to its check |
| `src/puzzle.ts` | Rung 1: `puzzle()` with a default for every key, `part()`, and how parts merge |
| `src/stock.ts` | The stock parts (`swap`, `lines`, `refill`), `grid`, `budget`, and the plain board helpers they are built from |
| `src/expand.ts` | `expand` prints the document. `explain` prints which part answers each hook |
| `src/types.ts` | The document, the rules and a round's events |
| `src/prng.ts` | The same generator `engine` uses. Each draw has a stream seeded from `<seed>/<draw id>` |
| `examples/` | Swap in seven lines, the same rules written flat by hand, and Swap with a part of an author's own |

The tests start with determinism, then the deal's check, then that the rules written flat report
the same events as the parts. The docs site's tests hold the expanded Swap to the typed reference.

Not built yet: settings, payouts and multipliers as data (rung 2), the streak, ticks, stages, tasks,
gauges, seats, and promotion. `docs/adr/0092-a-puzzle-is-written-in-rungs.md` gives the order.
