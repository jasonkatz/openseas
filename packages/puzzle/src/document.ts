/**
 * The puzzle document (docs/puzzles/DOMAIN.md, "The documents"): everything a puzzle declares about
 * itself, as data. The rules are the only part of a puzzle that is code; they are held to this
 * document by the engine (`round.ts`) and by `checkRules` (`check.ts`).
 */

/** A number, or the id of the setting that holds it. */
export type Sized = number | string;

export type Tempo =
  | { readonly kind: "still" }
  | { readonly kind: "ticking"; readonly tickMs: number }
  | { readonly kind: "turns"; readonly turnSeconds: number };

export interface Ending {
  readonly by: "clock" | "budget" | "stock" | "fail" | "outcome";
  /** Clock, budget and stock: the setting that sizes it. */
  readonly setting?: string;
  /** Fail and outcome: the event that names it. */
  readonly event?: string;
}

export interface BoardDecl {
  readonly shape: "grid" | "rings";
  readonly width?: Sized;
  readonly height?: Sized;
  readonly touch?: 4 | 8;
  readonly rim?: boolean;
  readonly rings?: Sized;
  readonly sectors?: Sized;
  readonly shared?: boolean;
}

export type SettingType = "whole" | "percent" | "permille" | "list" | "flag" | "maps";
export type SettingValue = number | boolean | readonly number[] | readonly unknown[];

export interface SettingDecl {
  readonly id: string;
  readonly type: SettingType;
  readonly default: SettingValue;
  /** The bounds every host holds it to. For a list, the bounds of each entry. */
  readonly min?: number;
  readonly max?: number;
  readonly line: string;
  readonly group: "board" | "deal" | "tempo" | "scoring";
  readonly unit?: "seconds" | "ticks" | "moves" | "cells" | "pieces" | "points";
  /** A list: the least and most entries, or the number or setting that fixes how many. */
  readonly entries?: { readonly least: number; readonly most: number } | { readonly count: Sized };
  readonly map?: { readonly board: string; readonly check: string };
  readonly role?: boolean;
}

export interface Relation {
  readonly is: "at-most" | "below" | "ascending" | "fits";
  readonly a: string;
  /** A setting, or `board` for fits. Absent for ascending. */
  readonly b?: string;
}

export interface DrawDecl {
  readonly id: string;
  readonly line: string;
  readonly gives: "kind" | "piece" | "place" | "map" | "task" | "number";
  readonly by: "even" | "weighted" | "bag" | "pick";
  readonly when: "start" | "refill" | "task" | "tick" | { readonly every: string };
  readonly reads: readonly string[];
  readonly shared?: boolean;
}

export interface CheckDecl {
  readonly id: string;
  readonly line: string;
  readonly draws: readonly string[];
  readonly tries: number;
  readonly fallback: string;
  readonly during?: string;
}

export interface SecretDecl {
  readonly id: string;
  readonly line: string;
  readonly hides: string;
  readonly revealedBy: readonly string[];
}

export interface Deal {
  readonly draws: readonly DrawDecl[];
  readonly checks: readonly CheckDecl[];
  readonly bounds: readonly { readonly setting: string; readonly caps: string }[];
  readonly secrets: readonly SecretDecl[];
}

/** What a layer can bring: the parts of a puzzle that exist only while it is on. */
export const BROUGHT = ["pieces", "events", "settings", "zones", "gauges", "controls", "payouts", "multipliers", "tasks", "draws"] as const;
export type Brought = (typeof BROUGHT)[number];

export interface LayerDecl {
  readonly id: string;
  readonly rule: string;
  readonly brings: { readonly [K in Brought]?: readonly string[] };
}

export interface StageDecl {
  readonly stage: string;
  readonly adds: readonly string[];
  /** Absent on the last stage, `full`. */
  readonly advance?: { readonly measure: "best-round" | "average-of-last" | "wins-over-stand-in" | "rounds-played"; readonly threshold: number };
}

export interface TierStarts {
  readonly steady: number;
  readonly sharp: number;
  readonly masterful: number;
  readonly legendary: number;
}

export interface Evaluation {
  readonly tierStarts?: TierStarts;
  readonly by?: "outcome";
  readonly paceWindowSeconds: number;
}

export interface SignalInDecl {
  readonly id: string;
  readonly type: "number" | "flag" | "outcome";
  readonly when: "on-change" | "sampled" | "at-end";
}

export interface PieceDecl {
  readonly id: string;
  readonly footprint?: unknown;
  /** The setting that counts its kinds: the piece is a family. */
  readonly family?: string;
  /** The piece it is based on. */
  readonly of?: string;
  readonly states?: readonly string[] | { readonly count: Sized };
}

export type MoveFieldType = "place" | "places" | "direction" | "piece" | "number" | "flag";
export type Gesture = "tap" | "long-press" | "draw" | "drag" | "swipe" | "slice" | "turn" | "hold";

