// The shapes the loop runs on: a round's events, the puzzle document and the rules (ADR 0092).
// They follow docs/puzzles/DOMAIN.md and the docs site's rules SDK, as far as rungs 0 and 1 reach:
// one seat, a still grid. Each later rung widens these and narrows nothing.

export type Cell = { readonly x: number; readonly y: number };
export interface Piece { readonly id: number; readonly piece: string; readonly kind?: number }
export type NewPiece = { readonly piece: string; readonly kind?: number };
export type Setting = number | readonly number[];
export type Settings = Readonly<Record<string, Setting>>;

export type ChangeKind = "arrive" | "leave" | "travel";
export type Change =
  | { readonly change: "arrive"; readonly at: Cell; readonly piece: Piece; readonly from: string }
  | { readonly change: "leave"; readonly at: Cell }
  | { readonly change: "travel"; readonly from: Cell; readonly to: Cell };

/** What a round reports. A board plays from these alone. */
export interface Event { readonly event: string; readonly fields: Readonly<Record<string, unknown>>; readonly points?: number; readonly changes: readonly Change[] }
export type AnyMove = { readonly move: string } & Readonly<Record<string, unknown>>;

// ---- the puzzle document, as the guide writes it. Every key is present in an expanded puzzle.

export interface SettingDecl { id: string; type: "whole" | "list"; default: Setting; min: number; max: number; description: string; group: "board" | "deal" | "tempo" | "scoring"; unit?: string; entries?: { least: number; most: number } }
export interface MoveDecl { id: string; description: string; gesture: string; fields: Record<string, "place" | "number" | "flag"> }
export interface EventDecl { id: string; description: string; fields: Record<string, "place" | "places" | "number" | "points">; changes: ChangeKind[]; step?: true }
export interface DrawDecl { id: string; description: string; gives: "kind" | "number"; by: "even"; when: "start" | "refill"; reads: string[] }
export interface CheckDecl { id: string; description: string; draws: string[]; tries: number; fallback: string; during?: string }
export interface PayoutDecl { id: string; description: string; on: string[]; counts: string; growth: "flat" | "linear" | "superlinear"; reads: string[] }
export interface PieceDecl { id: string; family?: string }

export interface Document {
  id: string;
  version: string;
  history: { version: string; description: string }[];
  mechanic: string;
  verb: string;
  round: { tempo: { kind: "still" }; ends: { id: string; by: "budget"; setting: string }[]; logLimit: number };
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
  multipliers: never[];
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
}
/** What a question is asked with. Answering changes nothing. */
export interface View { readonly settings: Settings; readonly board: Board }
/** What a hook that starts with "on" is given. It changes the round only by reporting events. */
export interface Ctx extends View {
  readonly step: number;
  draw(id: string): Draw;
  emit(event: string, fields: Record<string, unknown>, changes?: (e: Changes) => void): void;
}

export interface Rules<M extends AnyMove = AnyMove> {
  onStart(ctx: Ctx): void;
  /** Every try of a check has failed: deal a board that passes. Without it such a round refuses to start. */
  onFallback?(ctx: Ctx): void;
  canMove(view: View, move: M): string | null;
  onMove(ctx: Ctx, seat: 0, move: M): void;
  onCascade?(ctx: Ctx): void;
  onMoveEnd?(ctx: Ctx): void;
  listMoves?(view: View): M[];
  hint?(view: View): M | null;
  pointsFor?(event: Event, paid: number): number;
}

/** A puzzle the loop can run: a whole document and a flat rules object. This is the top rung. */
export interface Puzzle<M extends AnyMove = AnyMove> { readonly document: Document; readonly rules: Rules<M> }
