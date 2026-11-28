// Assembly, a prototype puzzle, written on rungs 2 and 3: a shipyard's parts bay, full, and a tray of blueprints. Each
// kind of part moves its own way: a girder swaps sideways, a strut up or down, a cable on the diagonals, a panel only
// when a neighbour that moves swaps with it, and a core never, standing for any part in a blueprint. A swap sets the bay
// up; fitting a blueprint takes every part under it, a new one comes in each cell it took, and a new blueprint comes
// from a bag of the sixteen in the pool. Fits with no swap between are a chain. What a fit pays for its size and its
// cores are payouts, and its place in the chain is the streak's multiplier. One part of its own holds the tray and bag.
//
// The tests play it beside the engine the studio deals, move for move, and hold the two to the same bay, tray, chain
// and score.
import { budget, grid, part, puzzle, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type SwapMove = { readonly move: "swap"; readonly a: Cell; readonly b: Cell };
export type FitMove = { readonly move: "fit"; readonly slot: number; readonly at: Cell };
type Move = SwapMove | FitMove;
/** The blueprints in the tray, each by its place in the pool, and what is left of the bag, dealt from the front. */
export interface Yard { readonly tray: readonly number[]; readonly bag: readonly number[] }

/** The parts, by the number the pool's drawings give them; a core is never drawn in a blueprint. */
export const PARTS = ["panel", "girder", "strut", "cable", "core"] as const;
const CORE = 4;
type Way = "side" | "up" | "diagonal";
const WAY: readonly (Way | null)[] = [null, "side", "up", "diagonal", null];
/**
 * The pool: sixteen blueprints, the same in every round, drawn as rows, one character a square: the part's digit
 * (0 panel, 1 girder, 2 strut, 3 cable), `.` where it has none.
 */
const POOL_ROWS: readonly (readonly string[])[] = [
  ["123"], ["1", "2", "3"], ["10", "3."], ["21", ".0"], ["0.", "32"], [".2", "13"],
  ["12", "30"], ["131", ".2."], ["0.", "2.", "31"], [".3", "20", "1."], ["21.", ".03"], ["2", "0", "1", "3"],
  [".1.", "203", ".1."], ["312", "0.2"], ["1..", "2..", "031"], ["23", "10", "2."],
];
interface Print { readonly width: number; readonly height: number; readonly parts: readonly { dc: number; dr: number; kind: number }[] }
export const POOL: readonly Print[] = POOL_ROWS.map((rows) => ({
  width: Math.max(...rows.map((r) => r.length)),
  height: rows.length,
  parts: rows.flatMap((line, dr) => [...line].flatMap((ch, dc) => (ch === "." ? [] : [{ dc, dr, kind: Number(ch) }]))),
}));
/** Deals tried before the opening bay is made to hold a fit by construction. */
const MAX_DEALS = 40;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const index = (board: Board, p: Cell): number => p.y * board.width + p.x;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
const kindsOf = (board: Board): number[] => board.places().map((p) => PARTS.indexOf(board.at(p)!.piece as (typeof PARTS)[number]));

/** How two cells lie, or null when they are not neighbours. */
const wayBetween = (a: Cell, b: Cell): Way | null => {
  const [dc, dr] = [b.x - a.x, b.y - a.y];
  if (Math.abs(dc) > 1 || Math.abs(dr) > 1 || (dc === 0 && dr === 0)) return null;
  return dr === 0 ? "side" : dc === 0 ? "up" : "diagonal";
};
/** Why two parts may not swap, or null when they may: either one must move the way they lie. */
function swapBlock(w: number, kinds: readonly number[], a: Cell, b: Cell): string | null {
  const way = wayBetween(a, b);
  if (way === null) return "reason.not_neighbours";
  const [p, q] = [kinds[a.y * w + a.x]!, kinds[b.y * w + b.x]!];
  if (p === CORE || q === CORE) return "reason.core";
  if (p === q) return "reason.same_part";
  return WAY[p] === way || WAY[q] === way ? null : "reason.wrong_way";
}
/** The cells a blueprint covers with the top left of its box at a place, in its parts' order; null when it hangs off. */
const cover = (w: number, h: number, print: Print, at: Cell): number[] | null =>
  at.x + print.width > w || at.y + print.height > h ? null : print.parts.map((p) => (at.y + p.dr) * w + at.x + p.dc);
const fits = (w: number, h: number, kinds: readonly number[], print: Print, at: Cell): boolean => {
  const c = cover(w, h, print, at);
  return c !== null && print.parts.every((p, i) => kinds[c[i]!] === CORE || kinds[c[i]!] === p.kind);
};
/** Every fit the bay allows, by slot and the cell its box's top left sits on. */
export function legalFits(w: number, h: number, kinds: readonly number[], tray: readonly number[]): { slot: number; at: Cell }[] {
  return tray.flatMap((shape, slot) => {
    const print = POOL[shape]!;
    const out: { slot: number; at: Cell }[] = [];
    for (let y = 0; y + print.height <= h; y++) for (let x = 0; x + print.width <= w; x++) if (fits(w, h, kinds, print, { x, y })) out.push({ slot, at: { x, y } });
    return out;
  });
}
/** Every legal swap, each pair once, the lower cell first. */
export function legalSwaps(w: number, h: number, kinds: readonly number[]): { a: Cell; b: Cell }[] {
  const out: { a: Cell; b: Cell }[] = [];
  for (let i = 0; i < w * h; i++) {
    const a = { x: i % w, y: Math.floor(i / w) };
    for (const [dc, dr] of [[1, -1], [1, 0], [1, 1], [0, 1]] as const) {
      const b = { x: a.x + dc, y: a.y + dr };
      if (b.x >= 0 && b.x < w && b.y >= 0 && b.y < h && swapBlock(w, kinds, a, b) === null) out.push(b.y * w + b.x > i ? { a, b } : { a: b, b: a });
    }
  }
  return out.sort((p, q) => p.a.y * w + p.a.x - (q.a.y * w + q.a.x) || p.b.y * w + p.b.x - (q.b.y * w + q.b.x));
}
const swapped = (kinds: readonly number[], a: number, b: number): number[] => {
  const out = kinds.slice();
  [out[a], out[b]] = [kinds[b]!, kinds[a]!];
  return out;
};

/** A part by the kind weights. */
const weighted = (ctx: Ctx<Yard>): number => {
  const weights = ctx.settings.kindWeights as readonly number[];
  let left = ctx.draw("parts").even(weights.reduce((a, b) => a + b, 0));
  for (let k = 0; k < weights.length; k++) if ((left -= weights[k]!) < 0) return k;
  return weights.length - 1;
};
/** The next blueprint from the bag; an empty bag is filled with the whole pool, shuffled. */
function nextPrint(ctx: Ctx<Yard>, bagIn: readonly number[]): { shape: number; bag: number[] } {
  let bag = bagIn.slice();
  if (bag.length === 0) {
    bag = POOL.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = ctx.draw("prints").even(i + 1);
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
  }
  return { shape: bag[0]!, bag: bag.slice(1) };
}

/**
 * The yard. The opening bay is dealt again until it holds a fit now or after one swap, so a new player can score in
 * their first seconds; after enough tries the first blueprint is laid into its top left.
 */
const yard = part<Move, Yard>({
  name: "yard",
  rule: "swap two parts where either moves the way they lie; fit a blueprint over the parts it asks for",
  pieces: PARTS.map((id) => ({ id })),
  moves: [
    { id: "swap", description: "swap the parts at two neighbouring places", gesture: "drag", fields: { a: "place", b: "place" } },
    { id: "fit", description: "fit the blueprint in a slot of the tray with the top left of its box at a place", gesture: "drag", fields: { slot: "number", at: "place" } },
  ],
  events: [
    { id: "deal", description: "the bay was dealt", fields: { count: "number" }, changes: ["arrive"] },
    { id: "print", description: "a blueprint came into a slot of the tray", fields: { slot: "number", shape: "number" } },
    { id: "swap", description: "two parts swapped", fields: { a: "place", b: "place" }, changes: ["travel"] },
    { id: "fit", description: "a blueprint took the parts under it", fields: { at: "place", slot: "number", parts: "number", size: "number", cores: "number", points: "points" }, changes: ["leave"] },
    { id: "refill", description: "a new part came into each cell a fit took", fields: { count: "number" }, changes: ["arrive"] },
  ],
  draws: [
    { id: "parts", description: "the part dealt to each cell, by the kind weights", gives: "piece", by: "weighted", when: "refill", reads: ["kindWeights"] },
    { id: "cores", description: "where the opening cores sit, and whether a new part is a core", gives: "piece", by: "even", when: "refill", reads: ["startCores", "corePermille", "maxCores"] },
    { id: "prints", description: "the order the pool is dealt in, a bag at a time", gives: "number", by: "bag", when: "refill", reads: ["traySize"] },
  ],
  stats: [{ id: "swaps", description: "swaps" }, { id: "fits", description: "fits" }, { id: "bigFits", description: "fits of five parts" }, { id: "coresUsed", description: "cores taken in fits" }],
  texts: ["reason.not_neighbours", "reason.core", "reason.same_part", "reason.wrong_way", "reason.no_blueprint", "reason.hangs_off", "reason.no_match"],
  hooks: {
    onStart(ctx) {
      const { width: w, height: h } = ctx.board;
      const n = numbers(ctx);
      let bag: readonly number[] = [];
      const tray: number[] = [];
      for (let s = 0; s < n.traySize!; s++) {
        const d = nextPrint(ctx, bag);
        [bag, tray[s]] = [d.bag, d.shape];
      }
      const cores = new Set<number>();
      while (cores.size < n.startCores!) cores.add(ctx.draw("cores").even(w * h));
      let kinds: number[] = [];
      let found = false;
      for (let attempt = 0; attempt < MAX_DEALS && !found; attempt++) {
        kinds = Array.from({ length: w * h }, (_, c) => (cores.has(c) ? CORE : weighted(ctx)));
        found = legalFits(w, h, kinds, tray).length > 0 || legalSwaps(w, h, kinds).some((s) => legalFits(w, h, swapped(kinds, index(ctx.board, s.a), index(ctx.board, s.b)), tray).length > 0);
      }
      if (!found) for (const p of POOL[tray[0]!]!.parts) if (kinds[p.dr * w + p.dc] !== CORE) kinds[p.dr * w + p.dc] = p.kind;
      ctx.emit("deal", { count: w * h }, (e) => kinds.forEach((k, i) => e.arrive(cell(ctx.board, i), { piece: PARTS[k]! })));
      tray.forEach((shape, slot) => ctx.emit("print", { slot, shape }));
      return { tray, bag };
    },
    canMove: {
      swap: (view, move: SwapMove) => swapBlock(view.board.width, kindsOf(view.board), move.a, move.b),
      fit(view, move: FitMove) {
        const print = Number.isInteger(move.slot) ? POOL[view.state.tray[move.slot] ?? -1] : undefined;
        if (!print) return "reason.no_blueprint";
        const { width: w, height: h } = view.board;
        if (!cover(w, h, print, move.at)) return "reason.hangs_off";
        return fits(w, h, kindsOf(view.board), print, move.at) ? null : "reason.no_match";
      },
    },
    onMove: {
      swap(ctx, _seat, move: SwapMove) {
        ctx.emit("swap", { a: move.a, b: move.b }, (e) => e.travel(move.a, move.b).travel(move.b, move.a).set("swaps", ctx.value("swaps") + 1));
      },
      fit(ctx, _seat, move: FitMove) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        const kinds = kindsOf(board);
        const took = cover(board.width, board.height, POOL[state.tray[move.slot]!]!, move.at)!;
        const cores = took.filter((c) => kinds[c] === CORE).length;
        ctx.emit("fit", { at: move.at, slot: move.slot, parts: took.length, size: Math.max(0, took.length - 2), cores }, (e) => {
          took.forEach((c) => e.leave(cell(board, c)));
          e.set("fits", ctx.value("fits") + 1).set("coresUsed", ctx.value("coresUsed") + cores);
          if (took.length >= 5) e.set("bigFits", ctx.value("bigFits") + 1);
        });
        // The bay refills in place, in reading order: a core by its chance while fewer than the most stand, else a part.
        let standing = kinds.filter((k, c) => k === CORE && !took.includes(c)).length;
        const fresh = [...took].sort((a, b) => a - b).map((c) => {
          const core = standing < n.maxCores! && n.corePermille! > 0 && ctx.draw("cores").chance(n.corePermille!);
          if (core) standing++;
          return { c, kind: core ? CORE : weighted(ctx) };
        });
        ctx.emit("refill", { count: fresh.length }, (e) => fresh.forEach((f) => e.arrive(cell(board, f.c), { piece: PARTS[f.kind]! })));
        const d = nextPrint(ctx, state.bag);
        const tray = state.tray.slice();
        tray[move.slot] = d.shape;
        ctx.emit("print", { slot: move.slot, shape: d.shape });
        return { tray, bag: d.bag };
      },
    },
    listMoves(view) {
      const { width: w, height: h } = view.board;
      const kinds = kindsOf(view.board);
      return [...legalFits(w, h, kinds, view.state.tray).map((f) => ({ move: "fit", ...f })), ...legalSwaps(w, h, kinds).map((s) => ({ move: "swap", ...s }))];
    },
  },
});

