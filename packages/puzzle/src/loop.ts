// The loop: start, play and read, for one seat on a grid.
// The loop takes a whole document and a flat rules object. It has never heard of a part.
//
// Luck: every draw has a stream of its own, seeded from `<seed>/<draw id>`. A move tried on a copy
// draws from `<seed>/try/<draw id>`, so trying never shows or shifts the luck to come.
//
// Points (ADR 0093): the rules never add one. An event is paid from the document's payouts and
// multipliers as it is reported, kept exact, and the entry's total is rounded down once, when it is
// banked at Close. A multiplier indexed by the streak holds for the whole entry, so it is applied there.
import { nextInt, seedFromString, type PrngState } from "./prng.js";
import { holds } from "./when.js";
import { DIRECTIONS, TIERS, type Tier } from "./types.js";
import type { AnyMove, AnySignal, Board, Cell, Change, Changes, CheckDecl, Ctx, Document, Event, Ground, MapRows, NewPiece, OpenTask, Piece, Puzzle, Rules, Setting, Settings, View } from "./types.js";

interface State {
  width: number;
  height: number;
  cells: (Piece | null)[];
  /** The terrain of each cell. Null is a plain cell. */
  ground: (Ground | null)[];
  nextId: number;
  /** One stream for each draw, made from the seed and the draw's id. */
  streams: Record<string, PrngState>;
  /** What is left in each bag, by its draw's id, next first. */
  bags: Record<string, readonly number[]>;
  /** The round's seed, and what streams are seeded under: the seed, or `<seed>/try` on a copy. */
  seed: string;
  streamKey: string;
  points: number;
  moves: number;
  /** When the last entry was made, in milliseconds from the round's start. */
  time: number;
  /** The last tick that has run. 0 before any has, and in a still puzzle. */
  tick: number;
  step: number;
  stepHit: boolean;
  /** Entries in a row that built the streak, and misses in a row since one did. */
  streak: number;
  misses: number;
  /** The longest the streak has stood. */
  best: number;
  /** What every gauge and stat the rules have set stands at. */
  values: Record<string, number>;
  /** The open tasks, oldest first. */
  tasks: OpenTask[];
  /** What the rules remember: whatever their hooks last gave back. */
  rules: unknown;
  ended: string | null;
}

/** A puzzle with one round's settings and stage: what every part of the loop is handed. */
interface Game {
  readonly puzzle: Puzzle;
  readonly doc: Document;
  readonly settings: Settings;
  readonly stage: string;
  /** The layers that are on at the stage. */
  readonly on: ReadonlySet<string>;
  /** What belongs to a layer that is off, by what it is. A thing no layer brings is always there. */
  readonly off: Readonly<Record<string, ReadonlyMap<string, string>>>;
}
function gameOf(puzzle: Puzzle, settings: Settings, stage: string): Game {
  const doc = puzzle.document;
  const at = doc.ladder.findIndex((x) => x.stage === stage);
  if (at < 0) throw new Error(`${doc.id} has no stage ${stage}: its ladder is ${doc.ladder.map((x) => x.stage).join(", ")}`);
  const on = new Set(doc.ladder.slice(0, at + 1).flatMap((x) => x.adds));
  const off: Record<string, Map<string, string>> = {};
  for (const layer of doc.layers) {
    if (on.has(layer.id)) continue;
    for (const [what, ids] of Object.entries(layer.brings)) for (const id of ids) (off[what] ??= new Map()).set(id, layer.id);
  }
  return { puzzle, doc, settings, stage, on, off };
}
/** Refuses a thing that belongs to a layer the stage has not reached. */
function here(g: Game, what: string, noun: string, id: string): void {
  const layer = g.off[what]?.get(id);
  if (layer) throw new Error(`${noun} ${id} belongs to the layer ${layer}, which the stage ${g.stage} has not reached`);
}
const there = (g: Game, what: string, id: string): boolean => !g.off[what]?.has(id);
/** The puzzle's streak. Where a layer brings the gauge that shows it, no streak is kept until the stage has reached that layer. */
const streakOf = (g: Game): Document["streak"] => (there(g, "gauges", "streak") ? g.doc.streak : undefined);

/** One line of a round's log: a move or a signal in, and when it came, in milliseconds from the round's start. */
export type Entry<M extends AnyMove = AnyMove> = { readonly at: number; readonly move: M } | { readonly at: number; readonly signal: AnySignal };

export interface Round<M extends AnyMove = AnyMove> {
  readonly puzzle: Puzzle<M>;
  readonly seed: string;
  readonly settings: Settings;
  /** The stage of the puzzle's ladder the round is played at. */
  readonly stage: string;
  readonly state: State;
  readonly log: readonly Entry<M>[];
  /**
   * What the last call reported: the events of a move and what it banked, or why it was refused. A reason
   * is a text key, never a sentence: the loop's own are `reason.round_over`, `reason.unknown_move` and
   * `reason.off_board`, and a part declares its own among its texts. A skin gives each its words.
   */
  readonly last: { readonly events: readonly Event[]; readonly refused: string | null; readonly banked: number };
}

const clone = (s: State): State => ({ ...s, cells: [...s.cells], ground: [...s.ground], streams: { ...s.streams }, bags: { ...s.bags }, values: { ...s.values }, tasks: [...s.tasks] });
/** A copy that draws from throwaway streams, so trying a move never shows or shifts the luck to come. */
const scratch = (s: State): State => ({ ...clone(s), streams: {}, streamKey: `${s.seed}/try` });

