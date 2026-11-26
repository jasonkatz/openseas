Every hook the loop asks, what it is given, and what happens when the rules leave it out. Three are required. Every other has a default, and a hook added later comes with one, so no puzzle already written has to change.

In the signatures, `P` is the puzzle's type and `S` is the rules' state. A hook that starts with `on` gets a [context](/api/context#the-context) and returns the next state or nothing. Any other hook gets a [view](/api/context#the-view) and returns its answer.

## At a glance

| Hook | Asked | When the rules leave it out |
|---|---|---|
| [`onStart`](#onstart) | Once, at Start: deal the board | Required |
| [`canMove`](#canmove) | May this seat make this move now, and if not, why | Required |
| [`onMove`](#onmove) | What a move that passed the check does | Required |
| [`onCascade`](#oncascade) | Again and again after a move, until it reports nothing | Nothing follows |
| [`onMoveEnd`](#onmoveend) | Once a move, when the cascade has run dry | Nothing |
| [`onTick`](#ontick) | Once for every tick, in order | Nothing happens between moves |
| [`onSignal`](#onsignal) | A signal in arrives | It changes nothing |
| [`onTaskNeeded`](#ontaskneeded) | Fewer tasks are open than the puzzle declares | The puzzle has no tasks |
| [`onOpen`](#onopen-and-onclose) | A phase opens | Nothing |
| [`onClose`](#onopen-and-onclose) | A phase closes | Nothing |
| [`onTurn`](#onturn) | A seat's turn comes | The seat is awaited |
| [`onEnd`](#onend) | An ending is met, and which | Nothing |
| [`whoseTurn`](#whoseturn) | In a phase in turn: which seat moves next | The next seat clockwise that is not sitting out |
| [`pickMove`](#pickmove) | What a seat no player holds plays | One of the four stand-in types plays |
| [`listMoves`](#listmoves) | Which moves a seat can make now | None of the four types plays |
| [`worth`](#worth) | What a move is worth to a seat | The points it pays that seat now |
| [`pointsFor`](#pointsfor) | What an event is worth | The puzzle's payouts and multipliers pay |
| [`placing`](#placing) | The sides in order | By points, or by the last side standing |
| [`score`](#score) | A seat's score | The seat's account |
| [`hint`](#hint) | A move worth making | The puzzle offers no hint |
| [`checkSettings`](#checksettings) | What is wrong with these settings or this map | Only bounds and relations are held |

## Required

### `onStart`

```ts
onStart(ctx: Ctx<P, S>): S
```

Asked once, at Start. It deals the board by reporting events, and returns the rules' first state.

```ts
onStart(ctx) {
  ctx.emit("fill", {}, (e) => {
    for (const place of ctx.board.places()) {
      e.arrive(place, { kind: 1 + ctx.draw("fill").even(ctx.settings.kinds) }, "above");
    }
  });
  return {};
}
```

### `canMove`

```ts
canMove(view: View<P, S>, move: Move<P>): string | null
```

Asked at Check. It answers `null` when the seat may make the move, or one plain reason when it may not. The reason goes back to the board.

Before it is asked, the loop has already refused a move from a seat that is not awaited or not held, a move the open phase does not take, and a move whose fields do not fit the document. So `canMove` holds only the puzzle's own rule.

```ts
canMove(view, { a, b }) {
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return "pick two pieces side by side";
  if (view.board.at(a)!.kind === view.board.at(b)!.kind) return "those two are the same kind";
  return null;
}
```

It may be written as one function for each move.

```ts
canMove: {
  bid: (view, move) => (move.tricks === 0 && view.settings.nilBonus === 0 ? "nil is off at this table" : null),
  play: (view, move) => followsSuit(view, move.card),
}
```

### `onMove`

```ts
onMove(ctx: Ctx<P, S>, seat: Seat, move: Move<P>): S | void
```

Asked at Move, for a move that passed the check. It says what the move does by reporting events. What follows by itself belongs in `onCascade`.

```ts
onMove(ctx, seat, { a, b }) {
  ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
}
```

Like `canMove`, it may be written as one function for each move. In a phase where seats act together, each seat's move is held back, seen only by its own seat, until every seat has one. `onMove` is then asked once with all of them.

## After a move

### `onCascade`

```ts
onCascade(ctx: Ctx<P, S>): S | void
```

Asked again and again after a move, until it reports nothing. Each asking is one step of what follows by itself: a clear, then the fall, then another clear. The loop counts the steps, from the events the document marks `step`, and applies any multiplier indexed by step.

```ts
onCascade(ctx) {
  const groups = groupsOf(ctx.board);
  for (const group of groups) {
    ctx.emit("clear", { pieces: group }, (e) => group.forEach((place) => e.leave(place)));
  }
  if (groups.length === 0) refill(ctx);
}
```

Every event in a cascade belongs to the move that started it.

### `onMoveEnd`

```ts
onMoveEnd(ctx: Ctx<P, S>): S | void
```

Asked once a move, when the cascade has run dry. It is where the end of a move is handled: a full trick is taken, a board with no move left is dealt again. What it reports may set the cascade off again, and the steps go on from the same count.

A board with no move left has no hook of its own. The rules report it from here: the round fails, the task ends, or the seat is out.

## Time and signals

### `onTick`

```ts
onTick(ctx: Ctx<P, S>, tick: Tick): S | void
```

Asked once for every tick of a ticking puzzle, in order. Before a move is checked, the loop plays every tick up to the move's time.

Within one tick the order is fixed: `onTick`, then each seat no player holds whose time to move has come, lowest seat first, then a player's move stamped at that tick.

### `onSignal`

```ts
onSignal(ctx: Ctx<P, S>, signal: Signal<P>): S | void
```

Asked when a signal in arrives. The signal is in the log, so a replay sees it too.

## Tasks

### `onTaskNeeded`

```ts
onTaskNeeded(ctx: Ctx<P, S>): S | void
```

Asked when fewer tasks are open than the puzzle declares. It deals one, or reports nothing to say there is no room yet.

The loop keeps which tasks are open, grades each one, pays on the grade and meets the stock ending. The rules deal a task here, and say on an event when one is done, wherever that happens.

## Phases and turns

### `onOpen` and `onClose`

```ts
onOpen:  { [phase in PhaseId<P>]?: (ctx: Ctx<P, S>) => S | void }
onClose: { [phase in PhaseId<P>]?: (ctx: Ctx<P, S>) => S | void }
```

Asked as a phase opens and as it closes, one function for each phase. Opening is where a hand is dealt. Closing is where it is counted.

```ts
onOpen: {
  hand(ctx) {
    for (const seat of ctx.seats) {
      ctx.emit("dealt", { seat }, (e) => e.deal(zone("deck"), zone("hand", seat), 13));
    }
  },
},
onClose: {
  hand(ctx) {
    for (const side of ctx.sides) countSide(ctx, side);
  },
}
```

The rules never open or close a phase themselves. A phase closes on an event the document names, when no seat is left to wait for, or when its repeats are used up.

### `whoseTurn`

```ts
whoseTurn(view: View<P, S>): Seat | null
```

Asked at Wait, in a phase where seats act in turn. It answers the seat that moves next, a player's seat included, or `null` for nobody, which closes the phase.

Left out, the answer is the next seat clockwise that is not sitting out.

### `onTurn`

```ts
onTurn(ctx: Ctx<P, S>, seat: Seat): S | void
```

Asked when a seat's turn comes. It may report an event and pass the turn, as when a seat that is all in has nothing to decide. Left out, the seat is simply awaited.

## Seats no player holds

A seat no player holds is played at once when it is awaited, through the same `canMove` and `onMove` as a player. Its moves are never entries in the log. A replay works them out again.

### `pickMove`

```ts
pickMove(view: View<P, S>, standIn: StandInId<P>): Move<P>
```

Asked for a seat that one of the puzzle's own stand-ins holds. It gets only that seat's view, so it has nowhere to read a card its seat cannot see.

Left out, one of the four stand-in types plays, where the rules answer `listMoves`.

### `listMoves`

```ts
listMoves(view: View<P, S>): Move<P>[]
```

Every move a seat can make now. With it, the puzzle takes all four stand-in types, and the loop can tell that a seat has no move left.

The four types choose from everything on the board, so they play only where a seat sees all of it. A puzzle with a place a seat cannot see brings stand-ins of its own.

### `worth`

```ts
worth(view: View<P, S>, move: Move<P>): number
```

What a move is worth to a seat. The greedy and planner stand-ins choose by it. Left out, it is the points the move pays that seat now.

## Points and endings

### `pointsFor`

```ts
pointsFor(event: Event<P>, paid: number): number
```

What an event is worth, where the document's payouts and multipliers cannot say it. It is given what they would pay. Left out, they pay.

Most puzzles never write this hook. A puzzle that does should first ask whether a payout could say it instead.

### `onEnd`

```ts
onEnd(ctx: Ctx<P, S>, reason: EndingId<P>): S | void
```

Asked once when an ending is met, and told which. What it reports can still pay, as a bonus for chips left over does. An ending the rules report closes the open phases first, and banks their tallies.

### `placing`

```ts
placing(result: Result<P>): Side[][]
```

The sides in order, best first, with tied sides sharing a place. Asked only where the document says [`placing.by`](/api/puzzle#placing) is `rules`. Left out, the loop places by points or by the last side standing.

### `score`

```ts
score(result: Result<P>): number
```

A seat's score, read from the reason the round ended, the placing, the seat's points, its side's and the time played. Left out, it is the seat's account. A score never goes below zero.

## Teaching and settings

### `hint`

```ts
hint(view: View<P, S>): Move<P> | null
```

A move worth making, for a player who is stuck. Left out, the puzzle offers no hint. A round that counts never hints.

### `checkSettings`

```ts
checkSettings(settings: Settings<P>): string | null
```

Asked before a round starts. It answers what is wrong with these settings or this map, or `null`. Left out, only the document's bounds and relations are held.

## Questions of your own

A puzzle may add questions for whatever else a board, a stand-in or a hint needs to ask, such as a preview of what a move would do. A question of the puzzle's own is written like any other: it gets a view, it answers, and it changes nothing.

```ts
// What a swap would clear, for the board to show before the player lets go.
preview(view: View<P, S>, move: Move<P>): Place[]
```

A question can be asked at any time, and the round is the same afterwards.
