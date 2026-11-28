// The shapes the loop runs on: a round's events, the puzzle document and the rules (ADR 0092).
// They follow docs/puzzles/DOMAIN.md and the docs site's rules SDK, as far as rungs 0 to 3 reach:
// one seat on a grid. Each later rung widens these and narrows nothing.

export type Cell = { readonly x: number; readonly y: number };
export interface Piece { readonly id: number; readonly piece: string; readonly kind?: number }
export type NewPiece = { readonly piece: string; readonly kind?: number };
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
}
export type AnyMove = { readonly move: string } & Readonly<Record<string, unknown>>;

// ---- the puzzle document, as the guide writes it. Every key is present in an expanded puzzle.

export interface SettingDecl { id: string; type: "whole" | "list" | "flag"; default: Setting; min?: number; max?: number; description: string; group: "board" | "deal" | "tempo" | "scoring"; unit?: string; entries?: { least: number; most: number } }
export interface MoveDecl { id: string; description: string; gesture: string; fields: Record<string, "place" | "number" | "flag"> }
export interface EventDecl { id: string; description: string; fields: Record<string, "place" | "places" | "number" | "points">; changes: ChangeKind[]; step?: true }
export interface DrawDecl { id: string; description: string; gives: "kind" | "piece" | "number"; by: "even" | "weighted"; when: "start" | "refill"; reads: string[] }
/** `needs: "settled"` asks only that nothing is left to happen by itself. Left out, a check also asks for a move worth making. */
export interface CheckDecl { id: string; description: string; draws: string[]; tries: number; needs?: "settled"; fallback: string; during?: string }
/** A number, or the id of the setting that holds it. */
export type Amount = number | string;
export interface PayoutDecl { id: string; description: string; on: string[]; counts?: string; growth: "flat" | "linear" | "superlinear" | "stepped"; cap?: Amount; reads: string[] }
/** `on` names the events it applies on: `every`, or ids joined by `or`, with an optional `when <condition>` after them. */
export interface MultiplierDecl { id: string; description: string; scales: string[]; on: string; by: { percent: string } | { table: string; index: "streak" | "step" } }
/** `builds.event` names one event, or several joined by `or`. */
export interface StreakDecl { builds: { event: string; when?: string }; grace: Amount; breaksOn: string[] }
export interface PieceDecl { id: string; family?: string }
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
  layers: { id: string; rule: string; brings: Record<string, string[]> }[];
  ladder: { stage: string; adds: string[] }[];
  signals: { in: never[]; out: never[] };
  pieces: PieceDecl[];
  moves: MoveDecl[];
  controls: never[];
  events: EventDecl[];
  payouts: PayoutDecl[];
  multipliers: MultiplierDecl[];
  streak?: StreakDecl;
  tasks: never[];
  gauges: never[];
  stats: never[];
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
}
export interface Draw { even(n: number): number; chance(permille: number): boolean }
export interface Changes {
  arrive(at: Cell, piece: NewPiece, from?: string): this;
  leave(at: Cell): this;
  travel(from: Cell, to: Cell): this;
  /** The piece on a cell becomes another, in place. It keeps its id. */
  change(at: Cell, to: NewPiece): this;
}
/** What a question is asked with. Answering changes nothing. */
export interface View<S = unknown> {
  readonly settings: Settings;
  readonly board: Board;
  /** What the rules remember that the loop does not keep. */
  readonly state: S;
  /** The points banked so far. */
  readonly score: number;
  /** Scoring entries in a row. */
  readonly streak: number;
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
  listMoves?(view: View<S>): M[];
  hint?(view: View<S>): M | null;
  pointsFor?(event: Event, paid: number): number;
}

/** A puzzle the loop can run: a whole document and a flat rules object. This is the top rung. */
export interface Puzzle<M extends AnyMove = AnyMove> { readonly document: Document; readonly rules: Rules<M, any> }
