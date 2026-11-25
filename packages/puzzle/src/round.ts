/**
 * The round (docs/puzzles/DOMAIN.md, "The round"): `start(seed, settings)`, `play(round, entry)`,
 * `mark(round, time)` and `read(round)`. The engine runs any puzzle that is a document and its
 * rules. It owns everything the guide gives one meaning for every puzzle: time and the endings,
 * the log's cap, a stream for each draw, the board and its changes, points from payouts and
 * multipliers, the streak, and judgement. The rules own only what is theirs: what a move does.
 *
 * Every round runs one loop (DOMAIN.md, "The rules", ADR 0088), and the rules are hooks on it:
 * `start` runs Start and asks `onStart`; `play` runs Check to Close for one entry, asking `canMove`,
 * `onMove`, `onCascade` until it reports nothing, and `onMoveEnd` once; a tick goes to `onTick` and
 * a signal in to `onSignal`. The loop counts a cascade's steps: the rules never do.
 *
 * The rules reach the round through a context and nothing else, so they cannot change the board
 * without a board change on an event, pay a point that is not a declared payout's, read a setting
 * the round does not have, or draw from a stream that is not a declared draw's.
 *
 * Nothing here keeps state between calls or reads a clock: the same seed, settings and log always
 * make the same round.
 */
import { applyChanges, boardString, emptyBoard, DIRECTIONS, type Board, type Change, type Direction, type PieceOn, type Place } from "./board.js";
import { checkPuzzle, checkRules, unsupported, type Knows } from "./check.js";
import { layerOf, type Brought, type DrawDecl, type EventDecl, type MoveDecl, type PuzzleDoc } from "./document.js";
import { Refused } from "./errors.js";
import { performanceOf, tierOf, type Scale, type Tier } from "./judge.js";
import { nextBelow, streamFrom, type StreamState } from "./prng.js";
import { multiplierPercent, payoutPoints, settleEvent } from "./scoring.js";
import { resolveSettings, SettingsReader, type Settings, type SettingsAsk } from "./settings.js";

export type Move = { readonly id: string } & Readonly<Record<string, unknown>>;
export type SignalValue = number | boolean | string;

/** One line of the log: a move or a signal in, stamped with its time in milliseconds from the start. */
export type Entry = { readonly at: number; readonly move: Move } | { readonly at: number; readonly signal: { readonly id: string; readonly value: SignalValue } };

/** The ordered record of a round, closed by a final time mark. The end of a round is never written in it. */
export interface Log {
  readonly entries: readonly Entry[];
  readonly end: number;
}

/** Something the rules report happened, with the board changes it carries and its points by payout. */
export interface RoundEvent {
  readonly id: string;
  /** The cascade step it belongs to, from 1, as the loop counted it. Everything in one step plays together. 0 for a tick or a signal. */
  readonly step: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly changes: readonly Change[];
  readonly points: number;
  readonly paid: Readonly<Record<string, number>>;
}

interface DrawState {
  readonly s: StreamState;
  /** A bag: what is left of the shuffled set. */
  readonly bag?: readonly number[];
}

export interface Round<S> {
  readonly puzzle: string;
  readonly version: string;
  readonly seed: string;
  readonly settings: Settings;
  /** Milliseconds since the start. */
  readonly at: number;
  /** Ticks played, in a ticking puzzle. */
  readonly ticks: number;
  readonly board: Board;
  /** What the rules keep besides the board. */
  readonly state: S;
  readonly streams: Readonly<Record<string, DrawState>>;
  readonly nextPiece: number;
  readonly score: number;
  /** The score by payout. */
  readonly paid: Readonly<Record<string, number>>;
  readonly streak: { readonly count: number; readonly misses: number; readonly best: number };
  /** Moves made. */
  readonly moves: number;
  /** Entries taken, moves and signals. */
  readonly entries: number;
  /** Recent points and when they were made, for pace: no older than the stretch pace reads. */
  readonly recent: readonly (readonly [at: number, points: number])[];
  readonly ended: { readonly by: "clock" | "budget" | "stock" | "fail" | "outcome"; readonly at: number } | null;
}

export interface GaugeRead {
  readonly value: number;
  readonly most?: number;
  readonly danger?: number;
}

