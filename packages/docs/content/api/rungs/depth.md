A player meets a puzzle a few rules at a time. On the fourth rung a puzzle says how it opens up, and takes on whatever else it needs, one key at a time: a task, a gauge, a stat, a piece that changes, a tempo that ticks, terrain and a map.

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

## A puzzle that ticks

Some puzzles move by themselves. In Gunnery pieces roll across a deck whether or not the player does anything. Such a puzzle sets its tempo, and a part answers [`onTick`](/api/hooks#ontick).

```ts title=gunnery.puzzle.ts
import { puzzle, part, ticking, grid, clock, budget } from "@openseas/puzzle";

export default puzzle("gunnery", {
  board: grid("width", "height"),
  tempo: ticking(200),
  parts: [deck, arrows, turrets, rolling, feed],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  // ...
});
```

A tick's length is the puzzle's own, in milliseconds, and no setting changes it. Ticks are counted from 1, and tick `n` falls at `n` times that length. The engine asks every part that has `onTick`, in the order the puzzle lists them, then runs the cascade and closes the tick as it closes a move.

A tick is never in the log. A move carries the time it was made, and the engine plays every tick due by then before it checks the move. So a round played again from its log ticks alike, however the time between moves was cut up. A host that only wants time to pass calls `advance(round, { at })`.

## Terrain and a map

A cell's terrain is what the cell is, apart from the piece on it. A part declares terrain as it declares pieces, with states where it has them.

```ts
const turrets = part({
  name: "turrets",
  rule: "a full turret fires by itself, and every turret firing is a broadside",
  terrain: [{ id: "turret", states: ["empty", "one", "two", "full", "jammed"] }],
  events: [{ id: "fire", description: "a full turret fired", fields: { at: "place" }, changes: ["change"] }],
  hooks: {
    onTick(ctx, tick) {
      // for each turret whose time has come:
      ctx.emit("fire", { at }, (e) => e.change(at, { terrain: "turret", state: "empty" }));
    },
  },
});
```

A hook reads a cell with [`board.terrain`](/api/view#board-terrain) and [`board.terrainState`](/api/view#board-terrainstate), and changes one on an event, as it changes a piece. A cell off the board reads as `off`, so rules that look one step ahead of a piece need no check for the edge.

A map is a board drawn by hand: a row for each row of the board, a terrain id for each cell. A puzzle keeps its maps in a setting of type `maps`, a draw picks one, and the rules lay it out on an event with `layMap`, so a screen can draw the deck from the event alone.

```ts
const deck = part({
  name: "deck",
  rule: "pieces roll across a deck drawn by hand",
  settings: [{ id: "decks", type: "maps", description: "the decks a round may be played on", group: "board" }],
  terrain: [{ id: "wall" }, { id: "crate" }, { id: "feeder" }, { id: "hatch" }],
  draws: [{ id: "deck", description: "which deck the round is played on", gives: "map", by: "pick", when: "start", reads: ["decks"] }],
  events: [{ id: "deck", description: "the deck was laid out", fields: { map: "number" }, changes: ["change"] }],
  hooks: {
    onStart(ctx) {
      const map = ctx.draw("deck").even(ctx.settings.decks.length);
      ctx.emit("deck", { map }, (e) => layMap(e, ctx.settings.decks[map]));
    },
  },
});
```

`mapOf` turns rows of text into a map, a character a cell. The engine refuses a map that does not fit the board, or that names terrain the puzzle does not declare, before a round starts.

## A bag

A bag is luck with a bound. It is filled from a list of counts, shuffled, and dealt out to the last item before it is filled again, so every run of that length holds the same pieces.

```ts
draws: [{ id: "feed", description: "the next piece out of the bag", gives: "piece", by: "bag", when: "tick", reads: ["bag"] }],
// ...and where the feeder drops a piece:
const next = ctx.draw("feed").next();
```

`next()` gives the item's number, counted from 0, among those the list counts. The engine keeps the bag, so a round played again deals alike.

## A streak that counts events

A streak counts moves unless it says otherwise. In a ticking puzzle successes come by themselves, two in one tick or none for many, so Gunnery's counts events.

```ts
streak: { builds: "loaded", counts: "events", breaksOn: ["jam"] },
```

Every full load builds it and is paid at the streak it leaves. A jam breaks it there and then. Nothing is a miss, so it takes no grace.

## Gunnery, whole

Gunnery is written on this rung as five parts in about 280 lines. A test plays it beside the engine the game ships for it, on the same decks from the same bags, and holds the two to the same pieces, turrets, feed, score and streak after every tick and every move.

## Still to come

> [!PREVIEW]
> This is designed and not built yet, and names in it may change.

| Add | For |
|---|---|
| A graded task | A task with a par, graded when it is done |

## What you learned

Nine ideas, each taken alone: a stage, a layer, a task, a gauge, a piece that changes, a tick, terrain, a map and a bag. Every puzzle for one player can be written on this rung or below it.
