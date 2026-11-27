// THROWAWAY SPIKE. Rung 1: puzzle() with a default for everything, and parts.
// A part is a slice of the puzzle document plus the hooks that work it. puzzle() merges parts into
// one whole document and one flat rules object, which is all the loop ever sees.
import type { AnyMove, CheckDecl, Ctx, Document, DrawDecl, Event, EventDecl, MoveDecl, PayoutDecl, PieceDecl, Puzzle, Rules, SettingDecl, View } from "./types.js";

export interface PartHooks {
  onStart?(ctx: Ctx): void;
  /** One answer for each move the part has a say on. */
  canMove?: Record<string, (view: View, move: any) => string | null>;
  onMove?: Record<string, (ctx: Ctx, seat: 0, move: any) => void>;
  onCascade?(ctx: Ctx): void;
  onMoveEnd?(ctx: Ctx): void;
  listMoves?(view: View): AnyMove[];
  hint?(view: View): AnyMove | null;
  pointsFor?(event: Event, paid: number): number;
}

export interface Part<M extends AnyMove = never> {
  /** How the part is written in a puzzle, for expand to print: its name and what it was called with. */
  readonly name: string;
  readonly args?: readonly unknown[];
  /** One plain line: what the part adds. It becomes part of the mechanic. */
  readonly rule: string;
  readonly settings?: readonly SettingDecl[];
  readonly pieces?: readonly PieceDecl[];
  readonly moves?: readonly MoveDecl[];
  readonly events?: readonly EventDecl[];
  readonly draws?: readonly DrawDecl[];
  readonly checks?: readonly CheckDecl[];
  readonly payouts?: readonly PayoutDecl[];
  readonly hooks: PartHooks;
  /** Only a type: the moves this part brings. */
  readonly __moves?: M;
}
/** An author's own part is written the same way a stock one is. */
export const part = <M extends AnyMove = never>(p: Part<M>): Part<M> => p;

export interface BoardSpec { readonly board: Document["board"]; readonly settings: readonly SettingDecl[] }
export interface EndSpec { readonly end: Document["round"]["ends"][number]; readonly settings: readonly SettingDecl[] }
export interface Spec<P extends readonly Part<any>[]> {
  readonly board: BoardSpec;
  /** How many kinds of piece are dealt. It becomes the setting `kinds`. */
  readonly pieces: number;
  readonly parts: P;
  readonly ends: EndSpec;
}
type MovesOf<T> = T extends Part<infer M> ? M : never;
export interface Composed<M extends AnyMove = AnyMove> extends Puzzle<M> { readonly parts: readonly Part<any>[] }

/** How parts merge. This table is the whole rule, and `explain` prints it for any puzzle. */
export const MERGE = {
  onStart: "every part, in the order listed",
  canMove: "every part with a say on the move, in order: the first reason refuses it",
  onMove: "every part with a say on the move, in order",
  onCascade: "parts in order: the first to report anything ends the step",
  onMoveEnd: "every part, in order",
  listMoves: "every part's moves, in order",
  hint: "the first part with an answer",
  pointsFor: "each part in order, handed what the last one paid",
} as const;

export function mergeHooks<M extends AnyMove>(parts: readonly Part<any>[]): Rules<M> {
  const having = <K extends keyof PartHooks>(k: K): NonNullable<PartHooks[K]>[] => parts.flatMap((p) => (p.hooks[k] ? [p.hooks[k]!] : []));
  const starts = having("onStart"), cans = having("canMove"), moves = having("onMove"), cascades = having("onCascade");
  const ends = having("onMoveEnd"), lists = having("listMoves"), hints = having("hint"), pays = having("pointsFor");
  const rules: Rules<M> = {
    onStart: (ctx) => starts.forEach((f) => f(ctx)),
    canMove: (view, move) => {
      for (const c of cans) {
        const reason = c[move.move]?.(view, move);
        if (reason) return reason;
      }
      return null;
    },
    onMove: (ctx, seat, move) => moves.forEach((m) => m[move.move]?.(ctx, seat, move)),
  };
  if (cascades.length) {
    rules.onCascade = (ctx) => {
      for (const f of cascades) {
        let reported = false;
        f({ ...ctx, step: ctx.step, emit: (...a) => ((reported = true), ctx.emit(...a)) });
        if (reported) return;
      }
    };
  }
  if (ends.length) rules.onMoveEnd = (ctx) => ends.forEach((f) => f(ctx));
  if (lists.length) rules.listMoves = (view) => lists.flatMap((f) => f(view)) as M[];
  if (hints.length) rules.hint = (view) => hints.reduce<AnyMove | null>((found, f) => found ?? f(view), null) as M | null;
  if (pays.length) rules.pointsFor = (event, paid) => pays.reduce((p, f) => f(event, p), paid);
  return rules;
}

