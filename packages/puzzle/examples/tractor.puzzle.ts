// Tractor, a prototype puzzle, written on rungs 2 and 3: loot adrift, pulled up toward a hatch at the top edge by a
// tractor beam. The verb is a swap with the piece below. A run of three or more of a kind is beamed aboard, the gaps
// close upward and new loot drifts in at the bottom; what rises may make new runs, a wave at a time. A cache is a sealed
// crate that rises with the loot and is hauled when it reaches the top row. A beacon is loot with a mark: in a run it
// fires along its row and column, or its diagonals, sweeping everything on them aboard. What a run, a sweep and the
// caches of one swap pay, and what each wave multiplies by, are payouts and multipliers. One part of its own holds how
// the field rises and refills, the beacons and the caches.
//
// The tests play it beside the engine the studio deals, swap for swap, and hold the two to the same field and score.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Ctx, type NewPiece, type View } from "../src/index.js";

export type SwapMove = { readonly move: "swap"; readonly at: Cell };
/** Scoring swaps so far, caches hauled in the swap being played, and its waves. */
export interface Hold { readonly clears: number; readonly hauled: number; readonly waves: number }

/** A piece of the field as the rules read it: loot of a kind, perhaps a beacon with its mark, or a cache. */
type Slot = { readonly kind: number; readonly mark?: "cross" | "saltire" } | { readonly cache: true } | null;
const MIN_RUN = 3;
const MAX_WAVES = 24;
const MAX_SETTLES = 12;
const MAX_DEALS = 60;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
const loot = (s: Slot | undefined): s is { kind: number; mark?: "cross" | "saltire" } => !!s && "kind" in s;
const pieceOf = (s: Slot): NewPiece => (!s ? { piece: "loot" } : "cache" in s ? { piece: "cache" } : s.mark ? { piece: "beacon", kind: s.kind, state: s.mark } : { piece: "loot", kind: s.kind });
function fieldOf(board: Board): Slot[] {
  return board.places().map((p) => {
    const q = board.at(p);
    if (!q) return null;
    if (q.piece === "cache") return { cache: true };
    return q.piece === "beacon" ? { kind: q.kind!, mark: q.state as "cross" | "saltire" } : { kind: q.kind! };
  });
}