export interface Read {
  readonly score: number;
  /** The score on the host's scale, and the tier it falls in. Null for a round judged by its outcome. */
  readonly performance: number | null;
  readonly tier: Tier | null;
  readonly paid: Readonly<Record<string, number>>;
  readonly stats: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, GaugeRead>>;
  readonly moves: number;
  readonly ended: Round<unknown>["ended"];
}

/** What the rules can see of a round. */
export interface RulesView<S> {
  readonly settings: SettingsReader;
  readonly board: Board;
  readonly state: S;
  readonly streak: number;
  readonly moves: number;
  readonly score: number;
}

/** How a piece is asked for when it arrives: the engine gives it its id. */
export interface NewPiece {
  readonly piece: string;
  readonly kind?: number;
  readonly state?: string | number;
}

export interface EventBuilder {
  arrive(piece: NewPiece, at: Place, from: "in-place" | { readonly zone: string; readonly spot: number } | { readonly off: Direction }): number;
  leave(id: number, at: Place, as?: "cleared" | { readonly zone: string; readonly spot: number }): void;
  travel(id: number, from: number, to: number, route?: readonly number[]): void;
  change(id: number, at: Place, becomes: { readonly piece?: string; readonly kind?: number; readonly state?: string | number }): void;
  /** Pay a declared payout on this event. What it counts is read from the event's own field. */
  pay(payout: string): void;
  /** A declared multiplier scales this event. Nothing happens when its layer is off: the multiplier does not exist. */
  scale(multiplier: string): void;
}

/** The start of a round: the rules lay the opening board and say what they keep. No event carries it: it is the start. */
export interface StartContext {
  readonly settings: SettingsReader;
  readonly board: Board;
  readonly draw: Draws;
  /** Lay a piece on the opening board. */
  place(piece: NewPiece, at: Place): number;
}

/**
 * What a hook that starts with `on` is asked with. It changes the round in one way only: it reports
 * events, and reads the board as each event leaves it.
 */
export interface HookContext<S> extends RulesView<S> {
  readonly draw: Draws;
  /** The cascade step the loop is on, from 1: the move is step 1, and every asking of `onCascade` or `onMoveEnd` that reports something is the next. 0 for a tick or a signal. */
  readonly step: number;
  /** Report an event. Its board changes happen together when `build` returns, and its points are settled then. */
  emit(id: string, fields: Readonly<Record<string, unknown>>, build?: (e: EventBuilder) => void): RoundEvent;
  /** This move built the streak. Returns the streak after it. */
  built(): number;
  /** The round's stock is worked through. */
  spent(): void;
  /** Points made so far in this entry. */
  readonly points: number;
}

/** A stream for each declared draw. Asking one never moves another. */
export interface Draws {
  /** An even roll: 0 to n - 1, each alike. */
  even(draw: string, n: number): number;
  /** A weighted roll: the index of one weight, each by its size. */
  weighted(draw: string, weights: readonly number[]): number;
  /** Yes or no, by a chance in a thousand. */
  chance(draw: string, permille: number): boolean;
  /** The next item of a shuffled set of `size`, dealt out in order and then shuffled again. */
  bag(draw: string, size: number): number;
  /** One entry of a list: its index. */
  pick(draw: string, length: number): number;
}

/**
 * The part of a puzzle that is code: hooks on the loop every round runs (DOMAIN.md, "The rules").
 * A hook that starts with `on` is asked when something has happened, and returns what the rules
 * keep besides the board. Every other hook is a question: answering it changes nothing.
 *
 * Three hooks are required. Every other has a default, so a puzzle writes only the ones it needs.
 * Not asked yet, because this engine runs one seat and no tasks: `whoseTurn`, `pickMove`,
 * `listMoves`, `onTaskNeeded`, `pointsFor`, `score`, `hint` and `checkSettings`.
 */
