// Rungs 1 to 3: puzzle() with a default for every key, numbers as data, and parts.
// A part is a slice of the puzzle document plus the hooks that work it. puzzle() merges parts into
// one whole document and one flat rules object, which is all the loop ever sees.
import { eventsNamed } from "./loop.js";
import { whenProblem } from "./when.js";
import type { AnyMove, CheckDecl, Ctx, Document, DrawDecl, EndDecl, Event, EventDecl, GaugeDecl, LayerDecl, MoveDecl, MultiplierDecl, PayoutDecl, PieceDecl, Puzzle, Rules, Setting, SettingDecl, StageDecl, StatDecl, StreakDecl, TaskDecl, View } from "./types.js";

/** A part's hooks. Each is handed the part's own state, and an "on" hook gives back the next one, or nothing to keep it. */
export interface PartHooks<S = any> {
  onStart?(ctx: Ctx<S>): S | void;
  onFallback?(ctx: Ctx<S>): S | void;
  /** One answer for each move the part has a say on. */
  canMove?: Record<string, (view: View<S>, move: any) => string | null>;
  onMove?: Record<string, (ctx: Ctx<S>, seat: 0, move: any) => S | void>;
  onCascade?(ctx: Ctx<S>): S | void;
  onMoveEnd?(ctx: Ctx<S>): S | void;
  onTaskNeeded?(ctx: Ctx<S>): S | void;
  listMoves?(view: View<S>): AnyMove[];
  hint?(view: View<S>): AnyMove | null;
  pointsFor?(event: Event, paid: number): number;
}

/** A setting as a part declares it. One with no default is named by the part and given its value by the puzzle. */
export type SettingNeed = Omit<SettingDecl, "default"> & { readonly default?: Setting };

export interface Part<M extends AnyMove = never, S = any> {
  /** How the part is written in a puzzle, for expand to print: its name and what it was called with. Its state is kept under the name. */
  readonly name: string;
  readonly args?: readonly unknown[];
  /** One plain line: what the part adds. It becomes part of the mechanic. */
  readonly rule: string;
  readonly settings?: readonly SettingNeed[];
  readonly pieces?: readonly PieceDecl[];
  readonly moves?: readonly MoveDecl[];
  readonly events?: readonly EventDecl[];
  readonly draws?: readonly DrawDecl[];
  readonly checks?: readonly CheckDecl[];
  readonly payouts?: readonly PayoutDecl[];
  readonly multipliers?: readonly MultiplierDecl[];
  readonly gauges?: readonly GaugeDecl[];
  readonly stats?: readonly StatDecl[];
  readonly tasks?: readonly TaskDecl[];
  /** The puzzle's streak, where this part is the rule that keeps one. A puzzle has at most one. */
  readonly streak?: StreakDecl;
  /** The text keys it needs words for, such as each reason it refuses a move with. */
  readonly texts?: readonly string[];
  readonly hooks: PartHooks<S>;
  /** Only a type: the moves this part brings. */
  readonly __moves?: M;
}
/** A rules object written whole, by hand: the top rung. It gives back what it was handed, typed. */
export const defineRules = <M extends AnyMove, S = unknown>(rules: Rules<M, S>): Rules<M, S> => rules;

/** An author's own part is written the same way a stock one is. */
export const part = <M extends AnyMove = never, S = any>(p: Part<M, S>): Part<M, S> => p;

