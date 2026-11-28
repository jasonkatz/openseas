# 0094. Depth is said on events: stages, tasks, gauges and stats

Status: Accepted. Builds on ADR 0066 (a puzzle is learned on a ladder), ADR 0088 (the rules are hooks on
one loop), ADR 0092 (a puzzle is written in rungs), whose rung 4 it builds for a still puzzle, and
ADR 0093 (the loop pays from data and banks once a move). It changes the guide in the places named below.

## Context

Rung 4 is where a puzzle says how it opens up: its stages, and whatever else it needs, a task, a gauge,
a stat, a piece that changes. ADR 0092 fixed the shape, a stage lists the parts it switches on, and left
the rest to the rung. It is proved by Paths, whose shipped engine is Salvage: six rules over four
stages, a posted bounty, a streak, and timed pieces that count down and ruin their neighbours.

Salvage fixed the test, as Cooling did for the rungs below: the same board and the same luck must give
the same board, move for move, at every stage. Writing it showed what the guide had not said. It
declared gauges, stats and tasks, and did not say how a hook moves one. It said a part never asks
whether it is on, and Paths' refill must know whether prizes are, because it is the refill that deals
them. And it said the board is dealt again when no move is left, where Salvage deals only its plain
pieces again and leaves a prize and a timed piece standing.

## Decision

1. **A part in a stage is a layer.** A puzzle lists its parts, all on, or its stages, each a list of the
   parts it switches on. The layer's id is the part's name, and it brings everything the part declares:
   its pieces, events, draws, settings, payouts, multipliers, gauges, stats and tasks. Until the round's
   stage reaches it the part is never asked, an event or a draw of its own is refused, and its payouts
   and multipliers pay nothing. Where a layer brings the streak's gauge, no streak is kept until that
   layer is on. The last stage is `full`. A setting a layer brings keeps its value at every stage, and
   a host leaves it out of a tuning panel.
2. **A hook may ask whether a layer is on.** `on(layer)` is on every view. A part still never tests
   whether it is on itself. It is for the part that deals: Paths' refill deals a prize only where the
   prizes layer is on. An option on the part that deals could not say it, because an option is fixed
   when the puzzle is written and a stage is chosen when a round starts.
3. **Parts are asked in the order the stages list them, and `order` names the ones asked first.** A
   layer that arrives late may need asking early: Paths' timers must see a timed piece before the path
   that takes it leaves the board.
4. **A gauge and a stat are set on an event.** `e.set(id, value)` sets one the puzzle declares, the loop
   keeps it, `value(id)` reads it, and `read(round)` gives them all. The event carries what it set, so a
   screen that sees only events can show every number. One that nothing has set stands at 0. The loop
   keeps `streak` and `best_streak` itself, and setting either is refused.
5. **A task is opened and finished on an event.** `e.open(task, holds)` opens one with what it holds,
   such as the kind a bounty names, and `e.done(task)` finishes the oldest open one. `task(id)` reads it.
   At the start, and at Close after the check, the loop asks `onTaskNeeded` while fewer are open than
   the task declares, and stops when the rules open none. Opening more than it declares is refused.
   Grading a task by par or by best is not built: every task is graded by nothing.
6. **A change that names a piece makes it that piece, whole.** `e.change(place, { piece })` leaves the
   piece its id and nothing else, so a timed piece that is ruined keeps no kind and no count. A change
   that names only a kind or a state changes that alone. A piece's state is a count or a named form.
7. **A check that holds during play hands the rules the board as it stands.** The rules' deal is asked
   on a copy that still holds every piece, and what it leaves alone stays where it is with its id. So a
   puzzle chooses what is dealt again: Paths deals its plain pieces and keeps the rest. The rules' state
   is left as it was. A trial deal runs the cascade and nothing after it: `onMoveEnd` is a move's.
8. **A move is worth making when it sets off a step or pays.** It is what a check and a hint ask of a
   listed move. A puzzle whose verb is its only scoring event marks that event as a step.
9. **A round may be started on a given board.** `start` takes a board, the tasks open on it, and where
   each draw's stream stands. A stream given is the one the deal draws from. It is how a test starts
   two engines level, and how a host will resume a round it did not deal.
10. **Paths rounds once a move, as every puzzle does.** Salvage rounds a path's points down, and then
    each prize taken at the floor. Over the 9,600 moves the test plays, the two differ on 5, each by
    one point. Every other number is the same.

Still to build on this rung: a ticking tempo, terrain, and a draw from a bag, with Gunnery. A puzzle's
tiers and a task's par wait for the rung that judges a round.

## Consequences

- `packages/puzzle` runs Paths at each of its four stages. Its test plays 800 moves at every stage on
  three sets of numbers beside Salvage, and holds the two to the same board, streak, bounty, counts and
  luck after each one. It also deals the same opening board from the same seed.
- The guide gains three things a hook does on an event (set, open, done), three things a view reads (a
  layer, a value, a task), `order`, and what a check during play hands the rules. The rules SDK on the
  docs site declares the same six.
- A puzzle that needs a rule to know about another layer says so in the open, with `on`. The price is
  that such a part cannot be lifted into another puzzle without the layer it names.
- Salvage's content cuts its stages by setting numbers to nothing. Paths cuts the same stages by
  leaving parts off, and the test holds the two ways to the same rounds.