export interface Rules<S> {
  readonly id: string;
  /** The version of the puzzle document these rules are written for. */
  readonly version: string;
  /** Everything the rules know, by id: held equal to what the document declares before any round runs. */
  readonly knows: Knows;
  /** Once, at Start: deal the board. */
  onStart(ctx: StartContext): S;
  /** At Check: null when the move may be made now, or the reason it may not. */
  canMove(view: RulesView<S>, move: Move): string | null;
  /** At Move: what a move that passed the check does. */
  onMove(ctx: HookContext<S>, move: Move): S;
  /** At Cascade, again and again until it reports nothing: one step of what follows by itself. Left out, nothing follows. */
  onCascade?(ctx: HookContext<S>): S;
  /** Once a move, when the cascade has run dry: what the end of the move brings. What it reports sets the cascade off again, on the same count. */
  onMoveEnd?(ctx: HookContext<S>): S;
  /** Once for every tick, in order. Left out, nothing happens between moves. */
  onTick?(ctx: HookContext<S>): S;
  /** A signal in arrives. Left out, it changes nothing. */
  onSignal?(ctx: HookContext<S>, id: string, value: SignalValue): S;
  /** Where the round's gauges are read. */
  gauges(view: RulesView<S>): Readonly<Record<string, number>>;
  /** Where the round's stats are read. */
  stats(view: RulesView<S>): Readonly<Record<string, number>>;
}

/** More steps than any cascade has: a cascade that reports something this many times never runs dry, and that is the rules' mistake. */
const CASCADE_LIMIT = 10_000;

export interface EngineOptions {
  /** The host's scale. */
  readonly scale: Scale;
  /** Told every declared part the rules use, as they use it: how a test shows the rules know everything declared. */
  readonly trace?: (kind: string, id: string) => void;
}

export interface Played<S> {
  readonly round: Round<S>;
  /** What happened, in the order the rules reported it. */
  readonly events: readonly RoundEvent[];
}

