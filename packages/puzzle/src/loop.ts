// Rung 0: start, play and read, for one seat on a still grid.
// The loop takes a whole document and a flat rules object. It has never heard of a part.
//
// Luck: every draw has a stream of its own, seeded from `<seed>/<draw id>`. A move tried on a copy
// draws from `<seed>/try/<draw id>`, so trying never shows or shifts the luck to come.
import { nextInt, seedFromString, type PrngState } from "./prng.js";
import type { AnyMove, Board, Cell, Change, Changes, CheckDecl, Ctx, Document, Event, Piece, Puzzle, Rules, Setting, Settings, View } from "./types.js";

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
  step: number;
  stepHit: boolean;
  ended: string | null;
}

export interface Round<M extends AnyMove = AnyMove> {
  readonly puzzle: Puzzle<M>;
  readonly seed: string;
  readonly settings: Settings;
  readonly state: State;
  readonly log: readonly M[];
  /** What the last call reported: the events of a move, or why it was refused. */
  readonly last: { readonly events: readonly Event[]; readonly refused: string | null };
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
    for (const n of typeof v === "number" ? [v] : v) if (n < d.min || n > d.max) throw new Error(`setting ${d.id}: ${n} is outside ${d.min} to ${d.max}`);
    out[d.id] = v;
  }
  for (const id of Object.keys(given)) if (!(id in out)) throw new Error(`setting ${id} is not declared`);
  return out;
}
const amount = (settings: Settings, a: string | number): number => (typeof a === "number" ? a : (settings[a] as number));

/** The context of an "on" hook: it reads the board and reports events, and each event is applied and paid as it is reported. */
function ctxOf(puzzle: Puzzle, settings: Settings, s: State, out: Event[]): Ctx {
  const { document: doc, rules } = puzzle;
  const board = boardOf(s);
  return {
    settings,
    board,
    get step() {
      return s.step;
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
      const changes: Change[] = [];
      const b: Changes = {
        arrive: (at, piece, from = "above") => (changes.push({ change: "arrive", at, piece: { id: s.nextId++, ...piece }, from }), b),
        leave: (at) => (changes.push({ change: "leave", at }), b),
        travel: (from, to) => (changes.push({ change: "travel", from, to }), b),
      };
      build?.(b);
      for (const c of changes) if (!decl.changes.includes(c.change)) throw new Error(`event ${id} does not declare the change ${c.change}`);
      // One event's changes happen together: everything that leaves or travels is lifted first.
      const at = (p: Cell): number => p.y * s.width + p.x;
      const lifted = changes.flatMap((c) => (c.change === "travel" ? [{ to: c.to, piece: s.cells[at(c.from)]! }] : []));
      for (const c of changes) if (c.change !== "arrive") s.cells[at(c.change === "leave" ? c.at : c.from)] = null;
      for (const l of lifted) s.cells[at(l.to)] = l.piece;
      for (const c of changes) if (c.change === "arrive") s.cells[at(c.at)] = c.piece;
      let event: Event = { event: id, fields, changes };
      if (Object.values(decl.fields).includes("points")) {
        let paid = 0;
        for (const p of doc.payouts.filter((p) => p.on.includes(id))) {
          const counted = fields[p.counts];
          const n = Array.isArray(counted) ? counted.length : (counted as number);
          const per = p.reads[0] ? amount(settings, p.reads[0]) : 1;
          paid += p.growth === "flat" ? per : p.growth === "linear" ? n * per : n * n * per;
        }
        paid = Math.floor(rules.pointsFor?.(event, paid) ?? paid);
        s.points += paid;
        event = { ...event, points: paid };
      }
      if (decl.step) s.stepHit = true;
      out.push(event);
    },
  };
}
const viewOf = (settings: Settings, s: State): View => ({ settings, board: boardOf(s) });

/** Cascade and Move end: asked until nothing more is reported. The loop counts the steps. */
function settle(puzzle: Puzzle, settings: Settings, s: State, out: Event[]): void {
  const ctx = ctxOf(puzzle, settings, s, out);
  const cascade = (): boolean => {
    let any = false;
    for (let guard = 0; ; guard++) {
      if (guard > 10_000) throw new Error("the cascade never runs dry");
      const before = out.length;
      s.stepHit = false;
      puzzle.rules.onCascade?.(ctx);
      if (out.length === before) return any;
      any = true;
      if (s.stepHit) s.step++;
    }
  };
  cascade();
  // Move end is asked when the cascade has run dry, and again only if what it reported set the cascade off.
  for (;;) {
    const before = out.length;
    puzzle.rules.onMoveEnd?.(ctx);
    if (out.length === before || !cascade()) return;
  }
}

function apply(puzzle: Puzzle, settings: Settings, s: State, move: AnyMove, out: Event[]): void {
  s.step = 0;
  puzzle.rules.onMove(ctxOf(puzzle, settings, s, out), 0, move);
  settle(puzzle, settings, s, out);
}

/** What a move would report, played on a copy. */
function tryMove(puzzle: Puzzle, settings: Settings, s: State, move: AnyMove): Event[] {
  const out: Event[] = [];
  apply(puzzle, settings, scratch(s), move, out);
  return out;
}
const isStep = (doc: Document, e: Event): boolean => doc.events.find((d) => d.id === e.event)?.step === true;
const scores = (puzzle: Puzzle, settings: Settings, s: State, move: AnyMove): boolean => tryMove(puzzle, settings, s, move).some((e) => isStep(puzzle.document, e));
/** A board is stuck when no listed move would set off a single step. Only a puzzle that can list its moves can be asked. */
const stuck = (puzzle: Puzzle, settings: Settings, s: State): boolean => !puzzle.rules.listMoves!(viewOf(settings, s)).some((m) => scores(puzzle, settings, s, m));

