A puzzle is a board, some pieces, something a player does and a way for a round to end. Say those four things and it plays. Everything else the engine knows about has a default, and stays out of your way until you want to change it.

> [!PREVIEW]
> The engine is being built to this design, a rung at a time. This page is the first two rungs, and they are built: everything on it runs as written, and this Swap plays in the studio. Names may still move while the rungs above are built.

## A whole puzzle

This is Swap: trade two touching pieces, and three or more of a kind in a line clear. The pieces below rise, new ones come in, and that can clear again.

```ts title=swap.puzzle.ts
import { puzzle, grid, swap, lines, refill, budget } from "@openseas/puzzle";

export default puzzle("swap", {
  board: grid(6, 7),
  pieces: 5,
  parts: [swap(), lines(3), refill()],
  ends: budget(20),
});
```

| Line | Says |
|---|---|
| `puzzle("swap", …)` | The puzzle's id: a plain word for its mechanic |
| `board: grid(6, 7)` | A grid six wide and seven tall |
| `pieces: 5` | Five kinds of piece, alike but for their kind |
| `parts: […]` | What a player does and what follows from it, as three stock parts |
| `ends: budget(20)` | A round is twenty moves |

A **part** is a mechanic with everything it needs: what it declares, and the code that works it. `swap` brings the move and refuses a bad one with a reason. A reason is a text key, so a skin gives it its words. `lines` finds every line and clears it. `refill` deals the board, lets pieces rise into the gaps and brings new ones in.

## Play a round

Three calls are everything a server, a test or a screen needs.

```ts
import { start, play, read } from "@openseas/puzzle";
import swap from "./swap.puzzle";

let round = start(swap, { seed: 7 });
round = play(round, { move: "swap", a: { x: 4, y: 0 }, b: { x: 4, y: 1 } });

console.log(round.last.refused); // null, or the text key of the reason, such as "reason.side_by_side"
console.log(round.last.events);  // what happened: a swap, then each clear and each rise
console.log(read(round).score);
```

A round is a value. `play` does not change the one it is given: it gives back the next. The same seed and the same moves always make the same round, so a server can play a round again from its moves and trust nothing a screen tells it.

A screen draws a round from its events alone. Each one carries what changed on the board.

## What you did not write

| Not written | Where it came from |
|---|---|
| The move and the events | The parts. `swap` brings the move and its event, `lines` the clear, `refill` the deal and the rise |
| Settings | Every number above became one: `width`, `height`, `kinds`, `moves`, and `lineMin` from `lines(3)` |
| A fair deal | The engine. A board never opens with a line already standing, or with no move to make. When play runs a board out of moves, it is dealt again |
| Scoring | The default: one point for each piece an event clears |
| Counting the moves, ending the round, the log | The engine, as for every puzzle |
| A look | A stock skin: an outline for each kind, told apart without colour |

## See all of it

Nothing is hidden behind those seven lines. They make one whole [puzzle document](/reference/puzzle) and one object of [hooks](/reference/hooks), and that pair is all the engine ever runs. You can print both.

```ts
import { expand, explain } from "@openseas/puzzle";
import swap from "./swap.puzzle";

console.log(expand(swap));  // the whole document, as JSON: close to 300 lines
console.log(explain(swap)); // which part answers each hook, and in what order
```

```text
onStart    refill
canMove    swap
onMove     swap
onCascade  lines, then refill   (the first to report anything ends the step)
listMoves  swap
```

Read the document when you want to know what a default is. You need none of it yet.

## Where to go from here

Each rung adds a few ideas to the one below, and nothing you have written changes when you climb.

| Rung | You write | You learn |
|---|---|---|
| Run and compose | This page | Round, move, board, pieces, part, ending |
| [Tune](/guides/tune) | Numbers and what pays, as data | Setting, payout, multiplier, condition |
| [Write a rule](/guides/own-rule) | A part of your own | Hook, event, draw, state |
| [Add depth](/guides/depth) | Stages a player unlocks, and more | Stage, task, gauge, tick |
| [Seat more players](/guides/seats) | Sides, turns and hidden hands | Seat, phase, sight, stand-in |
| [The whole thing](/guides/write-a-puzzle) | Every key and every hook, by hand | Everything the rungs below expand to |

When a puzzle is good enough for players, [Ship it](/guides/ship) says what the game asks of it.
