The rules are a puzzle's code, and the only part of it that is code. They live in one file, `<id>.rules.ts`, and they are small. One loop runs every round of every puzzle, and it asks the rules only for what is the puzzle's own: what a move does, and what follows from it.

> [!PREVIEW]
> The engine that runs these rules is being built to this design. The loop, the hooks and what each is asked are settled. Exact TypeScript signatures may still move, and [a few edges](#not-settled-yet) are open.

## A rules file

A rules file exports one object of hooks, passed through `defineRules`.

```ts title=swap.rules.ts
import { defineRules } from "@openseas/engine";
import type { Swap } from "./swap.puzzle.gen";

type State = {};

export default defineRules<Swap, State>({
  // Start: deal the board.
  onStart(ctx) {
    ctx.emit("fill", {}, (e) => {
      for (const place of ctx.board.places()) {
        const kind = 1 + ctx.draw("fill").even(ctx.settings.kinds);
        e.arrive(place, { piece: "kind", kind }, "above");
      }
    });
    return {};
  },

  // Check: may this seat make this move now? Answer null, or the reason it may not.
  canMove(view, { a, b }) {
    const touching = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    return touching ? null : "pick two pieces side by side";
  },

  // Move: what the move does, reported as an event.
  onMove(ctx, seat, { a, b }) {
    ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
  },
});
```

`defineRules` takes two types.

| Type | Is |
|---|---|
| `P` | The puzzle's own type, made from its document. It is what lets the compiler know every id the puzzle declares |
| `S` | The rules' own state: whatever the puzzle must remember that the engine does not already keep |

Three hooks are required: [`onStart`](/api/hooks#onstart), [`canMove`](/api/hooks#canmove) and [`onMove`](/api/hooks#onmove). Every other hook has a default, so a puzzle writes only the ones it needs.

## The loop

Every round runs the same loop. A hook is a named place in it where the rules are asked.

<!-- figure: loop -->

| Stage | What happens | Hooks asked |
|---|---|---|
| Start | The round is made from its seed and settings, and its first phase opens | `onStart`, `onOpen` |
| Wait | The loop works out who is awaited. A seat no player holds does not wait: it is played | `whoseTurn`, `onTurn`, `pickMove` |
| Check | A move from a seat that is not awaited, or one the open phase does not take, is refused. Only then are the rules asked | `canMove` |
| Move | The move is made. Where seats act together, every seat's move is made at once | `onMove` |
| Cascade | What the move sets off, a step at a time, until a step reports nothing. The loop counts the steps | `onCascade` |
| Move end | Asked once, when the cascade has run dry. What it reports may set the cascade off again | `onMoveEnd` |
| Close | Points are paid and banked, the streak is kept, tasks are graded and dealt, phases close and open, and the endings are checked | `pointsFor`, `onTaskNeeded`, `onClose`, `onOpen` |
| End | An ending is met. The sides are placed, and the score is read for each seat | `onEnd`, `placing`, `score` |

Wait to Close runs again for every entry until an ending is met. A tick goes to `onTick` and a signal goes to `onSignal`, where a move goes to `canMove` and `onMove`. Every entry and every tick then runs Cascade, Move end and Close, as a move does.

## Two kinds of hook

A hook's name says which kind it is.

| | A hook that starts with `on` | Any other hook |
|---|---|---|
| Is | Told that something happened | A question |
| Is given | A [context](/api/context): the whole table | A [view](/api/view): what one seat may see |
| May | Report events, and return the next state | Answer |
| Changes the round | Only through the events it reports | Never |

This split is what keeps a puzzle honest. A question cannot change anything, so a board, a stand-in or a hint may ask one at any time. A hook that changes the round can only do it by reporting an event, so a board that plays from events always shows what happened.

## State

The rules' state is plain data. An `on` hook returns the next state, or returns nothing to keep the state as it is.

```ts
type State = {
  dealer: Seat;
  bids: (number | null)[];
  broken: boolean;
};
```

Two things are true of it, always.

- **It holds only what the engine does not keep.** The board, the zones, points, the streak, whose turn it is and which phase is open are the engine's. Many puzzles keep an empty state.
- **It is public.** Every seat's view holds all of it. Anything a seat must not see is a piece in a place that seat cannot see, with no exception.

## The rules are pure

The same seed, settings and log must always make the same round. So a hook never reads a clock, never asks for a random number, and never reaches outside itself.

| A hook never uses | It uses |
|---|---|
| `Math.random` | A [draw](/api/context#draw) the document declares |
| `Date` or a timer | The time on the entry, and ticks |
| Anything global, a file or the network | Its arguments |

Every draw has a stream of its own, made from the seed and the draw's id. A move that changes what one draw is asked for never changes what the others give.

## What the engine keeps

None of this is ever written in a rules file.

- **The log and time.** Every entry is stamped and kept. A replay is the engine's.
- **Seats and the wait.** Who holds each seat, who the round is waiting for, and refusing a move from anyone else.
- **Phases.** Opening and closing them in the declared order, and refusing a move the open phase does not take.
- **Sight.** Building each seat's view and cutting each seat's copy of every event.
- **Points.** Paying every payout and multiplier, banking, the floor at zero, and the streak.
- **Cascades.** Counting the steps.
- **Tasks.** Which are open, each one's grade, and what the grade pays.
- **Endings.** Meeting them, placing the sides and reading the score.
- **Stand-ins.** Playing any seat no player holds, through the same `canMove` and `onMove` as a player.

## Every id is checked

Every id the rules name must be in the document: a draw, an event, a zone, a phase, a move, a payout. With the puzzle's type made from its document, a wrong id does not compile. At run time the engine refuses one, and names it.

The check runs both ways. A host will not run a puzzle whose document declares a part its rules never use.

## What every puzzle is tested by

Because the document says what the table is, every puzzle is tested from it. None of these is written by the puzzle's author.

| Test | What it does | What it catches |
|---|---|---|
| Finish | Plays many rounds with careless stand-ins in every seat | A round that never ends, and a wait where the awaited seat has no move |
| Sealed | Deals again what one seat cannot see, then plays on with that seat's own moves | Anything that seat is shown that differs before a revealing event |
| Hand-over | Changes holders and lapses seats at random entries | A round that stalls or replays differently after a hand-over |
| Leaving | Ends every round at a random entry | A score the payouts cannot make, or a side with no place |
| Board, for each seat | Draws the board from one seat's own events | A board that differs from that seat's view |
| Declared is used | Looks for every declared phase, zone, ending, payout, draw and dial in play | A declared part the rules never use |

A puzzle also keeps a few witness rounds: recorded rounds, each a seed, settings, a log and the read it must give. A change that alters one without raising the puzzle's major version fails the checks.

## Not settled yet

These are open while the engine is built. The pages here say what is decided and leave the rest unsaid.

- How the rules report the value of a gauge or a stat that the engine does not count itself.
- How `onTurn` says that a seat passes.
- The exact arguments of `onMove` in a phase where seats act together.
- Jumping between phases. Phases run in the order declared.
- Trying a move where a seat cannot see everything. Until then, such a puzzle brings its own stand-in.
