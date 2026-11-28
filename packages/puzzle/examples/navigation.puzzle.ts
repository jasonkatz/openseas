// Navigation, one of the game's own puzzles, written on rung 4 with a ticking tempo, on a ring board: a star chart
// of rings cut into sectors. Stars fall one at a time into the top sector and come to rest against the first star
// they meet. The navigator turns the rings so each lands where the constellation wants it, or is carried onto its
// marker later. When every marker holds its star the constellation is charted, and a larger one is dealt. Three or
// more loose stars of a kind in a row clear. A star with nowhere to land is a lost heading.
//
// The tests play it beside the engine the game ships, tick for tick.
//
// A cell's `x` is its sector, clockwise from the top, and its `y` its ring, from the innermost.
import { budget, clock, part, puzzle, rings, ticking, type Board, type Cell, type Changes, type Ctx, type SettingNeed, type View } from "../src/index.js";

export type TurnMove = { readonly move: "turn"; readonly ring: number; readonly dir: number };
export type DropMove = { readonly move: "drop" };
/** The star in the sky: its kind, the tick it set off on and the tick it comes down on. */
export interface Falling { readonly kind: number; readonly start: number; readonly land: number }
export interface Sky { readonly falling: Falling; readonly next: number; readonly tick: number; readonly landedAt: number; readonly landed: boolean }

const TICK_MS = 100;
const ENTRY = 0;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const whole = (id: string, value: number, min: number, max: number, description: string, group: SettingNeed["group"], unit?: string): SettingNeed => ({ id, type: "whole", default: value, min, max, description, group, ...(unit ? { unit } : {}) });
const kindsOf = (view: View): number => numbers(view).shapes! * numbers(view).colors!;
/** The kind a marker wants, counted from 1 as a star's kind is. */
const wanted = (board: Board, p: Cell): number | null => (board.terrain(p) === "marker" ? Number(board.terrainState(p)!.slice(5)) : null);
/** A star sitting on its own marker is charted, not loose. */
const onMarker = (board: Board, p: Cell): boolean => board.at(p) !== null && wanted(board, p) === board.at(p)!.kind;

/** Where a star falling into the top sector comes to rest: the innermost empty ring. Null when the outermost is taken. */
export function landing(board: Board): Cell | null {
  for (let y = board.height - 1; y >= 0; y--) if (board.at({ x: ENTRY, y })) return y === board.height - 1 ? null : { x: ENTRY, y: y + 1 };
  return { x: ENTRY, y: 0 };
}
/** Ticks a star set off on a tick takes to come down: slow at the start of the round, quickening evenly to the least. */
function fallTicks(view: View, tick: number): number {
  const n = numbers(view);
  const most = (n.roundSeconds! * 1000) / TICK_MS;
  const span = n.fallTicks! - n.fallTicksLeast!;
  if (span <= 0) return n.fallTicks!;
  return Math.max(n.fallTicksLeast!, n.fallTicks! - Math.floor(((span + 1) * Math.max(0, Math.min(tick, most))) / most));
}

/**
 * The sky. A star falls on its own clock and lands in the top sector, or is brought down at once. Two kinds are
 * known ahead: the falling star's and the next. A star arriving where the top sector is full is a lost heading: the
 * sector is swept and points are lost.
 */
