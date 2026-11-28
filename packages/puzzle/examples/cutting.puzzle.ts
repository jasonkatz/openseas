// Cutting, a prototype puzzle, written on rungs 2 and 3: a slab of blocks of ore, with a few flaws, cut up with a
// torch. A cut runs the whole way across the piece it is made in and splits it in two, so every piece is a rectangle.
// A piece of one ore is pure: it banks at once for its area squared. Cuts are limited; when they are spent, or nothing
// more can be banked, the slab is graded against the best any plan could have made of it and the next is dealt. What a
// pure piece banks, the grade's bonus and the streak of good slabs are payouts, a multiplier and the streak. One part
// of its own holds the slab, its pieces, and the table of the best any plan can do.
//
// The tests play it beside the engine the studio deals, cut for cut, and hold the two to the same slab, pieces,
// score and streak.
import { budget, clock, grid, part, puzzle, type Board, type Changes, type Ctx, type View } from "../src/index.js";

export type CutMove = { readonly move: "cut"; readonly piece: number; readonly vertical: boolean; readonly at: number };
export type DoneMove = { readonly move: "done" };
type Move = CutMove | DoneMove;

/** A rectangle of the slab: its top-left cell and its size. */
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** A mixed piece still on the table. */
export interface Piece extends Rect { readonly id: number }
/** The slab: the ore of every cell, the mixed pieces on the table, the cuts left, what it has banked and the best it could. */
export interface Slab { readonly ores: readonly number[]; readonly pieces: readonly Piece[]; readonly cutsLeft: number; readonly got: number; readonly best: number; readonly slab: number; readonly nextId: number }

const DEAL_TRIES = 40;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;

// ---- the table of bests: for every rectangle, the ore it is all of, what an unlimited torch banks, and what the best
// plan banks with at most k cuts. In cells squared.

interface Table { readonly w: number; readonly h: number; readonly k: number; readonly ore: Int8Array; readonly free: Int32Array; readonly best: Int32Array }
const rid = (t: { w: number; h: number }, x: number, y: number, w: number, h: number): number => ((x * t.h + y) * t.w + (w - 1)) * t.h + (h - 1);
function buildTable(W: number, H: number, ores: readonly number[], maxCuts: number): Table {
  const n = W * H * W * H;
  const K = maxCuts + 1;
  const t: Table = { w: W, h: H, k: maxCuts, ore: new Int8Array(n), free: new Int32Array(n), best: new Int32Array(n * K) };
  for (let w = 1; w <= W; w++)
    for (let h = 1; h <= H; h++)
      for (let x = 0; x + w <= W; x++)
        for (let y = 0; y + h <= H; y++) {
          const id = rid(t, x, y, w, h);
          const first = ores[y * W + x]!;
          let pure = true;
          for (let yy = y; yy < y + h && pure; yy++) for (let xx = x; xx < x + w && pure; xx++) pure = ores[yy * W + xx] === first;
          t.ore[id] = pure ? first : -1;
          if (pure) {
            t.free[id] = w * h * w * h;
            for (let k = 0; k <= maxCuts; k++) t.best[id * K + k] = w * h * w * h;
            continue;
          }
          let free = 0;
          for (let c = 1; c < w; c++) free = Math.max(free, t.free[rid(t, x, y, c, h)]! + t.free[rid(t, x + c, y, w - c, h)]!);
          for (let c = 1; c < h; c++) free = Math.max(free, t.free[rid(t, x, y, w, c)]! + t.free[rid(t, x, y + c, w, h - c)]!);
          t.free[id] = free;
          for (let k = 1; k <= maxCuts; k++) {
            let best = 0;
            const halves: [number, number][] = [];
            for (let c = 1; c < w; c++) halves.push([rid(t, x, y, c, h), rid(t, x + c, y, w - c, h)]);
            for (let c = 1; c < h; c++) halves.push([rid(t, x, y, w, c), rid(t, x, y + c, w, h - c)]);
            for (const [a, b] of halves) for (let k1 = 0; k1 < k; k1++) best = Math.max(best, t.best[a * K + k1]! + t.best[b * K + (k - 1 - k1)]!);
            t.best[id * K + k] = best;
          }
        }
  return t;
}
const tableBest = (t: Table, r: Rect, cuts: number): number => t.best[rid(t, r.x, r.y, r.w, r.h) * (t.k + 1) + Math.max(0, Math.min(cuts, t.k))]!;
/** The most the pieces on the table can bank between them with the cuts left. */
function bestRemaining(board: Board, s: Slab): number {
  if (s.pieces.length === 0 || s.cutsLeft <= 0) return 0;
  const t = buildTable(board.width, board.height, s.ores, s.cutsLeft);
  let row = new Array<number>(s.cutsLeft + 1).fill(0);
  for (const p of s.pieces) row = row.map((_, k) => Math.max(...Array.from({ length: k + 1 }, (_, own) => row[k - own]! + tableBest(t, p, own))));
  return row[s.cutsLeft]!;
}
/** The area of the largest pure rectangle on the slab. */
function largestBlock(t: Table): number {
  let best = 0;
  for (let w = 1; w <= t.w; w++) for (let h = 1; h <= t.h; h++) for (let x = 0; x + w <= t.w; x++) for (let y = 0; y + h <= t.h; y++) if (w * h > best && t.ore[rid(t, x, y, w, h)] !== -1) best = w * h;
  return best;
}

