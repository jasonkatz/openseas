// Rung 0: start, play and read, for one seat on a grid.
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
import type { AnyMove, Board, Cell, Change, Changes, CheckDecl, Ctx, Document, Event, NewPiece, Piece, Puzzle, Rules, Setting, Settings, View } from "./types.js";

interface State {
  width: number;
  height: number;
  cells: (Piece | null)[];
  nextId: number;
  /** One stream for each draw, made from the seed and the draw's id. */
  streams: Record<string, PrngState>;
  /** The round's seed, and what streams are seeded under: the seed, or `<seed>/try` on a copy. */
  seed: string;
  streamKey: string;
  points: number;
  moves: number;
  /** When the last entry was made, in milliseconds from the round's start. */
  time: number;
  step: number;
  stepHit: boolean;
  /** Entries in a row that built the streak, and misses in a row since one did. */
  streak: number;
  misses: number;
  /** What the rules remember: whatever their hooks last gave back. */
  rules: unknown;
  ended: string | null;
}

/** One line of a round's log: a move, and when it was made, in milliseconds from the round's start. */
export interface Entry<M extends AnyMove = AnyMove> { readonly at: number; readonly move: M }

export interface Round<M extends AnyMove = AnyMove> {
  readonly puzzle: Puzzle<M>;
  readonly seed: string;
  readonly settings: Settings;
  readonly state: State;
  readonly log: readonly Entry<M>[];
  /**
   * What the last call reported: the events of a move and what it banked, or why it was refused. A reason
   * is a text key, never a sentence: the loop's own are `reason.round_over`, `reason.unknown_move` and
   * `reason.off_board`, and a part declares its own among its texts. A skin gives each its words.
   */
  readonly last: { readonly events: readonly Event[]; readonly refused: string | null; readonly banked: number };
}

const clone = (s: State): State => ({ ...s, cells: [...s.cells], streams: { ...s.streams } });
/** A copy that draws from throwaway streams, so trying a move never shows or shifts the luck to come. */
const scratch = (s: State): State => ({ ...clone(s), streams: {}, streamKey: `${s.seed}/try` });

function boardOf(s: State): Board {
  const has = (p: Cell): boolean => Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < s.width && p.y < s.height;
  return {
    width: s.width,
    height: s.height,
    has,
    places: () => Array.from({ length: s.width * s.height }, (_, i) => ({ x: i % s.width, y: Math.floor(i / s.width) })),
    at: (p) => (has(p) ? s.cells[p.y * s.width + p.x]! : null),
  };
}

