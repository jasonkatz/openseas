On the third rung you write code for the first time: a part of your own, for the rule no stock part gives. Nothing from the rungs below changes.

> [!PREVIEW]
> This rung is designed and not built yet. A part of an author's own ran beside stock parts in a prototype. The sample shows the shape it will take, and names in it may change.

## A part of your own

A special piece that clears the three by three around it when it is swapped is no stock part's rule. It is one small part.

```ts title=cooling.puzzle.ts
import { puzzle, part, around, swap, lines, refill } from "@openseas/puzzle";

const spark = part({
  name: "spark",
  pieces: ["spark"],
  settings: { sparkPermille: 12 },
  events: { burst: { fields: { at: "place", pieces: "places", points: "points" }, changes: ["leave"], step: true } },
  onMove: {
    swap(ctx, seat, { a, b }) {
      const at = [a, b].find((p) => ctx.board.at(p)?.piece === "spark");
      if (!at) return;
      const pieces = around(ctx.board, at, 1);
      ctx.emit("burst", { at, pieces }, (e) => pieces.forEach((p) => e.leave(p)));
    },
  },
});

export default puzzle("cooling", {
  // ...everything from the rung below...
  parts: [
    swap({ along: "row" }),
    lines(3),
    refill({ from: "below", mix: [{ piece: "spark", permille: "sparkPermille" }] }),
    spark,
  ],
  pointsFor: (event, paid) => (event.event === "clear" ? event.size * (event.size - 2) : paid),
});
```

A part holds what it declares, here a piece, a setting and an event, beside the [hooks](/api/hooks) that work them. It is written the way a stock part is.

| Idea | What it is |
|---|---|
| Hook | A named place where the engine asks your code. `onMove` is told a move was made. Its name says whether it is told something or asked something |
| Event | The only way code changes a round. A hook reports that something happened, and the event carries what changed on the board |
| Draw | A declared source of luck. All luck comes from the seed, so a hook never asks for a random number |
| State | What a part must remember that the engine does not already keep. It is held under the part's name |

The part reports `burst` and never touches the score. The engine pays it, as it pays every event.

## How parts meet

Parts meet only through events and the board. A part never calls another. `swap` trades two pieces. `spark` sees that one of them was a spark and clears around it. `lines` sees lines on the board, and `refill` sees gaps.

| When the engine | It asks |
|---|---|
| Tells the puzzle something happened | Every part with that hook, in the order you list them |
| Runs one step of a cascade | The parts in order, stopping at the first that reports anything |
| Asks whether a move is allowed | Every part with a say on that move. The first reason given refuses it |

Two parts that declare the same id are refused, and the error names both. A part used twice takes a name of its own, as in `lines(3, { as: "rows" })`.

One part cannot reach into another. Where one must shape what another deals, the part that deals has an option for it: `refill` is told to mix sparks in. [How parts meet](/domain/rules#how-parts-meet) gives the rules whole.

## When scoring is your own

Where no growth curve gives what an event is worth, [`pointsFor`](/api/hooks#pointsfor) is handed the event and what the engine would pay, and answers what it is worth. Above, a group of n pays n × (n − 2).

## When a stock part is nearly right

Copy that one part into your own file and change it. A stock part uses only what any part may use, so the copy is ordinary code, and the other parts beside it do not notice.

## What you learned

Four ideas: a hook, an event, a draw and state. The [rules SDK](/api/rules) is the reference for all of it.
