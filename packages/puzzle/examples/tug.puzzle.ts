// Tug, a prototype puzzle, written on rungs 2 and 3: a cargo bay in zero gravity, a few fixed blocks, a few pods,
// and a flick as the verb. A flicked pod slides until a wall, a block or another pod stops it. One clamp is lit for
// one pod; bring that pod to rest on it and it is delivered. Every clamp is dealt with a par, the fewest flicks that
// can deliver it, found by searching every bay those flicks reach. What a delivery is worth by its par, what
// delivering at par multiplies it by and the streak of clean deliveries are payouts and multipliers. One part of its
// own holds the bay, the clamp and the search.
//
// The tests play it beside the engine the studio deals, flick for flick, and hold the two to the same bay, clamp,
// score and streak.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type FlickMove = { readonly move: "flick"; readonly pod: number; readonly dir: number };
export type SkipMove = { readonly move: "skip" };
type Move = FlickMove | SkipMove;

/** The lit clamp: the pod it wants, its cell (row by row from the top), and the fewest flicks that could deliver it when it lit. */
export interface Clamp { readonly pod: number; readonly cell: number; readonly par: number }
/** The fixed blocks, each pod's cell (entry n is pod n), the clamp, the flicks since it lit, and the level that sets the next par. */
export interface Bay { readonly blocks: readonly number[]; readonly pods: readonly number[]; readonly clamp: Clamp; readonly flicks: number; readonly level: number }

/** A flick's step by direction: up, right, down, left. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });

/** Where a pod at `from` comes to rest when flicked: the last free cell before a wall, a block or a pod. */
function glide(w: number, h: number, solid: Uint8Array, from: number, dir: number): number {
  let [x, y] = [from % w, Math.floor(from / w)];
  for (;;) {
    const [nx, ny] = [x + DX[dir]!, y + DY[dir]!];
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || solid[ny * w + nx] === 1) break;
    [x, y] = [nx, ny];
  }
  return y * w + x;
}
const solidOf = (board: Board, bay: Pick<Bay, "blocks" | "pods">): Uint8Array => {
  const solid = new Uint8Array(board.width * board.height);
  for (const c of [...bay.blocks, ...bay.pods]) solid[c] = 1;
  return solid;
};
/** Where a flick ends and what stopped it. */
export function slide(board: Board, bay: Bay, pod: number, dir: number): { to: number; stop: "wall" | "block" | "pod" } {
  const { width: w, height: h } = board;
  const to = glide(w, h, solidOf(board, bay), bay.pods[pod]!, dir);
  const [bx, by] = [(to % w) + DX[dir]!, Math.floor(to / w) + DY[dir]!];
  if (bx < 0 || bx >= w || by < 0 || by >= h) return { to, stop: "wall" };
  return { to, stop: bay.blocks.includes(by * w + bx) ? "block" : "pod" };
}

/**
 * For every pod and cell, the fewest flicks after which that pod can rest there, searching every bay up to `depth`
 * flicks away: -1 where it takes more. Breadth first, pods in order and directions in order. Index = pod * cells + cell.
 */
function reach(board: Board, blocks: readonly number[], start: readonly number[], depth: number): Int8Array {
  const { width: w, height: h } = board;
  const cells = w * h;
  const best = new Int8Array(start.length * cells).fill(-1);
  start.forEach((c, p) => (best[p * cells + c] = 0));
  const seen = new Set<string>([start.join(",")]);
  let frontier: number[][] = [start.slice()];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: number[][] = [];
    for (const s of frontier) {
      const solid = solidOf(board, { blocks, pods: s });
      for (let p = 0; p < s.length; p++)
        for (let dir = 0; dir < 4; dir++) {
          const to = glide(w, h, solid, s[p]!, dir);
          if (to === s[p]) continue;
          if (best[p * cells + to]! < 0) best[p * cells + to] = d;
          if (d === depth) continue;
          const s2 = s.slice();
          s2[p] = to;
          const key = s2.join(",");
          if (!seen.has(key)) seen.add(key), next.push(s2);
        }
    }
    frontier = next;
  }
  return best;
}

