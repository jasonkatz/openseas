This page builds one small puzzle from an empty file with every key and every hook written by hand, so the whole API is seen doing its job. It is the long way on purpose. The short way to the same puzzle is the [quickstart](/api/quickstart). The puzzle is Swap: swap two touching pieces, and three or more of a kind in a line clear. The pieces below rise, new ones come in, and that can clear again.

It takes two files. The document says what exists. The rules say what a move does.

## 1. Say what the puzzle is

Start with who the puzzle is and how a round runs. Swap is still: nothing happens between moves. It ends after a set number of swaps.

```json title=swap.puzzle.json
{
  "id": "swap",
  "version": "0.1",
  "history": [{ "version": "0.1", "description": "First version" }],
  "mechanic": "Swap two touching pieces to line up three or more of a kind",
  "verb": "swap",
  "round": {
    "tempo": { "kind": "still" },
    "ends": [{ "id": "moves", "by": "budget", "setting": "moves" }],
    "logLimit": 250
  },
  "board": { "shape": "grid", "width": "width", "height": "height", "touch": 4, "rim": false }
}
```

Nothing here names a world. `swap` is a neutral word for the mechanic. A skin will give the puzzle its name, and each piece its picture.

The board's size and the round's length are written as the ids of settings, not as numbers. That is how a number stays in one place.

## 2. Declare the numbers

