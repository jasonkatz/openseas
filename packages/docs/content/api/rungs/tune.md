The second rung is numbers. Everything that tunes a puzzle, and everything that pays, is written as data. No function is written on this rung.

## Numbers are settings

This is a puzzle with the numbers Cooling plays with, one of the game's own. Its board is 6 by 12 with 7 kinds. A round lasts 150 seconds. Later steps of a cascade pay double, then triple. Moves in a row that clear something build a streak worth a tenth more each.

```ts title=cooling.puzzle.ts
import { puzzle, grid, swap, lines, refill, clock } from "@openseas/puzzle";

export default puzzle("cooling", {
  board: grid("width", "height"),
  pieces: "kinds",
  parts: [swap({ along: "row" }), lines(3), refill()],
  ends: clock("roundSeconds"),

  settings: {
    width: 6, height: 12, kinds: 7,          // a bare number is a setting with that default
    roundSeconds: { default: 150, min: 30, max: 600, unit: "seconds" },
    cascadePercent: [100, 200, 300],
    streakPercent: [100, 110, 120, 130, 140, 150],
  },
  payouts: { group: { on: "clear", counts: "pieces", growth: "superlinear" } },
  multipliers: {
    cascade: { scales: "group", by: "cascadePercent", index: "step" },
    streak: { scales: "group", by: "streakPercent", index: "streak" },
  },
  streak: { builds: "clear", grace: 1 },
});
```

A [setting](/reference/puzzle#settings) is a number with a name. Wherever a number could be written, the name of a setting can be, as `grid("width", "height")` does. A bare number is a setting with that default. Give it bounds and a unit when you want a tuning panel to hold it to them.

Because every number is a setting, a tuning panel can show each one and change it, and a round can be started on other values without touching the file.

```ts
let round = start(cooling, { seed: 7, settings: { kinds: 5, roundSeconds: 60 } });
```

## What pays

The rules never add a point. You say what an event is worth, and the engine pays it.

| Key | Says |
|---|---|
| [`payouts`](/reference/puzzle#payouts) | What an event is worth: the event, what it counts, and how the points grow with the count |
| [`multipliers`](/reference/puzzle#multipliers) | What scales a payout: a step of a cascade, or a streak |
| [`streak`](/reference/puzzle#streak) | What builds the streak, and how many misses it forgives |

The engine counts the steps of a cascade and keeps the streak. You never do.

A group of four on the second step of a cascade, in the third move in a row to clear anything: 4 × 4 = 16, times 200% for the step, is 32, and the clear shows 32. A move is paid at the streak it leaves, and the third entry of the table is 120, so the move banks 32 × 120% = 38.4, rounded down to 38. Points are rounded down once, when a move is banked. What a move banked is on the round beside its events.

```ts
round = play(round, move, { at: 12_400 });
console.log(round.last.banked);  // what the move added to the score
console.log(read(round).streak);
```

An event that carries points and has no payout pays one point for each piece it names, which is how the [quickstart](/guides/quickstart) scored without saying anything.

## A clock

A round that ends on a clock is told when each move was made, in milliseconds from the round's start. A move made at or after the end is refused. The engine has no clock of its own, so a round played again from its log is always the same round.

```ts
read(round, { at: 151_000 }).ended;  // "clock"
```

A puzzle may have more than one ending: `ends: [clock("roundSeconds"), budget("maxMoves")]`.

## Conditions

Some scoring carries a condition. A streak may build only on a long path, or a multiplier may apply only to a big clear. A [condition](/reference/types#condition) is one comparison over an event's fields and the puzzle's settings, and nothing more.

```ts
streak: { builds: ["clear", "loop"], when: "path >= streakMin", grace: 1 },
multipliers: { big: { scales: "group", on: "clear when size >= 5", by: "bigPercent" } },
```

It is data, like the rest of this rung. Someone who has never seen a hook can read it, and a tuning panel can show it.

## What you learned

Four ideas: a setting, a payout, a multiplier and a condition. When a rule of your puzzle fits none of them, the next rung is [a part of your own](/guides/own-rule).
