/**
 * Swap's rules: the only part of the puzzle that is code, written as hooks on the loop every round
 * runs (docs/puzzles/DOMAIN.md, "The rules"). Everything a reader needs to know about the puzzle is
 * in `puzzle.json`; this file says what a swap does and what follows it.
 *
 * The board is a grid counted from the top. Pieces rise: a gap is filled by the pieces below it,
 * and new pieces come in from below the board. The line is counted in rows from the bottom, so a
 * row is under the line when it is among the bottom `rows`.
 *
 * - `canMove`: a swap trades a piece with its left or right neighbour, where the board has one.
 * - `onMove`: the two trade places. A burst that was swapped clears the pieces round where it
 *   landed, a sweep that was swapped clears itself and every piece of the kind it was swapped
 *   with, and every run of three or more of one kind, in a row or a column, clears; runs that
 *   touch are one group. Where anything cleared, the pieces rise and new ones come in.
 * - `onCascade`: one step of what follows. Every run the last rise made clears, and the pieces
 *   rise again. A board with no run reports nothing, and the cascade has run dry.
 * - `onMoveEnd`: the line is read, once a swap. Every float above it lifts off together and the
 *   pieces rise, which sets the cascade off again. A swap that has scored builds the streak.
 *
 * While no `level` signal has come, the puzzle moves the line itself: every swap raises it a share
 * of a row, and the points made since the line was last read lower it, never below `minRows`. From
 * the first signal (`onSignal`) the line is the signal's, and the puzzle stops moving it.
 */
import type { Board, PieceOn } from "../../board.js";
import { Refused } from "../../errors.js";
import type { HookContext, Move, NewPiece, Rules, RulesView, StartContext } from "../../round.js";
import type { SettingsReader } from "../../settings.js";

export interface SwapState {
  /** The line, in parts of a row: a row is `riseMoves` × `ventPoints` parts, so a swap's rise and a point's fall are both whole. */
  readonly heat: number;
  /** Rows under the line. */
  readonly rows: number;
  /** True once a `level` signal has come: the line is the signal's. */
  readonly wired: boolean;
  /** The round's score when the line was last read: what it has gained since lowers the line. */
  readonly counted: number;
  readonly swaps: number;
  readonly runs: number;
  readonly longest: number;
  readonly together: number;
  readonly lifted: number;
  readonly bestLift: number;
}

const kindAt = (p: PieceOn | null | undefined): number => (p && p.piece === "kind" ? p.kind! : 0);

/**
 * Every run of three or more of one kind, in a row or a column, as groups of cells: runs of one
 * kind that touch are one group. Each group's cells are in order, and the groups are in the order
 * of their first cell, so the same board always gives the same groups. Cells in `gone` are empty.
 */
export function findRuns(board: Board, gone: ReadonlySet<number> = new Set()): number[][] {
  const { width, height, cells } = board;
  const kind = (c: number, r: number): number => (gone.has(r * width + c) ? 0 : kindAt(cells[r * width + c]));
  const matched = new Uint8Array(cells.length);
  for (let r = 0; r < height; r++) {
    for (let start = 0, c = 1; c <= width; c++) {
      if (c === width || kind(c, r) !== kind(start, r)) {
        if (c - start >= 3 && kind(start, r) > 0) for (let k = start; k < c; k++) matched[r * width + k] = 1;
        start = c;
      }
    }
  }
  for (let c = 0; c < width; c++) {
    for (let start = 0, r = 1; r <= height; r++) {
      if (r === height || kind(c, r) !== kind(c, start)) {
        if (r - start >= 3 && kind(c, start) > 0) for (let k = start; k < r; k++) matched[k * width + c] = 1;
        start = r;
      }
    }
  }
  const groups: number[][] = [];
  const seen = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (!matched[i] || seen[i]) continue;
    const k = kindAt(cells[i]);
    const group: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      group.push(cur);
      const c = cur % width;
      const r = Math.floor(cur / width);
      for (const n of [c > 0 ? cur - 1 : -1, c < width - 1 ? cur + 1 : -1, r > 0 ? cur - width : -1, r < height - 1 ? cur + width : -1]) {
        if (n < 0 || seen[n] || !matched[n] || kindAt(cells[n]) !== k) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    groups.push(group.sort((a, b) => a - b));
  }
  return groups;
}