export interface BoardSpec { readonly board: Document["board"]; readonly settings: readonly SettingNeed[] }
export interface EndSpec { readonly end: EndDecl; readonly settings: readonly SettingNeed[] }
/** A setting as a puzzle writes it: a bare value is its default, and an object may bound and describe it. */
export type SettingSpec = Setting | { readonly default: Setting; readonly min?: number; readonly max?: number; readonly unit?: string; readonly description?: string; readonly group?: SettingDecl["group"] };
export interface PayoutSpec { readonly on: string | readonly string[]; readonly counts?: string; readonly growth?: PayoutDecl["growth"]; readonly cap?: number | string; readonly reads?: string; readonly description?: string }
/** `by` names the setting that holds the percent, or with `index` the list that holds one for each count. */
export interface MultiplierSpec { readonly scales: string | readonly string[]; readonly on?: string; readonly by: string; readonly index?: "streak" | "step"; readonly description?: string }
export interface StreakSpec { readonly builds: string | readonly string[]; readonly when?: string; readonly grace?: number | string; readonly breaksOn?: readonly string[] }
/** One stage of a puzzle's ladder: the parts it switches on, and the bar a player clears to move past it. */
export interface StageSpec<Q extends Part<any> = Part<any>> { readonly stage: string; readonly parts: readonly Q[]; readonly advance?: StageDecl["advance"] }
export const stage = <Q extends Part<any>>(id: string, parts: readonly Q[], opts: { advance?: StageDecl["advance"] } = {}): StageSpec<Q> => ({ stage: id, parts, ...opts });
/** A stage is passed by a best round of this many points. */
export const bestRound = (threshold: number): NonNullable<StageDecl["advance"]> => ({ measure: "best-round", threshold });

interface Common {
  readonly board: BoardSpec;
  /** How many kinds of piece are dealt. It becomes the setting `kinds`: write `"kinds"` to give its value among the settings. */
  readonly pieces: number | "kinds";
  readonly ends: EndSpec | readonly EndSpec[];
  /** The order the parts are asked in, by name, where it is not the order the stages list them in. */
  readonly order?: readonly string[];
  /** Numbers by name. One a part or the board already declares takes this value. Any other is the puzzle's own. */
  readonly settings?: Readonly<Record<string, SettingSpec>>;
  /** What an event is worth. An event that carries points and has no payout pays one point for each place it names. */
  readonly payouts?: Readonly<Record<string, PayoutSpec>>;
  readonly multipliers?: Readonly<Record<string, MultiplierSpec>>;
  readonly streak?: StreakSpec;
  /** Asked last, after every part's own. */
  readonly pointsFor?: (event: Event, paid: number) => number;
}
/**
 * A puzzle lists its parts, all on in every round, or its stages, each switching more parts on. A part in a
 * stage is a layer: it is never asked, and nothing it declares exists, until the round's stage has reached it.
 */
export type Spec<P extends readonly Part<any>[], Q extends Part<any> = never> = Common & ({ readonly parts: P; readonly stages?: undefined } | { readonly stages: readonly StageSpec<Q>[]; readonly parts?: undefined });
type MovesOf<T> = T extends Part<infer M, any> ? M : never;
export interface Composed<M extends AnyMove = AnyMove> extends Puzzle<M> { readonly parts: readonly Part<any>[] }

/** How parts merge. This table is the whole rule, and `explain` prints it for any puzzle. */
export const MERGE = {
  onStart: "every part, in the order listed",
  onFallback: "every part, in the order listed",
  canMove: "every part with a say on the move, in order: the first reason refuses it",
  onMove: "every part with a say on the move, in order",
  onCascade: "parts in order: the first to report anything ends the step",
  onMoveEnd: "every part, in order",
  onTaskNeeded: "every part, in order",
  listMoves: "every part's moves, in order",
  hint: "the first part with an answer",
  pointsFor: "each part in order, handed what the last one paid",
} as const;

/** What one part is handed: the loop's own context or view, with the part's state in place of the whole. */
const own = <T extends View>(base: T, name: string, states: Record<string, unknown>, more: PropertyDescriptorMap = {}): T => Object.create(base, { state: { get: () => states[name], enumerable: true }, ...more }) as T;

