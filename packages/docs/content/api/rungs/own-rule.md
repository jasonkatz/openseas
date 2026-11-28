On the third rung you write code for the first time: a part of your own, for the rule no stock part gives. Nothing from the rungs below changes.

## A part of your own

Cooling has a piece no stock part knows: a charge. Swap it, and everything in the three by three around it clears. It is one small part.

```ts title=cooling.puzzle.ts
import { puzzle, part, around, swap, lines, refill, clock, type SwapMove } from "@openseas/puzzle";

const charge = part({
  name: "charge",
  rule: "a charge swapped clears everything around it",
  pieces: [{ id: "charge" }],
  events: [{ id: "burst", description: "a charge cleared everything around it", fields: { at: "place", pieces: "places", points: "points" }, changes: ["leave"], step: true }],
  hooks: {
    onMove: {
      swap(ctx, seat, { a, b }: SwapMove) {
        // swap() has already traded the two, so the charge is where the other piece was.
        const at = [a, b].find((p) => ctx.board.at(p)?.piece === "charge");
        if (!at) return;
        const pieces = around(ctx.board, at, 1);
        ctx.emit("burst", { at, pieces }, (e) => pieces.forEach((p) => e.leave(p)));
      },
    },
  },
});

export default puzzle("cooling", {
  // ...everything from the rung below...
  parts: [
    swap({ along: "row" }),
    charge,
    lines(3),
    refill({ mix: [{ piece: "charge", permille: "chargePermille" }] }),
  ],
  settings: { /* ... */ chargePermille: 12 },
});
```

A part holds what it declares, here a piece and an event, beside the [hooks](/reference/hooks) that work them. It is written the way a stock part is.

| Idea | What it is |
|---|---|
| Hook | A named place where the engine asks your code. `onMove` is told a move was made. Its name says whether it is told something or asked something |
| Event | The only way code changes a round. A hook reports that something happened, and the event carries what changed on the board |
| Draw | A declared source of luck. All luck comes from the seed, so a hook never asks for a random number |
| State | What a part must remember that the engine does not already keep. It is held under the part's name |

The part reports `burst` and never touches the score. The engine pays it, as it pays every event: one point for each piece, until a payout says otherwise.

## How parts meet

Parts meet only through events and the board. A part never calls another. `swap` trades two pieces. `charge` sees that one of them was a charge and clears around it. `lines` sees lines on the board, and `refill` sees gaps.

| When the engine | It asks |
|---|---|
| Tells the puzzle something happened | Every part with that hook, in the order you list them |
| Runs one step of a cascade | The parts in order, stopping at the first that reports anything |
| Asks whether a move is allowed | Every part with a say on that move. The first reason given refuses it |

Two parts that declare the same id are refused, and the error names both.

One part cannot reach into another. Where one must shape what another deals, the part that deals has an option for it: `refill` is told to mix charges in. [How parts meet](/domain/rules#how-parts-meet) gives the rules whole.

## A part that remembers

Cooling's heat is a line that rises a little with every move and falls with the points a move earns. No stock part keeps it, and the engine does not either, so the part does. A hook that starts with `on` gives back the part's next state, or nothing to keep it as it is.

```ts
const heat = part<never, { heat: number }>({
  name: "heat",
  rule: "the heat rises with every move and falls with the points banked",
  settings: [{ id: "heatStart", type: "whole", default: 3, min: 0, max: 12, description: "rows under heat when a round starts", group: "tempo" }],
  hooks: {
    onStart: (ctx) => ({ heat: ctx.settings.heatStart as number }),
    onMoveEnd: (ctx) => ({ heat: Math.max(0, ctx.state.heat + 1 - Math.floor(ctx.pending / 40)) }),
  },
});
```

A hook reads four things the engine keeps for it: [`score`](/reference/view#score), [`streak`](/reference/view#streak), [`step`](/reference/context#step) and [`pending`](/reference/context#pending), which is what the move would bank if it closed now. A host reads a part's state from `read(round).state`, under the part's name.

## When scoring is your own

Where no growth curve gives what an event is worth, [`pointsFor`](/reference/hooks#pointsfor) is handed the event and what the engine would pay, and answers what it is worth. Cooling pays more for clearing several groups in one step. Each clear from `lines` says how many cleared together, and the puzzle multiplies by it.

```ts
pointsFor: (event, paid) => paid * ((event.fields.together as number | undefined) ?? 1),
```

Reach for it last. A group of n that pays n × n − 2n needs no code: it is two payouts on one event, one superlinear and one linear at −2.

## When a stock part is nearly right

Copy that one part into your own file and change it. A stock part uses only what any part may use, so the copy is ordinary code, and the other parts beside it do not notice.

## Cooling, whole

Cooling as the game ships it is written on these two rungs in about 130 lines: its numbers as settings, six payouts, two multipliers and a streak, three stock parts, and two parts of its own for its special pieces and its heat. A test plays it beside the engine the game ships from the same boards, and holds the two to the same score after every move.

## What you learned

Four ideas: a hook, an event, a draw and state. The [rules SDK](/guides/rules) is the reference for all of it.
