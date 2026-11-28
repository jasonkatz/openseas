// Engines, one of the game's own puzzles, written on rungs 2 and 3. Pairs of pellets are steered into a drive core
// and come to rest; injectors sit in the core with targets that want a kind. Fill every target of an injector and it
// fires; four or more of a kind in a line clear too, and what falls into place may set off the next step of a chain.
// A core that fills to the top flames out. Its numbers are data, and four parts of its own hold the rules.
//
// The tests play it beside the engine the game ships, pair for pair, and hold the two to the same core, injectors,
// pairs, score and streak.
//
// The core is read with its floor at the bottom: row 0 of the shipped engine is the board's last row.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Ctx, type SettingNeed, type View } from "../src/index.js";

export type PlaceMove = { readonly move: "place"; readonly at: Cell; readonly rot: number };
/** The two kinds of a pair, the first half then the second. */
export type Pair = readonly [number, number];

const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const whole = (id: string, value: number, min: number, max: number, description: string, group: SettingNeed["group"], unit?: string): SettingNeed => ({ id, type: "whole", default: value, min, max, description, group, ...(unit ? { unit } : {}) });
const key = (p: Cell): string => `${p.x},${p.y}`;
const below = (p: Cell): Cell => ({ x: p.x, y: p.y + 1 });
const isInjector = (board: Board, p: Cell): boolean => board.terrain(p) === "target" || board.terrain(p) === "blank";
/** An injector cell has a shelf under it when no cell of its injector is beneath. Injectors never touch, so any injector cell beneath is its own. */
const shelf = (board: Board, p: Cell): boolean => isInjector(board, p) && !isInjector(board, below(p));
/** The kind a target wants, counted from 1 as a piece's kind is. */
const wants = (board: Board, p: Cell): number => Number(board.terrainState(p)!.slice(5));

/**
 * The two cells of a pair with its anchor at a cell, the first half then the second. 0: side by side, first on the
 * left. 1: upright, first below. 2: side by side, first on the right. 3: upright, first above.
 */
export function pairCells(board: Board, at: Cell, rot: number): [Cell, Cell] | null {
  const side = { x: at.x + 1, y: at.y };
  const under = { x: at.x, y: at.y + 1 };
  const cells: [Cell, Cell] | null = rot === 0 ? [at, side] : rot === 1 ? [under, at] : rot === 2 ? [side, at] : rot === 3 ? [at, under] : null;
  return cells && cells.every((p) => board.has(p)) ? cells : null;
}
/** A pair fits where both cells are empty, and an upright pair never straddles a shelf. */
function fits(board: Board, at: Cell, rot: number): boolean {
  const cells = pairCells(board, at, rot);
  if (!cells || cells.some((p) => board.at(p))) return false;
  return rot % 2 === 0 || !shelf(board, at);
}
/** A unit of cells falls a row when none sits on the floor or a shelf, and what is under each is empty or its own. */
const canFall = (board: Board, unit: readonly Cell[], at: (p: Cell) => unknown = (p) => board.at(p)): boolean =>
  unit.every((p) => p.y < board.height - 1 && !shelf(board, p) && (!at(below(p)) || unit.some((q) => key(q) === key(below(p)))));
/** Every pair enters here: side by side, in the middle of the top row. */
const entry = (board: Board): Cell => ({ x: Math.floor((board.width - 2) / 2), y: 0 });

/**
 * Every resting place the pair can reach from the entry by sliding either way at any height, turning either way
 * (in place, else a column left, else a column right) and falling. A pair can be tucked under an injector.
 */
export function rests(board: Board): PlaceMove[] {
  const start = entry(board);
  if (!fits(board, start, 0)) return [];
  const seen = new Set([`${key(start)},0`]);
  const queue: { at: Cell; rot: number }[] = [{ at: start, rot: 0 }];
  const found: PlaceMove[] = [];
  const visit = (at: Cell, rot: number): void => {
    if (seen.has(`${key(at)},${rot}`) || !fits(board, at, rot)) return;
    seen.add(`${key(at)},${rot}`);
    queue.push({ at, rot });
  };
  while (queue.length > 0) {
    const { at, rot } = queue.shift()!;
    if (canFall(board, pairCells(board, at, rot)!)) visit(below(at), rot);
    else found.push({ move: "place", at, rot });
    visit({ x: at.x - 1, y: at.y }, rot);
    visit({ x: at.x + 1, y: at.y }, rot);
    for (const turn of [1, 3]) {
      const next = (rot + turn) % 4;
      const kick = [0, -1, 1].find((k) => fits(board, { x: at.x + k, y: at.y }, next));
      if (kick !== undefined) visit({ x: at.x + kick, y: at.y }, next);
    }
  }
  return found;
}