function gather<T extends { id: string }>(what: string, sources: readonly (readonly [string, readonly T[] | undefined])[]): T[] {
  const by = new Map<string, string>();
  const out: T[] = [];
  for (const [from, list] of sources) {
    for (const item of list ?? []) {
      const other = by.get(item.id);
      if (other) throw new Error(`${what} "${item.id}" is declared by both ${other} and ${from}`);
      by.set(item.id, from);
      out.push(item);
    }
  }
  return out;
}

export function puzzle<const P extends readonly Part<any>[]>(id: string, spec: Spec<P>): Composed<MovesOf<P[number]>> {
  const parts = spec.parts;
  const from = <K extends "settings" | "pieces" | "moves" | "events" | "draws" | "checks" | "payouts">(k: K) => parts.map((p) => [p.name, p[k]] as const);
  const kinds: SettingDecl = { id: "kinds", type: "whole", default: spec.pieces, min: 2, max: 8, description: "kinds of piece dealt", group: "board" };
  const settings = gather<SettingDecl>("setting", [["the board", spec.board.settings], ["the pieces", [kinds]], ["the ending", spec.ends.settings], ...from("settings")]);
  const pieces = gather<PieceDecl>("piece", [["the pieces", [{ id: "kind", family: "kinds" }]], ...from("pieces")]);
  const moves = gather<MoveDecl>("move", from("moves"));
  const events = gather<EventDecl>("event", from("events"));
  const draws = gather<DrawDecl>("draw", from("draws"));
  const checks = gather<CheckDecl>("check", from("checks"));
  let payouts = gather<PayoutDecl>("payout", from("payouts"));
  // The default scoring: an event that carries points pays one for each place it names.
  if (payouts.length === 0) {
    payouts = events.flatMap((e) => {
      const places = Object.entries(e.fields).find(([, t]) => t === "places")?.[0];
      return places && Object.values(e.fields).includes("points") ? [{ id: e.id, description: `one point for each piece of a ${e.id}`, on: [e.id], counts: places, growth: "linear" as const, reads: [] }] : [];
    });
  }
  if (moves.length === 0) throw new Error(`${id} has no move: add a part that brings one`);
  const mechanic = parts.map((p) => p.rule).join("; ");
  const rules = mergeHooks<MovesOf<P[number]>>(parts);
  const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id);
  const document: Document = {
    id,
    version: "0.1",
    history: [{ version: "0.1", description: "First version" }],
    mechanic: mechanic[0]!.toUpperCase() + mechanic.slice(1),
    verb: moves[0]!.id,
    round: { tempo: { kind: "still" }, ends: [spec.ends.end], logLimit: 1000 },
    board: spec.board.board,
    terrain: [],
    zones: [],
    settings,
    relations: [],
    deal: { draws, checks, bounds: [] },
    layers: [{ id: "full", rule: mechanic, brings: { draws: ids(draws), pieces: ids(pieces), events: ids(events), settings: ids(settings), payouts: ids(payouts) } }],
    ladder: [{ stage: "full", adds: ["full"] }],
    signals: { in: [], out: [] },
    pieces,
    moves,
    controls: [],
    events,
    payouts,
    multipliers: [],
    tasks: [],
    gauges: [],
    stats: [],
    texts: [{ key: "name" }, { key: "how_to" }, { key: "stage.full" }, { key: "stage.full_intro" }, ...Array.from({ length: kinds.max }, (_, i) => ({ key: `piece.kind_${i + 1}` })), ...pieces.filter((p) => !p.family).map((p) => ({ key: `piece.${p.id}` }))],
    teaching: { preview: false, hint: Boolean(rules.listMoves || rules.hint) },
  };
  return { document, rules, parts };
}
