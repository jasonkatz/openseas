The second rung is numbers. Everything that tunes a puzzle, and everything that pays, is written as data. No function is written on this rung.

> [!PREVIEW]
> This rung is designed and not built yet. The sample shows the shape it will take, and names in it may change.

## Numbers are settings

This is a puzzle with the numbers Cooling plays with, one of the game's own. Its board is 6 by 12 with 7 kinds. A round lasts 150 seconds. Later steps of a cascade pay double, then triple. Scoring moves in a row build a streak worth a tenth more each.

```ts title=cooling.puzzle.ts
import { puzzle, grid, swap, lines, refill, clock } from "@openseas/puzzle";

export default puzzle("cooling", {
  board: grid("width", "height"),
  pieces: "kinds",
  parts: [swap({ along: "row" }), lines(3), refill({ from: "below" })],
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

A [setting](/api/puzzle#settings) is a number with a name. Wherever a number could be written, the name of a setting can be, as `grid("width", "height")` does. A bare number is a setting with that default. Give it bounds and a unit when you want a tuning panel to hold it to them.

Because every number is a setting, a tuning panel can show each one and change it, and a round can be started on other values without touching the file.

## What pays

The rules never add a point. You say what an event is worth, and the engine pays it.

| Key | Says |
|---|---|
| [`payouts`](/api/puzzle#payouts) | What an event is worth: the event, what it counts, and how the points grow with the count |
| [`multipliers`](/api/puzzle#multipliers) | What scales a payout: a step of a cascade, or a streak |
| [`streak`](/api/puzzle#streak) | What builds the streak, and how many misses it forgives |

The engine counts the steps of a cascade and keeps the streak. You never do.

## Conditions

Some scoring carries a condition. A streak may build only on a long path, or a beat may play only on a big clear. A condition is a short comparison over an event's fields and the puzzle's settings, and nothing more.

```ts
streak: { builds: { on: ["clear", "loop"], when: "path.length >= streakMin" }, grace: 1 },
```

It is data, like the rest of this rung. Someone who has never seen a hook can read it, and a tuning panel can show it.

## What you learned

Four ideas: a setting, a payout, a multiplier and a condition. When a rule of your puzzle fits none of them, the next rung is [a part of your own](/api/own-rule).