/** The two sides of a cut: left then right for a vertical cut, top then bottom otherwise. */
export const split = (r: Rect, vertical: boolean, at: number): [Rect, Rect] =>
  vertical ? [{ x: r.x, y: r.y, w: at - r.x, h: r.h }, { x: at, y: r.y, w: r.x + r.w - at, h: r.h }] : [{ x: r.x, y: r.y, w: r.w, h: at - r.y }, { x: r.x, y: at, w: r.w, h: r.y + r.h - at }];
const pureOre = (board: Board, ores: readonly number[], r: Rect): number | null => {
  const first = ores[r.y * board.width + r.x]!;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (ores[y * board.width + x] !== first) return null;
  return first;
};
const cellsOf = (r: Rect): { x: number; y: number }[] => Array.from({ length: r.w * r.h }, (_, i) => ({ x: r.x + (i % r.w), y: r.y + Math.floor(i / r.w) }));

/**
 * Deal a slab: split the rectangle at random into blocks, a bigger one likelier to split and more often across its
 * longer side; give each an ore; then turn a few cells into flaws. A slab of one ore, or with one block bigger than
 * the most a slab may hold, is dealt again. Its cuts are the fewest that let the best plan bank its share of the best.
 */
function deal(ctx: Ctx<Slab>, slab: number, nextId: number): Slab {
  const { board } = ctx;
  const n = numbers(ctx);
  const [W, H] = [board.width, board.height];
  const draw = ctx.draw("slab");
  const level = Math.floor(slab / n.growEvery!);
  const parts = Math.min(n.partsMost!, n.partsLeast! + level);
  const flaws = Math.min(n.flawsMost!, n.flawsLeast! + Math.floor(level / 2));
  const whole: Rect = { x: 0, y: 0, w: W, h: H };
  let found: { ores: number[]; cuts: number; best: number } | null = null;
  for (let attempt = 0; attempt < DEAL_TRIES && !found; attempt++) {
    const blocks: Rect[] = [whole];
    while (blocks.length < parts) {
      const splittable = blocks.filter((b) => b.w > 1 || b.h > 1);
      if (splittable.length === 0) break;
      let pick = draw.even(splittable.reduce((sum, b) => sum + b.w * b.h, 0));
      const block = splittable.find((b) => (pick < b.w * b.h ? true : ((pick -= b.w * b.h), false)))!;
      const vertical = block.w > 1 && block.h > 1 ? draw.even(block.w + block.h) < block.w : block.w > 1;
      const at = vertical ? block.x + 1 + draw.even(block.w - 1) : block.y + 1 + draw.even(block.h - 1);
      blocks.splice(blocks.indexOf(block), 1, ...split(block, vertical, at));
    }
    const ores = new Array<number>(W * H).fill(0);
    for (const b of blocks) {
      const ore = draw.even(n.ores!);
      for (const c of cellsOf(b)) ores[c.y * W + c.x] = ore;
    }
    for (let i = 0; i < flaws; i++) {
      const c = draw.even(W * H);
      ores[c] = (ores[c]! + 1 + draw.even(n.ores! - 1)) % n.ores!;
    }
    const t = buildTable(W, H, ores, n.maxCuts!);
    if (t.ore[rid(t, 0, 0, W, H)] !== -1 || largestBlock(t) * 100 > n.maxBlockPercent! * W * H) continue;
    const free = t.free[rid(t, 0, 0, W, H)]!;
    let cuts = n.minCuts!;
    while (cuts < n.maxCuts! && tableBest(t, whole, cuts) * 100 < n.budgetPercent! * free) cuts++;
    if (tableBest(t, whole, cuts) > 0) found = { ores, cuts, best: tableBest(t, whole, cuts) };
  }
  if (!found) {
    // No deal worked: two halves of two ores, one cut apart.
    const ores = Array.from({ length: W * H }, (_, i) => (i % W >= Math.floor(W / 2) ? 1 : 0));
    found = { ores, cuts: n.minCuts!, best: tableBest(buildTable(W, H, ores, n.maxCuts!), whole, n.minCuts!) };
  }
  const { ores, cuts, best } = found;
  ctx.emit("slab", { cuts }, (e) => board.places().forEach((p) => e.arrive(p, { piece: "ore", kind: ores[p.y * W + p.x]! + 1 })));
  return { ores, pieces: [{ id: nextId, ...whole }], cutsLeft: cuts, got: 0, best: best * n.cellPoints!, slab, nextId: nextId + 1 };
}