export default puzzle("assembly", {
  board: grid("width", "height"),
  parts: [yard],
  ends: budget("maxMoves"),
  settings: {
    width: 6,
    height: 6,
    maxMoves: 1000,
    kindWeights: { default: [22, 26, 26, 26], min: 0, max: 100, description: "how often each part is dealt: panel, girder, strut, cable" },
    traySize: { default: 6, min: 1, max: 8, description: "blueprints in the tray" },
    fitPoints: { default: 10, min: 0, max: 1000, description: "points for each part of a fit past the second" },
    corePoints: { default: 10, min: 0, max: 1000, description: "points for each core in a fit" },
    chainPercent: { default: [100, 200, 300, 400, 500, 600], min: 100, max: 2000, description: "what a fit multiplies by, an entry for each place in the chain; the last holds" },
    startCores: { default: 2, min: 0, max: 10, description: "cores in the opening bay" },
    corePermille: { default: 30, min: 0, max: 500, description: "chance in a thousand that a new part is a core, while fewer than the most stand" },
    maxCores: { default: 3, min: 0, max: 10, description: "the most cores in the bay at once" },
  },
  // A fit of n parts pays for each past the second and for each core, times its place in the chain.
  payouts: {
    fit: { on: "fit", counts: "size", reads: "fitPoints" },
    cores: { on: "fit", counts: "cores", reads: "corePoints" },
  },
  multipliers: { chain: { scales: ["fit", "cores"], by: "chainPercent", index: "streak" } },
  // Fits with no swap between.
  streak: { builds: "fit", counts: "events", breaksOn: ["swap"] },
});
