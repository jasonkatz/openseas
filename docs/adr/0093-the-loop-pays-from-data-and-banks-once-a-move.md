# 0093. The loop pays from data and banks once a move

Status: Accepted. Builds on ADR 0003 (engines are pure), ADR 0088 (the rules are hooks on one loop) and
ADR 0092 (a puzzle is written in rungs), whose rungs 2 and 3 it builds. It settles what ADR 0092 left to
design for those rungs, and changes the guide in three places, each named below.

## Context

ADR 0092 left open, for the rung that would need each: the language of a condition, the arithmetic of
scoring, what a hook may read of what the loop keeps, and the unit of time. Rungs 2 and 3 need all four.
They are proved by Cooling, a puzzle the game ships, and Cooling's engine fixed the test: the same board
and the same luck must give the same score, move for move.

Cooling scores a move as a whole. Each step of its cascade pays its groups, times how many cleared
together, times the step's entry in a table. The move's total is then raised by the streak and rounded
down once. The guide said a multiplier's result is rounded down once for each event, which pays a move of
two fives at 110% ten points where Cooling pays eleven.

Cooling also showed two things the first two rungs had wrong for it. A swap that clears nothing is a
legal move there, a setup for the next, so its boards often have no move that scores and must not be
dealt again. And its heat needs to know, in the middle of a move, what the move has earned so far.

## Decision

1. **A condition is one comparison.** `<left> <op> <right>`, where the op is one of `>=`, `>`, `<=`, `<`,
   `==` and `!=`, and each side is a whole number, a setting's id or a field of the event. A field of
   places counts as how many it holds. There is no `and`, no `or` and no arithmetic. A condition that
   needs more is the rules' to hold: the hook reports a field that says so, and the condition reads it.
2. **Events are named one way.** Where a multiplier or the streak names the events it applies on, it
   writes `every`, or ids joined by `or`. A multiplier may add `when` and a condition after them.
3. **Points are kept exact and rounded down once a move.** An event is paid as it is reported: each
   payout that pays on it gives its base, and each multiplier that scales that payout by a percent, or
   by a step's entry in a table, multiplies it. Nothing is rounded yet. A multiplier indexed by the
   streak holds for the whole move, so it is applied when the move is banked, at Close, to everything the
   move earned that it scales. The total is rounded down there, once. This changes the guide, which
   rounded once for each event.
4. **An event's `points` is for showing.** It is what the event is worth before any multiplier that
   holds for the whole move, rounded down. What a move banked is reported beside its events, and the
   score is the sum of what moves banked, never of what events showed.
5. **`pointsFor` stands in for the payouts.** It is handed the event and what the payouts and
   multipliers make of it, and answers what it is worth. An answer that differs is a whole number, and
   is still raised by the streak where the event's first payout is.
6. **One asking is one step.** Every event marked `step` that a hook reports in one asking belongs to one
   step of the cascade, the move's own hook included. Each such event carries its step, counted from 1.
   How many cleared together in a step is the rules' to say: the stock `lines` puts it on each clear as
   the field `together`, and a puzzle that pays for it reads the field in `pointsFor`.
7. **The streak moves once a move.** A move that reported an event that builds it adds one, however many
   it reported. Its grace is a number or a setting.
8. **A hook reads four things the loop keeps:** the score banked so far, the streak, the step, and
   `pending`, what the move would bank if it closed now. It reads nothing else of the loop's.
9. **State is what a hook gives back.** A hook that starts with `on` answers the rules' next state, or
   nothing to keep it. Rules made of parts keep each part's state under its name, and a part is handed
   only its own. The cascade a deal runs unseen leaves no state behind, and a board dealt again during
   play leaves the state alone.
10. **Time is whole milliseconds from the round's start, and it is in the log.** Each line of a log is a
    move and when it was made. A round with a clock refuses a move made at or after its end. The loop
    never ends a round because time passed, since nothing told it so: a host reads a round at a time and
    is told whether its clock has run out. Time never runs backwards within a log.
11. **A check may ask only for a settled board.** `needs: "settled"` lets what would happen by itself
    happen unseen and asks for nothing more. It is for a puzzle where a move that sets nothing off is
    still a move. Left out, a check also asks for a move worth making, as before. This adds a key to the
    puzzle document.
12. **A round may be started on a board it is given**, with where each draw's stream stands. The rules'
    deal is still asked, on a copy, for the state they begin with. No check is held on such a board. It
    is how a studio opens a starting point and how one engine is tested beside another.
13. **A payout may be stepped, and a penalty is a setting below zero.** A group of n that pays n × n − 2n
    is two payouts on one event, one superlinear and one linear at −2, and holds no number in code.

## Consequences

- Cooling is written on the new engine in about 130 lines: its numbers as settings, six payouts, two
  multipliers, a streak, the stock `swap`, `lines` and `refill`, and two parts of its own for its
  special pieces and its heat. A test plays it beside the shipped engine from the same boards for 4,320
  moves over three sets of numbers and holds every step's points, every move's bank, the score, the
  streak, the heat and the board to be the same. It is an example in `packages/puzzle`, not yet the
  engine the game deals: moving Cooling over is promotion, which comes after rung 4.
- The stock parts gained what a second puzzle needed and no more: `swap` may be held to a row and may
  let two alike trade, `refill` may mix other pieces in and may ask only for a settled board, `grid`,
  `budget` and the new `clock` take a setting's name in place of a number, and a round may have more
  than one ending.
- `groupsOf` now takes runs of one kind that touch as one group, where it took only runs that share a
  cell. It is what the guide's example says and what Cooling ships.
- The guide's sections on multipliers, the streak and checks are rewritten to match, and gain a section
  on conditions. The reference marks a check's `needs`, lets a streak's `grace` be a setting, and says
  what a condition is. The rules SDK declares `score` and `streak` on a view and `pending` on a context.
- The docs site's pages for rungs 2 and 3 are no longer previews: their samples are the Cooling example.
- Paths' example document names its streak's events and condition in the new way. Nothing else of it
  changes until rung 4.
- Still to design, with rung 4: tasks, gauges, stats and ticks, and with them how the heat is reported
  as a gauge. Until then a board reads a part's state from `read`.