/** Grade the slab against its best, pay the grade, and deal the next. What is left on the table is scrap. */
function finish(ctx: Ctx<Slab>, s: Slab): Slab {
  const grade = s.got >= s.best ? "flawless" : s.got * 100 >= numbers(ctx).cleanPercent! * s.best ? "clean" : "rough";
  ctx.emit(grade, { got: s.got, best: s.best }, (e: Changes) => {
    for (const p of s.pieces) for (const c of cellsOf(p)) e.leave(c);
    e.set("slabs", ctx.value("slabs") + 1);
  });
  return deal(ctx, s.slab + 1, s.nextId);
}

/**
 * The slab. A cut splits a piece along a grid line inside it. Each half of one ore banks at once and leaves the
 * table; a mixed half stays. The slab is over when the table is bare, the cuts are spent, or no cut left could bank
 * anything; it can also be given up.
 */
const slab = part<Move, Slab>({
  name: "slab",
  rule: "cut a piece in two along a grid line across it; a piece of one ore banks for its area squared, and the slab is graded against the best plan",
  pieces: [{ id: "ore" }],
  moves: [
    { id: "cut", description: "cut a piece along the grid line `at`: a column line when vertical, else a row line", gesture: "drag", fields: { piece: "number", vertical: "flag", at: "number" } },
    { id: "done", description: "give the slab up as it stands, and take the next", gesture: "tap", fields: {} },
  ],
  events: [
    { id: "slab", description: "a slab was dealt, with its cuts", fields: { cuts: "number" }, changes: ["arrive"] },
    { id: "cut", description: "a piece was cut in two", fields: { piece: "number", vertical: "flag", at: "number" } },
    { id: "bank", description: "a piece of one ore banked and left the table", fields: { area: "number", ore: "number", points: "points" }, changes: ["leave"] },
    { id: "flawless", description: "a slab banked all its best", fields: { got: "number", best: "number", points: "points" }, changes: ["leave"] },
    { id: "clean", description: "a slab banked most of its best", fields: { got: "number", best: "number", points: "points" }, changes: ["leave"] },
    { id: "rough", description: "a slab banked less than most of its best", fields: { got: "number", best: "number" }, changes: ["leave"] },
  ],
  draws: [{ id: "slab", description: "how each slab splits into blocks, each block's ore, and where its flaws fall", gives: "kind", by: "even", when: "task", reads: ["ores", "partsLeast", "flawsLeast"] }],
  stats: [{ id: "slabs", description: "slabs finished" }, { id: "banked", description: "pieces banked" }],
  texts: ["reason.no_cuts", "reason.no_piece", "reason.not_inside"],
  hooks: {
    onStart: (ctx) => deal(ctx, 0, 1),
    canMove: {
      cut(view, move: CutMove) {
        if (view.state.cutsLeft <= 0) return "reason.no_cuts";
        const p = view.state.pieces.find((q) => q.id === move.piece);
        if (!p) return "reason.no_piece";
        const inside = move.vertical ? move.at > p.x && move.at < p.x + p.w : move.at > p.y && move.at < p.y + p.h;
        return Number.isInteger(move.at) && inside ? null : "reason.not_inside";
      },
    },
    onMove: {
      cut(ctx, _seat, move: CutMove) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        const piece = state.pieces.find((q) => q.id === move.piece)!;
        ctx.emit("cut", { piece: move.piece, vertical: move.vertical, at: move.at });
        let nextId = state.nextId;
        let got = state.got;
        const pieces = state.pieces.filter((q) => q.id !== piece.id);
        for (const r of split(piece, move.vertical, move.at)) {
          const id = nextId++;
          const ore = pureOre(board, state.ores, r);
          if (ore === null) {
            pieces.push({ id, ...r });
            continue;
          }
          got += n.cellPoints! * r.w * r.h * r.w * r.h;
          ctx.emit("bank", { area: r.w * r.h, ore }, (e) => {
            for (const c of cellsOf(r)) e.leave(c);
            e.set("banked", ctx.value("banked") + 1);
          });
        }
        const after: Slab = { ...state, pieces, cutsLeft: state.cutsLeft - 1, got, nextId };
        return pieces.length === 0 || after.cutsLeft === 0 || bestRemaining(board, after) === 0 ? finish(ctx, after) : after;
      },
      done: (ctx) => finish(ctx, ctx.state),
    },
    listMoves(view) {
      if (view.state.cutsLeft <= 0) return [{ move: "done" }];
      return [
        ...view.state.pieces.flatMap((p) => [
          ...Array.from({ length: p.w - 1 }, (_, i) => ({ move: "cut", piece: p.id, vertical: true, at: p.x + 1 + i })),
          ...Array.from({ length: p.h - 1 }, (_, i) => ({ move: "cut", piece: p.id, vertical: false, at: p.y + 1 + i })),
        ]),
        { move: "done" },
      ];
    },
  },
});

