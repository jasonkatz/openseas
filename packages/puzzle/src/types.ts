// The shapes the loop runs on: a round's events, the puzzle document and the rules (ADR 0092).
// They follow docs/puzzles/DOMAIN.md and the docs site's rules SDK, as far as rungs 0 to 3 reach:
// one seat on a grid. Each later rung widens these and narrows nothing.

export type Cell = { readonly x: number; readonly y: number };
/** A piece's state is one of its named forms, or a number it shows, such as the moves a fuse has left. */
export interface Piece { readonly id: number; readonly piece: string; readonly kind?: number; readonly state?: number | string }
export type NewPiece = { readonly piece: string; readonly kind?: number; readonly state?: number | string };
/** One hand-drawn map: a row for each row of the board, and in each row one terrain id for each cell. A plain cell is `plain`. */
export type MapRows = readonly (readonly string[])[];
export type Setting = number | boolean | readonly number[] | readonly MapRows[];
export type Settings = Readonly<Record<string, Setting>>;

export type ChangeKind = "arrive" | "leave" | "travel" | "change";
export type Change =
  | { readonly change: "arrive"; readonly at: Cell; readonly piece: Piece; readonly from: string }
  | { readonly change: "leave"; readonly at: Cell }
  | { readonly change: "travel"; readonly from: Cell; readonly to: Cell }
  | { readonly change: "change"; readonly at: Cell; readonly piece: Piece }
  | { readonly change: "change"; readonly at: Cell; readonly terrain: string; readonly state?: string };
