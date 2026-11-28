// Reactor, a prototype puzzle, written on rungs 2 and 3: a square core of fuel rods worked with one verb. A swipe
// slides every rod as far as it goes; two of one grade that meet fuse into the next. A rod of the top grade is hot:
// it fuses with nothing until a swipe pushes it out through an open port on the rim. Hot rods stacked nose to tail at
// a port leave together, a salvo. What a fusion is worth by its grade, a discharge, the run of discharges and the
// salvo are payouts and multipliers; the salvo is a table read at how many rods left together. One part of its own
// holds the ports, the rod to come and how a lane packs.
//
// The tests play it beside the engine the studio deals, swipe for swipe, and hold the two to the same core, ports,
// score and run.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Ctx, type Piece, type View } from "../src/index.js";

export type SwipeMove = { readonly move: "swipe"; readonly dir: number };
/** A port on the rim: its wall (0 top, 1 right, 2 bottom, 3 left, as a swipe that way) and its lane on that wall. */
export interface Port { readonly side: number; readonly lane: number }
/** The open ports, oldest first, the grade of the rod to come, and the swipes since the last discharge. */
export interface Core { readonly ports: readonly Port[]; readonly next: number; readonly since: number }

const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
/** The cells of a lane in the order a swipe toward `dir` packs them: the cell at that wall first. */
export function laneCells(n: number, dir: number, lane: number): number[] {
  return Array.from({ length: n }, (_, k) => (dir === 0 ? k * n + lane : dir === 1 ? lane * n + (n - 1 - k) : dir === 2 ? (n - 1 - k) * n + lane : lane * n + k));
}
const samePort = (a: Port, b: Port): boolean => a.side === b.side && a.lane === b.lane;
const hot = (view: View, grade: number): boolean => grade >= numbers(view).hotGrade!;
/** Every rim position not taken, side by side, lane by lane. */
const freeRim = (n: number, taken: readonly Port[]): Port[] => [0, 1, 2, 3].flatMap((side) => Array.from({ length: n }, (_, lane) => ({ side, lane }))).filter((p) => !taken.some((t) => samePort(t, p)));

/** What a swipe does before any dice: where each rod goes, the fusions, the rods that leave, and the lanes it changed. */
interface Swept {
  grades: (number | null)[];
  travels: { from: number; to: number }[];
  fused: { from: number; into: number; at: number; grade: number }[];
  out: { from: number; port: Port }[];
  changed: number[];
}
export function sweep(view: View, ports: readonly Port[], dir: number): Swept {
  const { board } = view;
  const n = board.width;
  const at = (c: number): Piece | null => board.at(cell(board, c));
  const grades: (number | null)[] = new Array(n * n).fill(null);
  const s: Swept = { grades, travels: [], fused: [], out: [], changed: [] };
  for (let lane = 0; lane < n; lane++) {
    const line = laneCells(n, dir, lane);
    let queue = line.filter((c) => at(c)).map((c) => ({ c, grade: at(c)!.kind! }));
    let moved = false;
    // Hot rods first in line at a wall with an open port leave, one or several nose to tail.
    if (ports.some((p) => p.side === dir && p.lane === lane)) {
      let gone = 0;
      while (gone < queue.length && hot(view, queue[gone]!.grade)) s.out.push({ from: queue[gone++]!.c, port: { side: dir, lane } });
      if (gone > 0) (queue = queue.slice(gone)), (moved = true);
    }
    let pos = 0;
    for (let i = 0; i < queue.length; i++, pos++) {
      const [a, b] = [queue[i]!, queue[i + 1]];
      const to = line[pos]!;
      if (b && a.grade === b.grade && !hot(view, a.grade)) {
        grades[to] = a.grade + 1;
        s.fused.push({ from: b.c, into: a.c, at: to, grade: a.grade + 1 });
        if (a.c !== to) s.travels.push({ from: a.c, to });
        i++;
        moved = true;
      } else {
        grades[to] = a.grade;
        if (a.c !== to) s.travels.push({ from: a.c, to }), (moved = true);
      }
    }
    if (moved) s.changed.push(lane);
  }
  return s;
}

/** Grade 1 rods on empty cells, each alike: the opening core, and the core after a scram. */
function seedRods(ctx: Ctx<Core>, why: "open" | "scram"): void {
  const { board } = ctx;
  for (let k = 0; k < numbers(ctx).startRods!; k++) {
    const empty = board.places().filter((p) => !board.at(p));
    if (empty.length === 0) break;
    const at = empty[ctx.draw("core").even(empty.length)]!;
    ctx.emit("rod", { at, grade: 1, why: why === "scram" }, (e) => e.arrive(at, { piece: "rod", kind: 1 }));
  }
}
const rollNext = (ctx: Ctx<Core>): number => (ctx.draw("core").chance(numbers(ctx).twoPermille!) ? 2 : 1);