const sky = part<DropMove, Sky>({
  name: "sky",
  rule: "stars fall one at a time into the top sector, on their own clock or brought down at once",
  pieces: [{ id: "star" }],
  settings: [
    whole("shapes", 3, 1, 6, "star shapes; a kind is a shape in a colour", "deal", "shapes"),
    whole("colors", 3, 1, 8, "star colours", "deal", "colours"),
    whole("fallTicks", 36, 1, 10_000, "ticks a star takes to fall at the start of a round", "tempo", "ticks"),
    whole("fallTicksLeast", 18, 1, 10_000, "ticks a star takes to fall by the end of a round", "tempo", "ticks"),
  ],
  moves: [{ id: "drop", description: "bring the falling star down now", gesture: "tap", fields: {} }],
  events: [
    { id: "land", description: "a star came to rest", fields: { at: "place" }, changes: ["arrive"] },
    { id: "lost", description: "a star arrived where the top sector was full, and the sector was swept", fields: { stars: "places", points: "points" }, changes: ["leave"], mistake: true },
  ],
  draws: [{ id: "sky", description: "the kind of each star, and each constellation's markers", gives: "kind", by: "even", when: "tick", reads: ["shapes", "colors", "startStars", "mostStars", "reusePercent"] }],
  stats: [{ id: "landings", description: "stars that came down, lost headings too" }, { id: "since_deal", description: "stars that came down since the constellation was dealt" }, { id: "lost", description: "lost headings" }],
  hooks: {
    onStart(ctx) {
      const draw = ctx.draw("sky");
      const kind = draw.even(kindsOf(ctx));
      return { falling: { kind, start: 0, land: fallTicks(ctx, 0) }, next: draw.even(kindsOf(ctx)), tick: 0, landedAt: -1, landed: false };
    },
    onTick(ctx, tick) {
      const state = { ...ctx.state, tick: tick.n };
      return state.falling.land <= tick.n ? land(ctx, state) : state;
    },
    onMove: {
      // A drop sent on the very tick a star came down was meant for that star: the new one keeps falling.
      drop: (ctx) => (ctx.state.landedAt === ctx.state.tick ? undefined : land(ctx, ctx.state)),
    },
    // Once what a landing set off has played out, the next star sets off.
    onMoveEnd(ctx) {
      const { state } = ctx;
      if (!state.landed) return;
      const next = ctx.draw("sky").even(kindsOf(ctx));
      return { ...state, falling: { kind: state.next, start: state.tick, land: state.tick + fallTicks(ctx, state.tick) }, next, landed: false };
    },
    listMoves: () => [{ move: "drop" }],
  },
});
function land(ctx: Ctx<Sky>, state: Sky): Sky {
  const { board } = ctx;
  const at = landing(board);
  const counted = (e: Changes): void => void e.set("landings", ctx.value("landings") + 1).set("since_deal", ctx.value("since_deal") + 1);
  if (at) ctx.emit("land", { at }, (e) => counted(e.arrive(at, { piece: "star", kind: state.falling.kind + 1 }, "sky")));
  else {
    const stars = Array.from({ length: board.height }, (_, y) => ({ x: ENTRY, y })).filter((p) => board.at(p));
    ctx.emit("lost", { stars }, (e) => {
      stars.forEach((p) => e.leave(p));
      counted(e);
      e.set("lost", ctx.value("lost") + 1);
    });
  }
  return { ...state, landedAt: state.tick, landed: true };
}

/** The verb: turn a ring a sector either way. Stars ride with their ring, and markers stay where they are. */
const turning = part<TurnMove>({
  name: "turning",
  rule: "turn any ring a sector either way",
  moves: [{ id: "turn", description: "turn a ring a sector, clockwise for 1 and back for -1", gesture: "drag", fields: { ring: "number", dir: "number" } }],
  events: [{ id: "turn", description: "a ring turned", fields: { ring: "number", dir: "number" }, changes: ["travel"] }],
  texts: ["reason.no_ring"],
  hooks: {
    canMove: { turn: (view, { ring, dir }: TurnMove) => (ring >= 0 && ring < view.board.height && (dir === 1 || dir === -1) ? null : "reason.no_ring") },
    onMove: {
      turn(ctx, _seat, { ring, dir }: TurnMove) {
        const { board } = ctx;
        const stars = Array.from({ length: board.width }, (_, x) => ({ x, y: ring })).filter((p) => board.at(p));
        ctx.emit("turn", { ring, dir }, (e) => stars.forEach((p) => e.travel(p, { x: (p.x + dir + board.width) % board.width, y: ring })));
      },
    },
    listMoves: (view) => Array.from({ length: view.board.height }, (_, ring) => [1, -1].map((dir): TurnMove => ({ move: "turn", ring, dir }))).flat(),
  },
});