export function mergeHooks<M extends AnyMove>(all: readonly Part<any>[], last?: (event: Event, paid: number) => number, layered = false): Rules<M, Record<string, unknown>> {
  const any = (k: keyof PartHooks): boolean => all.some((p) => p.hooks[k]);
  /** The parts that are on: every one, or where the puzzle has stages, those the round's stage has reached. */
  const onAt = (view: View<unknown>): readonly Part<any>[] => (layered ? all.filter((p) => view.on(p.name)) : all);
  const statesOf = (view: View<unknown>): Record<string, unknown> => ({ ...(view.state as Record<string, unknown> | undefined) });
  /** Tells every part, in order. Each part's answer is its own next state, kept under its name. */
  const tell = (ctx: Ctx<unknown>, each: (p: Part<any>, ctx: Ctx) => unknown, untilReported = false): Record<string, unknown> | void => {
    const states = statesOf(ctx);
    let changed = false;
    for (const p of onAt(ctx)) {
      let reported = false;
      const next = each(p, own(ctx, p.name, states, { emit: { value: (...a: Parameters<Ctx["emit"]>) => ((reported = true), ctx.emit(...a)) } }));
      if (next !== undefined) (states[p.name] = next), (changed = true);
      if (untilReported && reported) break;
    }
    return changed ? states : undefined;
  };
  const pays = all.flatMap((p) => (p.hooks.pointsFor ? [p.hooks.pointsFor] : [])).concat(last ? [last] : []);
  const rules: Rules<M, Record<string, unknown>> = {
    onStart: (ctx) => tell(ctx, (p, c) => p.hooks.onStart?.(c)),
    canMove: (view, move) => {
      const states = statesOf(view);
      for (const p of onAt(view)) {
        const reason = p.hooks.canMove?.[move.move]?.(own(view, p.name, states), move);
        if (reason) return reason;
      }
      return null;
    },
    onMove: (ctx, seat, move) => tell(ctx, (p, c) => p.hooks.onMove?.[move.move]?.(c, seat, move)),
  };
  if (any("onFallback")) rules.onFallback = (ctx) => tell(ctx, (p, c) => p.hooks.onFallback?.(c));
  if (any("onCascade")) rules.onCascade = (ctx) => tell(ctx, (p, c) => p.hooks.onCascade?.(c), true);
  if (any("onMoveEnd")) rules.onMoveEnd = (ctx) => tell(ctx, (p, c) => p.hooks.onMoveEnd?.(c));
  if (any("onTaskNeeded")) rules.onTaskNeeded = (ctx) => tell(ctx, (p, c) => p.hooks.onTaskNeeded?.(c));
  if (any("listMoves")) rules.listMoves = (view) => onAt(view).flatMap((p) => p.hooks.listMoves?.(own(view, p.name, statesOf(view))) ?? []) as M[];
  if (any("hint")) rules.hint = (view) => onAt(view).reduce<AnyMove | null>((found, p) => found ?? p.hooks.hint?.(own(view, p.name, statesOf(view))) ?? null, null) as M | null;
  if (pays.length) rules.pointsFor = (event, paid) => pays.reduce((n, f) => f(event, n), paid);
  return rules;
}

/** The reasons the loop itself refuses a move with. Every puzzle has words for them. */
export const LOOP_REASONS = ["reason.round_over", "reason.unknown_move", "reason.off_board"] as const;

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

const list = <T>(x: T | readonly T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? [...x] : [x as T]);

