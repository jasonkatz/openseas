// Deflectors, a prototype puzzle, written on rungs 2 and 3 with a ticking tempo: a square grid the player builds piece
// by piece, emitters on its left edge and targets on the other three. The next piece of a set supply goes on any cell,
// is turned first if it is a mirror, or is binned. A shot fires every emitter at once: each beam turns at every mirror,
// passes straight through a lens, splits at a splitter, and lights a target it leaves by having passed exactly the
// lenses its recipe asks for. A beam pays for its legs squared, more for each lens in its recipe, and the shot is
// multiplied by the targets it lit: a payout and two multipliers read at counts the beam carries. Mirrors a shot turned
// at, and lenses a lighting beam passed, are spent. One part of its own holds the targets, the queue and the trace.
//
// The tests play it beside the engine the studio deals, tick for tick, and hold the two to the same grid, targets,
// queue and score.
import { budget, clock, grid, part, puzzle, ticking, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type PlaceMove = { readonly move: "place"; readonly at: Cell };
export type TurnMove = { readonly move: "turn" };
export type BinMove = { readonly move: "bin" };
export type FireMove = { readonly move: "fire" };
type Move = PlaceMove | TurnMove | BinMove | FireMove;
/** A target on the edge: its place in the deal, its port, and the lens kinds a beam must pass, as a mask. */
export interface Target { readonly id: number; readonly port: number; readonly recipe: number }
/** The tick the round has reached, the targets, the pieces waiting (next first), pieces still to come, and the first tick the emitters can fire at. */
export interface Range { readonly now: number; readonly targets: readonly Target[]; readonly queue: readonly number[]; readonly left: number; readonly fireTick: number }

/** What a cell holds, as a number: empty, a mirror `/` or `\`, a lens of kind 0 to 2, or a splitter. */
const EMPTY = 0;
const SLASH = 1;
const BACKSLASH = 2;
const LENS = 3;
const LENS_KINDS = 3;
const SPLITTER = LENS + LENS_KINDS;
/** The most branches one emitter's beam is followed into. */
const MAX_BRANCHES = 16;
/** A tick is a tenth of a second, and it is the puzzle's own: no setting changes it. */
const TICK_MS = 100;
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const isMirror = (c: number): boolean => c === SLASH || c === BACKSLASH;
const lensKind = (c: number): number => (c >= LENS && c < SPLITTER ? c - LENS : -1);
const recipeSize = (mask: number): number => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
/** A cell's number as a piece on the board, and back. */
const pieceOf = (c: number): { piece: string; state?: number } => (isMirror(c) ? { piece: "mirror", state: c - SLASH } : c === SPLITTER ? { piece: "splitter" } : { piece: "lens", state: lensKind(c) });
const cellsOf = (board: Board): number[] =>
  board.places().map((p) => {
    const at = board.at(p);
    return !at ? EMPTY : at.piece === "mirror" ? SLASH + (at.state as number) : at.piece === "splitter" ? SPLITTER : LENS + (at.state as number);
  });
const cell = (n: number, i: number): Cell => ({ x: i % n, y: Math.floor(i / n) });

/** The emitters' ports, spread down the left edge, top to bottom. */
export const emitterPorts = (n: number, emitters: number): number[] => Array.from({ length: emitters }, (_, i) => 3 * n + Math.floor(((2 * i + 1) * n) / (2 * emitters)));
/** The cell a beam from a port stands in first, and the way it heads. Ports run top, right, bottom, left, each edge in order. */
const portEntry = (n: number, port: number): { col: number; row: number; dir: number } => {
  const i = port % n;
  return [{ col: i, row: 0, dir: 2 }, { col: n - 1, row: i, dir: 3 }, { col: i, row: n - 1, dir: 0 }, { col: 0, row: i, dir: 1 }][Math.floor(port / n)]!;
};
const exitPort = (n: number, col: number, row: number, dir: number): number => [col, n + row, 2 * n + col, 3 * n + row][dir]!;

interface Trace { readonly out: number; readonly turns: readonly number[]; readonly lenses: number; readonly lensCells: readonly number[] }
/**
 * Every branch of the beam from a port through the cells. A splitter ends the beam that meets it and starts two, turned
 * each way across it, each counting the split as a turn, the anticlockwise one first. A branch that comes to a cell
 * heading a way this beam already went stops there, leaving by no port.
 */
export function traceBeams(n: number, cells: readonly number[], entry: number): Trace[] {
  const seen = new Set<number>();
  const out: Trace[] = [];
  const todo = [{ ...portEntry(n, entry), turns: [] as number[], lensCells: [] as number[], lenses: 0 }];
  while (todo.length > 0 && out.length < MAX_BRANCHES) {
    const b = todo.shift()!;
    let { col, row, dir } = b;
    let [stopped, split] = [false, false];
    while (col >= 0 && col < n && row >= 0 && row < n) {
      const c = row * n + col;
      if (seen.has(c * 4 + dir)) {
        stopped = true;
        break;
      }
      seen.add(c * 4 + dir);
      const here = cells[c]!;
      if (isMirror(here)) (dir = here === SLASH ? dir ^ 1 : 3 - dir), b.turns.push(c);
      else if (here === SPLITTER) {
        for (const d of [(dir + 3) % 4, (dir + 1) % 4]) todo.push({ col: col + DX[d]!, row: row + DY[d]!, dir: d, turns: [...b.turns, c], lensCells: [...b.lensCells], lenses: b.lenses });
        split = true;
        break;
      } else if (lensKind(here) >= 0) (b.lenses |= 1 << lensKind(here)), b.lensCells.push(c);
      col += DX[dir]!;
      row += DY[dir]!;
    }
    if (split) continue;
    out.push({ out: stopped ? -1 : exitPort(n, col - DX[dir]!, row - DY[dir]!, dir), turns: b.turns, lenses: b.lenses, lensCells: b.lensCells });
  }
  return out;
}

/** A shot through the grid as it stands: every branch in emitter order, each lighting the first unlit target it may. */
export function resolve(n: number, cells: readonly number[], emitters: readonly number[], targets: readonly Target[]): { trace: Trace; target: Target | null }[] {
  const lit = new Set<number>();
  return emitters.flatMap((entry) =>
    traceBeams(n, cells, entry).map((trace) => {
      const target = targets.find((g) => !lit.has(g.id) && g.port === trace.out && g.recipe === trace.lenses) ?? null;
      if (target) lit.add(target.id);
      return { trace, target };
    }),
  );
}

/** A recipe by the weights: how many lenses, then which, drawn until that many kinds are in it. */
function recipe(ctx: Ctx<Range>): number {
  const weights = ctx.settings.recipeWeights as readonly number[];
  const draw = ctx.draw("range");
  let pick = draw.even(weights.reduce((a, w) => a + w, 0));
  let size = 0;
  while (pick >= weights[size]!) pick -= weights[size++]!;
  let mask = 0;
  while (recipeSize(mask) < size) mask |= 1 << draw.even(LENS_KINDS);
  return mask;
}
/** A piece from the supply: a lens of some kind, a splitter, or a mirror set at random. */
function piece(ctx: Ctx<Range>): number {
  const n = numbers(ctx);
  const draw = ctx.draw("range");
  const roll = draw.even(100);
  if (roll < n.lensChance!) return LENS + draw.even(LENS_KINDS);
  if (roll < n.lensChance! + n.splitterChance!) return SPLITTER;
  return draw.even(2) === 0 ? SLASH : BACKSLASH;
}
/** A cell from the empty ones, or from all when none is. */
function pickCell(ctx: Ctx<Range>, cells: readonly number[]): number {
  const empty = cells.flatMap((c, i) => (c === EMPTY ? [i] : []));
  const from = empty.length > 0 ? empty : cells.map((_, i) => i);
  return from[ctx.draw("range").even(from.length)]!;
}

/** The next piece leaves the queue, and the supply refills it while any is left. */
function takeNext(ctx: Ctx<Range>): { piece: number; queue: number[]; left: number } {
  const [next, ...queue] = ctx.state.queue;
  let left = ctx.state.left;
  if (left > 0) {
    const p = piece(ctx);
    queue.push(p);
    left--;
    ctx.emit("piece", { kind: p });
  }
  return { piece: next!, queue, left };
}

/**
 * The range. Nothing comes on the clock and nothing is placed for the player: the clock only bounds the round, and
 * holds the emitters a moment after each shot.
 */
const range = part<Move, Range>({
  name: "range",
  rule: "put the next piece on any cell, turning a mirror first, or bin it; fire every emitter when the grid is worth it",
  pieces: [{ id: "mirror", states: { count: 2 } }, { id: "lens", states: { count: LENS_KINDS } }, { id: "splitter" }],
  moves: [
    { id: "place", description: "put the next piece on a cell, in place of whatever is there", gesture: "tap", fields: { at: "place" } },
    { id: "turn", description: "turn the next piece, a mirror, between / and \\", gesture: "tap", fields: {} },
    { id: "bin", description: "bin the next piece, using it up", gesture: "tap", fields: {} },
    { id: "fire", description: "fire every emitter", gesture: "tap", fields: {} },
  ],
  events: [
    { id: "deal", description: "the grid was dealt its mirrors and lenses", fields: { count: "number" }, changes: ["arrive"] },
    { id: "target", description: "a target asks for a recipe: the lens kinds a beam must pass, as a mask", fields: { id: "number", port: "number", recipe: "number" } },
    { id: "piece", description: "a piece came into the queue from the supply", fields: { kind: "number" } },
    { id: "place", description: "the next piece went on a cell", fields: { at: "place", kind: "number" }, changes: ["arrive", "leave"] },
    { id: "turn", description: "the next piece, a mirror, was turned", fields: {} },
    { id: "bin", description: "the next piece was binned", fields: { kind: "number" } },
    { id: "fire", description: "every emitter fired", fields: { beams: "number", lit: "number" } },
    { id: "beam", description: "a beam lit a target, after so many legs, past the lenses its recipe asked for, in a shot that lit so many", fields: { port: "number", legs: "number", lenses: "number", lit: "number", points: "points" } },
    { id: "spend", description: "the mirrors the shot turned at and the lenses its lighting beams passed left the grid", fields: { count: "number" }, changes: ["leave"] },
  ],
  draws: [{ id: "range", description: "the opening grid, the targets' ports, every recipe and every piece of the supply", gives: "piece", by: "weighted", when: "refill", reads: ["recipeWeights", "lensChance", "splitterChance"] }],
  stats: [{ id: "placed", description: "pieces put down" }, { id: "binned", description: "pieces binned" }, { id: "shots", description: "shots fired" }, { id: "lit", description: "targets lit" }, { id: "spent", description: "cells spent" }, { id: "bestLit", description: "the most targets one shot lit" }, { id: "longest", description: "the most turns a lighting beam made" }],
  texts: ["reason.no_piece", "reason.no_mirror", "reason.not_ready"],
  hooks: {
    onStart(ctx) {
      const n = ctx.board.width;
      const s = numbers(ctx);
      const cells = new Array<number>(n * n).fill(EMPTY);
      for (let i = 0; i < s.mirrors!; i++) {
        const c = pickCell(ctx, cells);
        cells[c] = ctx.draw("range").even(2) === 0 ? SLASH : BACKSLASH;
      }
      for (let i = 0; i < s.lenses!; i++) cells[pickCell(ctx, cells)] = LENS + (i % LENS_KINDS);
      ctx.emit("deal", { count: s.mirrors! + s.lenses! }, (e) => cells.forEach((c, i) => c !== EMPTY && e.arrive(cell(n, i), pieceOf(c))));
      // Targets on the top, right and bottom edges, no two on one port.
      const ports = Array.from({ length: 3 * n }, (_, i) => i);
      const dealt = Array.from({ length: s.targets! }, () => ({ port: ports.splice(ctx.draw("range").even(ports.length), 1)[0]!, recipe: recipe(ctx) }));
      const targets = dealt.sort((a, b) => a.port - b.port).map((t, id) => ({ id, ...t }));
      for (const t of targets) ctx.emit("target", { ...t });
      const shown = Math.min(s.queueSize!, s.pieces!);
      const queue = Array.from({ length: shown }, () => piece(ctx));
      for (const kind of queue) ctx.emit("piece", { kind });
      return { now: 0, targets, queue, left: s.pieces! - shown, fireTick: 0 };
    },
    onTick: (ctx, tick) => ({ ...ctx.state, now: tick.n }),
    canMove: {
      place: (view) => (view.state.queue.length === 0 ? "reason.no_piece" : null),
      bin: (view) => (view.state.queue.length === 0 ? "reason.no_piece" : null),
      turn: (view) => (isMirror(view.state.queue[0] ?? EMPTY) ? null : "reason.no_mirror"),
      fire: (view) => (view.state.now < view.state.fireTick ? "reason.not_ready" : null),
    },
    onMove: {
      place(ctx, _seat, move: PlaceMove) {
        const t = takeNext(ctx);
        ctx.emit("place", { at: move.at, kind: t.piece }, (e) => (ctx.board.at(move.at) ? e.leave(move.at) : e).arrive(move.at, pieceOf(t.piece)).set("placed", ctx.value("placed") + 1));
        return { ...ctx.state, queue: t.queue, left: t.left };
      },
      bin(ctx) {
        const t = takeNext(ctx);
        ctx.emit("bin", { kind: t.piece }, (e) => e.set("binned", ctx.value("binned") + 1));
        return { ...ctx.state, queue: t.queue, left: t.left };
      },
      turn(ctx) {
        const [next, ...rest] = ctx.state.queue;
        ctx.emit("turn", {});
        return { ...ctx.state, queue: [next === SLASH ? BACKSLASH : SLASH, ...rest] };
      },
      fire(ctx) {
        const { board, state } = ctx;
        const s = numbers(ctx);
        const n = board.width;
        const cells = cellsOf(board);
        const shot = resolve(n, cells, emitterPorts(n, s.emitters!), state.targets);
        const lighting = shot.filter((b) => b.target);
        ctx.emit("fire", { beams: shot.length, lit: lighting.length }, (e) => {
          e.set("shots", ctx.value("shots") + 1).set("lit", ctx.value("lit") + lighting.length);
          if (lighting.length > ctx.value("bestLit")) e.set("bestLit", lighting.length);
          const longest = Math.max(ctx.value("longest"), ...lighting.map((b) => b.trace.turns.length));
          if (longest > ctx.value("longest")) e.set("longest", longest);
        });
        for (const b of lighting) ctx.emit("beam", { port: b.target!.port, legs: b.trace.turns.length + 1, lenses: recipeSize(b.target!.recipe), lit: lighting.length });
        if (ctx.settings.spend === true) {
          const spent = [...new Set(shot.flatMap((b) => (b.target ? [...b.trace.turns, ...b.trace.lensCells] : b.trace.turns)))].sort((a, b) => a - b);
          if (spent.length > 0) ctx.emit("spend", { count: spent.length }, (e) => {
            for (const c of spent) e.leave(cell(n, c));
            e.set("spent", ctx.value("spent") + spent.length);
          });
        }
        // A lit target asks for a new recipe, in port order.
        const litIds = new Set(lighting.map((b) => b.target!.id));
        const targets = state.targets.map((t) => (litIds.has(t.id) ? { ...t, recipe: recipe(ctx) } : t));
        for (const t of targets) if (litIds.has(t.id)) ctx.emit("target", { ...t });
        return { ...state, targets, fireTick: state.now + s.fireTicks! };
      },
    },
    listMoves(view) {
      const moves: Move[] = [];
      if (view.state.queue.length > 0) moves.push(...view.board.places().map((at) => ({ move: "place" as const, at })), { move: "bin" });
      if (isMirror(view.state.queue[0] ?? EMPTY)) moves.push({ move: "turn" });
      if (view.state.now >= view.state.fireTick) moves.push({ move: "fire" });
      return moves;
    },
  },
});

export default puzzle("deflectors", {
  board: grid("size", "size"),
  tempo: ticking(TICK_MS),
  parts: [range],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    size: 6,
    roundSeconds: 180,
    maxMoves: 4000,
    emitters: { default: 3, min: 1, max: 10, description: "emitters on the left edge, spread down it" },
    targets: { default: 5, min: 1, max: 8, description: "targets on the top, right and bottom edges" },
    mirrors: { default: 5, min: 0, max: 100, description: "mirrors on the grid at the start, set at random" },
    lenses: { default: 2, min: 0, max: 100, description: "lenses on the grid at the start, of each kind in turn" },
    recipeWeights: { default: [25, 45, 30], min: 0, max: 1000, description: "how often a recipe asks for no lens, one, two and so on, as weights; one entry turns recipes off" },
    lensPercent: { default: [150, 200, 250], min: 100, max: 10_000, description: "what a beam multiplies by for a recipe of one lens, two and three" },
    bouncePoints: { default: 1, min: 0, max: 1000, description: "points for a lighting beam, times its legs squared" },
    legCap: { default: 17, min: 2, max: 65, description: "the legs past which a beam pays no more" },
    litPercent: { default: [100, 200, 400], min: 0, max: 10_000, description: "what a shot multiplies by for lighting one target, two, three and so on; past the last, the last" },
    spend: { default: true, description: "mirrors a shot turned at, and lenses a lighting beam passed, leave the grid" },
    pieces: { default: 50, min: 1, max: 1000, description: "pieces the round deals, placed or binned" },
    queueSize: { default: 3, min: 1, max: 8, description: "pieces the queue shows, the next first" },
    lensChance: { default: 22, min: 0, max: 100, description: "chance in a hundred that a piece is a lens" },
    splitterChance: { default: 8, min: 0, max: 100, description: "chance in a hundred that a piece is a splitter" },
    fireTicks: { default: 10, min: 0, max: 10_000, description: "ticks after a shot before the emitters can fire again" },
  },
  // A beam of b turns has b + 1 legs and pays for them squared, up to the cap; its recipe's lenses and the targets the
  // shot lit multiply it.
  payouts: { beam: { on: "beam", counts: "legs", growth: "superlinear", cap: "legCap", reads: "bouncePoints" } },
  multipliers: {
    lenses: { scales: "beam", by: "lensPercent", index: { field: "lenses" } },
    lit: { scales: "beam", by: "litPercent", index: { field: "lit" } },
  },
});