/** What a cell is, as opposed to the piece on it. A cell with no terrain of its own is plain. */
export interface Ground { readonly terrain: string; readonly state?: string }
export const DIRECTIONS = ["right", "down", "left", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** What a round reports. A board plays from these alone. */
export interface Event {
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
  /** What it is worth, rounded down, before any multiplier that holds for the whole move, such as the streak. Only on an event that carries points. */
  readonly points?: number;
  /** Which step of the cascade it is part of, counted from 1. Only on an event that counts as a step. */
  readonly step?: number;
  readonly changes: readonly Change[];
  /** Gauges and stats it set, each to its new value. */
  readonly sets?: readonly { readonly id: string; readonly value: number }[];
  /** In a ticking puzzle: the tick it happened on, counted from 1. An event of a move carries the tick the move followed. */
  readonly tick?: number;
  /** Tasks it opened, each with what the task holds, and tasks it finished. */
  readonly tasks?: readonly ({ readonly task: string; readonly opened: Readonly<Record<string, unknown>> } | { readonly task: string; readonly done: true })[];
}
/** A task that is open: its id and what it holds, such as the kind a bounty names. */
export interface OpenTask { readonly task: string; readonly holds: Readonly<Record<string, unknown>> }
export type AnyMove = { readonly move: string } & Readonly<Record<string, unknown>>;
/** A signal in, as a host hands it on: which, and what it carries. A number or a flag is its `value`. */
export type AnySignal = { readonly signal: string } & Readonly<Record<string, unknown>>;

// ---- the puzzle document, as the guide writes it. Every key is present in an expanded puzzle.

export interface SettingDecl { id: string; type: "whole" | "list" | "flag" | "maps"; default: Setting; min?: number; max?: number; description: string; group: "board" | "deal" | "tempo" | "scoring"; unit?: string; entries?: { least: number; most: number } }
export interface MoveDecl { id: string; description: string; gesture: string; fields: Record<string, "place" | "places" | "direction" | "number" | "flag"> }
export interface EventDecl { id: string; description: string; fields: Record<string, "place" | "places" | "direction" | "number" | "flag" | "points">; changes?: ChangeKind[]; step?: true; mistake?: true }
export interface DrawDecl { id: string; description: string; gives: "kind" | "piece" | "place" | "map" | "number"; by: "even" | "weighted" | "bag" | "pick"; when: "start" | "refill" | "task" | "tick" | { every: string }; reads: string[] }
/** `needs: "settled"` asks only that nothing is left to happen by itself. Left out, a check also asks for a move worth making. */
export interface CheckDecl { id: string; description: string; draws: string[]; tries: number; needs?: "settled"; fallback: string; during?: string }
/** A number, or the id of the setting that holds it. */
export type Amount = number | string;
export interface PayoutDecl { id: string; description: string; on: string[]; counts?: string; growth: "flat" | "linear" | "superlinear" | "stepped"; cap?: Amount; reads: string[] }
/** `on` names the events it applies on: `every`, or ids joined by `or`, with an optional `when <condition>` after them. */
export interface MultiplierDecl { id: string; description: string; scales: string[]; on: string; by: { percent: string } | { table: string; index: "streak" | "step" } }
/**
 * `builds.event` names one event, or several joined by `or`. `counts: "events"` is for a puzzle whose successes
 * are not moves: every event that builds it counts, nothing is a miss, and each is paid at the streak it leaves.
 */
export interface StreakDecl { builds: { event: string; when?: string }; counts?: "moves" | "events"; grace: Amount; breaksOn: string[] }
export interface TerrainDecl { id: string; states?: string[] }
/** `of` names the piece it is based on. `states` is the number it shows, up to a count, or its named forms. */
export interface PieceDecl { id: string; family?: string; of?: string; states?: { count: Amount } | string[] }
export interface GaugeDecl { id: string; description: string; most?: Amount; danger?: Amount }
export interface StatDecl { id: string; description: string }
export interface TaskDecl { id: string; description: string; open: number; ends: ("done")[]; graded: "none"; grades: string[] }
export interface LayerDecl { id: string; rule: string; brings: Record<string, string[]> }
export interface StageDecl { stage: string; adds: string[]; advance?: { measure: "best-round" | "average" | "wins" | "rounds"; threshold: number } }
/** The five tiers every puzzle shares. Green starts at zero, and a puzzle says where the other four start. */
export const TIERS = ["green", "steady", "sharp", "masterful", "legendary"] as const;
export type Tier = (typeof TIERS)[number];
export interface Evaluation { tierStarts: Record<Exclude<Tier, "green">, number>; paceWindowSeconds: number }
/** The puzzle's biggest event: which one, and the field that says how big each is. `most` is the size that counts as biggest. */
export interface Moment { event: string; when?: string; size: string; most: Amount }
/** A value from outside the puzzle that steers it. It is never a move, and the log keeps it. `number` and `flag` carry a `value`. */
export interface SignalDecl { id: string; description: string; type: "number" | "flag"; when: "on-change" | "sampled" | "at-end"; min?: number; max?: Amount }
export interface EndDecl { id: string; by: "budget" | "clock"; setting: string }

export interface Document {
  id: string;
  version: string;
  history: { version: string; description: string }[];
  mechanic: string;
  verb: string;
  round: { tempo: { kind: "still" } | { kind: "ticking"; tickMs: number }; ends: EndDecl[]; logLimit: number };
  /** A ring board's cells are written with `x` the sector, counted clockwise from the top, and `y` the ring, counted from the innermost. */
  board: { shape: "grid"; width: string; height: string; touch: 4 | 8; rim: boolean } | { shape: "rings"; rings: string; sectors: string };
  terrain: TerrainDecl[];
  zones: never[];
  settings: SettingDecl[];
  relations: never[];
  deal: { draws: DrawDecl[]; checks: CheckDecl[]; bounds: never[] };
  layers: LayerDecl[];
  ladder: StageDecl[];
  signals: { in: SignalDecl[]; out: never[] };
  pieces: PieceDecl[];
  moves: MoveDecl[];
  controls: never[];
  events: EventDecl[];
  payouts: PayoutDecl[];
  multipliers: MultiplierDecl[];
  streak?: StreakDecl;
  tasks: TaskDecl[];
  gauges: GaugeDecl[];
  stats: StatDecl[];
  texts: { key: string }[];
  /** Needed only when a puzzle is ready. Without it a round is scored and never judged. */
  evaluation?: Evaluation;
  /** Needed only when a puzzle is ready. Without it no skin plays a beat. */
  moment?: Moment;
  teaching: { preview: boolean; hint: boolean };
}

// ---- the rules: the top rung. The loop knows these and nothing about parts.

export interface Board {
  /** On rings, the sectors around a ring and the rings: a cell's `x` and `y` run over them. */
  readonly width: number;
  readonly height: number;
  /** On rings, how many rings and sectors it has. 0 on a grid. */
  readonly rings: number;
  readonly sectors: number;
  places(): Cell[];
  has(place: Cell): boolean;
  at(place: Cell): Piece | null;
  /** What a cell is: the id of its terrain, or `plain`. A cell off the board is `off`. */
  terrain(place: Cell): string;
  /** The state a cell's terrain is in, or null where it has none. */
  terrainState(place: Cell): string | null;
  /** The cells on the board that touch a cell: four of them, or eight where the board counts corners. On rings: the two around its ring, which wraps, and the ones in and out along its sector. */
  touching(place: Cell): Cell[];
}
export interface Draw {
  even(n: number): number;
  chance(permille: number): boolean;
  /** One entry of a list, each alike. */
  pick<T>(list: readonly T[]): T;
  /** A draw from a bag only: the next item out of it, by its place in the list of counts the draw reads. The bag is shuffled again when it is empty. */
  next(): number;
}
export interface Changes {
  arrive(at: Cell, piece: NewPiece, from?: string): this;
  leave(at: Cell): this;
  travel(from: Cell, to: Cell): this;
  /**
   * The piece on a cell changes, in place, and keeps its id. Naming a piece makes it that piece. Naming only a kind
   * or a state changes that alone. A piece that travels on the same event is changed where it lands.
   * Naming a terrain changes the cell itself: to that terrain, in the state named or else its first.
   */
  change(at: Cell, to: Partial<NewPiece> | Ground): this;
  /** Sets a gauge or a stat the puzzle declares. */
  set(id: string, value: number): this;
  /** Opens a task the puzzle declares, with what it holds. */
  open(task: string, holds?: Record<string, unknown>): this;
  /** Finishes the open task of that id: the one opened first, where several are open. */
  done(task: string): this;
}
/** What a question is asked with. Answering changes nothing. */
export interface View<S = unknown> {
  readonly settings: Settings;
  readonly board: Board;
  /** What the rules remember that the loop does not keep. */
  readonly state: S;
  /** The points banked so far. */
  readonly score: number;
  /** Moves in a row that built the streak. */
  readonly streak: number;
  /** Whether a layer is on at the round's stage. */
  on(layer: string): boolean;
  /** What a gauge or a stat stands at. One nothing has set stands at 0. */
  value(id: string): number;
  /** The open task of that id, the one opened first, or null. */
  task(id: string): OpenTask | null;
}
/** What a hook that starts with "on" is given. It changes the round only by reporting events. */
export interface Ctx<S = unknown> extends View<S> {
  /** The step of the cascade the round is on: 0 before anything has counted as one. */
  readonly step: number;
  /** What this move would bank if it closed now: everything reported so far, with the streak, rounded down once. */
  readonly pending: number;
  draw(id: string): Draw;
  emit(event: string, fields: Record<string, unknown>, changes?: (e: Changes) => void): void;
}

/** One tick of a ticking puzzle: which it is, counted from 1, and its time in milliseconds from the round's start. */
export interface Tick { readonly n: number; readonly ms: number }

/** A hook that starts with "on" gives back the rules' next state, or nothing to keep it as it is. */
export interface Rules<M extends AnyMove = AnyMove, S = unknown> {
  onStart(ctx: Ctx<S>): S | void;
  /** Every try of a check has failed: deal a board that passes. Without it such a round refuses to start. */
  onFallback?(ctx: Ctx<S>): S | void;
  canMove(view: View<S>, move: M): string | null;
  onMove(ctx: Ctx<S>, seat: 0, move: M): S | void;
  onCascade?(ctx: Ctx<S>): S | void;
  onMoveEnd?(ctx: Ctx<S>): S | void;
  /** A ticking puzzle only: once for every tick, in order. */
  onTick?(ctx: Ctx<S>, tick: Tick): S | void;
  /** A signal in arrived. It is no move: it counts toward no budget, and is no miss of the streak. */
  onSignal?(ctx: Ctx<S>, signal: AnySignal): S | void;
  /** Fewer tasks are open than the puzzle declares: open one on an event, or report nothing when there is no room yet. */
  onTaskNeeded?(ctx: Ctx<S>): S | void;
  listMoves?(view: View<S>): M[];
  hint?(view: View<S>): M | null;
  pointsFor?(event: Event, paid: number): number;
}

/** A puzzle the loop can run: a whole document and a flat rules object. This is the top rung. */
export interface Puzzle<M extends AnyMove = AnyMove> { readonly document: Document; readonly rules: Rules<M, any> }
