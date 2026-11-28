A puzzle is on the fifth rung because it says it has seats, and for no other reason. Nobody picks a type of puzzle.

> [!PREVIEW]
> This rung is designed and not built yet. It is built last, against the game's four puzzles played in turns. The samples show the shape it will take.

## A rival on a board that works

The smallest step is a rival on a board that already plays: one shared grid, with one to four sides taking turns.

```ts title=pouring.puzzle.ts
export default puzzle("pouring", {
  // ...a puzzle for one player...
  seats: sides(1, 4),
  acts: "in-turn",
});
```

The engine then waits for each seat in turn, refuses a move from any other, plays every seat no player holds, and places the sides by points. A seat the engine plays is a stand-in, and four kinds of stand-in come free for any puzzle that can list its moves.

## A whole table

A card game of bids and tricks for two sides of two is the far end of the same rung. It adds hands only their holder sees, and phases that repeat.

```ts title=pact.puzzle.ts
export default puzzle("pact", {
  seats: sides(2, { seats: 2 }),
  zones: {
    deck: { seenBy: "nobody" },
    hand: { each: "seat", seenBy: "seat" },
    trick: {},
    won: { each: "side" },
  },
  phases: [phase("hand", { repeat: "until an ending" }, [
    phase("bids", { acts: "in-turn", moves: ["bid"] }),
    phase("tricks", { repeat: "handSize" }, [phase("trick", { acts: "in-turn", moves: ["play"] })]),
  ])],
  parts: [bidding, trickTaking, contractScoring],
});
```

| Idea | What it is |
|---|---|
| Seat and side | A place at the table, and the team it plays for |
| Phase | A stretch of a round that takes some moves and not others, such as bidding |
| Sight | What each seat may see. A [zone](/api/puzzle#zones) says who sees its pieces, and the engine cuts every seat's copy of every event |
| Stand-in | A seat the engine plays when no player holds it |

A hook is never handed a card its seat may not see, so no rule can leak one.

## The way out

A puzzle whose round no other puzzle's is like writes one function for all of it: a reducer.

```ts
export default reducer("battle", { settings, moves, events, start, apply });
```

It still declares its settings, moves and events, so `start`, `play` and `read`, a tuning panel and a skin all work on it. The engine keeps nothing else for it: no turns, no scoring, no checks. Two of the game's puzzles are reducers. One has every seat commit a move in secret and resolves them all at once. The other gives each seat a board of its own, played in real time.

A reducer is rare on purpose. Reach for it only when the round itself, and not one rule in it, fits nothing here.