/** The par the next clamp is dealt at, at a level. */
const parAt = (n: Record<string, number>, level: number): number => Math.min(n.maxPar!, n.startPar! + Math.floor(level / n.cleanPerStep!));
/** The highest the level goes: where clamps are dealt at the most par. */
const levelCap = (n: Record<string, number>): number => (n.maxPar! - n.startPar!) * n.cleanPerStep!;

/**
 * Light a clamp: a pod and a cell it can be brought to rest on in exactly `want` flicks and no fewer, each such pair
 * alike. An empty cell is preferred; when no pair needs that many, the nearest lower par is dealt. A clamp just
 * skipped is never dealt again at once.
 */
function dealClamp(ctx: Ctx<Bay>, blocks: readonly number[], pods: readonly number[], want: number, avoid: Clamp | null): Clamp {
  const cells = ctx.board.width * ctx.board.height;
  const best = reach(ctx.board, blocks, pods, want);
  for (const emptyOnly of [true, false])
    for (let par = want; par >= 1; par--) {
      const options: number[] = [];
      for (let p = 0; p < pods.length; p++)
        for (let c = 0; c < cells; c++) {
          if (best[p * cells + c] !== par || (emptyOnly && pods.includes(c)) || (avoid && avoid.pod === p && avoid.cell === c)) continue;
          options.push(p * cells + c);
        }
      if (options.length === 0) continue;
      const chosen = options[ctx.draw("bay").even(options.length)]!;
      return { pod: Math.floor(chosen / cells), cell: chosen % cells, par };
    }
  // No pod can move at all: no config the puzzle accepts deals such a bay.
  return { pod: 0, cell: [...Array(cells).keys()].find((c) => !blocks.includes(c) && !pods.includes(c)) ?? 0, par: want };
}

/** Moves the lit clamp on the board to a new one. */
function relight(ctx: Ctx<Bay>, from: Clamp | null, to: Clamp): void {
  ctx.emit("clamp", { at: cell(ctx.board, to.cell), pod: to.pod, par: to.par }, (e) => {
    if (from) e.change(cell(ctx.board, from.cell), { terrain: "plain" });
    e.change(cell(ctx.board, to.cell), { terrain: "clamp", state: `pod_${to.pod + 1}` });
  });
}

/**
 * The bay. Blocks are placed off the walls, none touching another, corners included, so no cell is walled in: the
 * layout is tried afresh a few times and the fullest kept. Pods float on free cells. A flick slides a pod until
 * something stops it; resting the wanted pod on the clamp delivers it, graded against par, and lights another.
 */