export interface MoveDecl {
  readonly id: string;
  readonly line: string;
  readonly gesture: Gesture;
  readonly inHand?: boolean;
  readonly fields: Readonly<Record<string, MoveFieldType>>;
}

export type EventFieldType = "place" | "places" | "piece" | "player" | "number" | "points";
export type ChangeKind = "arrive" | "leave" | "travel" | "change";

export interface EventDecl {
  readonly id: string;
  readonly line: string;
  readonly fields: Readonly<Record<string, EventFieldType>>;
  readonly mistake?: boolean;
  readonly changes?: readonly ChangeKind[];
}

export interface Moment {
  readonly event: string;
  /** An optional condition on the event: a number field, a comparison and a whole number, such as `prizes > 0`. */
  readonly when?: string;
  readonly size: string;
  readonly most: Sized;
}

export interface PayoutDecl {
  readonly id: string;
  readonly line: string;
  readonly on: readonly string[];
  /** The event's field it grows from. Absent for a flat payout. */
  readonly counts?: string;
  readonly growth: "flat" | "linear" | "superlinear" | "stepped";
  readonly cap?: Sized;
  /** The settings that size it. The first is its size: the points, or the list of them for a stepped payout. */
  readonly reads: readonly string[];
}

export interface MultiplierDecl {
  readonly id: string;
  readonly line: string;
  readonly scales: readonly string[];
  readonly on: string;
  readonly by: { readonly percent: string } | { readonly table: string; readonly index: "streak" | "step" };
}

export interface StreakDecl {
  readonly builds: { readonly event: string; readonly when?: string } | { readonly grade: string };
  readonly grace: number;
  readonly breaksOn: readonly string[];
}

export interface TaskDecl {
  readonly id: string;
  readonly line: string;
  readonly open: Sized;
  readonly ends: readonly ("done" | "given-up" | "out-of-time")[];
  readonly control?: string;
  readonly setting?: string;
  readonly graded: "par" | "best" | "none";
  readonly grades: readonly string[];
}

export interface GaugeDecl {
  readonly id: string;
  readonly line: string;
  readonly most?: Sized;
  readonly danger?: Sized;
}

export interface PuzzleDoc {
  readonly id: string;
  readonly version: string;
  readonly history: readonly { readonly version: string; readonly line: string }[];
  readonly mechanic: string;
  readonly verb: string;
  readonly round: { readonly tempo: Tempo; readonly ends: readonly Ending[]; readonly logLimit: number };
  readonly opponents?: unknown;
  readonly board: BoardDecl;
  readonly terrain: readonly { readonly id: string; readonly states?: readonly string[] }[];
  readonly zones: readonly { readonly id: string; readonly holds: Sized; readonly player: "watches" | "takes" }[];
  readonly settings: readonly SettingDecl[];
  readonly relations: readonly Relation[];
  readonly deal: Deal;
  readonly layers: readonly LayerDecl[];
  readonly ladder: readonly StageDecl[];
  readonly evaluation: Evaluation;
  readonly signals: { readonly in: readonly SignalInDecl[]; readonly out: readonly unknown[] };
  readonly pieces: readonly PieceDecl[];
  readonly moves: readonly MoveDecl[];
  readonly controls: readonly { readonly id: string; readonly move?: string; readonly key?: string }[];
  readonly events: readonly EventDecl[];
  readonly moment: Moment;
  readonly payouts: readonly PayoutDecl[];
  readonly multipliers: readonly MultiplierDecl[];
  readonly streak?: StreakDecl;
  readonly tasks: readonly TaskDecl[];
  readonly gauges: readonly GaugeDecl[];
  readonly stats: readonly { readonly id: string; readonly line: string }[];
  readonly texts: readonly { readonly key: string; readonly placeholders?: readonly string[] }[];
  readonly teaching: { readonly preview: boolean; readonly hint: boolean };
}

/** A version, read as its two parts. Null when it is not written `major.minor`. */
export function versionOf(text: string): { readonly major: number; readonly minor: number } | null {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/** The layer that brings a part, or null when it belongs to the whole puzzle and so always exists. */
export function layerOf(doc: PuzzleDoc, what: Brought, id: string): string | null {
  for (const layer of doc.layers) if (layer.brings[what]?.includes(id)) return layer.id;
  return null;
}

/** The layers on at a stage: its own and those of every stage before it. Null when the ladder has no such stage. */
export function stageLayers(doc: PuzzleDoc, stage: string): readonly string[] | null {
  const on: string[] = [];
  for (const s of doc.ladder) {
    on.push(...s.adds);
    if (s.stage === stage) return on;
  }
  return null;
}

/** The stage whose layers are exactly these, or null: a round is always some stage's (ADR 0072, ADR 0074). */
export function stageOf(doc: PuzzleDoc, layers: readonly string[]): string | null {
  const want = [...new Set(layers)].sort().join(",");
  for (const s of doc.ladder) {
    if ([...(stageLayers(doc, s.stage) ?? [])].sort().join(",") === want) return s.stage;
  }
  return null;
}