/** The verb: a pair comes to rest where it was steered. Two pairs wait, the one in hand and the one after it. */
const pairs = part<PlaceMove, { hand: Pair; next: Pair; count: number }>({
  name: "pairs",
  rule: "steer each pair of pellets to rest anywhere it can reach from the top",
  moves: [{ id: "place", description: "the pair in hand comes to rest with its anchor here, turned", gesture: "drag", fields: { at: "place", rot: "number" } }],
  events: [{ id: "land", description: "a pair came to rest", fields: { cells: "places" }, changes: ["arrive"] }],
  draws: [{ id: "core", description: "each pair's two kinds, where each injector is dealt, its shape and what each cell wants", gives: "kind", by: "even", when: "refill", reads: ["kinds", "injectorsAtOnce", "spanLeast", "spanMost"] }],
  texts: ["reason.out_of_reach"],
  hooks: {
    onStart: (ctx) => ({ hand: pairOf(ctx), next: pairOf(ctx), count: 1 }),
    canMove: { place: (view, { at, rot }: PlaceMove) => (rests(view.board).some((r) => key(r.at) === key(at) && r.rot === rot) ? null : "reason.out_of_reach") },
    onMove: {
      place(ctx, _seat, { at, rot }: PlaceMove) {
        const { hand, count } = ctx.state;
        const cells = pairCells(ctx.board, at, rot)!;
        // A pellet's state is the pair it came in: halves fall together while both are on the board.
        ctx.emit("land", { cells }, (e) => cells.forEach((p, i) => e.arrive(p, { piece: "kind", kind: hand[i]! + 1, state: count })));
      },
    },
    onMoveEnd: (ctx) => ({ hand: ctx.state.next, next: pairOf(ctx), count: ctx.state.count + 1 }),
    listMoves: (view) => rests(view.board),
  },
});
function pairOf(ctx: Ctx): Pair {
  const draw = ctx.draw("core");
  return [draw.even(numbers(ctx).kinds!), draw.even(numbers(ctx).kinds!)];
}

/** Shapes an injector takes, read from its bottom-left cell upward: bars from the settings, then stacks, Ls and a square. */
const FIXED: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0], [0, 1]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
];
/** Every injector on the board, each a set of cells that touch. Injectors never touch each other, not even at a corner. */
export function injectorsOn(board: Board): Cell[][] {
  const seen = new Set<string>();
  const out: Cell[][] = [];
  for (const first of board.places()) {
    if (!isInjector(board, first) || seen.has(key(first))) continue;
    const cells: Cell[] = [];
    const todo = [first];
    seen.add(key(first));
    while (todo.length > 0) {
      const p = todo.pop()!;
      cells.push(p);
      for (const q of board.touching(p)) if (isInjector(board, q) && !seen.has(key(q))) seen.add(key(q)), todo.push(q);
    }
    out.push(cells);
  }
  return out;
}
/**
 * Injectors are dealt until as many sit in the core as the settings say. A shape goes where every cell, and the
 * cell above each of its top cells, is empty, clear of the floor and the top rows, touching no other injector.
 * Each cell wants a kind two times in three, else holds anything, and at least one wants a kind. Where nothing
 * fits, the deal waits for the next move.
 */