const bay = part<Move, Bay>({
  name: "bay",
  rule: "flick a pod and it slides until something stops it; rest the wanted pod on the lit clamp to deliver it, against the par of flicks it could take",
  terrain: [{ id: "block" }, { id: "clamp", states: ["pod_1", "pod_2", "pod_3", "pod_4", "pod_5"] }],
  pieces: [{ id: "pod" }],
  moves: [
    { id: "flick", description: "flick a pod up, right, down or left (0 to 3); it slides until a wall, a block or a pod stops it", gesture: "swipe", fields: { pod: "number", dir: "number" } },
    { id: "skip", description: "give up on the lit clamp, for a penalty and the streak", gesture: "tap", fields: {} },
  ],
  events: [
    { id: "bay", description: "the bay was laid out: its blocks and its pods", fields: { blocks: "places", pods: "places" }, changes: ["arrive", "change"] },
    { id: "clamp", description: "a clamp lit for a pod, with the par it was dealt at", fields: { at: "place", pod: "number", par: "number" }, changes: ["change"] },
    { id: "slide", description: "a flicked pod slid until something stopped it", fields: { from: "place", to: "place", pod: "number" }, changes: ["travel"] },
    { id: "clean", description: "the wanted pod was delivered at par", fields: { at: "place", pod: "number", par: "number", flicks: "number", points: "points" } },
    { id: "late", description: "the wanted pod was delivered over par: within the slack, or slower", fields: { at: "place", pod: "number", par: "number", flicks: "number", slow: "flag", points: "points" } },
    { id: "skip", description: "the lit clamp was given up", fields: { at: "place", lost: "number", points: "points" } },
  ],
  draws: [{ id: "bay", description: "where each block and pod is placed, and which pod and cell each clamp lights for", gives: "place", by: "even", when: "start", reads: ["blocks", "pods"] }],
  stats: [{ id: "delivered", description: "pods delivered" }, { id: "clean", description: "pods delivered at par" }, { id: "skipped", description: "clamps given up" }],
  texts: ["reason.no_pod", "reason.no_way"],
  hooks: {
    onStart(ctx) {
      const { board } = ctx;
      const n = numbers(ctx);
      const draw = ctx.draw("bay");
      const inside = board.width >= 5 && board.height >= 5;
      const all = board.places().filter((p) => !inside || (p.x > 0 && p.y > 0 && p.x < board.width - 1 && p.y < board.height - 1)).map((p) => p.y * board.width + p.x);
      let blocks: number[] = [];
      for (let attempt = 0; attempt < 12 && blocks.length < n.blocks!; attempt++) {
        let free = all.slice();
        const laid: number[] = [];
        while (laid.length < n.blocks! && free.length > 0) {
          const at = free[draw.even(free.length)]!;
          laid.push(at);
          free = free.filter((f) => Math.abs((f % board.width) - (at % board.width)) > 1 || Math.abs(Math.floor(f / board.width) - Math.floor(at / board.width)) > 1);
        }
        if (laid.length > blocks.length) blocks = laid;
      }
      blocks.sort((a, b) => a - b);
      const free = board.places().map((p) => p.y * board.width + p.x).filter((c) => !blocks.includes(c));
      const pods = Array.from({ length: n.pods! }, () => free.splice(draw.even(free.length), 1)[0]!);
      ctx.emit("bay", { blocks: blocks.map((c) => cell(board, c)), pods: pods.map((c) => cell(board, c)) }, (e) => {
        for (const c of blocks) e.change(cell(board, c), { terrain: "block" });
        pods.forEach((c, p) => e.arrive(cell(board, c), { piece: "pod", kind: p + 1 }));
      });
      const clamp = dealClamp(ctx, blocks, pods, parAt(n, 0), null);
      relight(ctx, null, clamp);
      return { blocks, pods, clamp, flicks: 0, level: 0 };
    },
    canMove: {
      flick(view, move: FlickMove) {
        if (!Number.isInteger(move.pod) || move.pod < 0 || move.pod >= view.state.pods.length) return "reason.no_pod";
        if (![0, 1, 2, 3].includes(move.dir)) return "reason.no_way";
        return slide(view.board, view.state, move.pod, move.dir).to === view.state.pods[move.pod] ? "reason.no_way" : null;
      },
    },
    onMove: {
      flick(ctx, _seat, move: FlickMove) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        const from = state.pods[move.pod]!;
        const { to } = slide(board, state, move.pod, move.dir);
        ctx.emit("slide", { from: cell(board, from), to: cell(board, to), pod: move.pod }, (e) => e.travel(cell(board, from), cell(board, to)));
        const pods = state.pods.map((c, p) => (p === move.pod ? to : c));
        const flicks = state.flicks + 1;
        if (move.pod !== state.clamp.pod || to !== state.clamp.cell) return { ...state, pods, flicks };
        // Delivered: graded against par, and another clamp lights from the bay as it now stands.
        const par = state.clamp.par;
        const fields = { at: cell(board, to), pod: move.pod, par, flicks };
        const counts = (e: { set(id: string, v: number): unknown }, clean: boolean): void => {
          e.set("delivered", ctx.value("delivered") + 1);
          if (clean) e.set("clean", ctx.value("clean") + 1);
        };
        let level = state.level;
        if (flicks <= par) {
          ctx.emit("clean", fields, (e) => counts(e, true));
          level = Math.min(levelCap(n), level + 1);
        } else {
          const slow = flicks > par + n.slack!;
          ctx.emit("late", { ...fields, slow }, (e) => counts(e, false));
          if (slow) level = Math.max(0, level - 1);
        }
        const clamp = dealClamp(ctx, state.blocks, pods, parAt(n, level), null);
        relight(ctx, state.clamp, clamp);
        return { ...state, pods, clamp, flicks: 0, level };
      },
      skip(ctx) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        // The score never goes below zero: a skip takes what there is, up to the penalty.
        const lost = Math.min(ctx.score, -n.skipPoints!);
        ctx.emit("skip", { at: cell(board, state.clamp.cell), lost }, (e) => e.set("skipped", ctx.value("skipped") + 1));
        const level = Math.max(0, state.level - 1);
        const clamp = dealClamp(ctx, state.blocks, state.pods, parAt(n, level), state.clamp);
        relight(ctx, state.clamp, clamp);
        return { ...state, clamp, flicks: 0, level };
      },
    },
    listMoves(view) {
      const moves: Move[] = [];
      view.state.pods.forEach((_, pod) => [0, 1, 2, 3].forEach((dir) => slide(view.board, view.state, pod, dir).to !== view.state.pods[pod] && moves.push({ move: "flick", pod, dir })));
      return moves;
    },
    pointsFor: (event, paid) => (event.event === "skip" ? -(event.fields.lost as number) : paid),
  },
});