const AROUND = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
function boardOf(s: State, shape: Document["board"] | { shape: "grid"; touch: 4 } = { shape: "grid", touch: 4 }): Board {
  const has = (p: Cell): boolean => Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < s.width && p.y < s.height;
  const ringed = shape.shape === "rings";
  const touch = shape.shape === "grid" ? shape.touch : 4;
  return {
    // Clockwise from the cell above. On rings, out, clockwise, in and anticlockwise, and a ring wraps.
    touching: (p) =>
      ringed
        ? [{ x: p.x, y: p.y + 1 }, { x: (p.x + 1) % s.width, y: p.y }, { x: p.x, y: p.y - 1 }, { x: (p.x + s.width - 1) % s.width, y: p.y }].filter((q, i, all) => has(q) && all.findIndex((r) => r.x === q.x && r.y === q.y) === i && (q.x !== p.x || q.y !== p.y))
        : AROUND.filter(([dx, dy]) => touch === 8 || dx === 0 || dy === 0).map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(has),
    width: s.width,
    height: s.height,
    rings: ringed ? s.height : 0,
    sectors: ringed ? s.width : 0,
    has,
    places: () => Array.from({ length: s.width * s.height }, (_, i) => ({ x: i % s.width, y: Math.floor(i / s.width) })),
    at: (p) => (has(p) ? s.cells[p.y * s.width + p.x]! : null),
    terrain: (p) => (has(p) ? (s.ground[p.y * s.width + p.x]?.terrain ?? "plain") : "off"),
    terrainState: (p) => (has(p) ? (s.ground[p.y * s.width + p.x]?.state ?? null) : null),
  };
}

function settingsOf(doc: Document, given: Record<string, Setting> = {}): Settings {
  const out: Record<string, Setting> = {};
  for (const d of doc.settings) {
    const v = given[d.id] ?? d.default;
    const isMaps = Array.isArray(v) && v.length > 0 && v.every((m) => Array.isArray(m) && m.every((row) => Array.isArray(row) && row.every((id) => typeof id === "string")));
    const right = d.type === "flag" ? typeof v === "boolean" : d.type === "maps" ? isMaps : d.type === "list" ? Array.isArray(v) && !isMaps : typeof v === "number";
    if (!right) throw new Error(`setting ${d.id}: ${JSON.stringify(v)} is not a ${d.type === "flag" ? "flag" : d.type === "maps" ? "list of maps" : d.type === "list" ? "list" : "whole number"}`);
    for (const n of typeof v === "number" ? [v] : d.type === "list" ? (v as readonly number[]) : []) {
      if (!Number.isInteger(n)) throw new Error(`setting ${d.id}: ${n} is not a whole number`);
      if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) throw new Error(`setting ${d.id}: ${n} is outside ${d.min ?? "any"} to ${d.max ?? "any"}`);
    }
    out[d.id] = v;
  }
  for (const id of Object.keys(given)) if (!(id in out)) throw new Error(`setting ${id} is not declared`);
  return out;
}
const amount = (settings: Settings, a: string | number): number => (typeof a === "number" ? a : (settings[a] as number));
const entry = (list: Setting | undefined, count: number): number => {
  const t = list as readonly number[];
  return t[Math.min(Math.max(count, 0), t.length - 1)]!;
};

// ---- points, kept exact until they are banked

/** A share of an event's points: a whole number over a power of a hundred, and the streak's multipliers still to come. */
interface Term { num: number; den: number; held: string[] }
/** What one entry has earned and done to the streak so far. */
interface Tally { terms: Term[]; built: boolean; broke: boolean }
const newTally = (): Tally => ({ terms: [], built: false, broke: false });
const floorDiv = (a: number, b: number): number => (a - (((a % b) + b) % b)) / b;
function total(terms: readonly Term[]): number {
  const den = terms.reduce((d, t) => Math.max(d, t.den), 1);
  return floorDiv(terms.reduce((n, t) => n + t.num * (den / t.den), 0), den);
}
/**
 * The streak a move leaves, before any mistake breaks it: one more when the move built it, the same within
 * its grace, and none past it.
 */
function streakAfter(g: Game, tally: Tally, s: { streak: number; misses: number }, move = true): { streak: number; misses: number } {
  const streak = streakOf(g);
  if (!streak) return { streak: 0, misses: 0 };
  // A streak that counts events is kept as each is reported. A tick is no move, so one that builds nothing is no miss.
  if (streak.counts === "events" || (!move && !tally.built)) return { streak: s.streak, misses: s.misses };
  if (tally.built) return { streak: s.streak + 1, misses: 0 };
  const misses = s.misses + 1;
  return { streak: misses > amount(g.settings, streak.grace) ? 0 : s.streak, misses };
}
/**
 * What the tally would bank: each share times the multipliers held for the whole entry, rounded down once.
 * A move is paid at the streak it leaves. The table's first entry is for the first success in a row, its
 * last entry holds, and a move that leaves no streak is paid as it is.
 */
function bank(g: Game, tally: Tally, s: { streak: number; misses: number }, move = true): number {
  const { doc, settings } = g;
  const streak = streakAfter(g, tally, s, move).streak;
  return total(
    tally.terms.map((t) => {
      let { num, den } = t;
      for (const id of t.held) {
        const m = doc.multipliers.find((x) => x.id === id)!;
        num *= streak === 0 ? 100 : entry(settings[(m.by as { table: string }).table], streak - 1);
        den *= 100;
      }
      return { num, den, held: [] };
    }),
  );
}