/**
 * The chart. Stars pack toward the centre; a constellation whose every marker holds its kind is charted and a larger
 * one dealt; three or more loose stars of a kind in a row, around a ring or out along a sector, clear. Each opens
 * room, so the three are asked again until the chart is still.
 */
const chart = part({
  name: "chart",
  rule: "fill every marker of the constellation to chart it, and three loose stars of a kind in a row clear",
  terrain: [{ id: "marker", states: Array.from({ length: 48 }, (_, i) => `kind_${i + 1}`) }],
  settings: [
    whole("startStars", 3, 1, 96, "markers in the first constellation; one more every two charted", "deal", "markers"),
    whole("mostStars", 8, 1, 96, "the most markers a constellation has", "deal", "markers"),
    whole("reusePercent", 50, 0, 100, "chance in a hundred that a marker wants a kind already on the chart", "deal"),
    whole("runMin", 3, 2, 16, "loose stars of a kind in a row that clear", "scoring", "stars"),
  ],
  events: [
    { id: "constellation", description: "a constellation was dealt", fields: { markers: "places" }, changes: ["change"] },
    { id: "pack", description: "stars slid inward to fill the rings toward the centre", fields: {}, changes: ["travel"] },
    { id: "charted", description: "every marker held its star, and the constellation was charted", fields: { stars: "places", spare: "number", points: "points" }, changes: ["leave", "change"] },
    { id: "run", description: "loose stars of a kind in a row cleared", fields: { stars: "places", beyond: "number", points: "points" }, changes: ["leave"] },
  ],
  stats: [{ id: "charted", description: "constellations charted" }, { id: "runs", description: "runs cleared" }],
  hooks: {
    onStart: (ctx) => deal(ctx, 0),
    onCascade(ctx) {
      const { board } = ctx;
      pack(ctx);
      // A constellation dealt where its markers already hold their stars is charted at once.
      for (let markers = board.places().filter((p) => wanted(board, p) !== null); markers.length > 0 && markers.every((p) => onMarker(board, p)); markers = board.places().filter((p) => wanted(board, p) !== null)) {
        const n = markers.length;
        const spare = Math.max(0, 2 * n - ctx.value("since_deal")) * n;
        const done = ctx.value("charted") + 1;
        ctx.emit("charted", { stars: markers, spare }, (e) => {
          markers.forEach((p) => e.leave(p).change(p, { terrain: "plain" }));
          e.set("charted", done).set("since_deal", 0);
        });
        deal(ctx, done);
      }
      const runs = runsOf(ctx);
      for (const stars of runs) ctx.emit("run", { stars, beyond: stars.length - (numbers(ctx).runMin! - 1) }, (e) => {
          stars.forEach((p) => e.leave(p));
          e.set("runs", ctx.value("runs") + 1);
        });
    },
  },
});
/** Every sector packed toward the centre, reported as one event when anything moved. */
function pack(ctx: Ctx): void {
  const { board } = ctx;
  const moves: [Cell, Cell][] = [];
  for (let x = 0; x < board.width; x++) {
    let to = 0;
    for (let y = 0; y < board.height; y++) {
      if (!board.at({ x, y })) continue;
      if (y !== to) moves.push([{ x, y }, { x, y: to }]);
      to++;
    }
  }
  if (moves.length > 0) ctx.emit("pack", {}, (e) => moves.forEach(([from, to]) => e.travel(from, to)));
}
/**
 * A constellation for this many charted: a marker more every two, up to the most. Each takes a free cell, and wants
 * a kind already on the chart some of the time, else any kind.
 */