/**
 * The core. A swipe slides every rod; a used port closes and another opens where none was; the next rod enters on the
 * edge the rods slid away from, in a lane that changed. A core where nothing can move, or with too many hot rods, scrams:
 * it is emptied for a penalty and seeded again.
 */
const core = part<SwipeMove, Core>({
  name: "core",
  rule: "swipe and every rod slides; two of one grade fuse into the next, and a hot rod leaves through an open port it is pushed against",
  pieces: [{ id: "rod" }],
  moves: [{ id: "swipe", description: "slide every rod up, right, down or left (0 to 3)", gesture: "swipe", fields: { dir: "number" } }],
  events: [
    { id: "port", description: "a port opened on the rim", fields: { side: "number", lane: "number" } },
    { id: "rod", description: "a rod entered the core", fields: { at: "place", grade: "number", why: "flag" }, changes: ["arrive"] },
    { id: "discharge", description: "a hot rod left through a port", fields: { at: "place", side: "number", lane: "number", out: "number", points: "points" }, changes: ["leave"] },
    { id: "swipe", description: "every rod slid as far as it would go, and rods of one grade that met fused", fields: { dir: "number" }, changes: ["travel", "leave", "change"] },
    { id: "fuse", description: "two rods of one grade fused into one of the next", fields: { at: "place", grade: "number", rank: "number", points: "points" } },
    { id: "salvo", description: "two or more hot rods left in one swipe", fields: { count: "number" } },
    { id: "lapse", description: "the run of discharges lapsed: too many swipes since the last", fields: {} },
    { id: "scram", description: "the core was emptied for a penalty: nothing could move, or too many rods were hot", fields: { critical: "flag", lost: "number", points: "points" }, changes: ["leave"] },
  ],
  draws: [{ id: "core", description: "where each port opens, where each rod enters, and whether the next rod is grade 2", gives: "place", by: "even", when: "refill", reads: ["twoPermille", "startRods"] }],
  stats: [{ id: "discharges", description: "hot rods discharged" }, { id: "salvos", description: "swipes that discharged two or more" }, { id: "fusions", description: "fusions" }, { id: "scrams", description: "scrams" }],
  texts: ["reason.no_way", "reason.nothing_moves"],
  hooks: {
    onStart(ctx) {
      const ports: Port[] = [];
      for (let k = 0; k < numbers(ctx).ports!; k++) {
        const free = freeRim(ctx.board.width, ports);
        const p = free[ctx.draw("core").even(free.length)]!;
        ctx.emit("port", { side: p.side, lane: p.lane });
        ports.push(p);
      }
      seedRods(ctx, "open");
      return { ports, next: rollNext(ctx), since: 0 };
    },
    canMove: {
      swipe(view, move: SwipeMove) {
        if (![0, 1, 2, 3].includes(move.dir)) return "reason.no_way";
        return sweep(view, view.state.ports, move.dir).changed.length === 0 ? "reason.nothing_moves" : null;
      },
    },
    onMove: {
      swipe(ctx, _seat, move: SwipeMove) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        const size = board.width;
        const s = sweep(ctx, state.ports, move.dir);
        // The run: a discharge within the window of the last continues it, and a swipe that uses the window up ends it.
        let since = ctx.streak > 0 ? state.since + 1 : 0;
        for (const o of s.out) {
          ctx.emit("discharge", { at: cell(board, o.from), side: o.port.side, lane: o.port.lane, out: s.out.length }, (e) => e.leave(cell(board, o.from)).set("discharges", ctx.value("discharges") + 1));
          since = 0;
        }
        if (s.out.length > 1) ctx.emit("salvo", { count: s.out.length }, (e) => e.set("salvos", ctx.value("salvos") + 1));
        if (s.out.length === 0 && ctx.streak > 0 && since >= n.pipelineSwipes!) (since = 0), ctx.emit("lapse", {});
        ctx.emit("swipe", { dir: move.dir }, (e) => {
          for (const f of s.fused) e.leave(cell(board, f.from));
          for (const t of s.travels) e.travel(cell(board, t.from), cell(board, t.to));
          for (const f of s.fused) e.change(cell(board, f.at), { kind: f.grade });
        });
        for (const f of s.fused) ctx.emit("fuse", { at: cell(board, f.at), grade: f.grade, rank: f.grade - 1 }, (e) => e.set("fusions", ctx.value("fusions") + 1));
        // A used port closes and another opens somewhere it was not.
        const used = state.ports.filter((p) => s.out.some((o) => samePort(o.port, p)));
        let ports = state.ports.filter((p) => !used.includes(p));
        for (let k = 0; k < used.length; k++) {
          const free = freeRim(size, [...ports, ...used]);
          if (free.length === 0) break;
          const p = free[ctx.draw("core").even(free.length)]!;
          ctx.emit("port", { side: p.side, lane: p.lane });
          ports = [...ports, p];
        }
        // The next rod enters on the edge the rods slid away from, in a lane that changed.
        const lanes = s.changed.filter((lane) => !ctx.board.at(cell(board, laneCells(size, move.dir, lane)[size - 1]!)));
        if (lanes.length > 0) {
          const at = cell(board, laneCells(size, move.dir, lanes[ctx.draw("core").even(lanes.length)]!)[size - 1]!);
          ctx.emit("rod", { at, grade: state.next, why: false }, (e) => e.arrive(at, { piece: "rod", kind: state.next }));
        }
        const next = rollNext(ctx);
        const now = ctx.board;
        const jammed = [0, 1, 2, 3].every((d) => sweep(ctx, ports, d).changed.length === 0);
        const hotNow = now.places().filter((p) => now.at(p) && hot(ctx, now.at(p)!.kind!)).length;
        if (jammed || hotNow >= n.criticalHot!) {
          // The score never goes below zero: a scram takes what the score holds, this swipe's points too, up to the penalty.
          const lost = Math.min(ctx.score + ctx.pending, -n.scramPoints!);
          const rods = now.places().filter((p) => now.at(p));
          ctx.emit("scram", { critical: hotNow >= n.criticalHot!, lost }, (e) => {
            for (const p of rods) e.leave(p);
            e.set("scrams", ctx.value("scrams") + 1);
          });
          seedRods(ctx, "scram");
          since = 0;
        }
        return { ports, next, since };
      },
    },
    listMoves: (view) => [0, 1, 2, 3].filter((dir) => sweep(view, view.state.ports, dir).changed.length > 0).map((dir) => ({ move: "swipe", dir })),
    pointsFor: (event, paid) => (event.event === "scram" ? -(event.fields.lost as number) : paid),
  },
});