export default puzzle("cutting", {
  board: grid("width", "height"),
  parts: [slab],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 6,
    height: 6,
    roundSeconds: 150,
    maxMoves: 600,
    ores: { default: 4, min: 2, max: 8, description: "kinds of ore" },
    partsLeast: { default: 5, min: 2, max: 64, description: "blocks the first slab is dealt from; one more each step of growth" },
    partsMost: { default: 7, min: 2, max: 64, description: "the most blocks a slab is dealt from" },
    flawsLeast: { default: 1, min: 0, max: 64, description: "flaws on the first slab; one more every two steps of growth" },
    flawsMost: { default: 2, min: 0, max: 64, description: "the most flaws on a slab" },
    growEvery: { default: 2, min: 1, max: 1000, description: "slabs finished between one step of growth and the next" },
    maxBlockPercent: { default: 45, min: 10, max: 100, description: "the largest block of one ore a slab may hold, as a share of it; a slab with a bigger one is dealt again" },
    budgetPercent: { default: 85, min: 1, max: 100, description: "a slab gets the fewest cuts with which the best plan banks this share of what an unlimited torch could" },
    minCuts: { default: 3, min: 1, max: 12, description: "the fewest cuts a slab is given" },
    maxCuts: { default: 6, min: 1, max: 12, description: "the most cuts a slab is given" },
    cleanPercent: { default: 80, min: 1, max: 100, description: "the share of its best a slab must bank to be clean" },
    cellPoints: { default: 1, min: 1, max: 1000, description: "points for a pure piece, times its area squared" },
    cleanPoints: { default: 40, min: 0, max: 100_000, description: "the bonus for a clean slab, before the streak" },
    flawlessPoints: { default: 100, min: 0, max: 100_000, description: "the bonus for a slab that banked all its best, before the streak" },
    streakPercent: { default: [100, 125, 150, 175, 200], min: 100, max: 1000, description: "what a slab's bonus multiplies by, an entry for each good slab in a row" },
  },
  // A pure piece of area a banks a × a. A slab's grade pays a bonus the streak multiplies.
  payouts: {
    bank: { on: "bank", counts: "area", growth: "superlinear", reads: "cellPoints" },
    flawless: { on: "flawless", reads: "flawlessPoints" },
    clean: { on: "clean", reads: "cleanPoints" },
  },
  multipliers: { streak: { scales: ["flawless", "clean"], by: "streakPercent", index: "streak" } },
  // Clean and flawless slabs in a row. A rough one ends it.
  streak: { builds: "flawless or clean", counts: "events", breaksOn: ["rough"] },
});