/** `every`, or event ids joined by `or`, with an optional `when <condition>` after them. */
export function eventsNamed(text: string): { events: string[] | "every"; when: string | null } {
  const [names, when] = text.split(/\s+when\s+/, 2) as [string, string | undefined];
  const list = names.trim().split(/\s+or\s+/);
  return { events: list.length === 1 && list[0] === "every" ? "every" : list, when: when ?? null };
}
function applies(on: string, when: string | undefined, id: string, fields: Readonly<Record<string, unknown>>, settings: Settings): boolean {
  const named = eventsNamed(on);
  if (named.events !== "every" && !named.events.includes(id)) return false;
  return [named.when, when].every((w) => !w || holds(w, fields, settings));
}

/** What an event's payouts and multipliers make of it, a share for each payout that pays on it. */
function termsOf(g: Game, id: string, fields: Readonly<Record<string, unknown>>, step: number, streakNow: number | null): Term[] {
  const { doc, settings } = g;
  const terms: Term[] = [];
  for (const p of doc.payouts) {
    if (!p.on.includes(id) || !there(g, "payouts", p.id)) continue;
    let n = 1;
    if (p.growth !== "flat") {
      const counted = fields[p.counts!];
      n = Array.isArray(counted) ? counted.length : (counted as number);
      if (p.cap !== undefined) n = Math.min(n, amount(settings, p.cap));
    }
    const read = p.reads[0] === undefined ? 1 : settings[p.reads[0]];
    let num = p.growth === "stepped" ? (n < 1 ? 0 : entry(read as Setting, n - 1)) : (read as number) * (p.growth === "flat" ? 1 : p.growth === "linear" ? n : n * n);
    let den = 1;
    const held: string[] = [];
    for (const m of doc.multipliers) {
      if (!m.scales.includes(p.id) || !there(g, "multipliers", m.id) || !applies(m.on, undefined, id, fields, settings)) continue;
      if ("percent" in m.by) (num *= settings[m.by.percent] as number), (den *= 100);
      else if (m.by.index === "step") (num *= entry(settings[m.by.table], step - 1)), (den *= 100);
      else if (streakNow === null) held.push(m.id);
      // A streak that counts events has already counted this one: it is paid at the streak it leaves, now.
      else (num *= streakNow === 0 ? 100 : entry(settings[m.by.table], streakNow - 1)), (den *= 100);
    }
    terms.push({ num, den, held });
  }
  return terms;
}

/** What a question is asked with. */
function viewOf(g: Game, s: State): View {
  return {
    settings: g.settings,
    board: boardOf(s, g.doc.board),
    get state() {
      return s.rules;
    },
    get score() {
      return s.points;
    },
    get streak() {
      return s.streak;
    },
    on: (layer) => g.on.has(layer),
    value: (id) => (id === "streak" ? s.streak : id === "best_streak" ? s.best : (s.values[id] ?? 0)),
    task: (id) => s.tasks.find((t) => t.task === id) ?? null,
  };
}

