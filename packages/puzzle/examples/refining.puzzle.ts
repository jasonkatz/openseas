// Refining, a prototype puzzle, written on rungs 2 and 3 with a ticking tempo: a refinery's tower of fractions, packed
// as a honeycomb, every other column half a piece low. Vapour, oil and tar each rise past one partner and sink past
// another, so a diagonal swap goes only one way. On a clock the outlet column leaves, every column moves toward it and
// fresh feed enters at the far side; it may be drawn early. A column leaves by weight and is graded: a clear one extends
// the clear run, a smooth one pays a little, a foul one costs, and vapour sunk to the sump comes back as smoke. What
// each grade pays, the catalysts, the run and the costs are payouts and the streak. One part of its own holds the
// tower, its four feeds and the clock.
//
// The tests play it beside the engine the studio deals, tick for tick, and hold the two to the same tower, run and score.
import { budget, clock, grid, part, puzzle, ticking, type Board, type Cell, type Changes, type Ctx, type View } from "../src/index.js";

/** Swap the piece at a place with one of the two touching it in the column to its right: 0 the one up, 1 the one down. */
export type SwapMove = { readonly move: "swap"; readonly at: Cell; readonly dir: number };
export type DrawMove = { readonly move: "draw" };
type Move = SwapMove | DrawMove;
/** The tick the round has reached, the draws so far (which columns sit low turns on them), the tick of the next draw, and the vapour spilled all round. */
export interface Tower { readonly now: number; readonly draws: number; readonly nextDraw: number; readonly spilled: number }

const FRACTIONS = ["vapour", "oil", "tar", "smoke", "catalyst"] as const;
type Fraction = (typeof FRACTIONS)[number];
/** The stat each grade counts in, besides every draw. */
const STAT_OF: Record<string, string | undefined> = { clear: "clears", smooth: "smooths", foul: "fouls", dump: "dumps", spill: "spills" };
/** A tick is a tenth of a second, and it is the puzzle's own: no setting changes it. */
const TICK_MS = 100;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const fractionAt = (board: Board, p: Cell): Fraction => board.at(p)!.piece as Fraction;
/** Where a fraction stands in the cycle vapour, oil, tar; smoke stands as vapour, and a catalyst never swaps. */
const cyclePos = (f: Fraction): number | null => (f === "catalyst" ? null : f === "smoke" ? 0 : FRACTIONS.indexOf(f));
/** A pair may swap when its upper piece is vapour over tar, tar over oil, or oil over vapour. */
const linked = (upper: Fraction, lower: Fraction): boolean => {
  const [a, b] = [cyclePos(upper), cyclePos(lower)];
  return a !== null && b !== null && b === (a + 2) % 3;
};
/** True when a column sits half a piece low. A column keeps its height as it moves, so this turns over with every draw. */
const lowered = (tower: Tower, col: number): boolean => ((col + tower.draws) & 1) === 1;
/** The place a swap from `at` going `dir` pairs it with, or null off the tower. */
export function partner(board: Board, tower: Tower, at: Cell, dir: number): Cell | null {
  if (at.x >= board.width - 1) return null;
  const low = lowered(tower, at.x);
  const y = dir === 0 ? (low ? at.y : at.y - 1) : low ? at.y + 1 : at.y;
  return y >= 0 && y < board.height ? { x: at.x + 1, y } : null;
}
function canSwap(view: View<Tower>, at: Cell, dir: number): boolean {
  const other = partner(view.board, view.state, at, dir);
  if (!other) return false;
  const [a, b] = [fractionAt(view.board, at), fractionAt(view.board, other)];
  return dir === 0 ? linked(b, a) : linked(a, b);
}

/** One piece of feed: a catalyst by its own stream, else a fraction by the feed's weights. Both streams move every time. */
function feed(ctx: Ctx<Tower>, stream: "deal" | "feed"): Fraction {
  const n = numbers(ctx);
  const catalyst = ctx.draw(stream === "deal" ? "dealCatalyst" : "catalyst").chance(n.catalystPermille!);
  const roll = ctx.draw(stream).even(1000);
  if (catalyst) return "catalyst";
  return roll < n.vapourPermille! ? "vapour" : roll < n.vapourPermille! + n.oilPermille! ? "oil" : "tar";
}

/**
 * Draw the outlet: grade it, move every column one place toward it, feed a fresh one in, and turn every so many vapour
 * spilled into smoke, in place of the top vapour in the column nearest the outlet that holds any.
 */