export default puzzle("tug", {
  board: grid("width", "height"),
  parts: [bay],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 7,
    height: 7,
    roundSeconds: 120,
    maxMoves: 600,
    pods: { default: 4, min: 2, max: 5, description: "cargo pods in the bay" },
    blocks: { default: 5, min: 0, max: 16, description: "fixed blocks, off the walls and never touching; fewer are placed if they do not fit" },
    startPar: { default: 2, min: 1, max: 4, description: "the par of the first clamp, and the lowest any clamp is dealt at" },
    maxPar: { default: 4, min: 1, max: 4, description: "the highest par a clamp is dealt at: how deep the search that deals it goes" },
    cleanPerStep: { default: 2, min: 1, max: 20, description: "clean deliveries it takes to raise the next par by one; a slow delivery or a skip takes one back" },
    slack: { default: 2, min: 0, max: 20, description: "flicks over par a delivery may take and still score in full" },
    parPoints: { default: [10, 25, 50, 90], min: 0, max: 100_000, description: "what a delivery is worth, an entry for each par from 1" },
    cleanPercent: { default: 200, min: 100, max: 1000, description: "what delivering at par multiplies by" },
    slowPercent: { default: 50, min: 0, max: 100, description: "what a delivery slower than the slack multiplies by" },
    streakPercent: { default: [100, 115, 130, 145, 160, 180, 200], min: 100, max: 1000, description: "what a clean delivery multiplies by, an entry for each in a row" },
    skipPoints: { default: -15, min: -100_000, max: 0, description: "points a skip takes away, never more than the score holds" },
  },
  // A delivery pays by its par. At par it is doubled and the streak multiplies it; slower than the slack, it is halved.
  payouts: {
    clean: { on: "clean", counts: "par", growth: "stepped", reads: "parPoints" },
    late: { on: "late", counts: "par", growth: "stepped", reads: "parPoints" },
    skip: { on: "skip", reads: "skipPoints" },
  },
  multipliers: {
    clean: { scales: "clean", by: "cleanPercent" },
    slow: { scales: "late", on: "late when slow == 1", by: "slowPercent" },
    streak: { scales: "clean", by: "streakPercent", index: "streak" },
  },
  // Clean deliveries in a row. A flick that delivers nothing leaves it; a late delivery or a skip ends it.
  streak: { builds: "clean", counts: "events", breaksOn: ["late", "skip"] },
});