/** The context of an "on" hook: it reads the board and reports events, and each event is applied and paid as it is reported. */
function ctxOf(g: Game, s: State, out: Event[], tally: Tally): Ctx {
  const { doc, settings } = g;
  const rules = g.puzzle.rules;
  const view = viewOf(g, s);
  const ctx: Ctx = Object.create(view, {
    step: { get: () => s.step, enumerable: true },
    pending: { get: () => bank(g, tally, s), enumerable: true },
  }) as Ctx;
  ctx.draw = (id) => {
    if (!doc.deal.draws.some((d) => d.id === id)) throw new Error(`draw ${id} is not declared`);
    here(g, "draws", "draw", id);
    const next = (n: number): number => {
      const r = nextInt((s.streams[id] ??= seedFromString(`${s.streamKey}/${id}`)), n);
      s.streams[id] = r.state;
      return r.value;
    };
    return {
      even: next,
      chance: (permille) => next(1000) < permille,
      pick: (list) => list[next(list.length)]!,
      next() {
        const decl = doc.deal.draws.find((d) => d.id === id)!;
        if (decl.by !== "bag") throw new Error(`draw ${id} is not from a bag`);
        let bag = s.bags[id] ?? [];
        if (bag.length === 0) {
          // A fresh bag holds each item as often as the list the draw reads says, and is shuffled from its last place down.
          const fresh = (settings[decl.reads[0]!] as readonly number[]).flatMap((count, item) => Array.from({ length: count }, () => item));
          if (fresh.length === 0) throw new Error(`draw ${id}: its bag is empty`);
          for (let i = fresh.length - 1; i > 0; i--) {
            const j = next(i + 1);
            [fresh[i], fresh[j]] = [fresh[j]!, fresh[i]!];
          }
          bag = fresh;
        }
        s.bags[id] = bag.slice(1);
        return bag[0]!;
      },
    };
  };
  ctx.emit = (id, fields, build) => {
    const decl = doc.events.find((e) => e.id === id);
    if (!decl) throw new Error(`event ${id} is not declared`);
    here(g, "events", "event", id);
    const at = (p: Cell): number => p.y * s.width + p.x;
    const changes: Change[] = [];
    /** Changes to pieces, worked out once everything that travels has landed. */
    const late: { change: { change: "change"; at: Cell; piece?: Piece }; to: Partial<NewPiece> }[] = [];
    const sets: { id: string; value: number }[] = [];
    const tasks: NonNullable<Event["tasks"]>[number][] = [];
    const b: Changes = {
      arrive: (to, piece, from = "above") => (changes.push({ change: "arrive", at: to, piece: { id: s.nextId++, ...piece }, from }), b),
      leave: (from) => (changes.push({ change: "leave", at: from }), b),
      travel: (from, to) => (changes.push({ change: "travel", from, to }), b),
      change(where, to) {
        if ("terrain" in to) {
          const decl = doc.terrain.find((t) => t.id === to.terrain);
          if (!decl && to.terrain !== "plain") throw new Error(`event ${id} changes a cell to the terrain ${to.terrain}, which the puzzle does not have`);
          if (to.state !== undefined && !decl?.states?.includes(to.state)) throw new Error(`event ${id} changes a cell to ${to.terrain} in the state ${to.state}, which it does not have`);
          const state = to.state ?? decl?.states?.[0];
          changes.push({ change: "change", at: where, terrain: to.terrain, ...(state === undefined ? {} : { state }) });
          return b;
        }
        const change = { change: "change" as const, at: where };
        changes.push(change as Change);
        late.push({ change, to });
        return b;
      },
      set(what, value) {
        const gauge = doc.gauges.some((x) => x.id === what);
        if (!gauge && !doc.stats.some((x) => x.id === what)) throw new Error(`event ${id} sets ${what}, which is no gauge or stat of the puzzle`);
        if (what === "streak" || what === "best_streak") throw new Error(`event ${id} sets ${what}, which the loop keeps`);
        here(g, gauge ? "gauges" : "stats", gauge ? "gauge" : "stat", what);
        if (!Number.isFinite(value)) throw new Error(`event ${id} sets ${what} to ${value}`);
        sets.push({ id: what, value });
        return b;
      },
      open(task, holds = {}) {
        const t = doc.tasks.find((x) => x.id === task);
        if (!t) throw new Error(`event ${id} opens the task ${task}, which the puzzle does not have`);
        here(g, "tasks", "task", task);
        if (s.tasks.filter((x) => x.task === task).length + tasks.filter((x) => x.task === task && "opened" in x).length >= t.open) throw new Error(`event ${id} opens the task ${task}, and ${t.open} is open already`);
        tasks.push({ task, opened: holds });
        return b;
      },
      done(task) {
        if (!s.tasks.some((x) => x.task === task)) throw new Error(`event ${id} finishes the task ${task}, and none is open`);
        tasks.push({ task, done: true });
        return b;
      },
    };
    build?.(b);
    for (const c of changes) if (!decl.changes?.includes(c.change)) throw new Error(`event ${id} does not declare the change ${c.change}`);
    // One event's changes happen together: everything that leaves or travels is lifted first.
    const lifted = changes.flatMap((c) => (c.change === "travel" ? [{ to: c.to, piece: s.cells[at(c.from)]! }] : []));
    for (const c of changes) if (c.change === "leave" || c.change === "travel") s.cells[at(c.change === "leave" ? c.at : c.from)] = null;
    for (const l of lifted) s.cells[at(l.to)] = l.piece;
    for (const { change, to } of late) {
      const old = s.cells[at(change.at)];
      if (!old) throw new Error(`event ${id} changes the piece at ${change.at.x},${change.at.y}, and no piece is there`);
      // Naming a piece makes it that piece, whole. Naming less changes that alone.
      const next: Record<string, unknown> = to.piece === undefined ? { ...old, ...to } : { id: old.id, ...to };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      change.piece = next as unknown as Piece;
      s.cells[at(change.at)] = next as unknown as Piece;
    }
    for (const c of changes) {
      if (c.change === "arrive") s.cells[at(c.at)] = c.piece;
      else if (c.change === "change" && "terrain" in c) s.ground[at(c.at)] = c.terrain === "plain" ? null : { terrain: c.terrain, ...(c.state === undefined ? {} : { state: c.state }) };
    }
    for (const x of sets) s.values[x.id] = x.value;
    for (const t of tasks) {
      if ("opened" in t) s.tasks.push({ task: t.task, holds: t.opened });
      else s.tasks.splice(s.tasks.findIndex((x) => x.task === t.task), 1);
    }
    let event: Event = { event: id, fields, changes, ...(sets.length ? { sets } : {}), ...(tasks.length ? { tasks } : {}), ...(doc.round.tempo.kind === "ticking" ? { tick: s.tick } : {}) };
    const streak = streakOf(g);
    const byEvent = streak?.counts === "events";
    if (streak && byEvent && applies(streak.builds.event, streak.builds.when, id, fields, settings)) s.best = Math.max(s.best, ++s.streak);
    if (decl.step) {
      s.stepHit = true;
      event = { ...event, step: s.step + 1 };
    }
    if (Object.values(decl.fields).includes("points")) {
      let terms = termsOf(g, id, fields, Math.max(1, s.step + (decl.step ? 1 : 0)), byEvent ? s.streak : null);
      let paid = total(terms);
      if (rules.pointsFor) {
        const worth = Math.floor(rules.pointsFor({ ...event, points: paid }, paid));
        // An answer of the rules' own stands in for the payouts, and keeps the multipliers the first of them was held to.
        if (worth !== paid) terms = [{ num: worth, den: 1, held: terms[0]?.held ?? [] }];
        paid = worth;
      }
      tally.terms.push(...terms);
      event = { ...event, points: paid };
    }
    if (streak && byEvent) {
      if (streak.breaksOn.includes(id)) s.streak = 0;
    } else if (streak) {
      if (applies(streak.builds.event, streak.builds.when, id, fields, settings)) tally.built = true;
      if (streak.breaksOn.includes(id)) tally.broke = true;
    }
    out.push(event);
  };
  return ctx;
}

