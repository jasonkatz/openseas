# puzzle-spike

**Throwaway.** A spike of the bottom two rungs of the puzzle API ladder, written to answer two
questions before any ADR: do parts merge cleanly, and does a composed puzzle expand into today's
document and flat hooks. Nothing imports this package and it is never deployed. It lives on a
branch of its own and is not meant to merge.

- `examples/swap.puzzle.ts` is the seven-line Swap.
- `src/loop.ts` is rung 0: `start`, `play`, `read` for one seat on a still grid. It takes a document
  and a flat rules object and has never heard of a part.
- `src/puzzle.ts` is rung 1: `puzzle()`, a default for every key of the document, and how parts merge.
- `src/stock.ts` is the stock library: `swap`, `lines`, `refill`, and the plain board helpers under them.
- `src/expand.ts` prints a composed puzzle's whole document, and which part answers each hook.
- `examples/expanded/` holds what `expand` printed for Swap, and the same rules written by hand as one
  flat object, the way the docs site's "Write a puzzle" does it.
- `examples/sparks.puzzle.ts` adds an author's own part to Swap.

Run it:

```
pnpm --filter @openseas/puzzle-spike test     # the spike's questions, as tests
pnpm --filter @openseas/puzzle-spike expand   # write Swap's expansion
pnpm --filter @openseas/puzzle-spike demo     # build demo/dist/swap-spike.html, one file to open and play
```

## What held

1. **Seven lines play.** Swap deals, plays and ends on its budget over 200 seeds, and replays the
   same from its seed and log.
2. **The loop never sees a part.** `puzzle()` merges parts into one document and one flat rules
   object. The hand-written flat rules and the three merged parts reported the same 14,554 events
   over 200 rounds.
3. **The merge rule was enough** for Swap and for Swap with an author's own part: `on` hooks in
   listed order, a cascade step to the first part that reports, a move refused by the first reason.
4. **Ids are typed with no generator.** A move the parts do not bring does not compile.

## What broke, or had to change

1. **No part can own the deal's check.** "No line stands and a move exists" needs to know what
   clears and what a move is, which are two different parts. What worked: the loop holds the check.
   It deals, lets the board settle unseen and unpaid, and deals again when no listed move would set
   off a step. The rules then deal once and naively, and the tutorial's `freshBoard`, `findSwap` and
   its `onMoveEnd` reshuffle all disappear. Still open: the check's fallback (the spike throws after
   50 tries), and how a check names the events it is reported as.
2. **`expand` does not print readable flat rules.** It prints the real document (295 lines for Swap)
   and a rules file that is the list of parts. Turning merged parts into one hand-readable file of
   hooks is code generation the spike did not attempt. `explain` prints which part answers each hook.
3. **The docs site's reference refuses the defaults in four places:** `moment` and `evaluation` are
   required, a ladder needs two stages, and a payout must read a setting.
4. **A part cannot change what another part deals.** The sparks part could not put a spark into
   `refill`'s rise. It turns a piece into one afterwards, with an event of its own.
5. **Move end is ambiguous.** Asked again every time it reports, a part that draws a chance there
   can loop. The spike asks again only when what it reported set the cascade off.
6. **Ids are global across parts.** `lines(3)` twice collides on its setting. Part state is untested:
   no part here keeps any.

## Not done

Not in the studio: the demo is a standalone page with a stock skin drawn in the page, not a skin
document. No multipliers, streak, tiers, ticks, tasks or seats.