function settingsOf(doc: Document, given: Record<string, Setting> = {}): Settings {
  const out: Record<string, Setting> = {};
  for (const d of doc.settings) {
    const v = given[d.id] ?? d.default;
    const right = d.type === "flag" ? typeof v === "boolean" : d.type === "list" ? Array.isArray(v) : typeof v === "number";
    if (!right) throw new Error(`setting ${d.id}: ${JSON.stringify(v)} is not a ${d.type === "flag" ? "flag" : d.type === "list" ? "list" : "whole number"}`);
    for (const n of typeof v === "number" ? [v] : typeof v === "boolean" ? [] : v) {
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
/** What the tally would bank on this streak: each share times the multipliers held for the whole entry, rounded down once. */
function bank(doc: Document, settings: Settings, tally: Tally, streak: number): number {
  return total(
    tally.terms.map((t) => {
      let { num, den } = t;
      for (const id of t.held) {
        const m = doc.multipliers.find((x) => x.id === id)!;
        num *= entry(settings[(m.by as { table: string }).table], streak);
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
function termsOf(doc: Document, settings: Settings, id: string, fields: Readonly<Record<string, unknown>>, step: number): Term[] {
  const terms: Term[] = [];
  for (const p of doc.payouts) {
    if (!p.on.includes(id)) continue;
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
      if (!m.scales.includes(p.id) || !applies(m.on, undefined, id, fields, settings)) continue;
      if ("percent" in m.by) (num *= settings[m.by.percent] as number), (den *= 100);
      else if (m.by.index === "step") (num *= entry(settings[m.by.table], step - 1)), (den *= 100);
      else held.push(m.id);
    }
    terms.push({ num, den, held });
  }
  return terms;
}

/** The context of an "on" hook: it reads the board and reports events, and each event is applied and paid as it is reported. */
function ctxOf(puzzle: Puzzle, settings: Settings, s: State, out: Event[], tally: Tally): Ctx {
  const { document: doc, rules } = puzzle;
  const board = boardOf(s);
  return {
    settings,
    board,
    get state() {
      return s.rules;
    },
    get score() {
      return s.points;
    },
    get streak() {
      return s.streak;
    },
    get step() {
      return s.step;
    },
    get pending() {
      return bank(doc, settings, tally, s.streak);
    },
    draw(id) {
      if (!doc.deal.draws.some((d) => d.id === id)) throw new Error(`draw ${id} is not declared`);
      const next = (n: number): number => {
        const r = nextInt((s.streams[id] ??= seedFromString(`${s.streamKey}/${id}`)), n);
        s.streams[id] = r.state;
        return r.value;
      };
      return { even: next, chance: (permille) => next(1000) < permille };
    },
    emit(id, fields, build) {
      const decl = doc.events.find((e) => e.id === id);
      if (!decl) throw new Error(`event ${id} is not declared`);
      const at = (p: Cell): number => p.y * s.width + p.x;
      const changes: Change[] = [];
      const b: Changes = {
        arrive: (to, piece, from = "above") => (changes.push({ change: "arrive", at: to, piece: { id: s.nextId++, ...piece }, from }), b),
        leave: (from) => (changes.push({ change: "leave", at: from }), b),
        travel: (from, to) => (changes.push({ change: "travel", from, to }), b),
        change: (where, to) => (changes.push({ change: "change", at: where, piece: { id: s.cells[at(where)]!.id, ...to } }), b),
      };
      build?.(b);
      for (const c of changes) if (!decl.changes.includes(c.change)) throw new Error(`event ${id} does not declare the change ${c.change}`);
      // One event's changes happen together: everything that leaves or travels is lifted first.
      const lifted = changes.flatMap((c) => (c.change === "travel" ? [{ to: c.to, piece: s.cells[at(c.from)]! }] : []));
      for (const c of changes) if (c.change === "leave" || c.change === "travel") s.cells[at(c.change === "leave" ? c.at : c.from)] = null;
      for (const l of lifted) s.cells[at(l.to)] = l.piece;
      for (const c of changes) if (c.change === "arrive" || c.change === "change") s.cells[at(c.at)] = c.piece;
      let event: Event = { event: id, fields, changes };
      if (decl.step) {
        s.stepHit = true;
        event = { ...event, step: s.step + 1 };
      }
      if (Object.values(decl.fields).includes("points")) {
        let terms = termsOf(doc, settings, id, fields, Math.max(1, s.step + (decl.step ? 1 : 0)));
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
      const streak = doc.streak;
      if (streak) {
        if (applies(streak.builds.event, streak.builds.when, id, fields, settings)) tally.built = true;
        if (streak.breaksOn.includes(id)) tally.broke = true;
      }
      out.push(event);
    },
  };
}
const viewOf = (settings: Settings, s: State): View => ({ settings, board: boardOf(s), state: s.rules, score: s.points, streak: s.streak });

/** Asks one "on" hook. What it reports in one asking is one step at most, and what it gives back is the rules' next state. */
function ask(s: State, hook: () => unknown): void {
  s.stepHit = false;
  const next = hook();
  if (next !== undefined) s.rules = next;
  if (s.stepHit) s.step++;
}

/** Cascade and Move end: asked until nothing more is reported. The loop counts the steps. */
function settle(puzzle: Puzzle, settings: Settings, s: State, out: Event[], tally: Tally): void {
  const ctx = ctxOf(puzzle, settings, s, out, tally);
  const cascade = (): boolean => {
    let any = false;
    for (let guard = 0; ; guard++) {
      if (guard > 10_000) throw new Error("the cascade never runs dry");
      const before = out.length;
      ask(s, () => puzzle.rules.onCascade?.(ctx));
      if (out.length === before) return any;
      any = true;
    }
  };
  cascade();
  // Move end is asked when the cascade has run dry, and again only if what it reported set the cascade off.
  for (;;) {
    const before = out.length;
    ask(s, () => puzzle.rules.onMoveEnd?.(ctx));
    if (out.length === before || !cascade()) return;
  }
}

function apply(puzzle: Puzzle, settings: Settings, s: State, move: AnyMove, out: Event[], tally: Tally): void {
  s.step = 0;
  ask(s, () => puzzle.rules.onMove(ctxOf(puzzle, settings, s, out, tally), 0, move));
  settle(puzzle, settings, s, out, tally);
}

/** What a move would report, played on a copy. */
function tryMove(puzzle: Puzzle, settings: Settings, s: State, move: AnyMove): Event[] {
  const out: Event[] = [];
  apply(puzzle, settings, scratch(s), move, out, newTally());
  return out;
}
const scores = (puzzle: Puzzle, settings: Settings, s: State, move: AnyMove): boolean => tryMove(puzzle, settings, s, move).some((e) => e.step !== undefined);
/** A board is stuck when no listed move would set off a single step. Only a puzzle that can list its moves can be asked. */
const stuck = (puzzle: Puzzle, settings: Settings, s: State): boolean => !puzzle.rules.listMoves!(viewOf(settings, s)).some((m) => scores(puzzle, settings, s, m));

/** Reports a whole board as one event: whatever stood leaves, and every piece of the new board arrives. */
function lay(puzzle: Puzzle, settings: Settings, s: State, out: Event[], id: string, pieces: (cell: Cell) => NewPiece | null, from: string): void {
  const before = boardOf(s);
  const places = before.places();
  const left = places.filter((p) => before.at(p));
  ctxOf(puzzle, settings, s, out, newTally()).emit(id, {}, (e) => {
    for (const p of left) e.leave(p);
    for (const p of places) {
      const piece = pieces(p);
      if (piece) e.arrive(p, { piece: piece.piece, ...(piece.kind === undefined ? {} : { kind: piece.kind }) }, from);
    }
  });
}

/**
 * The deal, held to the document's check by the loop itself: deal on a copy, let the cascade run there unseen
 * and unpaid, and deal again if no listed move would set off a step. A check that needs only a settled board
 * stops at the cascade. The rules deal and know nothing of this.
 * When every try fails the rules' fallback deals, and what it deals is taken as it is.
 * Reported as one event: the check's `during` event when the board is dealt again, else the rules' own first event.
 * At the start the rules' state is what the deal's hook gave back. A board dealt again during play leaves it alone.
 */
function deal(puzzle: Puzzle, settings: Settings, s: State, out: Event[], check: CheckDecl | undefined, again: boolean): void {
  const tries = check?.tries ?? 1;
  // One more turn than the tries: the last is the fallback's.
  for (let t = 0; t <= tries; t++) {
    const fallback = t === tries;
    if (fallback && !(check && puzzle.rules.onFallback)) break;
    const trial: State = { ...clone(s), cells: s.cells.map(() => null) };
    const unseen: Event[] = [];
    const ctx = ctxOf(puzzle, settings, trial, unseen, newTally());
    ask(trial, () => (fallback ? puzzle.rules.onFallback!(ctx) : puzzle.rules.onStart(ctx)));
    const first = unseen[0]?.event;
    const began = trial.rules;
    if (check && !fallback) settle(puzzle, settings, trial, unseen, newTally());
    s.streams = trial.streams; // a failed try still used its luck, so the next try differs
    if (check && check.needs !== "settled" && !fallback && stuck(puzzle, settings, trial)) continue;
    if (!again) s.rules = began;
    const id = again ? check!.during! : first;
    if (id) lay(puzzle, settings, s, out, id, boardOf(trial).at, again ? "in place" : "above");
    return;
  }
  throw new Error(`check ${check!.id}: no deal passed in ${tries} tries, and the rules have no onFallback`);
}

export interface StartOptions {
  seed: string | number;
  settings?: Record<string, Setting>;
  /**
   * A board to open on in place of the deal, row by row from the top. The rules' own deal is still asked, on a
   * copy, for the state they begin with and the event a deal is reported as. No check is held on a given board.
   */
  board?: readonly (readonly (NewPiece | null)[])[];
  /** Where a draw's stream stands, by the draw's id, in place of the one made from the seed. */
  streams?: Record<string, PrngState>;
}

export function start<M extends AnyMove>(puzzle: Puzzle<M>, opts: StartOptions): Round<M> {
  const doc = puzzle.document;
  const p = puzzle as Puzzle;
  const settings = settingsOf(doc, opts.settings);
  const width = amount(settings, doc.board.width);
  const height = amount(settings, doc.board.height);
  const seed = String(opts.seed);
  const s: State = { width, height, cells: Array.from({ length: width * height }, () => null), nextId: 1, streams: {}, seed, streamKey: seed, points: 0, moves: 0, time: 0, step: 0, stepHit: false, streak: 0, misses: 0, rules: undefined, ended: null };
  const asks = doc.deal.checks.find((c) => c.needs !== "settled");
  if (asks && !puzzle.rules.listMoves) throw new Error(`${doc.id} declares the check ${asks.id}, so its rules must answer listMoves`);
  const events: Event[] = [];
  if (opts.board) {
    const given = opts.board;
    if (given.length !== height || given.some((row) => row.length !== width)) throw new Error(`${doc.id}: the board given is not ${width} by ${height}`);
    const trial = scratch(s);
    const unseen: Event[] = [];
    ask(trial, () => p.rules.onStart(ctxOf(p, settings, trial, unseen, newTally())));
    if (!unseen[0]) throw new Error(`${doc.id}: its rules report no event when they deal, so a board given has nothing to be reported as`);
    s.rules = trial.rules;
    lay(p, settings, s, events, unseen[0].event, (c) => given[c.y]![c.x]!, "above");
  } else deal(p, settings, s, events, doc.deal.checks[0], false);
  Object.assign(s.streams, opts.streams);
  s.step = 0;
  return { puzzle, seed, settings, state: s, log: [], last: { events, refused: null, banked: 0 } };
}

/** Which ending the clock has reached at a time, if any. */
function timeUp(doc: Document, settings: Settings, at: number): string | null {
  for (const end of doc.round.ends) if (end.by === "clock" && at >= amount(settings, end.setting) * 1000) return end.id;
  return null;
}

/**
 * Makes a move. `at` is when it was made, in whole milliseconds from the round's start: a round with a clock
 * needs it, and without it the move is taken as made when the last one was. Time never runs backwards.
 */
export function play<M extends AnyMove>(round: Round<M>, move: NoInfer<M>, when: { at?: number } = {}): Round<M> {
  const puzzle = round.puzzle as Puzzle;
  const doc = puzzle.document;
  const at = when.at ?? round.state.time;
  if (!Number.isInteger(at) || at < round.state.time) throw new Error(`a move at ${at} cannot follow one at ${round.state.time}`);
  const refuse = (refused: string): Round<M> => ({ ...round, last: { events: [], refused, banked: 0 } });
  if (round.state.ended || timeUp(doc, round.settings, at)) return refuse("reason.round_over");
  // Check: the loop refuses what it can before the rules are asked.
  const decl = doc.moves.find((m) => m.id === move.move);
  if (!decl) return refuse("reason.unknown_move");
  const board = boardOf(round.state);
  for (const [name, type] of Object.entries(decl.fields)) if (type === "place" && !board.has(move[name] as Cell)) return refuse("reason.off_board");
  const reason = puzzle.rules.canMove(viewOf(round.settings, round.state), move);
  if (reason) return refuse(reason);
  // Move, Cascade, Move end.
  const s = clone(round.state);
  const events: Event[] = [];
  const tally = newTally();
  apply(puzzle, round.settings, s, move, events, tally);
  // Close: the points are banked and the streak kept, then the check that holds during play, then the endings.
  const banked = bank(doc, round.settings, tally, s.streak);
  s.points = Math.max(0, s.points + banked);
  if (doc.streak) {
    if (tally.built) (s.streak++, (s.misses = 0));
    else if (++s.misses > amount(round.settings, doc.streak.grace)) s.streak = 0;
    if (tally.broke) s.streak = 0;
  }
  const check = doc.deal.checks.find((c) => c.during);
  if (check && stuck(puzzle, round.settings, s)) deal(puzzle, round.settings, s, events, check, true);
  s.moves++;
  s.time = at;
  for (const end of doc.round.ends) if (end.by === "budget" && s.moves >= amount(round.settings, end.setting)) s.ended = end.id;
  return { ...round, state: s, log: [...round.log, { at, move }], last: { events, refused: null, banked } };
}

export interface Read {
  score: number;
  /** The ending the round reached, by id. A clock's ending shows only when `read` is told the time. */
  ended: string | null;
  movesMade: number;
  movesLeft: number | null;
  /** Milliseconds left on the clock at the time given, or at the last move. Null where no clock ends the round. */
  msLeft: number | null;
  streak: number;
  /** What the rules remember. Rules made of parts keep each part's under its name. */
  state: unknown;
  board: (Piece | null)[][];
  wait: "anyone" | "nobody";
}
export function read(round: Round, when: { at?: number } = {}): Read {
  const s = round.state;
  const doc = round.puzzle.document;
  const at = Math.max(when.at ?? s.time, s.time);
  const budget = doc.round.ends.find((e) => e.by === "budget");
  const clock = doc.round.ends.find((e) => e.by === "clock");
  const board = Array.from({ length: s.height }, (_, y) => s.cells.slice(y * s.width, (y + 1) * s.width));
  const ended = s.ended ?? timeUp(doc, round.settings, at);
  return {
    score: s.points,
    ended,
    movesMade: s.moves,
    movesLeft: budget ? amount(round.settings, budget.setting) - s.moves : null,
    msLeft: clock ? Math.max(0, amount(round.settings, clock.setting) * 1000 - at) : null,
    streak: s.streak,
    state: s.rules,
    board,
    wait: ended ? "nobody" : "anyone",
  };
}

/** A move worth making: the rules' own answer, or the first listed move that would set off a step. */
export function hint<M extends AnyMove>(round: Round<M>): M | null {
  const puzzle = round.puzzle as Puzzle;
  const view = viewOf(round.settings, round.state);
  if (puzzle.rules.hint) return puzzle.rules.hint(view) as M | null;
  return (puzzle.rules.listMoves?.(view).find((m) => scores(puzzle, round.settings, round.state, m)) as M | undefined) ?? null;
}
export const listMoves = <M extends AnyMove>(round: Round<M>): M[] => round.puzzle.rules.listMoves?.(viewOf(round.settings, round.state)) ?? [];

/** The same seed, settings and log always make the same round. */
export function replay<M extends AnyMove>(puzzle: Puzzle<M>, seed: string, settings: Record<string, Setting>, log: readonly Entry<M>[]): Round<M> {
  return log.reduce((r, e) => play(r, e.move, { at: e.at }), start(puzzle, { seed, settings }));
}
export type { PrngState, Rules };