function dealInjectors(ctx: Ctx): void {
  const { board } = ctx;
  const n = numbers(ctx);
  const shapes = [...Array.from({ length: n.spanMost! - n.spanLeast! + 1 }, (_, i) => Array.from({ length: n.spanLeast! + i }, (_, x) => [x, 0] as const)), ...FIXED];
  const draw = ctx.draw("core");
  for (let have = injectorsOn(board); have.length < n.injectorsAtOnce!; have = injectorsOn(board)) {
    const shape = shapes[draw.even(shapes.length)]!;
    const [w, h] = [Math.max(...shape.map((c) => c[0])) + 1, Math.max(...shape.map((c) => c[1])) + 1];
    const spots: Cell[][] = [];
    // Rows counted from the floor, as the shipped engine counts them: from the third row up, and never in the top three.
    for (let row = 2; row + h - 1 <= board.height - 4; row++)
      for (let x = 0; x + w <= board.width; x++) {
        const cells = shape.map(([dx, dy]) => ({ x: x + dx, y: board.height - 1 - row - dy }));
        const free = cells.every((p) => !board.at(p) && (cells.some((q) => q.x === p.x && q.y === p.y - 1) || p.y === 0 || !board.at({ x: p.x, y: p.y - 1 })));
        if (free && have.every((other) => !other.some((a) => cells.some((b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1)))) spots.push(cells);
      }
    if (spots.length === 0) return;
    const cells = spots[draw.even(spots.length)]!;
    const wanted = cells.map((): number | null => (draw.even(3) !== 0 || cells.length === 1 ? draw.even(n.kinds!) : null));
    if (!wanted.some((k) => k !== null)) wanted[0] = draw.even(n.kinds!);
    ctx.emit("injector", { cells }, (e) => cells.forEach((p, i) => e.change(p, wanted[i] === null ? { terrain: "blank" } : { terrain: "target", state: `kind_${wanted[i]! + 1}` })));
  }
}
const injectors = part({
  name: "injectors",
  rule: "injectors sit in the core, each cell a target that wants a kind or a blank that holds anything",
  terrain: [{ id: "target", states: Array.from({ length: 8 }, (_, i) => `kind_${i + 1}`) }, { id: "blank" }],
  settings: [
    whole("injectorsAtOnce", 6, 0, 8, "injectors in the core at once", "deal", "injectors"),
    whole("spanLeast", 2, 1, 16, "the shortest bar an injector is dealt as", "deal", "cells"),
    whole("spanMost", 4, 1, 16, "the longest bar an injector is dealt as", "deal", "cells"),
  ],
  events: [{ id: "injector", description: "an injector was dealt into the core", fields: { cells: "places" }, changes: ["change"] }],
  hooks: { onStart: dealInjectors },
});

/**
 * One step of a chain: every run of four or more of a kind, crossing runs taken as one, and every injector whose
 * targets all hold their kind, clear together. Then everything falls, a pair together while both its halves are
 * left, and injectors are dealt again. A move that cleared nothing gives the deal another try.
 */
const chain = part({
  name: "chain",
  rule: "four or more of a kind in a line clear, an injector whose every target holds its kind fires, and what falls may clear again",
  settings: [whole("runMin", 4, 3, 8, "pellets of a kind in a line that clear", "scoring", "pellets")],
  events: [
    { id: "run", description: "a line of a kind cleared", fields: { pellets: "places", beyond: "number", together: "number", points: "points" }, changes: ["leave"], step: true },
    { id: "fire", description: "an injector fired", fields: { targets: "places", together: "number", points: "points" }, changes: ["leave", "change"], step: true },
    { id: "fall", description: "pellets fell into place", fields: {}, changes: ["travel"] },
  ],
  hooks: {
    onCascade(ctx) {
      const { board } = ctx;
      const min = numbers(ctx).runMin!;
      const runs = runsOf(board, min);
      const fired = injectorsOn(board).filter((cells) => cells.some((p) => board.terrain(p) === "target") && cells.every((p) => board.terrain(p) !== "target" || board.at(p)?.kind === wants(board, p)));
      const together = runs.length + fired.length;
      if (together === 0) return;
      for (const pellets of runs) ctx.emit("run", { pellets, beyond: Math.max(1, pellets.length - (min - 1)), together }, (e) => pellets.forEach((p) => e.leave(p)));
      for (const cells of fired) {
        const targets = cells.filter((p) => board.terrain(p) === "target");
        ctx.emit("fire", { targets, together }, (e) => {
          targets.forEach((p) => e.leave(p));
          cells.forEach((p) => e.change(p, { terrain: "plain" }));
        });
      }
      fall(ctx);
      dealInjectors(ctx);
    },
    onMoveEnd(ctx) {
      if (ctx.step === 0) dealInjectors(ctx);
    },
  },
});
/** Runs of `min` or more of a kind across or down, with crossing runs of one kind taken as one. */
function runsOf(board: Board, min: number): Cell[][] {
  const kindAt = (p: Cell): number => board.at(p)?.kind ?? -1;
  const inRun = new Set<string>();
  for (const [dx, dy] of [[1, 0], [0, 1]] as const)
    for (const p of board.places()) {
      if (kindAt(p) < 0 || kindAt({ x: p.x - dx, y: p.y - dy }) === kindAt(p)) continue;
      const run: Cell[] = [];
      for (let q = p; board.has(q) && kindAt(q) === kindAt(p); q = { x: q.x + dx, y: q.y + dy }) run.push(q);
      if (run.length >= min) run.forEach((q) => inRun.add(key(q)));
    }
  const groups: Cell[][] = [];
  const seen = new Set<string>();
  for (const first of board.places()) {
    if (!inRun.has(key(first)) || seen.has(key(first))) continue;
    const group: Cell[] = [];
    const todo = [first];
    seen.add(key(first));
    while (todo.length > 0) {
      const p = todo.pop()!;
      group.push(p);
      for (const q of board.touching(p)) if (inRun.has(key(q)) && !seen.has(key(q)) && kindAt(q) === kindAt(first)) seen.add(key(q)), todo.push(q);
    }
    groups.push(group);
  }
  return groups;
}
/**
 * Everything falls as far as it can, a row at a time. Units are visited from the floor up, a pair as one unit while
 * both its halves are left, so a stack falls together. Reported as one event from where each pellet stood.
 */
function fall(ctx: Ctx): void {
  const { board } = ctx;
  const now = new Map(board.places().filter((p) => board.at(p)).map((p) => [key(p), { from: p, pair: board.at(p)!.state }]));
  const at = (p: Cell) => now.get(key(p));
  // From the floor up, left to right.
  const order = (): Cell[] => [...now.keys()].map((k) => k.split(",").map(Number)).map(([x, y]) => ({ x: x!, y: y! })).sort((a, b) => b.y - a.y || a.x - b.x);
  for (let moved = true; moved; ) {
    moved = false;
    const done = new Set<unknown>();
    for (const p of order()) {
      const pellet = at(p);
      if (!pellet || done.has(pellet.pair)) continue;
      done.add(pellet.pair);
      const unit = order().filter((q) => at(q)!.pair === pellet.pair);
      if (!canFall(board, unit, at)) continue;
      const lifted = unit.map((q) => [q, at(q)!] as const);
      for (const [q] of lifted) now.delete(key(q));
      for (const [q, v] of lifted) now.set(key(below(q)), v);
      moved = true;
    }
  }
  const travels = [...now.entries()].filter(([k, v]) => k !== key(v.from));
  if (travels.length > 0) ctx.emit("fall", {}, (e) => travels.forEach(([k, v]) => e.travel(v.from, { x: Number(k.split(",")[0]), y: Number(k.split(",")[1]) })));
}

/** A core so full that no pair can enter flames out: every pellet goes, points are lost and fresh injectors are dealt. */
const flameout = part({
  name: "flameout",
  rule: "a core too full for the next pair flames out, and play goes on",
  events: [{ id: "flameout", description: "the core flamed out and was swept", fields: { points: "points" }, changes: ["leave", "change"], mistake: true }],
  stats: [{ id: "flameouts", description: "flameouts" }],
  hooks: {
    onMoveEnd(ctx) {
      const { board } = ctx;
      if (fits(board, entry(board), 0)) return;
      ctx.emit("flameout", {}, (e) => {
        board.places().filter((p) => board.at(p)).forEach((p) => e.leave(p));
        board.places().filter((p) => isInjector(board, p)).forEach((p) => e.change(p, { terrain: "plain" }));
        e.set("flameouts", ctx.value("flameouts") + 1);
      });
      dealInjectors(ctx);
    },
  },
});

export default puzzle("engines", {
  board: grid("width", "height"),
  pieces: "kinds",
  // The pair before the injectors at the start, and after them once a move has played out.
  parts: [chain, pairs, injectors, flameout],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: { default: 12, max: 16 },
    height: { default: 20, max: 32 },
    kinds: 3,
    roundSeconds: 150,
    maxMoves: 10_000,
    runPoints: { default: 4, min: 0, max: 1000, description: "points for each pellet of a run beyond three" },
    injectorPoints: { default: 6, min: 0, max: 1000, description: "points for each target of an injector that fires" },
    flameoutPoints: { default: -40, min: -10_000, max: 0, description: "points a flameout takes away" },
    chainPercent: { default: [100, 300, 600, 1000], min: 100, max: 100_000, description: "what each step of a chain multiplies by, from the landing's own clear" },
  },
  payouts: {
    run: { on: "run", counts: "beyond", reads: "runPoints" },
    fire: { on: "fire", counts: "targets", reads: "injectorPoints" },
    flameout: { on: "flameout", reads: "flameoutPoints" },
  },
  multipliers: { chain: { scales: ["run", "fire"], by: "chainPercent", index: "step" } },
  // Pairs in a row that cleared something. A flameout ends the run.
  streak: { builds: ["run", "fire"], breaksOn: ["flameout"] },
  // Whatever clears in one step multiplies by how many cleared together.
  pointsFor: (event, paid) => paid * ((event.fields.together as number | undefined) ?? 1),
});