/** Every run of three or more on the field: rows first, top to bottom, then columns, left to right. */
function findRuns(w: number, h: number, f: readonly Slot[]): { cells: number[]; kind: number }[] {
  const runs: { cells: number[]; kind: number }[] = [];
  const scan = (line: number[]): void => {
    let start = 0;
    for (let i = 1; i <= line.length; i++) {
      const [a, b] = [f[line[start]!], i < line.length ? f[line[i]!] : null];
      if (i < line.length && loot(a) && loot(b) && a.kind === b.kind) continue;
      if (i - start >= MIN_RUN && loot(a)) runs.push({ cells: line.slice(start, i), kind: a.kind });
      start = i;
    }
  };
  for (let r = 0; r < h; r++) scan(Array.from({ length: w }, (_, c) => r * w + c));
  for (let c = 0; c < w; c++) scan(Array.from({ length: h }, (_, r) => r * w + c));
  return runs;
}
const runThrough = (w: number, h: number, f: readonly Slot[], i: number, dc: number, dr: number): number => {
  const p = f[i];
  if (!loot(p)) return 0;
  let n = 1;
  for (const s of [1, -1]) for (let [c, r] = [(i % w) + dc * s, Math.floor(i / w) + dr * s]; c >= 0 && c < w && r >= 0 && r < h; c += dc * s, r += dr * s) {
    const q = f[r * w + c];
    if (!loot(q) || q.kind !== p.kind) break;
    n++;
  }
  return n;
};
const runAt = (w: number, h: number, f: readonly Slot[], i: number): boolean => runThrough(w, h, f, i, 1, 0) >= MIN_RUN || runThrough(w, h, f, i, 0, 1) >= MIN_RUN;
const swapped = (f: readonly Slot[], a: number, b: number): Slot[] => f.map((s, i) => (i === a ? f[b]! : i === b ? f[a]! : s));
/** True when some swap with the piece below makes a run. */
function hasSwap(w: number, h: number, f: readonly Slot[]): boolean {
  for (let i = 0; i < w * (h - 1); i++) {
    const [a, b] = [f[i], f[i + w]];
    if (!loot(a) || !loot(b) || a.kind === b.kind) continue;
    const after = swapped(f, i, i + w);
    if (runAt(w, h, after, i) || runAt(w, h, after, i + w)) return true;
  }
  return false;
}
/** The cells a beacon fires along, nearest first, round the directions in turn. */
function markCells(w: number, h: number, i: number, mark: "cross" | "saltire"): number[] {
  const dirs = mark === "cross" ? [[0, -1], [1, 0], [0, 1], [-1, 0]] : [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  const out: number[] = [];
  for (let d = 1; d < Math.max(w, h); d++)
    for (const [dc, dr] of dirs) {
      const [c, r] = [(i % w) + dc! * d, Math.floor(i / w) + dr! * d];
      if (c >= 0 && c < w && r >= 0 && r < h) out.push(r * w + c);
    }
  return out;
}

/** A kind for a cell that makes no run with what is already left of it and above it. */
function calm(ctx: Ctx<Hold>, f: readonly Slot[], i: number): number {
  const w = ctx.board.width;
  const banned = new Set<number>();
  const same = (a: number, b: number): void => void (loot(f[a]) && loot(f[b]) && f[a]!.kind === f[b]!.kind && banned.add(f[a]!.kind));
  if (i % w >= 2) same(i - 1, i - 2);
  if (Math.floor(i / w) >= 2) same(i - w, i - 2 * w);
  const allowed = Array.from({ length: numbers(ctx).kinds! }, (_, k) => k + 1).filter((k) => !banned.has(k));
  return allowed[ctx.draw("field").even(allowed.length)]!;
}
/** A kind for a cell that completes no run with the pieces round it. */
function unmatched(ctx: Ctx<Hold>, f: readonly Slot[], i: number): number {
  const { width: w, height: h } = ctx.board;
  const kinds = Array.from({ length: numbers(ctx).kinds! }, (_, k) => k + 1);
  let allowed = kinds.filter((k) => !runAt(w, h, f.map((s, j) => (j === i ? { kind: k } : s)), i));
  if (allowed.length === 0) allowed = kinds;
  return allowed[ctx.draw("field").even(allowed.length)]!;
}
/** Loot into every cell that holds no cache or beacon, with no run standing and a swap to make. */
function dealLoot(ctx: Ctx<Hold>, f: Slot[]): Slot[] {
  const { width: w, height: h } = ctx.board;
  const keep = f.map((s) => !!s && ("cache" in s || !!s.mark));
  for (let attempt = 0; attempt < MAX_DEALS; attempt++) {
    for (let i = 0; i < f.length; i++) if (!keep[i]) f[i] = null;
    for (let i = 0; i < f.length; i++) if (!keep[i]) f[i] = { kind: calm(ctx, f, i) };
    if (findRuns(w, h, f).length === 0 && hasSwap(w, h, f)) break;
  }
  return f;
}

/**
 * Everything rises into the gaps over it, then each column fills from the bottom: a cache now and then while too few
 * are out, else loot that completes no run. With `beacon`, one piece of the new loot drifts in as a beacon.
 */
function settle(ctx: Ctx<Hold>, beacon: boolean): void {
  const { board } = ctx;
  const { width: w, height: h } = board;
  const n = numbers(ctx);
  const f = fieldOf(board);
  const rises: [number, number][] = [];
  const filled: number[] = [];
  const next: Slot[] = new Array(f.length).fill(null);
  for (let col = 0; col < w; col++) {
    let row = 0;
    for (let r = 0; r < h; r++) {
      if (!f[r * w + col]) continue;
      next[row * w + col] = f[r * w + col]!;
      if (r !== row) rises.push([r * w + col, row * w + col]);
      row++;
    }
    filled.push(row);
  }
  if (rises.length > 0) ctx.emit("rise", { count: rises.length }, (e) => rises.forEach(([a, b]) => e.travel(cell(board, a), cell(board, b))));
  let caches = next.filter((s) => s && "cache" in s).length;
  const fresh: number[] = [];
  for (let col = 0; col < w; col++)
    for (let r = filled[col]!; r < h; r++) {
      const i = r * w + col;
      if (caches < n.maxCaches! && ctx.draw("field").chance(n.cachePermille!)) (next[i] = { cache: true }), caches++;
      else next[i] = { kind: unmatched(ctx, next, i) };
      fresh.push(i);
    }
  if (beacon) {
    const lootIn = fresh.filter((i) => loot(next[i]));
    if (lootIn.length > 0) {
      const i = lootIn[ctx.draw("field").even(lootIn.length)]!;
      next[i] = { kind: (next[i] as { kind: number }).kind, mark: ctx.draw("field").even(2) === 0 ? "cross" : "saltire" };
    }
  }
  if (fresh.length > 0) ctx.emit("drift", { count: fresh.length }, (e) => fresh.forEach((i) => e.arrive(cell(board, i), pieceOf(next[i]!), "below")));
}

/**
 * The hold. A swap trades a piece with the one under it. Each wave beams its runs aboard, fires the beacons in them and
 * sweeps their lines, then the field rises and refills, and caches that reach the top are hauled and it rises again.
 * Every cache of one swap is paid together when it ends; a field with no swap left is dealt again in place.
 */
const hold = part<SwapMove, Hold>({
  name: "hold",
  rule: "swap a piece with the one below; runs of three are beamed aboard and the field rises, a beacon sweeps its lines, and a cache is hauled at the top",
  pieces: [{ id: "loot" }, { id: "beacon", states: ["cross", "saltire"] }, { id: "cache" }],
  moves: [{ id: "swap", description: "swap the piece at a place with the piece under it", gesture: "drag", fields: { at: "place" } }],
  events: [
    { id: "field", description: "the field was dealt, or dealt again in place when no swap was left", fields: { count: "number" }, changes: ["arrive", "leave"] },
    { id: "swap", description: "two pieces traded places", fields: { at: "place" }, changes: ["travel"] },
    { id: "scoring", description: "the swap made a run", fields: {} },
    { id: "run", description: "a run of one kind was beamed aboard", fields: { cells: "places", kind: "number", length: "number", points: "points" }, step: true },
    { id: "sweep", description: "beacons swept loot aboard along their marks", fields: { count: "number", points: "points" }, step: true },
    { id: "fire", description: "a beacon in a run fired along its mark", fields: { at: "place" } },
    { id: "beam", description: "everything the wave took left the field", fields: { cells: "places" }, changes: ["leave"] },
    { id: "rise", description: "pieces rose into the gaps over them", fields: { count: "number" }, changes: ["travel"] },
    { id: "drift", description: "new loot drifted in at the bottom", fields: { count: "number" }, changes: ["arrive"] },
    { id: "top", description: "caches that reached the top row were hauled", fields: { count: "number" }, changes: ["leave"] },
    { id: "haul", description: "the caches one swap hauled were paid together", fields: { caches: "number", points: "points" } },
  ],
  draws: [{ id: "field", description: "the caches the field opens with, each piece of loot dealt or drifting in, the caches that drift in and each beacon", gives: "piece", by: "even", when: "refill", reads: ["kinds", "cachePermille", "maxCaches"] }],
  stats: [{ id: "clears", description: "swaps that made a run" }, { id: "cleared", description: "loot beamed aboard" }, { id: "caches", description: "caches hauled" }, { id: "fired", description: "beacons fired" }],
  texts: ["reason.no_below", "reason.cache"],
  hooks: {
    onStart(ctx) {
      const { board } = ctx;
      const { width: w, height: h } = board;
      const f: Slot[] = new Array(w * h).fill(null);
      // Caches open in the lower half, a column each, so each has loot over it to be cleared.
      const cols = Array.from({ length: w }, (_, c) => c);
      const top = Math.ceil(h / 2);
      for (let k = 0; k < numbers(ctx).startCaches! && cols.length > 0; k++) {
        const col = cols.splice(ctx.draw("field").even(cols.length), 1)[0]!;
        f[(top + ctx.draw("field").even(h - top)) * w + col] = { cache: true };
      }
      dealLoot(ctx, f);
      ctx.emit("field", { count: f.length }, (e) => f.forEach((s, i) => e.arrive(cell(board, i), pieceOf(s))));
      return { clears: 0, hauled: 0, waves: 0 };
    },
    canMove: {
      swap(view, move: SwapMove) {
        if (move.at.y >= view.board.height - 1) return "reason.no_below";
        const [a, b] = [view.board.at(move.at), view.board.at({ x: move.at.x, y: move.at.y + 1 })];
        return a?.piece === "cache" || b?.piece === "cache" ? "reason.cache" : null;
      },
    },
    onMove: {
      swap(ctx, _seat, move: SwapMove) {
        const { board } = ctx;
        const below = { x: move.at.x, y: move.at.y + 1 };
        ctx.emit("swap", { at: move.at }, (e) => e.travel(move.at, below).travel(below, move.at));
        const scoring = findRuns(board.width, board.height, fieldOf(board)).length > 0;
        if (scoring) ctx.emit("scoring", {}, (e) => e.set("clears", ctx.value("clears") + 1));
        return { clears: ctx.state.clears + (scoring ? 1 : 0), hauled: 0, waves: 0 };
      },
    },
    // One wave a step: its runs and sweeps are paid at the step's entry, then the field settles.
    onCascade(ctx) {
      const { board, state } = ctx;
      const { width: w, height: h } = board;
      const n = numbers(ctx);
      if (state.waves >= MAX_WAVES) return;
      const f = fieldOf(board);
      const runs = findRuns(w, h, f);
      if (runs.length === 0) return;
      const inRun: number[] = [];
      for (const r of runs) for (const c of r.cells) if (!inRun.includes(c)) inRun.push(c);
      const queue = inRun.filter((c) => loot(f[c]) && (f[c] as { mark?: string }).mark).sort((a, b) => a - b);
      const firing = new Set(queue);
      const gone = new Set(inRun);
      const swept: number[] = [];
      const caches: number[] = [];
      for (let q = 0; q < queue.length; q++) {
        const at = queue[q]!;
        ctx.emit("fire", { at: cell(board, at) }, (e) => e.set("fired", ctx.value("fired") + 1));
        for (const c of markCells(w, h, at, (f[at] as { mark: "cross" | "saltire" }).mark)) {
          if (!f[c] || gone.has(c)) continue;
          gone.add(c);
          if ("cache" in f[c]!) caches.push(c);
          else {
            swept.push(c);
            if ((f[c] as { mark?: string }).mark && !firing.has(c)) firing.add(c), queue.push(c);
          }
        }
      }
      for (const r of runs) ctx.emit("run", { cells: r.cells.map((c) => cell(board, c)), kind: r.kind, length: r.cells.length });
      if (swept.length > 0) ctx.emit("sweep", { count: swept.length });
      const taken = [...inRun, ...swept, ...caches];
      ctx.emit("beam", { cells: taken.map((c) => cell(board, c)) }, (e) => {
        for (const c of taken) e.leave(cell(board, c));
        e.set("cleared", ctx.value("cleared") + inRun.length + swept.length);
        if (caches.length > 0) e.set("caches", ctx.value("caches") + caches.length);
      });
      // A beacon drifts in with the first new loot after every so many scoring swaps.
      const beaconDue = state.waves === 0 && n.beaconEvery! > 0 && state.clears % n.beaconEvery! === 0;
      let hauled = state.hauled + caches.length;
      for (let s = 0; s < MAX_SETTLES; s++) {
        settle(ctx, beaconDue && s === 0);
        const topped = Array.from({ length: w }, (_, c) => c).filter((c) => ctx.board.at({ x: c, y: 0 })?.piece === "cache");
        if (topped.length === 0) break;
        hauled += topped.length;
        ctx.emit("top", { count: topped.length }, (e) => {
          for (const c of topped) e.leave({ x: c, y: 0 });
          e.set("caches", ctx.value("caches") + topped.length);
        });
      }
      return { ...state, hauled, waves: state.waves + 1 };
    },
    onMoveEnd(ctx) {
      const { board, state } = ctx;
      if (state.hauled > 0) ctx.emit("haul", { caches: state.hauled });
      const f = fieldOf(board);
      if (!hasSwap(board.width, board.height, f)) {
        const before = f.slice();
        dealLoot(ctx, f);
        const changed = f.flatMap((s, i) => (s !== before[i] ? [i] : []));
        ctx.emit("field", { count: changed.length }, (e) => {
          for (const i of changed) e.leave(cell(board, i));
          for (const i of changed) e.arrive(cell(board, i), pieceOf(f[i]!));
        });
      }
    },
    listMoves: (view) =>
      view.board.places().filter((p) => p.y < view.board.height - 1 && view.board.at(p)?.piece !== "cache" && view.board.at({ x: p.x, y: p.y + 1 })?.piece !== "cache").map((at) => ({ move: "swap", at })),
  },
});

export default puzzle("tractor", {
  board: grid("width", "height"),
  parts: [hold],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 6,
    height: 9,
    roundSeconds: 120,
    maxMoves: 800,
    kinds: { default: 5, min: 3, max: 8, description: "kinds of loot" },
    startCaches: { default: 1, min: 0, max: 10, description: "caches on the opening field" },
    cachePermille: { default: 25, min: 0, max: 500, description: "chance in a thousand that a piece drifting in is a cache, while too few are out" },
    maxCaches: { default: 3, min: 0, max: 10, description: "the most caches out at once" },
    beaconEvery: { default: 5, min: 0, max: 1000, description: "scoring swaps between one beacon and the next; 0 deals none" },
    runPoints: { default: 5, min: 0, max: 1000, description: "points for a run of n, times n squared" },
    sweepPoints: { default: 10, min: 0, max: 10_000, description: "points for each piece of loot a beacon sweeps, outside any run" },
    cachePoints: { default: 150, min: 0, max: 100_000, description: "points for the caches of one swap, times their count squared" },
    cascadePercent: { default: [100, 150, 200], min: 100, max: 1000, description: "what each wave of a swap multiplies by, an entry for each" },
  },
  // A run of n pays n × n, a sweep each piece, and k caches of one swap k × k. Each wave multiplies its runs and sweeps.
  payouts: {
    run: { on: "run", counts: "length", growth: "superlinear", reads: "runPoints" },
    sweep: { on: "sweep", counts: "count", reads: "sweepPoints" },
    haul: { on: "haul", counts: "caches", growth: "superlinear", reads: "cachePoints" },
  },
  multipliers: { cascade: { scales: ["run", "sweep"], by: "cascadePercent", index: "step" } },
});