function draw(ctx: Ctx<Tower>, tick: number, early: boolean): Tower {
  const { board, state } = ctx;
  const n = numbers(ctx);
  const [W, H] = [board.width, board.height];
  const out = Array.from({ length: H }, (_, y) => fractionAt(board, { x: W - 1, y }));
  const count = (f: Fraction): number => out.filter((k) => k === f).length;
  const [vapour, oil, tar, smoke, catalysts] = FRACTIONS.map(count) as [number, number, number, number, number];
  const up = tar <= vapour + smoke;
  const fields = { early, catalysts, fouls: tar + smoke };
  const grade = !up ? (vapour === 0 ? "dump" : "spill") : tar === 0 && smoke === 0 && oil === 0 && vapour > 0 ? "clear" : tar === 0 && smoke === 0 && vapour > oil ? "smooth" : tar === 0 && smoke === 0 ? "plain" : "foul";
  // The score never goes below zero: a foul column takes what the score holds, up to its cost.
  const lost = grade === "foul" ? Math.min(Math.max(0, ctx.score + ctx.pending), -n.foulPoints! * (tar + smoke)) : 0;
  const fresh = Array.from({ length: H }, () => feed(ctx, "feed"));
  ctx.emit(grade, { ...fields, run: ctx.streak + 1, lost }, (e: Changes) => {
    for (let y = 0; y < H; y++) {
      e.leave({ x: W - 1, y });
      for (let x = W - 2; x >= 0; x--) e.travel({ x, y }, { x: x + 1, y });
      e.arrive({ x: 0, y }, { piece: fresh[y]! }, "feed");
    }
    e.set("draws", ctx.value("draws") + 1);
    const stat = STAT_OF[grade];
    if (stat) e.set(stat, ctx.value(stat) + 1);
  });
  const spilled = state.spilled + (up ? 0 : vapour);
  if (n.smokeEvery! > 0) {
    const made = Math.floor(spilled / n.smokeEvery!) - Math.floor(state.spilled / n.smokeEvery!);
    for (let k = 0; k < made; k++) {
      const near = Array.from({ length: W }, (_, i) => W - 1 - i).map((x) => Array.from({ length: H }, (_, y) => ({ x, y })).find((p) => fractionAt(ctx.board, p) === "vapour")).find((p) => p);
      if (near) ctx.emit("smoke", { at: near }, (e) => e.change(near, { piece: "smoke" }));
    }
  }
  return { now: tick, draws: state.draws + 1, nextDraw: tick + n.pulseTicks!, spilled };
}

/**
 * The tower. A swap is diagonal, with one of the two pieces touching a piece in the column to its right, and only one
 * way round. The clock draws the outlet every so many ticks; a draw by hand starts the count again.
 */