/** Asks one "on" hook. What it reports in one asking is one step at most, and what it gives back is the rules' next state. */
function ask(s: State, hook: () => unknown): void {
  s.stepHit = false;
  const next = hook();
  if (next !== undefined) s.rules = next;
  if (s.stepHit) s.step++;
}

/** The cascade: asked until it reports nothing. The loop counts the steps. True when it reported anything. */
function cascade(g: Game, s: State, out: Event[], ctx: Ctx): boolean {
  let any = false;
  for (let guard = 0; ; guard++) {
    if (guard > 10_000) throw new Error("the cascade never runs dry");
    const before = out.length;
    ask(s, () => g.puzzle.rules.onCascade?.(ctx));
    if (out.length === before) return any;
    any = true;
  }
}

/** Move or Tick, then Cascade and Move end. Move end is asked when the cascade has run dry, and again only if what it reported set the cascade off. */
function apply(g: Game, s: State, first: (ctx: Ctx) => unknown, out: Event[], tally: Tally): void {
  const ctx = ctxOf(g, s, out, tally);
  s.step = 0;
  ask(s, () => first(ctx));
  cascade(g, s, out, ctx);
  for (;;) {
    const before = out.length;
    ask(s, () => g.puzzle.rules.onMoveEnd?.(ctx));
    if (out.length === before || !cascade(g, s, out, ctx)) return;
  }
}

/** What a move would report, played on a copy. */
function tryMove(g: Game, s: State, move: AnyMove): Event[] {
  const out: Event[] = [];
  apply(g, scratch(s), (ctx) => g.puzzle.rules.onMove(ctx, 0, move), out, newTally());
  return out;
}
/** A move is worth making when it sets off an event that counts as a step, or pays. */
const scores = (g: Game, s: State, move: AnyMove): boolean => tryMove(g, s, move).some((e) => e.step !== undefined || (e.points ?? 0) > 0);
/** A board is stuck when no listed move is worth making. Only a puzzle that can list its moves can be asked. */
const stuck = (g: Game, s: State): boolean => !g.puzzle.rules.listMoves!(viewOf(g, s)).some((m) => scores(g, s, m));

/**
 * Reports a board as one event: whatever is no longer there leaves, and whatever is new arrives. A piece
 * that stands where it stood is left alone.
 */
function lay(g: Game, s: State, out: Event[], id: string, pieces: (cell: Cell) => Piece | NewPiece | null, from: string): void {
  const before = boardOf(s);
  const stays = (p: Cell): boolean => {
    const was = before.at(p), is = pieces(p);
    return Boolean(was && is && "id" in is && is.id === was.id);
  };
  const places = before.places().filter((p) => !stays(p));
  ctxOf(g, s, out, newTally()).emit(id, {}, (e) => {
    for (const p of places) if (before.at(p)) e.leave(p);
    for (const p of places) {
      const piece = pieces(p);
      if (piece) e.arrive(p, { piece: piece.piece, ...(piece.kind === undefined ? {} : { kind: piece.kind }), ...(piece.state === undefined ? {} : { state: piece.state }) }, from);
    }
  });
}

/**
 * The deal, held to the document's check by the loop itself: deal on a copy, let the cascade run there unseen
 * and unpaid, and deal again if no listed move is worth making. A check that needs only a settled board
 * stops at the cascade. The rules deal and know nothing of this.
 * When every try fails the rules' fallback deals, and what it deals is taken as it is.
 * Reported as one event: the check's `during` event when the board is dealt again, else the rules' own first event.
 * At the start the rules deal onto an empty board, and their state is what the deal's hook gave back. During play
 * they are handed the board as it stands, so what they leave alone stays, and their state is left alone.
 */
function deal(g: Game, s: State, out: Event[], check: CheckDecl | undefined, again: boolean): void {
  const rules = g.puzzle.rules;
  // With no check to hold, the rules deal straight onto the round, and what they report is what is seen.
  if (!check) return ask(s, () => rules.onStart(ctxOf(g, s, out, newTally())));
  const tries = check?.tries ?? 1;
  // One more turn than the tries: the last is the fallback's.
  for (let t = 0; t <= tries; t++) {
    const fallback = t === tries;
    if (fallback && !(check && rules.onFallback)) break;
    const trial: State = again ? clone(s) : { ...clone(s), cells: s.cells.map(() => null) };
    const unseen: Event[] = [];
    const ctx = ctxOf(g, trial, unseen, newTally());
    ask(trial, () => (fallback ? rules.onFallback!(ctx) : rules.onStart(ctx)));
    const first = unseen[0]?.event;
    const began = trial.rules;
    if (check && !fallback) cascade(g, trial, unseen, ctx);
    s.streams = trial.streams; // a failed try still used its luck, so the next try differs
    if (check && check.needs !== "settled" && !fallback && stuck(g, trial)) continue;
    if (!again) Object.assign(s, { rules: began, ground: trial.ground, bags: trial.bags, values: trial.values });
    const id = again ? check!.during! : first;
    if (id) lay(g, s, out, id, boardOf(trial).at, again ? "in place" : "above");
    return;
  }
  throw new Error(`check ${check!.id}: no deal passed in ${tries} tries, and the rules have no onFallback`);
}