export interface Engine<S> {
  readonly doc: PuzzleDoc;
  settings(ask?: SettingsAsk): Settings;
  start(seed: string, settings: Settings): Round<S>;
  play(round: Round<S>, entry: Entry): Played<S>;
  /** Time passes with nothing played: ticks fall due and the clock can end the round. Also the log's final time mark. */
  mark(round: Round<S>, at: number): Played<S>;
  read(round: Round<S>): Read;
  /** The loop's Check, asked without playing: null when the move may be made now, or the reason it may not. */
  canMove(round: Round<S>, move: Move): string | null;
  /** Performance over the recent stretch of the round, read at a time. Null without a clock to read it against. */
  pace(round: Round<S>, at: number): { readonly performance: number; readonly tier: Tier } | null;
  /** A short fingerprint of everything a round is, to tell two rounds apart cheaply. */
  hash(round: Round<S>): string;
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function placeOk(board: Board, p: unknown): p is Place {
  if (whole(p)) return p >= 0 && p < board.cells.length;
  if (typeof p !== "object" || p === null) return false;
  const z = p as { zone?: unknown; spot?: unknown };
  const spots = typeof z.zone === "string" ? board.zones[z.zone] : undefined;
  return spots !== undefined && whole(z.spot) && z.spot >= 0 && z.spot < spots.length;
}

/** Holds a move to its declaration: every declared field, of its type, and nothing more. */
function moveProblem(decl: MoveDecl, move: Move, board: Board): string | null {
  const names = Object.keys(decl.fields);
  for (const k of Object.keys(move)) if (k !== "id" && !names.includes(k)) return `${decl.id} has no field ${k}`;
  for (const name of names) {
    const v = move[name];
    const ok = {
      place: () => placeOk(board, v),
      places: () => Array.isArray(v) && v.length > 0 && v.length <= board.cells.length * 2 && v.every((p) => placeOk(board, p)),
      direction: () => (DIRECTIONS as readonly unknown[]).includes(v),
      piece: () => whole(v) && v >= 0,
      number: () => whole(v),
      flag: () => typeof v === "boolean",
    }[decl.fields[name]!]();
    if (!ok) return `${decl.id}.${name} must be a ${decl.fields[name]}`;
  }
  return null;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The engine for one puzzle. It refuses to be made from a puzzle that is not ready, from rules
 * that know more or less than the document declares, or from a puzzle that needs a part of the
 * guide this engine does not run yet (`unsupported`).
 */
export function engine<S>(doc: PuzzleDoc, rules: Rules<S>, options: EngineOptions): Engine<S> {
  const problems = [...checkPuzzle(doc), ...checkRules(doc, rules), ...unsupported(doc)];
  if (problems.length > 0) throw new Error(`${doc.id} cannot be run: ${problems.join("; ")}`);
  const trace = options.trace;

  const byId = <T extends { readonly id: string }>(list: readonly T[]): ReadonlyMap<string, T> => new Map(list.map((x) => [x.id, x]));
  const events = byId(doc.events);
  const payouts = byId(doc.payouts);
  const multipliers = byId(doc.multipliers);
  const draws = byId(doc.deal.draws);
  const moves = byId(doc.moves);
  const signals = byId(doc.signals.in);
  const tempo = doc.round.tempo;
  const tickMs = tempo.kind === "ticking" ? tempo.tickMs : 0;
  const clock = doc.round.ends.find((e) => e.by === "clock");
  const budget = doc.round.ends.find((e) => e.by === "budget");
  const stock = doc.round.ends.find((e) => e.by === "stock");
  const closers = new Map(doc.round.ends.filter((e) => e.by === "fail" || e.by === "outcome").map((e) => [e.event!, e.by as "fail" | "outcome"]));

  /** True while the part exists: it belongs to the whole puzzle, or its layer is on. */
  const exists = (settings: Settings, what: Brought, id: string): boolean => {
    const layer = layerOf(doc, what, id);
    return layer === null || settings.layers.includes(layer);
  };
  const streakOn = (settings: Settings): boolean => doc.streak !== undefined && doc.multipliers.some((m) => "table" in m.by && m.by.index === "streak" && exists(settings, "multipliers", m.id));
  const clockMs = (settings: Settings): number | null => (clock ? (settings.values[clock.setting!] as number) * 1000 : null);

  /** One call's working copy of a round. Made, used and frozen inside a single `start`, `play` or `mark`. */
  class Work implements HookContext<S>, StartContext {
    board: Board;
    state: S;
    streams: Record<string, DrawState>;
    nextPiece: number;
    score: number;
    paid: Record<string, number>;
    streakCount: number;
    misses: number;
    best: number;
    step = 1;
    points = 0;
    out: RoundEvent[] = [];
    didBuild = false;
    didSpend = false;
    closed: "fail" | "outcome" | null = null;
    readonly settings: SettingsReader;
    /** The streak as the entry began: a multiplier that holds for a move holds for its whole cascade. */
    readonly streak: number;
    readonly moves: number;
    readonly draw: Draws;

    constructor(
      readonly r: Round<S>,
      private readonly opening = false,
    ) {
      this.board = r.board;
      this.state = r.state;
      this.streams = { ...r.streams };
      this.nextPiece = r.nextPiece;
      this.score = r.score;
      this.paid = { ...r.paid };
      this.streakCount = r.streak.count;
      this.misses = r.streak.misses;
      this.best = r.streak.best;
      this.streak = r.streak.count;
      this.moves = r.moves;
      this.settings = new SettingsReader(r.settings, trace);
      this.draw = {
        even: (id, n) => this.roll(id, "even", n),
        weighted: (id, weights) => {
          if (weights.length === 0 || !weights.every((w) => whole(w) && w >= 0)) throw new Error(`draw ${id} was asked with bad weights`);
          const total = weights.reduce((a, b) => a + b, 0);
          let x = this.roll(id, "weighted", total);
          for (let i = 0; i < weights.length; i++) {
            if (x < weights[i]!) return i;
            x -= weights[i]!;
          }
          throw new Error("unreachable");
        },
        chance: (id, permille) => {
          if (!whole(permille) || permille < 0 || permille > 1000) throw new Error(`draw ${id} was asked a chance of ${permille} in a thousand`);
          return this.roll(id, "weighted", 1000) < permille;
        },
        bag: (id, size) => {
          const decl = this.drawDecl(id, "bag");
          let { s, bag } = this.stream(decl);
          if (!bag || bag.length === 0) {
            // A new bag: every item once, shuffled from the back.
            const items = Array.from({ length: size }, (_, i) => i);
            for (let i = items.length - 1; i > 0; i--) {
              const [j, after] = nextBelow(s, i + 1);
              s = after;
              [items[i], items[j]] = [items[j]!, items[i]!];
            }
            bag = items;
          }
          this.streams[id] = { s, bag: bag.slice(1) };
          return bag[0]!;
        },
        pick: (id, length) => this.roll(id, "pick", length),
      };
    }

    private drawDecl(id: string, by: DrawDecl["by"]): DrawDecl {
      const decl = draws.get(id);
      if (!decl) throw new Error(`the rules drew from ${id}, which is not a declared draw`);
      if (decl.by !== by) throw new Error(`draw ${id} is declared ${decl.by}, and was asked as ${by}`);
      if (!exists(this.r.settings, "draws", id)) throw new Error(`the rules drew from ${id}, whose layer is off`);
      trace?.("draws", id);
      return decl;
    }

    /** Every draw's stream is made from the seed and the draw's id, the first time it is asked. */
    private stream(decl: DrawDecl): DrawState {
      return this.streams[decl.id] ?? { s: streamFrom(`${doc.id}:${this.r.seed}:${decl.id}`) };
    }

    private roll(id: string, by: DrawDecl["by"], n: number): number {
      const decl = this.drawDecl(id, by);
      const [value, s] = nextBelow(this.stream(decl).s, n);
      this.streams[id] = { s };
      return value;
    }

    place(piece: NewPiece, at: Place): number {
      if (!this.opening) throw new Error("only the start lays pieces without an event");
      const on = this.make(piece);
      this.board = applyChanges(this.board, [{ change: "arrive", piece: on, at, from: "in-place" }]);
      return on.id;
    }

    private make(piece: NewPiece): PieceOn {
      const decl = doc.pieces.find((p) => p.id === piece.piece);
      if (!decl) throw new Error(`the rules dealt ${piece.piece}, which is not a declared piece`);
      if (!exists(this.r.settings, "pieces", piece.piece)) throw new Error(`the rules dealt ${piece.piece}, whose layer is off`);
      const family = decl.family ?? (decl.of ? doc.pieces.find((p) => p.id === decl.of)?.family : undefined);
      if (family !== undefined) {
        const kinds = this.r.settings.values[family];
        if (!whole(piece.kind) || typeof kinds !== "number" || piece.kind < 1 || piece.kind > kinds) throw new Error(`${piece.piece} needs a kind from 1 to ${String(kinds)}`);
      } else if (piece.kind !== undefined) throw new Error(`${piece.piece} is not a family, so it has no kind`);
      trace?.("pieces", piece.piece);
      const on: { id: number; piece: string; kind?: number; state?: string | number } = { id: this.nextPiece++, piece: piece.piece };
      if (piece.kind !== undefined) on.kind = piece.kind;
      if (piece.state !== undefined) on.state = piece.state;
      return on;
    }

    built(): number {
      if (!streakOn(this.r.settings) || this.didBuild) return this.streakCount;
      this.didBuild = true;
      this.streakCount++;
      this.misses = 0;
      this.best = Math.max(this.best, this.streakCount);
      return this.streakCount;
    }

    spent(): void {
      if (!stock) throw new Error("the rules say the stock is spent, and the puzzle declares no stock ending");
      this.didSpend = true;
    }

    emit(id: string, fields: Readonly<Record<string, unknown>>, build?: (e: EventBuilder) => void): RoundEvent {
      if (this.opening) throw new Error("the start reports no events");
      const decl = events.get(id);
      if (!decl) throw new Error(`the rules reported ${id}, which is not a declared event`);
      if (!exists(this.r.settings, "events", id)) throw new Error(`the rules reported ${id}, whose layer is off`);
      trace?.("events", id);
      const pointsField = Object.keys(decl.fields).find((k) => decl.fields[k] === "points");
      this.holdFields(decl, fields, pointsField);

      const changes: Change[] = [];
      const pays: string[] = [];
      const scales: string[] = [];
      const allow = (kind: Change["change"]): void => {
        if (!decl.changes?.includes(kind)) throw new Error(`${id} is not declared to carry ${kind}`);
      };
      build?.({
        arrive: (piece, at, from) => {
          allow("arrive");
          const on = this.make(piece);
          changes.push({ change: "arrive", piece: on, at, from });
          return on.id;
        },
        leave: (pieceId, at, as = "cleared") => {
          allow("leave");
          changes.push({ change: "leave", id: pieceId, at, as });
        },
        travel: (pieceId, from, to, route) => {
          allow("travel");
          changes.push(route ? { change: "travel", id: pieceId, from, to, route } : { change: "travel", id: pieceId, from, to });
        },
        change: (pieceId, at, becomes) => {
          allow("change");
          changes.push({ change: "change", id: pieceId, at, becomes });
        },
        pay: (payout) => {
          const p = payouts.get(payout);
          if (!p) throw new Error(`the rules paid ${payout}, which is not a declared payout`);
          if (!exists(this.r.settings, "payouts", payout)) throw new Error(`the rules paid ${payout}, whose layer is off`);
          if (!p.on.includes(id)) throw new Error(`payout ${payout} is not declared to pay on ${id}`);
          if (pays.includes(payout)) throw new Error(`payout ${payout} was paid twice on one ${id}`);
          pays.push(payout);
        },
        scale: (multiplier) => {
          const m = multipliers.get(multiplier);
          if (!m) throw new Error(`the rules scaled by ${multiplier}, which is not a declared multiplier`);
          if (exists(this.r.settings, "multipliers", multiplier) && !scales.includes(multiplier)) scales.push(multiplier);
        },
      });

      if (pays.length > 0 && pointsField === undefined) throw new Error(`${id} pays points and declares no points field to carry them`);
      const settled = settleEvent(
        pays.map((payout) => {
          const p = payouts.get(payout)!;
          trace?.("payouts", payout);
          return { payout, base: payoutPoints(p, p.counts === undefined ? null : countOf(id, p.counts, fields), this.settings) };
        }),
        scales.map((mid) => {
          const m = multipliers.get(mid)!;
          trace?.("multipliers", mid);
          return { percent: multiplierPercent(m, this.settings, this.streak, this.step), scales: m.scales };
        }),
      );
      this.board = applyChanges(this.board, changes);
      this.score = Math.max(0, this.score + settled.points);
      this.points += settled.points;
      for (const [k, v] of Object.entries(settled.paid)) this.paid[k] = (this.paid[k] ?? 0) + v;
      // A mistake the streak breaks on breaks it at once.
      if (decl.mistake && doc.streak?.breaksOn.includes(id)) {
        this.streakCount = 0;
        this.misses = 0;
      }
      const by = closers.get(id);
      if (by && !this.closed) this.closed = by;
      const event: RoundEvent = { id, step: this.step, fields: pointsField === undefined ? { ...fields } : { ...fields, [pointsField]: settled.points }, changes, points: settled.points, paid: settled.paid };
      this.out.push(event);
      return event;
    }

    /** Holds an event to its declaration: every declared field, of its type, and nothing more. The points field is the engine's to fill. */
    private holdFields(decl: EventDecl, fields: Readonly<Record<string, unknown>>, pointsField: string | undefined): void {
      for (const k of Object.keys(fields)) if (!(k in decl.fields) || k === pointsField) throw new Error(`${decl.id} was reported with ${k}, which is not a field the rules may set`);
      for (const [name, type] of Object.entries(decl.fields)) {
        if (name === pointsField) continue;
        const v = fields[name];
        const ok = type === "place" ? placeOk(this.board, v) : type === "places" ? Array.isArray(v) && v.every((p) => placeOk(this.board, p)) : whole(v);
        if (!ok) throw new Error(`${decl.id}.${name} must be a ${type}`);
      }
    }

    freeze(extra: Partial<Round<S>>): Round<S> {
      return {
        ...this.r,
        board: this.board,
        state: this.state,
        streams: this.streams,
        nextPiece: this.nextPiece,
        score: this.score,
        paid: this.paid,
        streak: { count: this.streakCount, misses: this.misses, best: this.best },
        ...extra,
      };
    }
  }

  /** What a payout counts on an event: a number field's value, or how many places a places field holds. */
  function countOf(event: string, field: string, fields: Readonly<Record<string, unknown>>): number {
    const v = fields[field];
    if (Array.isArray(v)) return v.length;
    if (whole(v)) return v;
    throw new Error(`${event} has no ${field} to count`);
  }

  const viewOf = (r: Round<S>): RulesView<S> => ({ settings: new SettingsReader(r.settings, trace), board: r.board, state: r.state, streak: r.streak.count, moves: r.moves, score: r.score });

  /** Keeps what pace reads: the points of the recent stretch, no older than the pace's stretch. */
  function recentAfter(r: Round<S>, at: number, points: number): Round<S>["recent"] {
    const oldest = at - doc.evaluation.paceWindowSeconds * 1000;
    const kept = r.recent.filter(([t]) => t > oldest);
    return points > 0 ? [...kept, [at, points] as const] : kept;
  }

  /** Time moves on to `at`: every tick that falls due is played, and the clock ends the round when it runs out. */
  function advance(round: Round<S>, at: number): Played<S> {
    const end = clockMs(round.settings);
    const until = end === null ? at : Math.min(at, end);
    let r = round;
    const out: RoundEvent[] = [];
    if (tickMs > 0 && rules.onTick) {
      // Tick n falls due n ticks after the start. One that would fall on the clock's end is never played.
      while (!r.ended && (r.ticks + 1) * tickMs <= until && (end === null || (r.ticks + 1) * tickMs < end)) {
        const due = (r.ticks + 1) * tickMs;
        const w = new Work({ ...r, at: due });
        w.step = 0;
        w.state = rules.onTick(w);
        out.push(...w.out);
        r = w.freeze({ at: due, ticks: r.ticks + 1, recent: recentAfter(r, due, w.points), ended: w.closed ? { by: w.closed, at: due } : w.didSpend ? { by: "stock", at: due } : null });
      }
    }
    if (r.ended) return { round: r, events: out };
    if (end !== null && at >= end) return { round: { ...r, at: end, ended: { by: "clock", at: end } }, events: out };
    return { round: { ...r, at }, events: out };
  }

  function timeProblem(round: Round<S>, at: unknown): string | null {
    if (!whole(at) || at < 0) return "a time is a whole number of milliseconds from the start";
    if (at < round.at) return "time never runs back";
    return null;
  }

  return {
    doc,
    settings: (ask) => resolveSettings(doc, ask),

    start(seed, settings) {
      // A host may hand back settings it stored: they are held to the document again, never trusted.
      const held = resolveSettings(doc, { layers: settings.layers, values: settings.values });
      const reader = new SettingsReader(held);
      const b = doc.board;
      const zones = Object.fromEntries(doc.zones.filter((z) => exists(held, "zones", z.id)).map((z) => [z.id, reader.sized(z.holds)]));
      const blank: Round<S> = {
        puzzle: doc.id,
        version: doc.version,
        seed,
        settings: held,
        at: 0,
        ticks: 0,
        board: emptyBoard(reader.sized(b.width!), reader.sized(b.height!), zones),
        state: undefined as S,
        streams: {},
        nextPiece: 1,
        score: 0,
        paid: {},
        streak: { count: 0, misses: 0, best: 0 },
        moves: 0,
        entries: 0,
        recent: [],
        ended: null,
      };
      const w = new Work(blank, true);
      w.state = rules.onStart(w);
      return w.freeze({});
    },

    play(round, entry) {
      if (round.ended) throw new Refused("round", ["the round has ended"]);
      if (round.entries >= doc.round.logLimit) throw new Refused("log", [`the log holds at most ${doc.round.logLimit} entries`]);
      const late = timeProblem(round, entry.at);
      if (late) throw new Refused("entry", [late]);
      const before = advance(round, entry.at);
      if (before.round.ended) throw new Refused("round", ["the round ended before this entry"]);
      const r = before.round;
      const w = new Work(r);

      if ("move" in entry) {
        const decl = moves.get(entry.move.id);
        if (!decl) throw new Refused("entry", [`no move ${String(entry.move.id)}`]);
        // Check: a move the rules do not allow changes nothing, and its reason goes back.
        const bad = moveProblem(decl, entry.move, r.board) ?? rules.canMove(viewOf(r), entry.move);
        if (bad) throw new Refused("entry", [bad]);
        trace?.("moves", decl.id);
        // Move: step 1.
        w.state = rules.onMove(w, entry.move);
        // Cascade: a step at a time until a step reports nothing. Then Move end, asked once: what
        // it reports is a step too, and sets the cascade off again on the same count.
        let steps = 1;
        const cascade = (): void => {
          if (!rules.onCascade) return;
          for (;;) {
            if (steps >= CASCADE_LIMIT) throw new Error(`${doc.id}'s cascade never ran dry`);
            const before = w.out.length;
            w.step = steps + 1;
            w.state = rules.onCascade(w);
            if (w.out.length === before) return;
            steps++;
          }
        };
        cascade();
        if (rules.onMoveEnd) {
          const before = w.out.length;
          w.step = steps + 1;
          w.state = rules.onMoveEnd(w);
          if (w.out.length > before) {
            steps++;
            cascade();
          }
        }
        // A move that builds nothing is a miss; more misses in a row than the grace break the streak.
        if (streakOn(r.settings) && !w.didBuild) {
          w.misses++;
          if (w.misses > doc.streak!.grace) w.streakCount = 0;
        }
      } else {
        const decl = signals.get(entry.signal.id);
        if (!decl) throw new Refused("entry", [`no signal ${String(entry.signal.id)}`]);
        const v = entry.signal.value;
        const ok = decl.type === "number" ? whole(v) : decl.type === "flag" ? typeof v === "boolean" : typeof v === "string";
        if (!ok) throw new Refused("entry", [`signal ${decl.id} must be a ${decl.type}`]);
        trace?.("signals", decl.id);
        w.step = 0;
        if (rules.onSignal) w.state = rules.onSignal(w, decl.id, v);
      }

      const movesMade = r.moves + ("move" in entry ? 1 : 0);
      const ended: Round<S>["ended"] = w.closed
        ? { by: w.closed, at: entry.at }
        : w.didSpend
          ? { by: "stock", at: entry.at }
          : budget && movesMade >= (r.settings.values[budget.setting!] as number)
            ? { by: "budget", at: entry.at }
            : null;
      const next = w.freeze({ at: entry.at, moves: movesMade, entries: r.entries + 1, recent: recentAfter(r, entry.at, w.points), ended });
      return { round: next, events: [...before.events, ...w.out] };
    },

    mark(round, at) {
      if (round.ended) return { round, events: [] };
      const late = timeProblem(round, at);
      if (late) throw new Refused("entry", [late]);
      return advance(round, at);
    },

    canMove(round, move) {
      if (round.ended) return "the round has ended";
      const decl = moves.get(move.id);
      if (!decl) return `no move ${String(move.id)}`;
      return moveProblem(decl, move, round.board) ?? rules.canMove(viewOf(round), move);
    },

    read(round) {
      const view = viewOf(round);
      const reader = new SettingsReader(round.settings);
      const values = rules.gauges(view);
      const gauges: Record<string, GaugeRead> = {};
      for (const g of doc.gauges) {
        if (!exists(round.settings, "gauges", g.id)) continue;
        const value = values[g.id];
        if (!whole(value)) throw new Error(`the rules give no value for gauge ${g.id}`);
        trace?.("gauges", g.id);
        gauges[g.id] = { value, ...(g.most === undefined ? {} : { most: reader.sized(g.most) }), ...(g.danger === undefined ? {} : { danger: reader.sized(g.danger) }) };
      }
      for (const id of Object.keys(values)) if (!(id in gauges)) throw new Error(`the rules give gauge ${id}, which this round does not have`);

      const kept = rules.stats(view);
      const stats: Record<string, number> = {};
      for (const s of doc.stats) {
        // The engine keeps the streak, so it keeps its stat.
        const value = s.id === "best_streak" ? round.streak.best : kept[s.id];
        if (!whole(value)) throw new Error(`the rules keep no stat ${s.id}`);
        trace?.("stats", s.id);
        stats[s.id] = value;
      }
      for (const id of Object.keys(kept)) if (!(id in stats) || id === "best_streak") throw new Error(`the rules keep stat ${id}, which the puzzle does not declare`);

      const starts = doc.evaluation.tierStarts;
      const performance = starts ? performanceOf(round.score, starts, options.scale) : null;
      return { score: round.score, performance, tier: performance === null ? null : tierOf(performance, options.scale), paid: round.paid, stats, gauges, moves: round.moves, ended: round.ended };
    },

    pace(round, at) {
      const end = clockMs(round.settings);
      const starts = doc.evaluation.tierStarts;
      if (end === null || !starts) return null;
      const now = Math.min(Math.max(at, round.at), end);
      // Early in a round the stretch is as long as the round has run, and never under a second.
      const stretch = Math.max(1000, Math.min(doc.evaluation.paceWindowSeconds * 1000, now));
      const points = round.recent.reduce((sum, [t, p]) => (t > now - stretch ? sum + p : sum), 0);
      const performance = performanceOf(Math.floor((points * end) / stretch), starts, options.scale);
      return { performance, tier: tierOf(performance, options.scale) };
    },

    hash(round) {
      const { board, ...rest } = round;
      return fnv(`${boardString(board)}#${stable(rest)}`);
    },
  };
}