/** What is wrong with the scoring a document declares, or nothing. Every id it names must be one the puzzle has. */
function scoringProblem(doc: Document): string | null {
  const settings = doc.settings.map((s) => s.id);
  const event = (id: string): EventDecl | undefined => doc.events.find((e) => e.id === id);
  const typed = (id: string, type: SettingDecl["type"]): boolean => doc.settings.find((s) => s.id === id)?.type === type;
  const named = (what: string, text: string, extra?: string): string | null => {
    const { events, when } = eventsNamed(text);
    const ids = events === "every" ? doc.events.map((e) => e.id) : events;
    for (const id of ids) if (!event(id)) return `${what} names the event ${id}, which the puzzle does not have`;
    for (const w of [when, extra ?? null]) {
      if (!w) continue;
      for (const id of events === "every" ? [] : ids) {
        const wrong = whenProblem(w, Object.keys(event(id)!.fields), settings);
        if (wrong) return `${what}: ${wrong}`;
      }
    }
    return null;
  };
  for (const p of doc.payouts) {
    const what = `payout ${p.id}`;
    for (const id of p.on) {
      const e = event(id);
      if (!e) return `${what} pays on the event ${id}, which the puzzle does not have`;
      if (!Object.values(e.fields).includes("points")) return `${what} pays on the event ${id}, which carries no points`;
      if (p.growth !== "flat" && !["number", "places"].includes(e.fields[p.counts ?? ""] ?? "")) return `${what} counts ${p.counts}, which is no number or places of the event ${id}`;
    }
    for (const id of p.reads) if (!typed(id, p.growth === "stepped" ? "list" : "whole")) return `${what} reads ${id}, which is no ${p.growth === "stepped" ? "list" : "whole number"} among the settings`;
    if (p.growth === "stepped" && p.reads.length === 0) return `${what} is stepped, so it reads a list`;
  }
  for (const m of doc.multipliers) {
    const what = `multiplier ${m.id}`;
    for (const id of m.scales) if (!doc.payouts.some((p) => p.id === id)) return `${what} scales the payout ${id}, which the puzzle does not have`;
    const wrong = named(what, m.on);
    if (wrong) return wrong;
    if ("percent" in m.by ? !typed(m.by.percent, "whole") : !typed(m.by.table, "list")) return `${what} reads ${"percent" in m.by ? `${m.by.percent}, which is no whole number` : `${m.by.table}, which is no list`} among the settings`;
    if ("index" in m.by && m.by.index === "streak" && !doc.streak) return `${what} is indexed by the streak, and the puzzle declares none`;
    if ("index" in m.by && m.by.index === "step" && !doc.events.some((e) => e.step)) return `${what} is indexed by the step, and no event of the puzzle counts as one`;
  }
  if (doc.streak) {
    const wrong = named("the streak", doc.streak.builds.event, doc.streak.builds.when);
    if (wrong) return wrong;
    if (typeof doc.streak.grace === "string" && !typed(doc.streak.grace, "whole")) return `the streak's grace reads ${doc.streak.grace}, which is no whole number among the settings`;
    for (const id of doc.streak.breaksOn) if (!event(id)) return `the streak breaks on the event ${id}, which the puzzle does not have`;
  }
  return null;
}