function deal(ctx: Ctx, charted: number): void {
  const { board } = ctx;
  const n = numbers(ctx);
  const draw = ctx.draw("sky");
  const size = Math.min(n.mostStars!, n.startStars! + Math.floor(charted / 2));
  const free = board.places();
  const onChart = board.places().filter((p) => board.at(p)).map((p) => board.at(p)!.kind!);
  const markers: { at: Cell; kind: number }[] = [];
  for (let i = 0; i < size && free.length > 0; i++) {
    const at = free.splice(draw.even(free.length), 1)[0]!;
    const reuse = draw.even(100) < n.reusePercent!;
    markers.push({ at, kind: reuse && onChart.length > 0 ? onChart[draw.even(onChart.length)]! : draw.even(kindsOf(ctx)) + 1 });
  }
  markers.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  ctx.emit("constellation", { markers: markers.map((m) => m.at) }, (e) => markers.forEach((m) => e.change(m.at, { terrain: "marker", state: `kind_${m.kind}` })));
}
/** Runs of loose stars of a kind: around each ring, counted once where one wraps past the top, then out along each sector. */
function runsOf(ctx: Ctx): Cell[][] {
  const { board } = ctx;
  const min = numbers(ctx).runMin!;
  const loose = (p: Cell): number | null => (board.at(p) && !onMarker(board, p) ? board.at(p)!.kind! : null);
  const runs: Cell[][] = [];
  const line = (cells: Cell[]): void => {
    let run: Cell[] = [];
    for (const p of cells) {
      if (run.length > 0 && loose(p) !== null && loose(p) === loose(run[0]!)) run.push(p);
      else {
        if (run.length >= min) runs.push(run);
        run = loose(p) === null ? [] : [p];
      }
    }
    if (run.length >= min) runs.push(run);
  };
  for (let y = 0; y < board.height; y++) {
    const at = (x: number): Cell => ({ x: ((x % board.width) + board.width) % board.width, y });
    const start = Array.from({ length: board.width }, (_, x) => x).find((x) => loose(at(x)) === null || loose(at(x - 1)) === null || loose(at(x)) !== loose(at(x - 1)));
    line(Array.from({ length: board.width }, (_, i) => at((start ?? 0) + i)));
  }
  for (let x = 0; x < board.width; x++) line(Array.from({ length: board.height }, (_, y) => ({ x, y })));
  return runs;
}

export default puzzle("navigation", {
  board: rings("rings", "sectors"),
  // A tick is a tenth of a second, and it is the puzzle's own: no setting changes it.
  tempo: ticking(TICK_MS),
  parts: [sky, turning, chart],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    rings: 3,
    sectors: 8,
    roundSeconds: 150,
    maxMoves: 2000,
    starPoints: { default: 10, min: 0, max: 1000, description: "points a constellation earns, times its markers squared, and again for each landing it saved" },
    runPoints: { default: 5, min: 0, max: 1000, description: "points for each star of a run beyond two" },
    lostPoints: { default: -40, min: -10_000, max: 0, description: "points a lost heading takes away" },
    chainPercent: { default: [100, 125, 150, 175, 200], min: 100, max: 1000, description: "what a constellation's stars multiply by, an entry for each charted in a row without a lost heading" },
  },
  // A constellation of n markers pays n × n, and n again for every landing under 2n it took.
  payouts: {
    stars: { on: "charted", counts: "stars", growth: "superlinear", reads: "starPoints" },
    spare: { on: "charted", counts: "spare", reads: "starPoints" },
    run: { on: "run", counts: "beyond", reads: "runPoints" },
    lost: { on: "lost", reads: "lostPoints" },
  },
  multipliers: { chain: { scales: "stars", by: "chainPercent", index: "streak" } },
  // Constellations charted in a row. A lost heading ends the run.
  streak: { builds: "charted", counts: "events", breaksOn: ["lost"] },
});