export default puzzle("reactor", {
  board: grid("size", "size"),
  parts: [core],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    size: { default: 4, min: 3, max: 8, description: "the core is this many cells on a side" },
    roundSeconds: 120,
    maxMoves: 1500,
    hotGrade: { default: 4, min: 3, max: 9, description: "the grade that is hot: it fuses no more and must go out through a port" },
    ports: { default: 2, min: 1, max: 8, description: "ports open on the rim at once" },
    criticalHot: { default: 4, min: 2, max: 64, description: "hot rods in the core at once that make it scram" },
    startRods: { default: 2, min: 1, max: 63, description: "rods in the core at the start, and after a scram" },
    twoPermille: { default: 200, min: 0, max: 1000, description: "chance in a thousand that the next rod to enter is grade 2" },
    pipelineSwipes: { default: 8, min: 1, max: 1000, description: "swipes after a discharge within which the next one carries the run on" },
    fusePoints: { default: [2, 5, 12], min: 0, max: 100_000, description: "what fusing into each grade is worth, from grade 2 to the hot grade" },
    dischargePoints: { default: 100, min: 0, max: 100_000, description: "what a hot rod out through a port is worth, before the run and the salvo" },
    pipelinePercent: { default: [100, 125, 150, 175, 200], min: 100, max: 1000, description: "what a discharge multiplies by, an entry for each in the run" },
    salvoPercent: { default: [100, 250, 400], min: 100, max: 2000, description: "what a swipe's discharges multiply by, an entry for each rod out in it" },
    scramPoints: { default: -150, min: -100_000, max: 0, description: "points a scram takes away, never more than the score holds" },
  },
  payouts: {
    fuse: { on: "fuse", counts: "rank", growth: "stepped", reads: "fusePoints" },
    discharge: { on: "discharge", reads: "dischargePoints" },
    scram: { on: "scram", reads: "scramPoints" },
  },
  multipliers: {
    pipeline: { scales: "discharge", by: "pipelinePercent", index: "streak" },
    salvo: { scales: "discharge", by: "salvoPercent", index: { field: "out" } },
  },
  // Discharges, each within the window of the last. A swipe that uses the window up, or a scram, ends the run.
  streak: { builds: "discharge", counts: "events", breaksOn: ["lapse", "scram"] },
});