export function puzzle<const P extends readonly Part<any>[], Q extends Part<any> = never>(id: string, spec: Spec<P, Q>): Composed<MovesOf<P[number] | Q>> {
  const staged = spec.stages;
  const listed: readonly Part<any>[] = staged ? staged.flatMap((x) => x.parts) : spec.parts!;
  if (staged) {
    const twice = listed.find((p, i) => listed.findIndex((q) => q.name === p.name) !== i);
    if (twice) throw new Error(`${id}: the part ${twice.name} is in two stages. Each part is switched on by exactly one`);
    if (staged.at(-1)?.stage !== "full") throw new Error(`${id}: the last stage of a ladder is the whole puzzle, and is called full`);
  }
  for (const name of spec.order ?? []) if (!listed.some((p) => p.name === name)) throw new Error(`${id}: the order names ${name}, which is no part of the puzzle`);
  const place = (p: Part<any>): number => (spec.order?.includes(p.name) ? spec.order.indexOf(p.name) : (spec.order?.length ?? 0) + listed.indexOf(p));
  const parts = [...listed].sort((a, b) => place(a) - place(b));
  const from = <K extends "settings" | "pieces" | "moves" | "events" | "draws" | "checks" | "payouts" | "multipliers" | "gauges" | "stats" | "tasks">(k: K) => parts.map((p) => [p.name, p[k]] as const);
  const ends = list(spec.ends);
  const kinds: SettingNeed = { id: "kinds", type: "whole", ...(spec.pieces === "kinds" ? {} : { default: spec.pieces }), min: 2, max: 8, description: "kinds of piece dealt", group: "board" };
  const needs = gather<SettingNeed>("setting", [["the board", spec.board.settings], ["the pieces", [kinds]], ...ends.map((e) => [`the ending ${e.end.id}`, e.settings] as const), ...from("settings")]);
  const given = spec.settings ?? {};
  const written = (v: SettingSpec): Exclude<SettingSpec, Setting> => (typeof v === "object" && !Array.isArray(v) ? (v as Exclude<SettingSpec, Setting>) : { default: v as Setting });
  const settings: SettingDecl[] = needs.map((need) => {
    const made = { ...need, ...(need.id in given ? written(given[need.id]!) : {}) };
    if (made.default === undefined) throw new Error(`${id}: the setting ${need.id} has no value. Give it one among the settings`);
    return made as SettingDecl;
  });
  for (const [name, v] of Object.entries(given)) {
    if (needs.some((n) => n.id === name)) continue;
    const w = written(v);
    settings.push({ id: name, type: typeof w.default === "boolean" ? "flag" : typeof w.default === "number" ? "whole" : "list", description: name, group: "scoring", ...w });
  }
  const pieces = gather<PieceDecl>("piece", [["the pieces", [{ id: "kind", family: "kinds" }]], ...from("pieces")]);
  const moves = gather<MoveDecl>("move", from("moves"));
  const events = gather<EventDecl>("event", from("events"));
  const draws = gather<DrawDecl>("draw", from("draws"));
  const checks = gather<CheckDecl>("check", from("checks"));
  const mine: PayoutDecl[] = Object.entries(spec.payouts ?? {}).map(([name, p]) => ({ id: name, description: p.description ?? name, on: list(p.on), ...(p.counts ? { counts: p.counts } : {}), growth: p.growth ?? (p.counts ? "linear" : "flat"), ...(p.cap === undefined ? {} : { cap: p.cap }), reads: list(p.reads) }));
  const payouts = gather<PayoutDecl>("payout", [...from("payouts"), ["the puzzle", mine]]);
  // The default scoring: an event that carries points and has no payout pays one for each place it names.
  for (const e of events) {
    const places = Object.entries(e.fields).find(([, t]) => t === "places")?.[0];
    if (!places || !Object.values(e.fields).includes("points") || payouts.some((p) => p.on.includes(e.id))) continue;
    if (payouts.some((p) => p.id === e.id)) continue;
    payouts.push({ id: e.id, description: `one point for each piece of a ${e.id}`, on: [e.id], counts: places, growth: "linear", reads: [] });
  }
  const scaled: MultiplierDecl[] = Object.entries(spec.multipliers ?? {}).map(([name, m]) => {
    const scales = list(m.scales);
    // Left unsaid, a multiplier applies on every event its payouts pay on.
    const on = m.on ?? [...new Set(payouts.filter((p) => scales.includes(p.id)).flatMap((p) => p.on))].join(" or ");
    return { id: name, description: m.description ?? name, scales, on, by: m.index ? { table: m.by, index: m.index } : { percent: m.by } };
  });
  const multipliers = gather<MultiplierDecl>("multiplier", [...from("multipliers"), ["the puzzle", scaled]]);
  const gauges = gather<GaugeDecl>("gauge", from("gauges"));
  const stats = gather<StatDecl>("stat", from("stats"));
  const tasks = gather<TaskDecl>("task", from("tasks"));
  const streaks = [...parts.flatMap((p) => (p.streak ? [[p.name, p.streak] as const] : [])), ...(spec.streak ? [["the puzzle", { builds: { event: list(spec.streak.builds).join(" or "), ...(spec.streak.when ? { when: spec.streak.when } : {}) }, grace: spec.streak.grace ?? 0, breaksOn: [...(spec.streak.breaksOn ?? [])] } satisfies StreakDecl] as const] : [])];
  if (streaks.length > 1) throw new Error(`${id}: a puzzle has at most one streak, and both ${streaks[0]![0]} and ${streaks[1]![0]} declare one`);
  const streak: StreakDecl | undefined = streaks[0]?.[1];
  if (moves.length === 0) throw new Error(`${id} has no move: add a part that brings one`);
  if (ends.length === 0) throw new Error(`${id} has no ending: give it one`);
  const mechanic = parts.map((p) => p.rule).join("; ");
  const rules = mergeHooks<MovesOf<P[number] | Q>>(parts, spec.pointsFor, Boolean(staged));
  const ids = (list: readonly { id: string }[] | undefined): string[] => (list ?? []).map((x) => x.id);
  /** What a part brings as a layer: everything it declares, by what it is. The default payout of an event it brings is its too. */
  const brings = (p: Part<any>): Record<string, string[]> => {
    const events = ids(p.events);
    const all: Record<string, string[]> = { draws: ids(p.draws), pieces: ids(p.pieces), events, settings: ids(p.settings), gauges: ids(p.gauges), stats: ids(p.stats), payouts: [...ids(p.payouts), ...payouts.filter((x) => events.includes(x.id) && !ids(p.payouts).includes(x.id) && !mine.includes(x)).map((x) => x.id)], multipliers: ids(p.multipliers), tasks: ids(p.tasks) };
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v.length > 0));
  };
  const layers: LayerDecl[] = staged
    ? listed.map((p) => ({ id: p.name, rule: p.rule, brings: brings(p) }))
    : [{ id: "full", rule: mechanic, brings: { draws: ids(draws), pieces: ids(pieces), events: ids(events), settings: ids(settings), payouts: ids(payouts), ...(multipliers.length ? { multipliers: ids(multipliers) } : {}) } }];
  const ladder: StageDecl[] = staged ? staged.map((x) => ({ stage: x.stage, adds: x.parts.map((p) => p.name), ...(x.advance ? { advance: x.advance } : {}) })) : [{ stage: "full", adds: ["full"] }];
  const kindsMost = settings.find((s) => s.id === "kinds")!.max ?? 8;
  const document: Document = {
    id,
    version: "0.1",
    history: [{ version: "0.1", description: "First version" }],
    mechanic: mechanic[0]!.toUpperCase() + mechanic.slice(1),
    verb: moves[0]!.id,
    round: { tempo: { kind: "still" }, ends: ends.map((e) => e.end), logLimit: 1000 },
    board: spec.board.board,
    terrain: [],
    zones: [],
    settings,
    relations: [],
    deal: { draws, checks, bounds: [] },
    layers,
    ladder,
    signals: { in: [], out: [] },
    pieces,
    moves,
    controls: [],
    events,
    payouts,
    multipliers,
    ...(streak ? { streak } : {}),
    tasks,
    gauges,
    stats,
    texts: [{ key: "name" }, { key: "how_to" }, ...ladder.flatMap((x) => [{ key: `stage.${x.stage}` }, { key: `stage.${x.stage}_intro` }]), ...Array.from({ length: kindsMost }, (_, i) => ({ key: `piece.kind_${i + 1}` })), ...pieces.filter((p) => !p.family).map((p) => ({ key: `piece.${p.id}` })), ...LOOP_REASONS.map((key) => ({ key })), ...gather("text", parts.map((p) => [p.name, (p.texts ?? []).map((id) => ({ id }))] as const)).map((x) => ({ key: x.id }))],
    teaching: { preview: false, hint: Boolean(rules.listMoves || rules.hint) },
  };
  const wrong = scoringProblem(document);
  if (wrong) throw new Error(`${id}: ${wrong}`);
  return { document, rules, parts };
}