/**
 * One new piece. The kind is drawn for every cell, whether or not another piece takes it, so the
 * kinds a seed deals are the same at every stage. The opening board has no float.
 */
function deal(settings: SettingsReader, draw: StartContext["draw"], opening: boolean): NewPiece {
  const kind = draw.even("kind", settings.number("kinds")) + 1;
  let special = 2;
  if (settings.has("specials")) {
    const burst = settings.number("burstPermille");
    const sweep = settings.number("sweepPermille");
    special = draw.weighted("special", [burst, sweep, 1000 - burst - sweep]);
  }
  const float = !opening && settings.has("line") && draw.chance("float", settings.number("floatPermille"));
  if (float) return { piece: "float" };
  if (special === 0) return { piece: "burst" };
  if (special === 1) return { piece: "sweep" };
  return { piece: "kind", kind };
}

const NO_RUN_TRIES = 20;

/** The partner cell of a swap, or null when the board has none that way. */
function partner(board: Board, at: number, to: unknown): number | null {
  const c = at % board.width;
  if (to === "right") return c < board.width - 1 ? at + 1 : null;
  if (to === "left") return c > 0 ? at - 1 : null;
  return null;
}

/** Rows under the line for a line held in parts of a row. */
const rowsOf = (settings: SettingsReader, heat: number): number => Math.floor(heat / (settings.number("riseMoves") * settings.number("ventPoints")));

type Ctx = HookContext<SwapState>;

/** Clear a group of cells on an event of its own. */
function clear(ctx: Ctx, event: "run" | "burst" | "sweep", fields: Readonly<Record<string, unknown>>, places: readonly number[]): void {
  const cells = ctx.board.cells;
  ctx.emit(event, { ...fields, places }, (e) => {
    for (const p of places) e.leave(cells[p]!.id, p);
    e.pay(event);
    e.scale("cascade");
    e.scale("streak");
  });
}

/** Every run on the board clears, each on an event of its own. Returns the state with its stats, and how many groups cleared. */
function clearRuns(ctx: Ctx, s: SwapState, gone: ReadonlySet<number> = new Set()): readonly [SwapState, number] {
  const runs = findRuns(ctx.board, gone);
  let longest = s.longest;
  for (const places of runs) {
    longest = Math.max(longest, places.length);
    clear(ctx, "run", {}, places);
  }
  return [{ ...s, runs: s.runs + runs.length, longest }, runs.length];
}

/** The bonus for clearing several groups in one step. */
function together(ctx: Ctx, s: SwapState, groups: number): SwapState {
  if (groups >= 2 && ctx.settings.has("chains")) {
    ctx.emit("together", { groups }, (e) => {
      e.pay("together");
      e.scale("cascade");
      e.scale("streak");
    });
  }
  return { ...s, together: Math.max(s.together, groups) };
}

/** The pieces rise into the gaps, column by column, and new ones come in from below. */
function rise(ctx: Ctx): void {
  const { width, height, cells } = ctx.board;
  ctx.emit("rise", {}, (e) => {
    for (let c = 0; c < width; c++) {
      let write = 0;
      for (let r = 0; r < height; r++) {
        const p = cells[r * width + c];
        if (!p) continue;
        if (r !== write) e.travel(p.id, r * width + c, write * width + c);
        write++;
      }
      for (let r = write; r < height; r++) e.arrive(deal(ctx.settings, ctx.draw, false), r * width + c, { off: "down" });
    }
  });
}

