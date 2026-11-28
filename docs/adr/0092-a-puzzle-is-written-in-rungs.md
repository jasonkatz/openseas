# 0092. A puzzle is written in rungs: defaults, parts, and nothing hidden

Status: Accepted. Builds on ADR 0003 (engines are pure), ADR 0036 (a prototype is a whole engine in
files of its own), ADR 0088 (the rules are hooks on one loop), ADR 0090 (the engine keeps the table) and ADR 0091 (the docs site). It
changes what ADR 0088 says in three places, each named below.

## Context

The puzzle design in `docs/puzzles/DOMAIN.md` is complete at the top and has no bottom. A puzzle is a
document of 29 top-level keys and rules of up to 21 hooks, and every key is required before one round
can be played. The smallest puzzle the docs site teaches, Swap, takes 132 lines of JSON, 69 lines of
TypeScript and three helper functions the page names and leaves to the reader. A second stage, four
tier starts and a named moment are all asked for before the author has seen a board.

An API people enjoy is flexible for experts, gradual for learners and convenient for beginners, and
is best built in that order. The loop and its hooks are the flexible part, and they are done. Nothing
is gradual, and nothing is convenient.

A throwaway prototype (`packages/puzzle-spike`, removed in this change) built the two lowest rungs to
test the idea. A seven-line Swap played 200 seeds to their endings and replayed each the same. The
same rules written by hand as one flat object reported the same 14,554 events. Four things broke, and
each became a decision here: the deal's check had no owner among the parts, merged rules could not be
printed as code without a code generator, the typed reference refused the defaults in four places,
and one part could not shape what another dealt.

## Decision

Three rules, then the rungs, then eleven decisions.

1. **Everything has a default.** A puzzle with a board, pieces, a move and an ending is valid, and
   plays.
2. **A puzzle is built from parts.** A part is a slice of the puzzle document with the hooks that
   work it. A stock mechanic, a layer and an author's own rule are all parts, written one way.
3. **Nothing is hidden.** However a puzzle is written, the loop runs one whole document and one flat
   set of hooks, and the author can print both. The lower rungs produce the top one. They are not a
   second engine beside it.

**The rungs.** Each adds at most four ideas to the one below and changes nothing already written.

| Rung | The author writes | Proved with |
|---|---|---|
| 0. Run | Three calls: `start`, `play`, `read` | Any puzzle |
| 1. Compose | A board, pieces, stock parts and an ending | Swap |
| 2. Tune | Settings, payouts, multipliers and conditions, as data | Cooling's numbers |
| 3. Rule | A part of their own: an event and a hook or two | Cooling's special pieces |
| 4. Deepen | Stages, tasks, gauges, ticks, a hint | Paths, Gunnery |
| 5. Seat | Sides, turns, phases, sight, stand-ins | Pouring, then Freefall, Pact and Showdown |
| Exit | A reducer: one function that owns its round | Space Battle, Swordfighting |

The whole document and every hook, as ADR 0088 and ADR 0090 give them, are what every rung expands to, and stay
the reference.

4. **Code first, then the document.** Until promotion a puzzle's source is the TypeScript that lists
   its parts. Promotion writes the whole document once, and it is the source from then on.
5. **After promotion, code holds no number.** The file shrinks to its parts and the author's own
   hooks, and the build refuses a number in it. For every puzzle a player can meet, only the document
   holds numbers, as before.
6. **The loop holds the deal's check.** It asks the rules to deal, runs the cascade unseen and
   unpaid, and deals again when no listed move would score. It does the same during play when the
   board runs out. This changes ADR 0088, where the rules held the check inside `onStart` and
   `onMoveEnd`: what clears and what a move is are two parts' rules, so no part can own it.
7. **A puzzle with a check lists its moves.** The loop tries each listed move on a copy. It is the
   only way to ask without knowing the mechanic.
8. **A ready puzzle supplies its fallback, in a hook.** `onFallback` is new. A valid puzzle may leave
   it out, and then a round that cannot be dealt refuses to start and names the check.
9. **Expanding is showing, not generating.** `expand` prints the document and `explain` prints which
   part answers each hook. Nothing writes a file of merged rules. Copying is done one part at a time.
10. **Valid and ready are two states.** The moment, the tier starts, a second stage and a payout's
    settings are needed to ship, not to play. This changes ADR 0088, which had only ready. A valid
    puzzle plays in the studio, scored and unjudged, and the game cannot deal it.
11. **A part shapes another's deal through an option**, as in `refill({ mix })`. There is no general
    way for one part to intercept another.
12. **Ids are the puzzle's.** Two parts declaring one id is an error naming both. A part used twice
    takes a name of its own, and a part's state is held under its name.
13. **Move end is asked again only when what it reported set the cascade off.** ADR 0088 already
    asks it once more in that case. This fixes that it is not asked again otherwise, so a part that
    draws a chance there cannot loop.
14. **A new package, `@openseas/puzzle`, started clean beside `engine`.** The 23 hand-written
    reducers stay where they are, and each moves when the rung it needs exists. `engine` keeps its
    rule of no dependencies. The docs site's rules SDK is this package's surface, and names it.
15. **A new reducer is its own ADR.** The exit is for a shape no other puzzle has, and must not
    become the easy road.

The words: **part**, **stock part**, **reducer**, **valid**, **ready**, **promotion**, **expand**,
**explain** and **rung** go into `docs/puzzles/CONTEXT.md`. A puzzle's ladder is its stages, so the
levels of the API are rungs and the API is never called a ladder in the guide or on the site.

## Consequences

- The guide gains a section, Parts, and the site shows it on the page for the rules. Checks, the
  loop's table, the list of hooks and the conditions for ready are rewritten to match. `onFallback`
  is a hook, declared in the rules SDK.
- The typed reference marks `moment` and `evaluation` as needed only when a puzzle is ready, and lets
  a ladder have one stage and a payout read no setting. A document `expand` prints passes it.
- The docs site's API area starts with rung 1 and has a page a rung. Rungs 2 to 5 are marked as not
  built, and their samples are held to nothing until they are.
- Build order: rungs 0 and 1 with Swap in the studio, rungs 2 and 3 with Cooling compared against its
  shipped engine, rung 4 with Paths and Gunnery, promotion, then rung 5 with Pouring. Each rung is
  proved by a real puzzle before the next begins.
- Still to design, each with the rung that needs it: the shapes of `start`, `play` and `read`; a
  default for every key; the language of a condition; the arithmetic of scoring; what a hook may read
  of what the loop keeps; how a gauge or a stat is reported and a task dealt; who an event pays
  between seats. How a stream is made from the seed, and the unit of time, are decided with rung 0,
  because changing either later changes how every stored round replays.
- Risks held by rule: a stock part gains an option only when a second puzzle needs it, and more than
  four new ideas on a rung is a design bug.
