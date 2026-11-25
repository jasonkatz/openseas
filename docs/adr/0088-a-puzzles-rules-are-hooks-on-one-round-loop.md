# 0088. A puzzle's rules are hooks on one round loop

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md), whose purity and replay
it keeps, [0073](./0073-motion-is-the-skins-and-the-puzzle-names-its-moment.md), whose events carry
every change to the board, [0075](./0075-a-puzzle-declares-its-deal.md), whose streams and secrets it
reads, and [0076](./0076-stand-ins-are-four-types-on-two-dials.md), whose stand-ins it plays. Changes
the puzzle domain guide's lines on the score, on how a round between sides is judged, and on every
puzzle between sides taking the four stand-in types.

## Context

The guide says the rules are the only part of a puzzle that is code, and nothing about their shape.
The twenty-three puzzles in `engine` each wrote theirs by hand as one reducer, and each answers the
same questions its own way: whether a move is allowed, what it does, what follows by itself, what it
is worth, who moves next, what a seat no player holds plays, what a tick does. Pact and Showdown have
their boards send a `next` move on a timer for every stand-in. Freefall plays its rival inside the
player's own drop. Swordfighting runs its cascade twice within one drop, before and after its scrap
ripens, on one count.

A first shape for the rules, tried with one puzzle in the domain engine, was a handful of functions
with one of them, `play`, holding everything a move sets off. It could not say where a stand-in
moves, where a task is dealt or where a cascade ends, so each of those would have stayed each
puzzle's own. The owner found it too abstract to build the other puzzles on, and asked for a plain
frame: a loop every puzzle runs, with named places for a puzzle's own code, on which every puzzle
already written can be made again with nothing sacrificed.

The frame below was held against all twenty-three engines. The eight hardest, Swordfighting, Space
Battle, Showdown, Pact, Engines, Scanner, Gunnery and Freefall, were sketched on it hook by hook
before it was written down, and all eight fit.

## Decision

1. **Every round runs one loop,** the same for every puzzle: Start; then Wait, Check, Move, Cascade,
   Move end and Close, again for every entry until an ending is met; then End. The engine that runs
   a round owns the loop and what the guide gives one meaning for every puzzle: the log, time, seats,
   tasks, points, the streak, the endings and what each seat may see.
2. **The rules are hooks.** A hook is a named place in the loop where the engine asks the rules. A
   hook whose name starts with `on` is asked when something has happened, and it changes the round in
   one way only: it reports events, and reads the board as each event leaves it. Every other hook is a
   question: the rules answer it, and answering changes nothing. Three hooks are required, `onStart`,
   `canMove` and `onMove`. Every other has a default, and a hook added later must come with one, so no
   puzzle already on the frame has to change.

   | Hook | Asked | Left out |
   |---|---|---|
   | `onStart` | Once, at Start: deal the board | Required |
   | `canMove` | At Check: may this seat make this move now, and if not, why | Required |
   | `onMove` | At Move: what the move does | Required |
   | `onCascade` | At Cascade, again until it reports nothing: one step of what follows by itself | Nothing follows |
   | `onMoveEnd` | Once a move, when the cascade has run dry: what the end of the move brings | Nothing |
   | `onTick` | Once for every tick, in order | Nothing happens between moves |
   | `onSignal` | A signal in arrives | It changes nothing |
   | `onTaskNeeded` | Fewer tasks are open than the puzzle declares: deal one, or say there is no room yet | The puzzle has no tasks |
   | `whoseTurn` | At Wait: which seat no player holds moves next | Only players move |
   | `pickMove` | What that seat plays | One of the four stand-in types plays, where the rules answer `listMoves` |
   | `listMoves` | Which moves a seat can make now | None of the four types, and the engine cannot tell that a seat has no move left |
   | `pointsFor` | At Close: what an event is worth | The puzzle's payouts and multipliers pay |
   | `score` | At End: the round's score, read from every side's points, the time played and the outcome | The points of the player's side |
   | `hint` | A move worth making | The puzzle offers no hint |
   | `checkSettings` | Before a round can start: what is wrong with these settings or this map | Only bounds and relations are held |
   | A puzzle's own questions | Whatever else a board, a stand-in or a hint needs to ask, such as a preview | None |

3. **Every move is made by a seat, and every seat runs the same loop.** A solo puzzle has one seat.
   Only Wait differs: a seat a player holds waits for that player's move, and for a seat no player
   holds the engine asks `whoseTurn`, then `pickMove`, and plays the answer at once through the same
   `canMove` and `onMove`. A stand-in's moves are never entries. The log holds only what came from
   outside, moves and signals, a replay works the rest out again, and the board sets the pace it is
   shown at.