const tower = part<Move, Tower>({
  name: "tower",
  rule: "swap a fraction past its partner on a diagonal; the outlet column is drawn on a clock and graded by what it holds",
  pieces: FRACTIONS.map((id) => ({ id })),
  moves: [
    { id: "swap", description: "swap the piece at a place with the one up (0) or down (1) of it in the column to its right", gesture: "drag", fields: { at: "place", dir: "number" } },
    { id: "draw", description: "draw the outlet now, before the clock does", gesture: "tap", fields: {} },
  ],
  events: [
    { id: "deal", description: "the tower was dealt", fields: { count: "number" }, changes: ["arrive"] },
    { id: "swap", description: "two fractions on a diagonal swapped", fields: { at: "place", other: "place" }, changes: ["travel"] },
    { id: "clear", description: "a column of vapour rose to the tank, and extended the clear run", fields: { early: "flag", run: "number", catalysts: "number", fouls: "number", lost: "number", points: "points" }, changes: ["leave", "travel", "arrive"] },
    { id: "smooth", description: "a column rose with no tar or smoke and more vapour than oil", fields: { early: "flag", run: "number", catalysts: "number", fouls: "number", lost: "number", points: "points" }, changes: ["leave", "travel", "arrive"] },
    { id: "plain", description: "a column rose with no tar or smoke, but mostly oil", fields: { early: "flag", run: "number", catalysts: "number", fouls: "number", lost: "number" }, changes: ["leave", "travel", "arrive"] },
    { id: "foul", description: "a column rose with tar or smoke in it", fields: { early: "flag", run: "number", catalysts: "number", fouls: "number", lost: "number", points: "points" }, changes: ["leave", "travel", "arrive"], mistake: true },
    { id: "dump", description: "a column with no vapour sank to the sump", fields: { early: "flag", run: "number", catalysts: "number", fouls: "number", lost: "number" }, changes: ["leave", "travel", "arrive"] },
    { id: "spill", description: "a column sank and spilled its vapour", fields: { early: "flag", run: "number", catalysts: "number", fouls: "number", lost: "number" }, changes: ["leave", "travel", "arrive"] },
    { id: "smoke", description: "spilled vapour came back as smoke", fields: { at: "place" }, changes: ["change"] },
  ],
  draws: [
    { id: "deal", description: "each fraction of the opening tower", gives: "piece", by: "weighted", when: "start", reads: ["vapourPermille", "oilPermille"] },
    { id: "dealCatalyst", description: "which pieces of the opening tower are catalysts", gives: "piece", by: "even", when: "start", reads: ["catalystPermille"] },
    { id: "feed", description: "each fraction of the fresh feed", gives: "piece", by: "weighted", when: "refill", reads: ["vapourPermille", "oilPermille"] },
    { id: "catalyst", description: "which pieces of the fresh feed are catalysts", gives: "piece", by: "even", when: "refill", reads: ["catalystPermille"] },
  ],
  stats: [{ id: "draws", description: "columns drawn" }, { id: "clears", description: "clear columns" }, { id: "smooths", description: "smooth columns" }, { id: "fouls", description: "foul columns" }, { id: "dumps", description: "dumps" }, { id: "spills", description: "spills" }],
  texts: ["reason.not_linked"],
  hooks: {
    onStart(ctx) {
      const places = ctx.board.places();
      const kinds = places.map(() => feed(ctx, "deal"));
      ctx.emit("deal", { count: places.length }, (e) => places.forEach((p, i) => e.arrive(p, { piece: kinds[i]! })));
      return { now: 0, draws: 0, nextDraw: numbers(ctx).pulseTicks!, spilled: 0 };
    },
    onTick: (ctx, tick) => (tick.n === ctx.state.nextDraw ? draw(ctx, tick.n, false) : { ...ctx.state, now: tick.n }),
    canMove: { swap: (view, move: SwapMove) => ([0, 1].includes(move.dir) && canSwap(view, move.at, move.dir) ? null : "reason.not_linked") },
    onMove: {
      swap(ctx, _seat, move: SwapMove) {
        const other = partner(ctx.board, ctx.state, move.at, move.dir)!;
        ctx.emit("swap", { at: move.at, other }, (e) => e.travel(move.at, other).travel(other, move.at));
      },
      draw: (ctx) => draw(ctx, ctx.state.now, true),
    },
    listMoves: (view) => [...view.board.places().flatMap((at) => [0, 1].filter((dir) => canSwap(view, at, dir)).map((dir) => ({ move: "swap", at, dir }))), { move: "draw" }],
    pointsFor: (event, paid) => (event.event === "foul" ? -(event.fields.lost as number) : paid),
  },
});

export default puzzle("refining", {
  board: grid("width", "height"),
  tempo: ticking(TICK_MS),
  parts: [tower],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 6,
    height: 5,
    roundSeconds: 120,
    maxMoves: 2000,
    vapourPermille: { default: 450, min: 1, max: 1000, description: "chance in a thousand that a piece of feed is vapour" },
    oilPermille: { default: 275, min: 0, max: 1000, description: "chance in a thousand that a piece of feed is oil; the rest is tar" },
    catalystPermille: { default: 30, min: 0, max: 300, description: "chance in a thousand that a piece of feed is a catalyst instead" },
    pulseTicks: { default: 80, min: 5, max: 10_000, description: "ticks between draws; a draw by hand starts the count again" },
    smokeEvery: { default: 2, min: 0, max: 100, description: "vapour spilled for each smoke that comes back; 0 makes none" },
    runCap: { default: 5, min: 1, max: 50, description: "the run past which a clear column pays no more" },
    clearPoints: { default: 100, min: 0, max: 10_000, description: "points for a clear column, times its place in the run" },
    smoothPoints: { default: 20, min: 0, max: 10_000, description: "points for a smooth column" },
    catalystPoints: { default: 50, min: 0, max: 10_000, description: "points for each catalyst in a clear or smooth column" },
    foulPoints: { default: -10, min: -10_000, max: 0, description: "points each tar or smoke in a rising column takes away" },
  },
  // The k-th clear column of a run pays k times, up to the cap. A foul column costs for each tar or smoke.
  payouts: {
    clear: { on: "clear", counts: "run", cap: "runCap", reads: "clearPoints" },
    smooth: { on: "smooth", reads: "smoothPoints" },
    catalysts: { on: ["clear", "smooth"], counts: "catalysts", reads: "catalystPoints" },
    foul: { on: "foul", counts: "fouls", reads: "foulPoints" },
  },
  // Clear columns in a row. A dump leaves the run as it was; any other column ends it.
  streak: { builds: "clear", counts: "events", breaksOn: ["smooth", "plain", "foul", "spill"] },
});