/** Tasks: while fewer are open than a task declares, the rules are asked to open one. They may say there is no room yet by opening none. */
function needTasks(g: Game, s: State, out: Event[]): void {
  const ctx = ctxOf(g, s, out, newTally());
  for (const t of g.doc.tasks) {
    if (!there(g, "tasks", t.id)) continue;
    for (;;) {
      const open = s.tasks.filter((x) => x.task === t.id).length;
      if (open >= t.open) break;
      ask(s, () => g.puzzle.rules.onTaskNeeded?.(ctx));
      if (s.tasks.filter((x) => x.task === t.id).length === open) break;
    }
  }
}

export interface StartOptions {
  seed: string | number;
  settings?: Record<string, Setting>;
  /** The stage of the puzzle's ladder to play at. Left out, the last: the whole puzzle. */
  stage?: string;
  /**
   * A board to open on in place of the deal, row by row from the top. The rules' own deal is still asked, on a
   * copy, for the state they begin with and the event a deal is reported as. No check is held on a given board.
   */
  board?: readonly (readonly (NewPiece | null)[])[];
  /** With a board: the tasks open on it, in place of the ones the rules would open. */
  tasks?: readonly OpenTask[];
  /** Where a draw's stream stands, by the draw's id, in place of the one made from the seed. */
  streams?: Record<string, PrngState>;
}

export function start<M extends AnyMove>(puzzle: Puzzle<M>, opts: StartOptions): Round<M> {
  const doc = puzzle.document;
  const settings = settingsOf(doc, opts.settings);
  const stage = opts.stage ?? doc.ladder.at(-1)!.stage;
  const g = gameOf(puzzle as Puzzle, settings, stage);
  const width = amount(settings, doc.board.shape === "rings" ? doc.board.sectors : doc.board.width);
  const height = amount(settings, doc.board.shape === "rings" ? doc.board.rings : doc.board.height);
  const seed = String(opts.seed);
  for (const d of doc.settings) {
    if (d.type !== "maps") continue;
    (settings[d.id] as readonly MapRows[]).forEach((map, i) => {
      if (map.length !== height || map.some((row) => row.length !== width)) throw new Error(`setting ${d.id}: map ${i} is not ${width} by ${height}`);
      const unknown = map.flat().find((id) => id !== "plain" && !doc.terrain.some((t) => t.id === id));
      if (unknown) throw new Error(`setting ${d.id}: map ${i} names the terrain ${unknown}, which the puzzle does not have`);
    });
  }
  const s: State = { width, height, cells: Array.from({ length: width * height }, () => null), ground: Array.from({ length: width * height }, () => null), nextId: 1, streams: {}, bags: {}, seed, streamKey: seed, points: 0, moves: 0, time: 0, tick: 0, step: 0, stepHit: false, streak: 0, misses: 0, best: 0, values: {}, tasks: [], rules: undefined, ended: null };
  const asks = doc.deal.checks.find((c) => c.needs !== "settled");
  if (asks && !puzzle.rules.listMoves) throw new Error(`${doc.id} declares the check ${asks.id}, so its rules must answer listMoves`);
  const events: Event[] = [];
  if (opts.board) {
    const given = opts.board;
    if (given.length !== height || given.some((row) => row.length !== width)) throw new Error(`${doc.id}: the board given is not ${width} by ${height}`);
    const trial = scratch(s);
    const unseen: Event[] = [];
    ask(trial, () => g.puzzle.rules.onStart(ctxOf(g, trial, unseen, newTally())));
    if (!unseen[0]) throw new Error(`${doc.id}: its rules report no event when they deal, so a board given has nothing to be reported as`);
    s.rules = trial.rules;
    lay(g, s, events, unseen[0].event, (c) => given[c.y]![c.x]!, "above");
    Object.assign(s.streams, opts.streams);
    if (opts.tasks) s.tasks = [...opts.tasks];
    else needTasks(g, s, events);
  } else {
    Object.assign(s.streams, opts.streams);
    deal(g, s, events, doc.deal.checks[0], false);
    needTasks(g, s, events);
  }
  s.step = 0;
  return { puzzle, seed, settings, stage, state: s, log: [], last: { events, refused: null, banked: 0 } };
}

/** Which ending the clock has reached at a time, if any. */
function timeUp(doc: Document, settings: Settings, at: number): string | null {
  for (const end of doc.round.ends) if (end.by === "clock" && at >= amount(settings, end.setting) * 1000) return end.id;
  return null;
}

/** Close: the points are banked and the streak kept, then the check that holds during play, then tasks. What was banked. */
function close(g: Game, s: State, events: Event[], tally: Tally, move: boolean): number {
  const banked = bank(g, tally, s, move);
  s.points = Math.max(0, s.points + banked);
  Object.assign(s, streakAfter(g, tally, s, move));
  s.best = Math.max(s.best, s.streak);
  // A mistake breaks the streak at once, after the move has been paid at it.
  if (tally.broke) s.streak = 0;
  const check = g.doc.deal.checks.find((c) => c.during);
  if (check && stuck(g, s)) deal(g, s, events, check, true);
  needTasks(g, s, events);
  return banked;
}

