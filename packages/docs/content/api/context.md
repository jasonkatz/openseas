What a hook is handed. A question gets a **view**: what one seat may see. A hook that starts with `on` gets a **context**: the whole table, and the two things that change a round, `draw` and `emit`.

## The view

Every question is asked with one seat's view. There is nowhere in a view to read a piece that seat may not see, so a stand-in or a hint cannot cheat by accident.

| Member | Type | Is |
|---|---|---|
| `seat` | `Seat` or `null` | The seat this view is for. `null` is the table's public view |
| `state` | `S` | The rules' own state. It is always public |
| `settings` | `Settings<P>` | This round's value for every setting, by id |
| `phase` | phase id or `null` | The open phase, innermost |
| `repeat` | number | Which repeat of the phase this is, from 0 |
| `lastSeat` | `Seat` or `null` | The seat that moved last in this phase |
| `board` | [`Board`](#the-board) | The board, as this seat sees it |
| `zone(id, owner?)` | list of pieces | What a [zone](#zones) holds. A piece this seat may not see is its id alone |
| `allowed(move)` | `string` or `null` | `canMove`, asked again for this seat |
| `try(move)` | a tried move | Plays the move on a copy of the round and gives back what came of it |
| `next(seat)` | `Seat` | The next seat clockwise |
| `sideOf(seat)` | `Side` | The side a seat is on |
| `seatsOf(side)` | list of seats | The seats of a side |

### Trying a move

`try` plays a move on a copy of the round and reads what came of it: the events it caused and the view afterwards. The copy draws from a throwaway stream, so trying never shows the luck to come and never shifts the deal.

`pickMove`, `hint`, a preview and the four stand-in types all try moves this one way.

```ts
hint(view) {
  let best: Move<P> | null = null;
  let most = 0;
  for (const move of candidates(view)) {
    const points = view.try(move).points;
    if (points > most) [best, most] = [move, points];
  }
  return best;
}
```

## The context

A context has everything a view has, for the whole table, and adds these.

| Member | Type | Is |
|---|---|---|
| `seats` | list of seats | Every seat in the round |
| `sides` | list of sides | Every side in the round |
| `step` | number | The cascade step the loop has counted |
| `draw(id)` | [`Draw`](#draws) | One of the document's draws. Refused when the document declares no such draw |
| `emit(id, fields, changes?)` | | [Reports an event](#reporting-an-event) |

A context sees the table, and still not what is hidden. A hidden piece stays hidden even here, and is read only by [peeking](#on-an-event).

## Reporting an event

`emit` is the one way the rules change a round.

```ts
ctx.emit(id, fields, (e) => { /* the board changes this event carries */ });
```

| Argument | Is |
|---|---|
| `id` | One of the document's events |
| `fields` | The event's fields, as the document types them. A field typed `points` is left out: the engine fills it when it pays the event |
| `changes` | Optional. A function that says what changes on the board, through the builder `e` |

The engine applies the changes as the event is reported. The lines after an `emit` read the board as that event left it.

### Board changes

Everything that happens on a board is one of four changes. The document says which of them each event can carry, and a change it does not list is refused.

| On `e` | Does |
|---|---|
| `arrive(place, piece, from?)` | Puts a new piece on the board. `from` says where it comes from: `"in place"`, off the board in a direction such as `"above"`, or a spot in a zone |
| `leave(place, to?)` | Takes a piece off the board. It is cleared, or taken to a spot in a zone |
| `travel(from, to, route?)` | Moves a piece from one cell to another, with its route when it passes through other cells |
| `travel(piece, from, to)` | Moves a piece between zones, or between a zone and the board |
| `change(place, piece)` | A piece's state or kind, or a cell's terrain, becomes another where it stands |

Each returns `e`, so changes chain.

```ts
ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
```

### On an event

An event may do four more things. Each is refused when it names something the document does not declare.

| On `e` | Does | Refused when |
|---|---|---|
| `deal(from, to, count)` | Puts pieces from a draw or a zone straight into a place. The hook never learns what was dealt | The draw or the place is not declared |
| `peek(piece)` | Reads a piece the table cannot see | The event is not declared to reveal that place |
| `sitOut(seat, phase?)` | A seat sits out of a phase, or is out of the round | The seat or the phase is not there |
| `pay(payout, to)` | Pays a declared payout to a seat or a side | The account is not in the round |

Two more keep a deck of cards short to write.

| On `e` | Does |
|---|---|
| `gather(into, ...from)` | Brings every piece of the named zones into one |
| `shuffle(zone)` | Shuffles a zone, with the draw declared for it |

```ts
ctx.emit("dealt", { seat }, (e) => e.deal(zone("deck"), zone("hand", seat), 13));
```

A secret only ever comes out on an event. A piece becomes seen by travelling to a place more seats see, or by being shown where it lies.

## Draws

All luck comes from `ctx.draw(id)`. Each draw has its own stream, made from the seed and the draw's id.

| On a draw | Gives |
|---|---|
| `even(n)` | A whole number from 0 up to, and not including, `n`, each alike |
| `chance(permille)` | True that many times in a thousand |
| `pick(list)` | One entry of a list |
| `next()` | The next item of a bag: a shuffled set dealt out in order, then shuffled again |

```ts
const kind = 1 + ctx.draw("debris").even(ctx.settings.kinds);
const isPrize = ctx.draw("prize").chance(ctx.settings.prizePermille);
```

## The board

| Member | Type | Is |
|---|---|---|
| `width`, `height` | number | A grid's size |
| `rings`, `sectors` | number | A ring board's size |
| `places()` | list of places | Every cell |
| `at(place)` | piece or `null` | The piece on a cell |
| `has(place)` | boolean | Whether the cell is on the board |
| `touching(place)` | list of places | The cells that touch it, by the board's own shape |

A **place** is a cell on a board or a numbered spot in a zone. On a grid a cell is `{ x, y }`, with rows counted from the top and columns from the left. On rings it is `{ ring, sector }`, with ring 0 innermost and sector 0 at the top.

A **piece** is what the rules know about one thing on the table.

| Member | Type | Is |
|---|---|---|
| `id` | number | Unique within the round, from the moment it is dealt until it leaves |
| `piece` | piece id | Which of the document's pieces it is |
| `kind` | number | Its kind within its family, from 1 |
| `state` | name or number | Its state, where it has one |

A piece a seat may not see reaches that seat with its `id` and nothing else.

## Zones

`zone(id, owner?)` names a zone. The owner is required for a zone each seat or each side has.

```ts
zone("deck")            // the round's
zone("hand", seat)      // one seat's
zone("won", side)       // one side's
```

On a view or a context, `zone(id, owner?)` reads what the zone holds, in order. On a view the owner may be left out for the view's own seat.

## The whole surface

Everything a rules file can touch, in one place. `P` is the puzzle's type and `S` is the rules' state.

```ts title=engine.d.ts tall
export function defineRules<P extends Puzzle, S>(rules: Rules<P, S>): Rules<P, S>;
export function zone<P>(id: ZoneId<P>, owner?: Seat | Side): ZoneRef;

export interface Rules<P extends Puzzle, S> {
  // Required: the only three.
  onStart(ctx: Ctx<P, S>): S;
  canMove: Ask<P, S, Move<P>, string | null> | { [M in MoveId<P>]: Ask<P, S, Move<P, M>, string | null> };
  onMove: On<P, S, [Seat, Move<P>]> | { [M in MoveId<P>]: On<P, S, [Seat, Move<P, M>]> };

  // Optional. Each has a default, so a puzzle writes only the ones it needs.
  onCascade?: On<P, S>;                                   // default: nothing follows a move
  onMoveEnd?: On<P, S>;                                   // default: nothing
  onTick?: On<P, S, [Tick]>;                              // default: time changes nothing
  onSignal?: On<P, S, [Signal<P>]>;                       // default: a signal changes nothing
  onTaskNeeded?: On<P, S>;                                // default: the puzzle has no tasks
  onOpen?: { [Ph in PhaseId<P>]?: On<P, S> };             // default: nothing
  onClose?: { [Ph in PhaseId<P>]?: On<P, S> };            // default: nothing
  onTurn?: On<P, S, [Seat]>;                              // default: the seat is awaited
  onEnd?: On<P, S, [EndingId<P>]>;                        // default: nothing
  whoseTurn?: Ask<P, S, void, Seat | null>;               // default: the next seat clockwise
  pickMove?: Ask<P, S, StandInId<P>, Move<P>>;            // default: one of the four types, from listMoves
  listMoves?: Ask<P, S, void, Move<P>[]>;                 // default: none
  worth?: Ask<P, S, Move<P>, number>;                     // default: the points the move pays now
  hint?: Ask<P, S, void, Move<P> | null>;                 // default: no hint
  pointsFor?(event: Event<P>, paid: number): number;      // default: the document's payouts and multipliers
  placing?(result: Result<P>): Side[][];                  // default: by points, or last side standing
  score?(result: Result<P>): number;                      // default: the seat's account
  checkSettings?(settings: Settings<P>): string | null;   // default: only bounds and relations
}

// A hook that starts with "on" changes the round in one way only: it reports events.
// It returns the next state, or nothing to keep the state as it is.
type On<P, S, A extends unknown[] = []> = (ctx: Ctx<P, S>, ...args: A) => S | void;
// Any other hook is a question, asked with one seat's view. Answering changes nothing.
type Ask<P, S, A, R> = (view: View<P, S>, arg: A) => R;

// What one seat may see.
export interface View<P, S> {
  readonly seat: Seat | null;
  readonly state: Readonly<S>;
  readonly settings: Settings<P>;
  readonly phase: PhaseId<P> | null;
  readonly repeat: number;
  readonly lastSeat: Seat | null;
  readonly board: Board<P>;
  zone(id: ZoneId<P>, owner?: Seat | Side): readonly Piece<P>[];
  allowed(move: Move<P>): string | null;
  try(move: Move<P>): Tried<P, S>;
  next(seat: Seat): Seat;
  sideOf(seat: Seat): Side;
  seatsOf(side: Side): Seat[];
}

// What a hook that starts with "on" gets: the whole table. Hidden pieces stay hidden even here.
export interface Ctx<P, S> extends Omit<View<P, S>, "seat" | "allowed" | "try"> {
  readonly seats: Seat[];
  readonly sides: Side[];
  readonly step: number;
  draw(id: DrawId<P>): Draw;
  emit<E extends EventId<P>>(id: E, fields: EventFields<P, E>, changes?: (e: Changes<P>) => void): void;
}

// What one event carries.
export interface Changes<P> {
  arrive(place: Place, piece: NewPiece<P>, from?: Direction | "in place" | ZoneRef): this;
  leave(place: Place, to?: ZoneRef): this;
  travel(from: Place, to: Place, route?: Place[]): this;
  travel(piece: PieceId, from: ZoneRef, to: ZoneRef): this;
  change(place: Place, piece: NewPiece<P>): this;
  deal(from: ZoneRef | DrawId<P>, to: ZoneRef | Place, count?: number): this;
  peek(piece: PieceId): Piece<P>;
  sitOut(seat: Seat, phase?: PhaseId<P>): this;
  pay(payout: PayoutId<P>, to: Seat | Side): this;
  gather(into: ZoneRef, ...from: (ZoneRef | ZoneId<P>)[]): this;
  shuffle(zone: ZoneRef): this;
}

export interface Draw {
  even(n: number): number;
  chance(permille: number): boolean;
  pick<T>(list: readonly T[]): T;
  next(): number;
}

export interface Board<P = unknown> {
  readonly width: number;    // a grid's
  readonly height: number;
  readonly rings: number;    // a ring board's
  readonly sectors: number;
  places(): Place[];
  at(place: Place): Piece<P> | null;
  has(place: Place): boolean;
  touching(place: Place): Place[];
}

export interface Tried<P, S> { readonly events: Event<P>[]; readonly points: number; readonly view: View<P, S> }
export interface Result<P> { readonly reason: EndingId<P>; readonly placing: Side[][]; readonly seat: Seat; readonly points: number; readonly sidePoints: number; readonly seconds: number }

export type Place = { x: number; y: number } | { ring: number; sector: number } | { zone: ZoneRef; spot: number };
export type Seat = number;
export type Side = number;
```