4. **The engine counts a cascade, and a move has an end.** Each asking of `onCascade` that reports
   something is a step. `onMoveEnd` is asked once, and when what it reports sets the cascade off
   again, the steps go on from the same count.
5. **A turn's moves are resolved together.** In a puzzle of turns the engine holds each seat's move
   back until every seat has one, then asks `onMove` once with all of them. `canMove` is asked a seat
   at a time, and a stand-in plans before it can see a player's plan.
6. **Ticks run in a fixed order.** Before a move is checked the engine plays every tick up to the
   move's time. Within one tick it is `onTick`, then each seat no player holds whose time to move has
   come, lowest seat first, then a player's move stamped at that tick. How often such a seat moves is
   its delay, which the engine keeps.
7. **The engine keeps a puzzle's tasks:** which are open, each one's grade, what the grade pays, and
   the stock ending. The rules deal one in `onTaskNeeded` and say on an event when one is done,
   wherever that happens, a cascade included. Where the puzzle says the player asks for the next task,
   the engine waits for that control.
8. **Points are a seat's, and stop at zero as they are paid.** An event's points go to the seat that
   earned them, a penalty never takes a seat's points below zero, and a side's points are its seats'
   together. The score is the points of the player's side unless the rules answer `score`.
9. **A secret says who may see it:** nobody, its seat or its side. A question about a move, `canMove`,
   `listMoves`, `pickMove`, `hint` or one of the puzzle's own, is asked with only what its seat may
   see. The hooks that start with `on`, `pointsFor` and `score` see the whole round. The four stand-in
   types choose from everything on the board, so a puzzle with a secret a seat cannot see brings
   stand-ins of its own.
10. **A puzzle between sides says how its rounds are judged:** by their outcome, or by their score
    through tier starts as a solo round is.
11. **Nothing else gets a hook until a puzzle needs one.** A board with no move left is reported from
    `onMoveEnd`: the round fails, the task ends or the seat is out. A turn that runs out of time stays
    outside the rules, and whoever keeps the turn's clock sends an ordinary move.
12. **A puzzle moves onto the frame with nothing sacrificed:** the same rules, numbers and feel. Its
    design file still holds, its own tests pass, its bots land in the same tiers on its ladder table,
    and its board still shows every preview, hint and motion. It need not deal the same round from
    the same seed, since ADR 0075 already moves each draw to a stream of its own.

## Consequences

- The guide gains a section, The rules, with the loop and the hooks. Its lines on points and the
  score, between sides, tiers, Versus, secrets, tasks, sides and stand-ins say what is decided here,
  and the puzzle document gains `evaluation.by` for a puzzle between sides, a secret's `seenBy` and a
  task's `next`. A puzzle between sides is ready when it takes the four stand-in types or brings one
  of its own. The glossary gains loop, hook and question.
- This moves no puzzle and adds no code. Every engine in `engine` keeps its reducer until it is moved
  by a change of its own, held to the bar in decision 12.
- The six puzzles between sides that exist, Space Battle, Swordfighting, Freefall, Showdown, Pact and
  Pouring, are judged by their score today and stay so. Moving one to its outcome is a product
  decision of its own.
- Pact's and Showdown's timed `next` moves go when those puzzles move, since a stand-in's moves are
  replayed and not logged. That changes how their stored rounds replay, so it is a new major (ADR
  0079).
- Left to the building, since none changes the frame: a stream for each stand-in's choices and a
  throwaway one for a hint or a question, so neither shifts the deal; one way to try a move on a copy
  of the round, which `pickMove`, hints and the four stand-in types all need; which steps of a cascade
  a puzzle counts, as Swordfighting counts only those that break; whether what a tick or a signal
  changes runs Cascade and Move end as a move does; an opponent outside the round, which arrives as
  signals; and where gauges, stats and pace are read.
- What a turn does when its time runs out stays under the guide's Not yet covered, until a second
  player sits in a seat.

## Alternatives considered

- **One function for everything a move sets off.** It is the least to learn, and enough for a solo
  puzzle with no cascade. Every puzzle with stand-ins, tasks or a cascade would then place them by
  hand again, which is what the reducers do today.
- **Declaring the rules instead of writing them.** The engines differ most in exactly what a move
  does and what follows it. Saying that without code would take a language of its own, and the owner
  asked for the opposite: plain places to put code, with the engine working around them.
- **A puzzle playing its own stand-ins,** with a logged move for each, as Pact and Showdown do. The
  log fills with moves nobody made, the board's timer becomes part of the round, and every puzzle
  writes turn order again.
- **Hooks that edit the board directly.** A board plays from events alone (ADR 0073), so a change
  with no event would be one no board could show.