/**
 * Ticks: every tick that has fallen due by a time is run, in order. Tick n falls due n ticks' lengths into the
 * round, so nothing ticks at its start, and the last tick is the one that falls on the clock's end or before it.
 * Each is an entry of its own: Tick, Cascade, Move end and Close. What they banked between them.
 */
function runTicks(g: Game, s: State, at: number, events: Event[]): number {
  const tempo = g.doc.round.tempo;
  if (tempo.kind !== "ticking") return 0;
  const clock = g.doc.round.ends.find((e) => e.by === "clock");
  const until = clock ? Math.min(at, amount(g.settings, clock.setting) * 1000) : at;
  let banked = 0;
  while (!s.ended && (s.tick + 1) * tempo.tickMs <= until) {
    const tick = { n: ++s.tick, ms: s.tick * tempo.tickMs };
    const tally = newTally();
    apply(g, s, (ctx) => g.puzzle.rules.onTick?.(ctx, tick), events, tally);
    banked += close(g, s, events, tally, false);
  }
  return banked;
}

/**
 * Makes a move. `at` is when it was made, in whole milliseconds from the round's start: a round with a clock
 * needs it, and without it the move is taken as made when the last one was. Time never runs backwards.
 * In a ticking puzzle every tick due by then runs first, so the move follows the tick it was made on.
 */
export function play<M extends AnyMove>(round: Round<M>, move: NoInfer<M>, when: { at?: number } = {}): Round<M> {
  const g = gameOf(round.puzzle as Puzzle, round.settings, round.stage);
  const { doc } = g;
  const at = when.at ?? round.state.time;
  if (!Number.isInteger(at) || at < round.state.time) throw new Error(`a move at ${at} cannot follow one at ${round.state.time}`);
  const refuse = (refused: string): Round<M> => ({ ...round, last: { events: [], refused, banked: 0 } });
  if (round.state.ended || timeUp(doc, round.settings, at)) return refuse("reason.round_over");
  // A move that is refused leaves the round as it was, its ticks included.
  const s = clone(round.state);
  const events: Event[] = [];
  let banked = runTicks(g, s, at, events);
  // Check: the loop refuses what it can before the rules are asked.
  const decl = doc.moves.find((m) => m.id === move.move);
  if (!decl) return refuse("reason.unknown_move");
  const board = boardOf(s);
  for (const [name, type] of Object.entries(decl.fields)) {
    const given = move[name];
    if (type === "place" && !board.has(given as Cell)) return refuse("reason.off_board");
    if (type === "places" && !(Array.isArray(given) && given.every((p) => board.has(p as Cell)))) return refuse("reason.off_board");
    if (type === "flag" && typeof given !== "boolean") return refuse("reason.unknown_move");
    if (type === "number" && !Number.isInteger(given)) return refuse("reason.unknown_move");
    if (type === "direction" && !(DIRECTIONS as readonly unknown[]).includes(given)) return refuse("reason.unknown_move");
  }
  const reason = g.puzzle.rules.canMove(viewOf(g, s), move);
  if (reason) return refuse(reason);
  // Move, Cascade, Move end, Close, then the endings.
  const tally = newTally();
  apply(g, s, (ctx) => g.puzzle.rules.onMove(ctx, 0, move), events, tally);
  banked += close(g, s, events, tally, true);
  s.moves++;
  s.time = at;
  for (const end of doc.round.ends) if (end.by === "budget" && s.moves >= amount(round.settings, end.setting)) s.ended = end.id;
  return { ...round, state: s, log: [...round.log, { at, move } as Entry<M>], last: { events, refused: null, banked } };
}

/**
 * Lets time pass with no move: every tick due by `at` runs. It writes nothing in the log, since the ticks between
 * two moves are worked out again from the moves' own times. A host calls it to show a ticking round moving, and
 * once more at the round's end.
 */
export function advance<M extends AnyMove>(round: Round<M>, when: { at: number }): Round<M> {
  const g = gameOf(round.puzzle as Puzzle, round.settings, round.stage);
  if (!Number.isInteger(when.at) || when.at < round.state.time) throw new Error(`time cannot run back from ${round.state.time} to ${when.at}`);
  const s = clone(round.state);
  const events: Event[] = [];
  const banked = runTicks(g, s, when.at, events);
  s.time = when.at;
  return { ...round, state: s, last: { events, refused: null, banked } };
}

/**
 * A signal in from outside the puzzle, such as a level a role wires in. It is told to the rules and runs Cascade,
 * Move end and Close as a move does, after every tick due by then. It is no move: it counts toward no budget, is no
 * miss of the streak, and the rules are never asked whether it may come. The log keeps it, so a replay sees it.
 */
