A player meets a puzzle a few rules at a time. On the fourth rung a puzzle says how it opens up, how a round is judged, and takes on whatever else it needs, one key at a time.

> [!PREVIEW]
> This rung is designed and not built yet. The sample shows the shape it will take, and names in it may change.

## Stages

A rule a player unlocks is a part with a name and one line that says the rule. Its settings, its event, what it pays and its hook sit together. A stage lists the parts it switches on.

```ts title=paths.puzzle.ts
const loops = part({
  name: "loops",
  rule: "a closed path takes every prize at once",
  settings: { loopMin: 4, loopPercent: 200, insidePoints: 10, prizeLoopPoints: 50 },
  events: { loop: { fields: { path: "places", inside: "places", prizes: "number", points: "points" }, changes: ["leave"] } },
  payouts: {
    inside: { on: "loop", counts: "inside", growth: "linear" },
    prize_loop: { on: "loop", counts: "prizes", growth: "superlinear" },
  },
  multipliers: { loop: { scales: "path", on: "loop", by: "loopPercent" } },
  onMove: {
    trace(ctx, seat, { path, closed }) {
      if (!closed || path.length < ctx.settings.loopMin) return;
      // report "loop" with the pieces inside and the prizes taken
    },
  },
});

export default puzzle("paths", {
  // ...board, pieces, ending...
  stages: [
    stage("paths", [paths], { advance: bestRound(120) }),
    stage("streak", [streak, prizes], { advance: bestRound(280) }),
    stage("loops", [loops, bounty], { advance: bestRound(780) }),
    stage("full", [timers]),
  ],
  tiers: { steady: 850, sharp: 2450, masterful: 4800, legendary: 8400 },
});
```

A part that is switched off is never asked, so the hook above does not test whether loops are on. A stage changes nothing but which parts are on, and the last stage is the whole puzzle. In the document these are its [layers](/api/puzzle#layers) and its [ladder](/api/puzzle#ladder).

## Judging

Until a puzzle says where its tiers start, its rounds are scored and not judged. `tiers` places a score on the scale every puzzle shares. It is the puzzle's [evaluation](/api/puzzle#evaluation).

## One key at a time

Each of these is added the same way, by saying it. None changes what is already written.

| Add | For |
|---|---|
| A task | A thing to finish inside a round, graded when it is done, such as one pattern to build |
| A gauge | A value a screen shows as it moves, such as heat |
| A ticking tempo | A puzzle whose rules move by themselves, whether or not anyone moves |
| A hint | A move worth making, offered to a player who is stuck |

## What you learned

Four ideas, each taken alone: a stage, a task, a gauge and a tick. Every puzzle for one player can be written on this rung or below it.
