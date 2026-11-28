// The rules SDK: everything a rules file can touch.
// P is the puzzle's type, made from its puzzle file. S is the rules' own state.

export function defineRules<P extends Puzzle, S>(rules: Rules<P, S>): Rules<P, S>;
export function zone<P extends Puzzle = Puzzle>(id: ZoneId<P>, owner?: Seat | Side): ZoneRef;

export interface Rules<P extends Puzzle, S> {
  onStart(ctx: Ctx<P, S>): S;
  onFallback?: On<P, S>;
  canMove: Ask<P, S, Move<P>, string | null> | { [M in MoveId<P>]: Ask<P, S, Move<P, M>, string | null> };
  onMove: On<P, S, [seat: Seat, move: Move<P>]> | { [M in MoveId<P>]: On<P, S, [seat: Seat, move: Move<P, M>]> };
  onCascade?: On<P, S>;
  onMoveEnd?: On<P, S>;
  onTick?: On<P, S, [tick: Tick]>;
  onSignal?: On<P, S, [signal: Signal<P>]>;
  onTaskNeeded?: On<P, S>;
  onOpen?: { [Ph in PhaseId<P>]?: On<P, S> };
  onClose?: { [Ph in PhaseId<P>]?: On<P, S> };
  onTurn?: On<P, S, [seat: Seat]>;
  onEnd?: On<P, S, [reason: EndingId<P>]>;
  whoseTurn?: Ask<P, S, void, Seat | null>;
  pickMove?: Ask<P, S, StandInId<P>, Move<P>>;
  listMoves?: Ask<P, S, void, Move<P>[]>;
  worth?: Ask<P, S, Move<P>, number>;
  hint?: Ask<P, S, void, Move<P> | null>;
  pointsFor?(event: Event<P>, paid: number): number;
  placing?(ended: Ended<P>): Side[][];
  score?(result: Result<P>): number;
  checkSettings?(settings: Settings<P>): string | null;
}

// A hook that starts with "on" changes the round in one way only: it reports events.
// It returns the next state, or nothing to keep the state as it is.
export type On<P extends Puzzle, S, A extends unknown[] = []> = (ctx: Ctx<P, S>, ...args: A) => S | void;
// Any other hook is a question, asked with one seat's view. Answering changes nothing.
export type Ask<P extends Puzzle, S, A, R> = (view: View<P, S>, arg: A) => R;

// What one seat may see.
export interface View<P extends Puzzle, S> {
  readonly seat: Seat | null;
  readonly state: Readonly<S>;
  readonly settings: Settings<P>;
  readonly score: number;
  readonly streak: number;
  readonly phase: PhaseId<P> | null;
  readonly repeat: number;
  readonly lastSeat: Seat | null;
  readonly board: Board<P>;
  zone(id: ZoneId<P>, owner?: Seat | Side): readonly Piece<P>[];
  on(layer: LayerId<P>): boolean;
  value(id: CountId<P>): number;
  task(id: TaskId<P>): OpenTask | null;
  allowed(move: Move<P>): string | null;
  try(move: Move<P>): Tried<P, S>;
  next(seat: Seat): Seat;
  sideOf(seat: Seat): Side;
  seatsOf(side: Side): readonly Seat[];
}

// What a hook that starts with "on" gets: the whole table. Hidden pieces stay hidden even here.
export interface Ctx<P extends Puzzle, S> extends Omit<View<P, S>, "seat" | "allowed" | "try"> {
  readonly seats: readonly Seat[];
  readonly sides: readonly Side[];
  readonly step: number;
  readonly pending: number;
  draw(id: DrawId<P>): Draw;
  emit<E extends EventId<P>>(id: E, fields: EventFields<P, E>, changes?: (e: Changes<P>) => void): void;
}

// The board changes one event carries, and what else an event may do.
export interface Changes<P extends Puzzle> {
  arrive(place: Cell<P>, piece: NewPiece<P>, from?: Edge | "in place" | Spot): this;
  leave(place: Cell<P>, to?: Spot): this;
  travel(from: Cell<P>, to: Cell<P>, route?: readonly Cell<P>[]): this;
  send(piece: PieceId, to: ZoneRef): this;
  change(place: Cell<P>, to: Change<P>): this;
  deal(from: ZoneRef | DrawId<P>, to: ZoneRef | Cell<P>, count?: number): this;
  peek(piece: PieceId): Piece<P>;
  sitOut(seat: Seat, phase?: PhaseId<P>): this;
  pay(payout: PayoutId<P>, to: Seat | Side): this;
  set(id: CountId<P>, value: number): this;
  open(task: TaskId<P>, holds?: { readonly [name: string]: unknown }): this;
  done(task: TaskId<P>): this;
  gather(into: ZoneRef, ...from: ZoneRef[]): this;
  shuffle(zone: ZoneRef): this;
}

export interface Draw {
  even(n: number): number;
  chance(permille: number): boolean;
  pick<T>(list: readonly T[]): T;
  next(): number;
}

