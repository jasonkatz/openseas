// The shapes the loop runs on: a round's events, the puzzle document and the rules (ADR 0092).
// They follow docs/puzzles/DOMAIN.md and the docs site's rules SDK, as far as rungs 0 to 3 reach:
// one seat on a grid. Each later rung widens these and narrows nothing.

export type Cell = { readonly x: number; readonly y: number };
/** A piece's state is one of its named forms, or a number it shows, such as the moves a fuse has left. */
export interface Piece { readonly id: number; readonly piece: string; readonly kind?: number; readonly state?: number | string }
export type NewPiece = { readonly piece: string; readonly kind?: number; readonly state?: number | string };
export type Setting = number | boolean | readonly number[];
export type Settings = Readonly<Record<string, Setting>>;

export type ChangeKind = "arrive" | "leave" | "travel" | "change";
export type Change =
  | { readonly change: "arrive"; readonly at: Cell; readonly piece: Piece; readonly from: string }
  | { readonly change: "leave"; readonly at: Cell }
  | { readonly change: "travel"; readonly from: Cell; readonly to: Cell }
  | { readonly change: "change"; readonly at: Cell; readonly piece: Piece };

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
  /** Tasks it opened, each with what the task holds, and tasks it finished. */
  readonly tasks?: readonly ({ readonly task: string; readonly opened: Readonly<Record<string, unknown>> } | { readonly task: string; readonly done: true })[];
}
/** A task that is open: its id and what it holds, such as the kind a bounty names. */
export interface OpenTask { readonly task: string; readonly holds: Readonly<Record<string, unknown>> }
export type AnyMove = { readonly move: string } & Readonly<Record<string, unknown>>;

// ---- the puzzle document, as the guide writes it. Every key is present in an expanded puzzle.

export interface SettingDecl { id: string; type: "whole" | "list" | "flag"; default: Setting; min?: number; max?: number; description: string; group: "board" | "deal" | "tempo" | "scoring"; unit?: string; entries?: { least: number; most: number } }
export interface MoveDecl { id: string; description: string; gesture: string; fields: Record<string, "place" | "places" | "number" | "flag"> }
export interface EventDecl { id: string; description: string; fields: Record<string, "place" | "places" | "number" | "flag" | "points">; changes?: ChangeKind[]; step?: true; mistake?: true }
export interface DrawDecl { id: string; description: string; gives: "kind" | "piece" | "place" | "number"; by: "even" | "weighted"; when: "start" | "refill" | "task" | { every: string }; reads: string[] }
/** `needs: "settled"` asks only that nothing is left to happen by itself. Left out, a check also asks for a move worth making. */
export interface CheckDecl { id: string; description: string; draws: string[]; tries: number; needs?: "settled"; fallback: string; during?: string }
/** A number, or the id of the setting that holds it. */
export type Amount = number | string;
export interface PayoutDecl { id: string; description: string; on: string[]; counts?: string; growth: "flat" | "linear" | "superlinear" | "stepped"; cap?: Amount; reads: string[] }
/** `on` names the events it applies on: `every`, or ids joined by `or`, with an optional `when <condition>` after them. */
export interface MultiplierDecl { id: string; description: string; scales: string[]; on: string; by: { percent: string } | { table: string; index: "streak" | "step" } }
/** `builds.event` names one event, or several joined by `or`. */
export interface StreakDecl { builds: { event: string; when?: string }; grace: Amount; breaksOn: string[] }
/** `of` names the piece it is based on. `states` is the number it shows, up to a count, or its named forms. */
export interface PieceDecl { id: string; family?: string; of?: string; states?: { count: Amount } | { named: string[] } }
export interface GaugeDecl { id: string; description: string; most?: Amount; danger?: Amount }
export interface StatDecl { id: string; description: string }
export interface TaskDecl { id: string; description: string; open: number; ends: ("done")[]; graded: "none"; grades: string[] }
export interface LayerDecl { id: string; rule: string; brings: Record<string, string[]> }
export interface StageDecl { stage: string; adds: string[]; advance?: { measure: "best-round" | "average" | "wins" | "rounds"; threshold: number } }
export interface EndDecl { id: string; by: "budget" | "clock"; setting: string }

export interface Document {
  id: string;
  version: string;
  history: { version: string; description: string }[];
  mechanic: string;
  verb: string;
  round: { tempo: { kind: "still" }; ends: EndDecl[]; logLimit: number };
  board: { shape: "grid"; width: string; height: string; touch: 4 | 8; rim: boolean };
  terrain: never[];
  zones: never[];
  settings: SettingDecl[];
  relations: never[];
  deal: { draws: DrawDecl[]; checks: CheckDecl[]; bounds: never[] };
  layers: LayerDecl[];
  ladder: StageDecl[];
  signals: { in: never[]; out: never[] };
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
  teaching: { preview: boolean; hint: boolean };
}

// ---- the rules: the top rung. The loop knows these and nothing about parts.

export interface Board {
  readonly width: number;
  readonly height: number;
  places(): Cell[];
  has(place: Cell): boolean;
  at(place: Cell): Piece | null;
  /** The cells on the board that touch a cell: four of them, or eight where the board counts corners. */
  touching(place: Cell): Cell[];
}
export interface Draw { even(n: number): number; chance(permille: number): boolean }
export interface Changes {
  arrive(at: Cell, piece: NewPiece, from?: string): this;
  leave(at: Cell): this;
  travel(from: Cell, to: Cell): this;
  /** The piece on a cell changes, in place, and keeps its id. Naming a piece makes it that piece. Naming only a kind or a state changes that alone. */
  change(at: Cell, to: Partial<NewPiece>): this;
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

/** A hook that starts with "on" gives back the rules' next state, or nothing to keep it as it is. */
export interface Rules<M extends AnyMove = AnyMove, S = unknown> {
  onStart(ctx: Ctx<S>): S | void;
  /** Every try of a check has failed: deal a board that passes. Without it such a round refuses to start. */
  onFallback?(ctx: Ctx<S>): S | void;
  canMove(view: View<S>, move: M): string | null;
  onMove(ctx: Ctx<S>, seat: 0, move: M): S | void;
  onCascade?(ctx: Ctx<S>): S | void;
  onMoveEnd?(ctx: Ctx<S>): S | void;
  /** Fewer tasks are open than the puzzle declares: open one on an event, or report nothing when there is no room yet. */
  onTaskNeeded?(ctx: Ctx<S>): S | void;
  listMoves?(view: View<S>): M[];
  hint?(view: View<S>): M | null;
  pointsFor?(event: Event, paid: number): number;
}

/** A puzzle the loop can run: a whole document and a flat rules object. This is the top rung. */
export interface Puzzle<M extends AnyMove = AnyMove> { readonly document: Document; readonly rules: Rules<M, any> }