Every number that tunes the puzzle is a [setting](/api/puzzle#settings), with a default, bounds and a description. A tuning panel is built from these, and every host holds a round to these bounds.

```json
{
  "settings": [
    { "id": "width", "type": "whole", "default": 6, "min": 4, "max": 9, "description": "columns on the board", "group": "board", "unit": "cells" },
    { "id": "height", "type": "whole", "default": 7, "min": 4, "max": 10, "description": "rows on the board", "group": "board", "unit": "cells" },
    { "id": "kinds", "type": "whole", "default": 5, "min": 3, "max": 6, "description": "kinds dealt; fewer makes lines easier to find", "group": "board" },
    { "id": "moves", "type": "whole", "default": 20, "min": 1, "max": 200, "description": "swaps in a round", "group": "tempo", "unit": "moves" },
    { "id": "groupPoints", "type": "whole", "default": 1, "min": 0, "max": 100, "description": "points a cleared group earns, times its size squared", "group": "scoring", "unit": "points" },
    { "id": "cascadePercent", "type": "list", "default": [100, 200, 300], "min": 100, "max": 1000, "description": "what each step of a cascade multiplies by; the last entry holds", "group": "scoring", "entries": { "least": 1, "most": 8 } },
    { "id": "streakPercent", "type": "list", "default": [100, 110, 120, 130, 140, 150], "min": 100, "max": 1000, "description": "what the streak multiplies by, an entry for each scoring swap in a row", "group": "scoring", "entries": { "least": 1, "most": 16 } }
  ],
  "relations": [
    { "is": "ascending", "a": "cascadePercent" },
    { "is": "ascending", "a": "streakPercent" }
  ]
}
```

## 3. Declare the pieces and the luck

Swap has one family of pieces. The document does not list the kinds: the `kinds` setting says how many are dealt, and they are numbered from 1.

All the luck in a round is declared as draws. Swap has two: the board it opens on, and the pieces that rise in. Each has a stream of its own, so asking one for more never changes what the other gives.

```json
{
  "pieces": [{ "id": "kind", "family": "kinds" }],
  "deal": {
    "draws": [
      { "id": "fill", "description": "the kind of every piece on a fresh board", "gives": "kind", "by": "even", "when": "start", "reads": ["kinds"] },
      { "id": "rise", "description": "the kind of each piece that rises in", "gives": "kind", "by": "even", "when": "refill", "reads": ["kinds"] }
    ],
    "checks": [
      {
        "id": "playable", "description": "no line stands and at least one swap makes one", "draws": ["fill"], "tries": 50,
        "fallback": "lays two of a kind in a row with a third one step away, so one swap always makes a line",
        "during": "reshuffle"
      }
    ],
    "bounds": []
  }
}
```

The check is a promise to the player: no board is ever dealt with nothing to do. Its fallback always passes, so the promise holds even when luck fails fifty times.

## 4. Declare the move and the events

A move is what a player does. An event is what the rules report happened. A board plays from events alone, so every change to the board is carried on one.

```json
{
  "moves": [
    { "id": "swap", "description": "swap two pieces side by side", "gesture": "drag", "fields": { "a": "place", "b": "place" } }
  ],
  "events": [
    { "id": "fill", "description": "a fresh board was dealt", "fields": {}, "changes": ["arrive"] },
    { "id": "swap", "description": "two pieces traded places", "fields": { "a": "place", "b": "place" }, "changes": ["travel"] },
    { "id": "clear", "description": "a group of three or more cleared", "fields": { "pieces": "places", "size": "number", "points": "points" }, "changes": ["leave"], "step": true },
    { "id": "rise", "description": "pieces rose and new ones came in from below", "fields": {}, "changes": ["travel", "arrive"] },
    { "id": "reshuffle", "description": "no swap was left, so the board was dealt again", "fields": {}, "changes": ["leave", "arrive"] }
  ],
  "moment": { "event": "clear", "when": "size > 3", "size": "size", "most": 7 }
}
```

`clear` is marked `step`, so the engine counts each clear as a step of the cascade. The moment says which event is the puzzle's biggest, so every skin pulses on the same thing.

## 5. Declare what pays

The rules never add a point. The document says what each event is worth, and the engine pays it.

```json
{
  "payouts": [
    { "id": "group", "description": "a group pays its size squared", "on": ["clear"], "counts": "pieces", "growth": "superlinear", "reads": ["groupPoints"] }
  ],
  "multipliers": [
    { "id": "cascade", "description": "later steps of a cascade pay more", "scales": ["group"], "on": "clear", "by": { "table": "cascadePercent", "index": "step" } },
    { "id": "streak", "description": "scoring swaps in a row pay more", "scales": ["group"], "on": "clear", "by": { "table": "streakPercent", "index": "streak" } }
  ],
  "streak": { "builds": { "event": "clear" }, "grace": 1, "breaksOn": [] }
}
```

A group of four on the second step of a cascade, on a streak of three: 4 × 4 = 16, times 200% for the step, times 120% for the streak, is 38.4, rounded down once to 38.

## 6. Say how it opens up and how it is judged

A new player meets a puzzle a few rules at a time. Swap has two layers, and a ladder of two stages that switches them on.

```json
{
  "layers": [
    {
      "id": "lines", "rule": "three or more of a kind in a line clear, and what rises can clear again",
      "brings": { "draws": ["fill", "rise"], "pieces": ["kind"], "events": ["fill", "swap", "clear", "rise", "reshuffle"], "settings": ["groupPoints", "cascadePercent"], "payouts": ["group"], "multipliers": ["cascade"] }
    },
    {
      "id": "streak", "rule": "scoring swaps in a row pay more",
      "brings": { "settings": ["streakPercent"], "gauges": ["streak"], "multipliers": ["streak"] }
    }
  ],
  "ladder": [
    { "stage": "lines", "adds": ["lines"], "advance": { "measure": "best-round", "threshold": 150 } },
    { "stage": "full", "adds": ["streak"] }
  ],
  "evaluation": {
    "tierStarts": { "steady": 150, "sharp": 300, "masterful": 500, "legendary": 800 },
    "paceWindowSeconds": 12
  }
}
```

The tier starts place a round's score on the one scale every puzzle shares. They are the puzzle's alone: no host can move them.

## 7. Finish the document

The rest is short. Swap is solo, so it has no `opponents`, `points` or `placing`. It has no terrain, zones, controls, tasks or signals, and those are written as empty lists.

```json
{
  "terrain": [],
  "zones": [],
  "controls": [],
  "signals": { "in": [], "out": [] },
  "tasks": [],
  "gauges": [{ "id": "streak", "description": "scoring swaps in a row" }],
  "stats": [{ "id": "best_streak", "description": "the longest streak" }],
  "texts": [
    { "key": "name" },
    { "key": "how_to" },
    { "key": "stage.lines" },
    { "key": "stage.lines_intro" },
    { "key": "stage.full" },
    { "key": "stage.full_intro" },
    { "key": "piece.kind_1" },
    { "key": "piece.kind_2" },
    { "key": "piece.kind_3" },
    { "key": "piece.kind_4" },
    { "key": "piece.kind_5" },
    { "key": "piece.kind_6" },
    { "key": "event.reshuffle" },
    { "key": "gauge.streak", "placeholders": ["count"] },
    { "key": "stat.best_streak" }
  ],
  "teaching": { "preview": false, "hint": true }
}
```

That is the whole document. It has said nothing yet about what a swap does.

## 8. Write the rules

The rules are an object of hooks. Swap writes eight. It keeps no state of its own, because the pieces sit on the engine's board.

```ts title=swap.rules.ts
import { defineRules, type Board, type GridCell, type Move, type View } from "@openseas/puzzle";
import type { Swap } from "./swap.puzzle.gen";

type State = {};

export default defineRules<Swap, State>({
  // Start: deal a board. The engine holds the deal to the "playable" check, so this only deals.
  onStart(ctx) {
    ctx.emit("fill", {}, (e) => {
      for (const p of ctx.board.places()) e.arrive(p, { piece: "kind", kind: 1 + ctx.draw("fill").even(ctx.settings.kinds) }, "above");
    });
    return {};
  },

  // Asked only when fifty deals in a row failed the check: lay a board that is sure to pass.
  // Two kinds as a chequerboard make no line. A third, two in a row and one a step away, gives one sure swap.
  onFallback(ctx) {
    const sure = (p: GridCell): boolean => (p.y === 0 && p.x < 2) || (p.y === 1 && p.x === 2);
    ctx.emit("fill", {}, (e) => {
      for (const p of ctx.board.places()) e.arrive(p, { piece: "kind", kind: sure(p) ? 1 : 2 + ((p.x + p.y) % 2) }, "above");
    });
  },

  // Check: a question, asked with this seat's view. Answering changes nothing.
  // The engine has already checked that a and b are places on the board.
  canMove(view, { a, b }) {
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return "pick two pieces side by side";
    if (view.board.at(a)!.kind === view.board.at(b)!.kind) return "those two are the same kind";
    return null;
  },

  // Move: what the move does, reported as an event.
  onMove(ctx, seat, { a, b }) {
    ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
  },

  // Cascade: asked again and again until it reports nothing.
  // The engine counts each "clear" as a step and applies the cascade multiplier itself.
  onCascade(ctx) {
    const groups = groupsOf(ctx.board);
    if (groups.length > 0) {
      for (const g of groups) ctx.emit("clear", { pieces: g, size: g.length }, (e) => g.forEach((p) => e.leave(p)));
      return;
    }
    if (ctx.board.places().every((p) => ctx.board.at(p))) return; // full again: nothing to report
    ctx.emit("rise", {}, (e) => {
      for (let x = 0; x < ctx.board.width; x++) {
        let top = 0; // pieces rise to the top of their column...
        for (let y = 0; y < ctx.board.height; y++) {
          if (!ctx.board.at({ x, y })) continue;
          if (y !== top) e.travel({ x, y }, { x, y: top });
          top++;
        }
        for (let y = top; y < ctx.board.height; y++) { // ...and new ones come in from below
          e.arrive({ x, y }, { piece: "kind", kind: 1 + ctx.draw("rise").even(ctx.settings.kinds) }, "below");
        }
      }
    });
  },

  // Every swap there is. The engine tries these to hold the check, and deals the board again,
  // as "reshuffle", when none of them would clear anything.
  listMoves: swaps,

  // A question the board asks after a few idle seconds: the swap that pays most now.
  hint(view) {
    let best: Move<Swap> | null = null;
    let most = 0;
    for (const move of swaps(view)) {
      const points = view.try(move).points;
      if (points > most) [best, most] = [move, points];
    }
    return best;
  },
});

// Every swap side by side that the rules allow, each written once.
function swaps(view: View<Swap, State>): Move<Swap>[] {
  const moves: Move<Swap>[] = [];
  for (const a of view.board.places()) {
    for (const b of view.board.touching(a)) {
      const first = a.y < b.y || (a.y === b.y && a.x < b.x);
      if (first && view.allowed({ move: "swap", a, b }) === null) moves.push({ move: "swap", a, b });
    }
  }
  return moves;
}

// Swap's one helper is a plain function on a board. It does not touch the engine.
declare function groupsOf(board: Board<Swap>): GridCell[][]; // every run of three or more, touching runs joined
```

Read it for what is missing. The rules never add a point, never count a step of the cascade, never keep a streak, never count the swaps left and never decide the round is over. They never test their own deal either, and never look for a board with no swap left. Each of those was declared in the document, so the engine does it.

This is every hook written by hand, the top rung. The [quickstart](/api/quickstart) makes the same puzzle from three stock parts in seven lines, and those lines expand to a document and hooks like the ones on this page.

## 9. Dress it

A skin gives every piece a drawing and every key a text. This is the start of one, in the space theme.

```json title=swap.skin.json
{
  "puzzle": "swap",
  "theme": "space",
  "pieces": {
    "kind_1": { "tint": "sand", "layers": [{ "kind": "rect", "x": 2, "y": 6, "w": 20, "h": 12, "r": 3 }] },
    "kind_2": { "tint": "sky", "layers": [{ "kind": "disc", "x": 12, "y": 12, "r": 10 }] }
  },
  "events": {
    "clear": { "cues": ["pop"], "points": "pieces" },
    "reshuffle": { "cues": ["whoosh"], "callout": 1 }
  },
  "texts": {
    "name": "Stowage",
    "piece.kind_1": "Crate",
    "gauge.streak": "Streak x{count}"
  }
}
```

Its cues and motion start as a copy of the theme's. The [skin object](/api/skin) has the rest.

## 10. Know it works

Nobody writes a test to learn whether Swap ever stalls, or whether a round always ends. Every puzzle is run through the same [six tests](/api/rules#what-every-puzzle-is-tested-by), made from its document.

Swap then records a few witness rounds: a seed, settings, a log and the read each must give. From then on, a change that would make an old round replay differently fails the checks unless the puzzle's major version is raised.

## What you wrote, and what you did not

| You wrote | The engine did |
|---|---|
| What a swap needs to be allowed | Refused a place off the board before you were asked |
| What a swap does, as an event | Applied it to the board and sent it to the screen |
| One step of what follows | Counted the steps and ran them until nothing was left |
| How a board is dealt, and every swap there is | Held each deal to its check, and dealt again when no swap was left |
| Nothing about luck | Kept each draw's stream apart, so the deal never shifts |
| Nothing about points | Paid every clear, with the step and the streak, rounded once |
| Nothing about time | Counted the swaps and ended the round |
| Nothing about replays | Kept the log, and replays the round from it |