/**
 * The deal, held to the document's check by the loop itself: deal on a copy, let the cascade run there unseen
 * and unpaid, and deal again if no listed move would set off a step. The rules deal and know nothing of this.
 * When every try fails the rules' fallback deals, and what it deals is taken as it is.
 * Reported as one event: the check's `during` event when the board is dealt again, else the rules' own first event.
 */
function deal(puzzle: Puzzle, settings: Settings, s: State, out: Event[], check: CheckDecl | undefined, again: boolean): void {
  const tries = check?.tries ?? 1;
  // One more turn than the tries: the last is the fallback's.
  for (let t = 0; t <= tries; t++) {
    const fallback = t === tries;
    if (fallback && !(check && puzzle.rules.onFallback)) break;
    const trial: State = { ...clone(s), cells: s.cells.map(() => null) };
    const unseen: Event[] = [];
    if (fallback) puzzle.rules.onFallback!(ctxOf(puzzle, settings, trial, unseen));
    else puzzle.rules.onStart(ctxOf(puzzle, settings, trial, unseen));
    const first = unseen[0]?.event;
    if (check && !fallback) settle(puzzle, settings, trial, unseen);
    s.streams = trial.streams; // a failed try still used its luck, so the next try differs
    if (check && !fallback && stuck(puzzle, settings, trial)) continue;
    const id = again ? check!.during! : first;
    if (!id) return;
    const before = boardOf(s);
    const places = before.places();
    const left = places.filter((p) => before.at(p));
    const dealt = boardOf(trial);
    ctxOf(puzzle, settings, s, out).emit(id, {}, (e) => {
      for (const p of left) e.leave(p);
      for (const p of places) {
        const piece = dealt.at(p);
        if (piece) e.arrive(p, { piece: piece.piece, ...(piece.kind === undefined ? {} : { kind: piece.kind }) }, again ? "in place" : "above");
      }
    });
    return;
  }
  throw new Error(`check ${check!.id}: no deal passed in ${tries} tries, and the rules have no onFallback`);
}

export function start<M extends AnyMove>(puzzle: Puzzle<M>, opts: { seed: string | number; settings?: Record<string, Setting> }): Round<M> {
  const doc = puzzle.document;
  const settings = settingsOf(doc, opts.settings);
  const width = amount(settings, doc.board.width);
  const height = amount(settings, doc.board.height);
  const seed = String(opts.seed);
  const s: State = { width, height, cells: Array.from({ length: width * height }, () => null), nextId: 1, streams: {}, seed, streamKey: seed, points: 0, moves: 0, step: 0, stepHit: false, ended: null };
  if (doc.deal.checks.length > 0 && !puzzle.rules.listMoves) throw new Error(`${doc.id} declares the check ${doc.deal.checks[0]!.id}, so its rules must answer listMoves`);
  const events: Event[] = [];
  deal(puzzle as Puzzle, settings, s, events, doc.deal.checks[0], false);
  s.points = 0;
  return { puzzle, seed, settings, state: s, log: [], last: { events, refused: null } };
}

export function play<M extends AnyMove>(round: Round<M>, move: M): Round<M> {
  const puzzle = round.puzzle as Puzzle;
  const doc = puzzle.document;
  const refuse = (refused: string): Round<M> => ({ ...round, last: { events: [], refused } });
  if (round.state.ended) return refuse("the round is over");
  // Check: the loop refuses what it can before the rules are asked.
  const decl = doc.moves.find((m) => m.id === move.move);
  if (!decl) return refuse(`${move.move} is not a move of this puzzle`);
  const board = boardOf(round.state);
  for (const [name, type] of Object.entries(decl.fields)) if (type === "place" && !board.has(move[name] as Cell)) return refuse(`${name} is not a place on the board`);
  const reason = puzzle.rules.canMove(viewOf(round.settings, round.state), move);
  if (reason) return refuse(reason);
  // Move, Cascade, Move end.
  const s = clone(round.state);
  const events: Event[] = [];
  apply(puzzle, round.settings, s, move, events);
  // Close: the check that holds during play, then the endings.
  const check = doc.deal.checks.find((c) => c.during);
  if (check && stuck(puzzle, round.settings, s)) deal(puzzle, round.settings, s, events, check, true);
  s.moves++;
  for (const end of doc.round.ends) if (end.by === "budget" && s.moves >= amount(round.settings, end.setting)) s.ended = end.id;
  return { ...round, state: s, log: [...round.log, move], last: { events, refused: null } };
}

export interface Read { score: number; ended: string | null; movesMade: number; movesLeft: number | null; board: (Piece | null)[][]; wait: "anyone" | "nobody" }
export function read(round: Round): Read {
  const s = round.state;
  const budget = round.puzzle.document.round.ends.find((e) => e.by === "budget");
  const board = Array.from({ length: s.height }, (_, y) => s.cells.slice(y * s.width, (y + 1) * s.width));
  return { score: s.points, ended: s.ended, movesMade: s.moves, movesLeft: budget ? amount(round.settings, budget.setting) - s.moves : null, board, wait: s.ended ? "nobody" : "anyone" };
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
export function replay<M extends AnyMove>(puzzle: Puzzle<M>, seed: string, settings: Record<string, Setting>, log: readonly M[]): Round<M> {
  return log.reduce((r, m) => play(r, m), start(puzzle, { seed, settings }));
}
export type { Rules };