export interface Board<P extends Puzzle = Puzzle> {
  readonly width: number;
  readonly height: number;
  readonly rings: number;
  readonly sectors: number;
  places(): Cell<P>[];
  has(place: Cell<P>): boolean;
  at(place: Cell<P>): Piece<P> | null;
  terrain(place: Cell<P>): TerrainId<P> | "plain" | "off";
  terrainState(place: Cell<P>): string | null;
  touching(place: Cell<P>): Cell<P>[];
}

// The shape of a puzzle's type. The real one is made from the puzzle file, and names every id in it.
export interface Puzzle {
  readonly cell: GridCell | RingCell;
  readonly settings: { readonly [id: string]: number | boolean | readonly number[] | readonly (readonly string[])[] };
  readonly moves: { readonly [id: string]: object };
  readonly events: { readonly [id: string]: object };
  readonly signals: { readonly [id: string]: unknown };
  readonly pieces: string;
  readonly states: string | number;
  readonly terrain: string;
  readonly phases: string;
  readonly zones: string;
  readonly draws: string;
  readonly payouts: string;
  readonly endings: string;
  readonly standIns: string;
  readonly layers: string;
  readonly counts: string;
  readonly tasks: string;
}

export type MoveId<P extends Puzzle> = keyof P["moves"] & string;
export type EventId<P extends Puzzle> = keyof P["events"] & string;
export type SignalId<P extends Puzzle> = keyof P["signals"] & string;
export type PhaseId<P extends Puzzle> = P["phases"];
export type ZoneId<P extends Puzzle> = P["zones"];
export type DrawId<P extends Puzzle> = P["draws"];
export type PayoutId<P extends Puzzle> = P["payouts"];
export type EndingId<P extends Puzzle> = P["endings"];
export type StandInId<P extends Puzzle> = P["standIns"];
export type TerrainId<P extends Puzzle> = P["terrain"];
export type LayerId<P extends Puzzle> = P["layers"];
export type CountId<P extends Puzzle> = P["counts"];
export type TaskId<P extends Puzzle> = P["tasks"];

export type Seat = number;
export type Side = number;
export type PieceId = number;
export type Points = number & { readonly __points: true };

export type GridCell = { readonly x: number; readonly y: number };
export type RingCell = { readonly ring: number; readonly sector: number };
export type Cell<P extends Puzzle = Puzzle> = P["cell"];
export type Spot = { readonly zone: ZoneRef; readonly spot: number };
export type Place<P extends Puzzle = Puzzle> = Cell<P> | Spot;
export type ZoneRef = { readonly zone: string; readonly owner: Seat | Side | null };
export type Edge = "above" | "below" | "left" | "right";
export type Direction = "up" | "down" | "left" | "right" | "up-left" | "up-right" | "down-left" | "down-right" | "in" | "out" | "clockwise" | "anticlockwise";

export interface Piece<P extends Puzzle = Puzzle> {
  readonly id: PieceId;
  readonly piece?: P["pieces"];
  readonly kind?: number;
  readonly state?: P["states"];
}
export interface NewPiece<P extends Puzzle = Puzzle> {
  readonly piece: P["pieces"];
  readonly kind?: number;
  readonly state?: P["states"];
}
export type Change<P extends Puzzle = Puzzle> = { readonly piece?: P["pieces"]; readonly kind?: number; readonly state?: P["states"] } | { readonly terrain: TerrainId<P> | "plain"; readonly state?: string };

export type Settings<P extends Puzzle> = Readonly<P["settings"]>;
export type Move<P extends Puzzle, M extends MoveId<P> = MoveId<P>> = { [K in M]: { readonly move: K } & Readonly<P["moves"][K]> }[M];
export type Event<P extends Puzzle, E extends EventId<P> = EventId<P>> = { [K in E]: { readonly event: K } & Readonly<P["events"][K]> }[E];
export type EventFields<P extends Puzzle, E extends EventId<P>> = { readonly [K in keyof P["events"][E] as P["events"][E][K] extends Points ? never : K]: P["events"][E][K] };
export type Signal<P extends Puzzle, G extends SignalId<P> = SignalId<P>> = { [K in G]: { readonly signal: K; readonly seat: Seat | null; readonly value: P["signals"][K] } }[G];

export interface OpenTask { readonly task: string; readonly holds: { readonly [name: string]: unknown } }
export interface Tick { readonly n: number; readonly ms: number }
export interface Tried<P extends Puzzle, S> { readonly events: readonly Event<P>[]; readonly points: number; readonly view: View<P, S> }
export interface Outcome { readonly reason: string; readonly placing: readonly (readonly Side[])[] }
export interface SideResult { readonly side: Side; readonly seats: readonly Seat[]; readonly points: number; readonly out: number | null }
export interface Ended<P extends Puzzle> { readonly reason: EndingId<P>; readonly seconds: number; readonly sides: readonly SideResult[] }
export interface Result<P extends Puzzle> { readonly reason: EndingId<P>; readonly seconds: number; readonly placing: readonly (readonly Side[])[]; readonly seat: Seat; readonly points: number; readonly sidePoints: number }