export function signal<M extends AnyMove>(round: Round<M>, sig: AnySignal, when: { at?: number } = {}): Round<M> {
  const g = gameOf(round.puzzle as Puzzle, round.settings, round.stage);
  const { doc } = g;
  const at = when.at ?? round.state.time;
  if (!Number.isInteger(at) || at < round.state.time) throw new Error(`a signal at ${at} cannot follow an entry at ${round.state.time}`);
  const decl = doc.signals.in.find((x) => x.id === sig.signal);
  if (!decl) throw new Error(`${doc.id} takes no signal ${sig.signal}`);
  const v = sig.value;
  if (decl.type === "flag" ? typeof v !== "boolean" : !Number.isInteger(v) || (decl.min !== undefined && (v as number) < decl.min) || (decl.max !== undefined && (v as number) > amount(round.settings, decl.max))) throw new Error(`signal ${sig.signal}: ${JSON.stringify(v)} is not a ${decl.type === "flag" ? "flag" : `whole number from ${decl.min ?? "any"} to ${decl.max ?? "any"}`}`);
  if (round.state.ended || timeUp(doc, round.settings, at)) return { ...round, last: { events: [], refused: "reason.round_over", banked: 0 } };
  const s = clone(round.state);
  const events: Event[] = [];
  let banked = runTicks(g, s, at, events);
  const tally = newTally();
  apply(g, s, (ctx) => g.puzzle.rules.onSignal?.(ctx, sig), events, tally);
  banked += close(g, s, events, tally, false);
  s.time = at;
  return { ...round, state: s, log: [...round.log, { at, signal: sig }], last: { events, refused: null, banked } };
}

export interface Read {
  score: number;
  /** The tier the score stands in. Null where the puzzle says nothing of how a round is judged. */
  tier: Tier | null;
  /** The ending the round reached, by id. A clock's ending shows only when `read` is told the time. */
  ended: string | null;
  stage: string;
  movesMade: number;
  movesLeft: number | null;
  /** Milliseconds left on the clock at the time given, or at the last move. Null where no clock ends the round. */
  msLeft: number | null;
  streak: number;
  /** Every gauge the stage has, by id, and every stat. */
  gauges: Record<string, number>;
  stats: Record<string, number>;
  /** The open tasks, oldest first. */
  tasks: readonly OpenTask[];
  /** What the rules remember. Rules made of parts keep each part's under its name. */
  state: unknown;
  board: (Piece | null)[][];
  /** The terrain of every cell, row by row. Null is a plain cell. */
  ground: (Ground | null)[][];
  /** The last tick that has run. 0 in a still puzzle. */
  tick: number;
  wait: "anyone" | "nobody";
}
export function read(round: Round, when: { at?: number } = {}): Read {
  const s = round.state;
  const g = gameOf(round.puzzle as Puzzle, round.settings, round.stage);
  const { doc } = g;
  const view = viewOf(g, s);
  const at = Math.max(when.at ?? s.time, s.time);
  const budget = doc.round.ends.find((e) => e.by === "budget");
  const clock = doc.round.ends.find((e) => e.by === "clock");
  const board = Array.from({ length: s.height }, (_, y) => s.cells.slice(y * s.width, (y + 1) * s.width));
  const ended = s.ended ?? timeUp(doc, round.settings, at);
  const values = (what: "gauges" | "stats"): Record<string, number> => Object.fromEntries(doc[what].filter((x) => there(g, what, x.id)).map((x) => [x.id, view.value(x.id)]));
  const starts = doc.evaluation?.tierStarts;
  return {
    score: s.points,
    tier: starts ? TIERS.reduce<Tier>((at, tier) => (tier !== "green" && s.points >= starts[tier] ? tier : at), "green") : null,
    ended,
    stage: round.stage,
    movesMade: s.moves,
    movesLeft: budget ? amount(round.settings, budget.setting) - s.moves : null,
    msLeft: clock ? Math.max(0, amount(round.settings, clock.setting) * 1000 - at) : null,
    streak: s.streak,
    gauges: values("gauges"),
    stats: values("stats"),
    tasks: s.tasks,
    state: s.rules,
    board,
    ground: Array.from({ length: s.height }, (_, y) => s.ground.slice(y * s.width, (y + 1) * s.width)),
    tick: s.tick,
    wait: ended ? "nobody" : "anyone",
  };
}

const gameFor = (round: Round): Game => gameOf(round.puzzle as Puzzle, round.settings, round.stage);
/** A move worth making: the rules' own answer, or the first listed move that would set off a step or pay. */
export function hint<M extends AnyMove>(round: Round<M>): M | null {
  const g = gameFor(round as Round);
  const view = viewOf(g, round.state);
  if (g.puzzle.rules.hint) return g.puzzle.rules.hint(view) as M | null;
  return (g.puzzle.rules.listMoves?.(view).find((m) => scores(g, round.state, m)) as M | undefined) ?? null;
}
/** What a question is asked with, for a host that asks one of its own: the board, the settings, and what the loop keeps. */
export const view = (round: Round): View => viewOf(gameFor(round), round.state);
export const listMoves = <M extends AnyMove>(round: Round<M>): M[] => (round.puzzle.rules.listMoves?.(viewOf(gameFor(round as Round), round.state)) as M[] | undefined) ?? [];

/** The same seed, settings, stage and log always make the same round. */
export function replay<M extends AnyMove>(puzzle: Puzzle<M>, seed: string, settings: Record<string, Setting>, log: readonly Entry<M>[], stage?: string, until?: number): Round<M> {
  const round = log.reduce((r, e) => ("signal" in e ? signal(r, e.signal, { at: e.at }) : play(r, e.move, { at: e.at })), start(puzzle, { seed, settings, ...(stage ? { stage } : {}) }));
  return until === undefined ? round : advance(round, { at: until });
}
export type { PrngState, Rules };
