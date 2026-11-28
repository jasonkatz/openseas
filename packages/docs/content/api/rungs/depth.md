A player meets a puzzle a few rules at a time. On the fourth rung a puzzle says how it opens up, and takes on whatever else it needs, one key at a time: a task, a gauge, a stat, a piece that changes.

## Stages

A rule a player unlocks is a part, written as on the rung below: a name, one line that says the rule, and what it declares beside the hooks that work it. A stage lists the parts it switches on.

```ts title=paths.puzzle.ts
import { puzzle, part, stage, bestRound, grid, clock } from "@openseas/puzzle";

const loops = part({
  name: "loops",
  rule: "a closed path takes whatever is inside it and every prize at once",
  settings: [/* loopMin, loopPercent, insidePoints, prizeLoopPoints */],
  events: [{ id: "loop", description: "a path closed", fields: { path: "places", inside: "places", prizes: "places", points: "points" }, changes: ["leave"], step: true }],
  payouts: [
    { id: "inside", description: "each piece inside a loop", on: ["loop"], counts: "inside", growth: "linear", reads: ["insidePoints"] },
    { id: "prize_loop", description: "the prizes a loop takes, squared", on: ["loop"], counts: "prizes", growth: "superlinear", reads: ["prizeLoopPoints"] },
  ],
  multipliers: [{ id: "loop", description: "closing multiplies a path's own points", scales: ["path"], on: "loop", by: { percent: "loopPercent" } }],
  hooks: {
    onMove: {
      trace(ctx, seat, move) {
        if (!move.closed) return;
        // report "loop" with the path, the pieces inside it and every prize on the board
      },
    },
  },
});

export default puzzle("paths", {
  board: grid("width", "height", { touch: 8 }),
  pieces: "kinds",
  stages: [
    stage("paths", [paths], { advance: bestRound(120) }),
    stage("streak", [streak, prizes], { advance: bestRound(280) }),
    stage("loops", [loops, bounty], { advance: bestRound(780) }),
    stage("full", [timers]),
  ],
  ends: clock("roundSeconds"),
  settings: { width: 7, height: 8, kinds: 5, roundSeconds: 120 },
});
```

A round is started at a stage, and at the last one when none is named.

```ts
const round = start(paths, { seed: 1, stage: "streak" });
```

A part that is switched off is never asked, so the hook above does not test whether loops are on. Nothing the part declares exists yet either: the engine refuses its event and its draw, and its payouts pay nothing. A stage changes nothing but which parts are on, and the last stage, `full`, is the whole puzzle. In the document these are its [layers](/api/puzzle#layers) and its [ladder](/api/puzzle#ladder).

| Idea | What it is |
|---|---|
| Stage | A step of the ladder a new player climbs. It names the parts it switches on, and the bar a player clears to move past it |
| Layer | A part that a stage switches on, with everything it declares |

## When one part deals for another

Parts meet only through events and the board. One thing more is allowed: any hook may ask whether a layer is on. It is for the part that deals what a later layer brings. Paths' refill is the one place a new piece comes from, so it is the refill that deals a prize, once prizes are on.

```ts
const prize = ctx.on("prizes") && ctx.draw("prize").chance(ctx.settings.prizePermille);
e.arrive(place, prize ? { piece: "prize" } : { piece: "kind", kind: 1 + ctx.draw("debris").even(ctx.settings.kinds) });
```

Parts are asked in the order the stages list them. A layer that arrives late sometimes needs asking early, as Paths' timers must see a timed piece before the path that takes it leaves the board. The puzzle names the parts to ask first.

```ts
order: ["timers", "bounty"],
```

## A task

A task is a thing to finish inside a round. Paths posts a bounty: one kind, and a bonus for a long path of it. The part declares the task, opens one when the engine asks, and says on an event when it is done.

```ts
const bounty = part<never, { last: number }>({
  name: "bounty",
  rule: "a posted kind pays a bonus for a long path of it",
  tasks: [{ id: "bounty", description: "a long path of the posted kind", open: 1, ends: ["done"], graded: "none", grades: [] }],
  events: [
    { id: "bounty", description: "the bounty was filled", fields: { kind: "number", points: "points" } },
    { id: "posted", description: "a bounty was posted", fields: { kind: "number" } },
  ],
  // ...its settings, its draw and its payout...
  hooks: {
    onMove: {
      trace(ctx, seat, { path }) {
        const kind = ctx.board.at(path[0])!.kind!;
        if (ctx.task("bounty")?.holds.kind !== kind || path.length < ctx.settings.bountyLength) return;
        ctx.emit("bounty", { kind }, (e) => e.done("bounty"));
        return { last: kind };
      },
    },
    onTaskNeeded(ctx) {
      const kind = /* a kind from the draw, never the last one */;
      ctx.emit("posted", { kind }, (e) => e.open("bounty", { kind }));
    },
  },
});
```

The engine keeps which tasks are open. Whenever fewer are open than the task declares, at the start of a round and as each move closes, it asks [`onTaskNeeded`](/api/hooks#ontaskneeded). A task holds whatever the rules gave it, here the kind, and any hook reads it with [`task`](/api/view#task).

## A gauge and a stat

A gauge is a number a player watches while a round is played. A stat is a count shown when it ends. A part declares one, and sets it on an event.

```ts
stats: [{ id: "loops", description: "loops closed" }],
// ...and where the loop is reported:
ctx.emit("loop", { path, inside, prizes }, (e) => e.set("loops", ctx.value("loops") + 1));
```

The engine keeps the value, and the event carries it, so a screen that sees only events can show every number. [`value`](/api/view#value) reads one back, and `read(round)` gives them all. A puzzle with a streak declares the gauge `streak` and the stat `best_streak`, and the engine keeps those two itself.

## A piece that changes

A piece can change where it stands. Paths' timed pieces count down with every move, and one that reaches nothing ruins the pieces round it.

```ts
pieces: [{ id: "timed", of: "kind", states: { count: "timerFuse" } }, { id: "ruined" }],
// ...
ctx.emit("burn", { pieces }, (e) => pieces.forEach((p) => e.change(p, { state: ctx.board.at(p)!.state - 1 })));
ctx.emit("blowup", { place, ruined }, (e) => ruined.forEach((p) => e.change(p, { piece: "ruined" })));
```

A change that names only a state or a kind changes that alone. One that names a piece makes it that piece, whole. Either way the piece keeps its id, so a board can show the same piece changing. An event marked `mistake`, as `blowup` is, can break the streak.

## Paths, whole

Paths is written on this rung as six parts over four stages, in about 330 lines. A test plays it beside the engine the game ships for it, from the same boards at every stage, and holds the two to the same board, streak, bounty and counts after every move.

## Still to come

> [!PREVIEW]
> These are designed and not built yet, and names in them may change.

| Add | For |
|---|---|
| A ticking tempo | A puzzle whose rules move by themselves, whether or not anyone moves |
| Tiers | Where a score sits on the scale every puzzle shares. It is the puzzle's [evaluation](/api/puzzle#evaluation) |
| A graded task | A task with a par, graded when it is done |

## What you learned

Five ideas, each taken alone: a stage, a layer, a task, a gauge and a piece that changes. Every still puzzle for one player can be written on this rung or below it.