export const SWAP_RULES: Rules<SwapState> = {
  id: "swap",
  version: "0.1",
  knows: {
    layers: ["runs", "chains", "streak", "specials", "line"],
    settings: ["roundSeconds", "width", "height", "kinds", "runPoints", "cascadePercent", "togetherPoints", "streakPercent", "burstPermille", "sweepPermille", "burstPoints", "sweepPoints", "floatPermille", "liftPoints", "startRows", "minRows", "dangerRows", "riseMoves", "ventPoints"],
    terrain: [],
    zones: [],
    pieces: ["kind", "burst", "sweep", "float"],
    moves: ["swap"],
    controls: [],
    events: ["trade", "run", "burst", "sweep", "together", "rise", "lift", "level", "streak"],
    gauges: ["level", "streak"],
    payouts: ["run", "together", "burst", "sweep", "lift"],
    multipliers: ["cascade", "streak"],
    tasks: [],
    draws: ["kind", "special", "float"],
    checks: ["no_run"],
    secrets: [],
    signals: ["level"],
    stats: ["best_streak", "swaps", "runs", "longest", "together", "lifted", "best_lift"],
  },

  onStart(ctx: StartContext): SwapState {
    const { settings } = ctx;
    const { width, height } = ctx.board;
    const kinds = settings.number("kinds");
    // The check `no_run`: a kind that would complete a run with the two pieces left of it or above
    // it is drawn again, up to the tries, and then the fallback takes the lowest kind that does not.
    const laid: number[] = [];
    for (let i = 0; i < width * height; i++) {
      const c = i % width;
      const makesRun = (k: number): boolean => (c >= 2 && laid[i - 1] === k && laid[i - 2] === k) || (i >= 2 * width && laid[i - width] === k && laid[i - 2 * width] === k);
      let piece = deal(settings, ctx.draw, true);
      for (let tries = 1; piece.piece === "kind" && makesRun(piece.kind!) && tries < NO_RUN_TRIES; tries++) piece = { piece: "kind", kind: ctx.draw.even("kind", kinds) + 1 };
      if (piece.piece === "kind" && makesRun(piece.kind!)) {
        let k = 1;
        while (makesRun(k)) k++;
        piece = { piece: "kind", kind: k };
      }
      laid.push(piece.piece === "kind" ? piece.kind! : 0);
      ctx.place(piece, i);
    }
    const line = settings.has("line");
    const per = line ? settings.number("riseMoves") * settings.number("ventPoints") : 1;
    const rows = line ? settings.number("startRows") : 0;
    return { heat: rows * per, rows, wired: false, counted: 0, swaps: 0, runs: 0, longest: 0, together: 0, lifted: 0, bestLift: 0 };
  },

  canMove(view: RulesView<SwapState>, move: Move): string | null {
    if (typeof move.at !== "number") return "a swap starts on a cell";
    if (move.to !== "left" && move.to !== "right") return "a piece is swapped left or right";
    return partner(view.board, move.at, move.to) === null ? "there is no piece that way" : null;
  },

  onMove(ctx: Ctx, move: Move): SwapState {
    const { width, height } = ctx.board;
    const a = move.at as number;
    const b = partner(ctx.board, a, move.to)!;
    const first = ctx.board.cells[a]!;
    const second = ctx.board.cells[b]!;
    ctx.emit("trade", { a, b }, (e) => {
      e.travel(first.id, a, b);
      e.travel(second.id, b, a);
    });

    // What the swap itself clears. The two that were swapped act from where they landed.
    const board = ctx.board;
    const gone = new Set<number>();
    const claim = (cells: readonly number[]): number[] => {
      const out = cells.filter((c) => !gone.has(c)).sort((x, y) => x - y);
      for (const c of out) gone.add(c);
      return out;
    };
    const landed: readonly (readonly [number, PieceOn, PieceOn])[] = [
      [b, first, second],
      [a, second, first],
    ];
    let groups = 0;
    for (const [at, piece] of landed) {
      if (piece.piece !== "burst") continue;
      const blast: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const c = (at % width) + dc;
          const r = Math.floor(at / width) + dr;
          if (c >= 0 && c < width && r >= 0 && r < height) blast.push(r * width + c);
        }
      }
      const places = claim(blast);
      if (places.length === 0) continue;
      clear(ctx, "burst", { place: at }, places);
      groups++;
    }
    for (const [at, piece, other] of landed) {
      if (piece.piece !== "sweep") continue;
      const wipe = [at];
      if (other.piece === "kind") board.cells.forEach((p, i) => void (kindAt(p) === other.kind && wipe.push(i)));
      const places = claim(wipe);
      if (places.length === 0) continue;
      clear(ctx, "sweep", { place: at }, places);
      groups++;
    }
    const [cleared, runs] = clearRuns(ctx, { ...ctx.state, swaps: ctx.state.swaps + 1 }, gone);
    groups += runs;
    const s = together(ctx, cleared, groups);
    if (groups > 0) rise(ctx);
    return s;
  },

  onCascade(ctx: Ctx): SwapState {
    const [cleared, groups] = clearRuns(ctx, ctx.state);
    if (groups === 0) return ctx.state;
    const s = together(ctx, cleared, groups);
    rise(ctx);
    return s;
  },

  onMoveEnd(ctx: Ctx): SwapState {
    const { settings } = ctx;
    const { width, height } = ctx.board;
    let s = ctx.state;
    if (settings.has("line")) {
      // The puzzle's own line rises a share of a row with the swap and falls with the points made
      // since it was last read, never below its least. A signal's line stays put.
      if (!s.wired) {
        const per = settings.number("riseMoves") * settings.number("ventPoints");
        const heat = Math.max(settings.number("minRows") * per, Math.min(height * per, s.heat + settings.number("ventPoints") - (ctx.score - s.counted) * settings.number("riseMoves")));
        const rows = rowsOf(settings, heat);
        if (rows !== s.rows) ctx.emit("level", { rows });
        s = { ...s, heat, rows, counted: ctx.score };
      }
      const cells = ctx.board.cells;
      const places: number[] = [];
      for (let i = 0; i < (height - s.rows) * width; i++) if (cells[i]?.piece === "float") places.push(i);
      if (places.length > 0) {
        ctx.emit("lift", { places, count: places.length }, (e) => {
          for (const p of places) e.leave(cells[p]!.id, p);
          e.pay("lift");
          e.scale("streak");
        });
        rise(ctx);
        s = { ...s, lifted: s.lifted + places.length, bestLift: Math.max(s.bestLift, places.length) };
      }
    }
    // A swap that has scored builds the streak.
    if (ctx.points > 0) {
      const count = ctx.built();
      if (count > ctx.streak) ctx.emit("streak", { count });
    }
    return s;
  },

  onSignal(ctx: Ctx, id: string, value): SwapState {
    const s = ctx.state;
    if (id !== "level" || typeof value !== "number") return s;
    if (!ctx.settings.has("line")) throw new Refused("entry", ["this round has no line to set"]);
    if (value < 0 || value > ctx.board.height) throw new Refused("entry", ["the line is from no rows to the whole board"]);
    if (value !== s.rows) ctx.emit("level", { rows: value });
    return { ...s, rows: value, heat: value * ctx.settings.number("riseMoves") * ctx.settings.number("ventPoints"), wired: true };
  },

  gauges(view: RulesView<SwapState>) {
    return { ...(view.settings.has("line") ? { level: view.state.rows } : {}), ...(view.settings.has("streak") ? { streak: view.streak } : {}) };
  },

  stats(view: RulesView<SwapState>) {
    const s = view.state;
    return { swaps: s.swaps, runs: s.runs, longest: s.longest, together: s.together, lifted: s.lifted, best_lift: s.bestLift };
  },
};
