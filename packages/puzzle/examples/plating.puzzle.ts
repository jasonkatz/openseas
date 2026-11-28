// Plating, one of the game's own puzzles, written on rungs 2 and 3: a hull with breaches in it, a tray of three
// five-cell plates, and a weld as the one verb. Its numbers are data: what a sealed breach is worth, what each
// rating multiplies it by, the brushing bonus and the flawless streak are payouts and multipliers. One part of
// its own holds what no stock part gives: the tray, the breaches and how a plate is laid over them.
//
// The tests play it beside the engine the game ships, plate for plate, and hold the two to the same hull,
// breaches, tray, score and streak.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Changes, type Ctx, type SettingNeed, type View } from "../src/index.js";

export type PlaceMove = { readonly move: "place"; readonly slot: number; readonly rot: number; readonly flip: boolean; readonly x: number; readonly y: number };

/** The twelve pentominoes, as cells from the corner of the box around each. A plate is one of them. */
export const PENTOMINOES: readonly (readonly (readonly [number, number])[])[] = [
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
];
/** A pentomino turned `rot` quarter turns, mirrored first when `flip`, from the corner of its box, top row first. */
export function orient(shape: number, rot: number, flip: boolean): [number, number][] {
  let cells: (readonly [number, number])[] = [...PENTOMINOES[shape]!];
  if (flip) cells = cells.map(([x, y]) => [-x, y] as const);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) cells = cells.map(([x, y]) => [-y, x] as const);
  const [mx, my] = [Math.min(...cells.map((c) => c[0])), Math.min(...cells.map((c) => c[1]))];
  return cells.map(([x, y]) => [x - mx, y - my] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** A plate in the tray: its pentomino, which way its brushing runs, and its metal, which changes nothing. */
export interface Offered { readonly shape: number; readonly brush: "across" | "down"; readonly kind: number }
/** A breach being worked: its cells, the plates laid on it and the cells they wasted, and how long it has been left. */
export interface Breach { readonly id: number; readonly cells: readonly number[]; readonly plates: number; readonly waste: number; readonly idle: number; readonly widened: boolean; readonly across: boolean }
export interface Hull { readonly tray: readonly Offered[]; readonly breaches: readonly Breach[]; readonly nextId: number; readonly used: number }

const RATINGS = ["flawless", "solid", "holds", "tape", "gum"] as const;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const whole = (id: string, value: number, min: number, max: number, description: string, group: SettingNeed["group"], unit?: string): SettingNeed => ({ id, type: "whole", default: value, min, max, description, group, ...(unit ? { unit } : {}) });
/** Cells are kept as numbers, row by row from the top: the order the hull is read in. */
const index = (board: Board, p: Cell): number => p.y * board.width + p.x;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
/** A quarter turn swaps the way the brushing runs. */
const brushOf = (plate: Offered, rot: number): Offered["brush"] => (rot % 2 === 0 ? plate.brush : plate.brush === "across" ? "down" : "across");

/** Where a plate goes when it is welded: the breach it works, the cells it is laid on, and the cells it wastes. */
export interface Weld { readonly breach: number; readonly laid: readonly number[]; readonly waste: readonly number[]; readonly overhang: number }
/**
 * A plate works the breach it covers most open cells of, the first dealt on a tie. What hangs off the hull, lies
 * over another breach or lies over a plate on sound hull is not laid. What lies on sound hull, or over a plate
 * already on its own breach, is waste. A plate that covers no open cell of any breach is refused.
 */
export function weldOf(view: View<Hull>, move: PlaceMove): Weld | null {
  const { board, state } = view;
  const plate = state.tray[move.slot];
  if (!plate) return null;
  const owner = new Map<number, number>();
  for (const b of state.breaches) for (const c of b.cells) owner.set(c, b.id);
  const covered = (c: number): boolean => board.at(cell(board, c)) !== null;
  const fresh = new Map<number, number>();
  const onHull: number[] = [];
  let overhang = 0;
  for (const [dx, dy] of orient(plate.shape, move.rot, move.flip)) {
    const p = { x: move.x + dx, y: move.y + dy };
    if (!board.has(p)) {
      overhang++;
      continue;
    }
    const c = index(board, p);
    onHull.push(c);
    const b = owner.get(c);
    if (b !== undefined && !covered(c)) fresh.set(b, (fresh.get(b) ?? 0) + 1);
  }
  let breach: number | null = null;
  for (const [b, n] of fresh) if (breach === null || n > fresh.get(breach)! || (n === fresh.get(breach)! && b < breach)) breach = b;
  if (breach === null) return null;
  const laid: number[] = [];
  const waste: number[] = [];
  for (const c of onHull) {
    const b = owner.get(c);
    if (b === undefined) {
      if (!covered(c)) laid.push(c);
      waste.push(c);
    } else if (b === breach) {
      laid.push(c);
      if (covered(c)) waste.push(c);
    } else waste.push(c);
  }
  return { breach, laid, waste, overhang };
}

/** Every cell within one step of a breach, corners too: no other breach may open or widen there. */
function nearBreaches(board: Board, breaches: readonly Breach[], except: number | null): Set<number> {
  const near = new Set<number>();
  for (const b of breaches) {
    if (b.id === except) continue;
    for (const c of b.cells) {
      const p = cell(board, c);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (board.has({ x: p.x + dx, y: p.y + dy })) near.add(index(board, { x: p.x + dx, y: p.y + dy }));
    }
  }
  return near;
}
const beside = (board: Board, c: number): number[] => {
  const p = cell(board, c);
  return [{ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }].filter((q) => board.has(q)).map((q) => index(board, q));
};
/** A pentomino laid anywhere it is accepted, each place alike. Null where none is. */
function anyPentomino(ctx: Ctx<Hull>, accept: (cells: number[]) => boolean): number[] | null {
  const { board } = ctx;
  const options: number[][] = [];
  for (let shape = 0; shape < PENTOMINOES.length; shape++)
    for (let rot = 0; rot < 4; rot++)
      for (const flip of [false, true]) {
        const o = orient(shape, rot, flip);
        const [w, h] = [Math.max(...o.map((c) => c[0])) + 1, Math.max(...o.map((c) => c[1])) + 1];
        for (let y = 0; y + h <= board.height; y++)
          for (let x = 0; x + w <= board.width; x++) {
            const cells = o.map(([dx, dy]) => index(board, { x: x + dx, y: y + dy }));
            if (accept(cells)) options.push(cells);
          }
      }
  return options.length === 0 ? null : options[ctx.draw("hull").even(options.length)]!;
}

/**
 * The hull. Breaches open on sound hull, each one to three pentominoes laid edge to edge, so a perfect fill
 * always exists, and never touching another. A plate is welded from the tray, and when every cell of its breach
 * is covered the breach is sealed: rated by the plates it took beyond the fewest, its plates come off, and a new
 * breach opens. A breach left alone while others are worked widens by a cell, past what its plates can fill without waste.
 */
const hull = part<PlaceMove, Hull>({
  name: "hull",
  rule: "weld five-cell plates from a tray over breaches in the hull; a breach is sealed when every cell is covered, and rated by the plates it took",
  settings: [
    whole("metals", 4, 1, 8, "metals a plate comes in, which change nothing but its look", "deal"),
    whole("breachesAtOnce", 3, 1, 6, "breaches open at once", "deal", "breaches"),
    whole("breachLeast", 1, 1, 6, "the fewest pentominoes a breach is made of", "deal", "pentominoes"),
    whole("breachMost", 3, 1, 6, "the most pentominoes a breach is made of", "deal", "pentominoes"),
    whole("widenAfter", 6, 1, 100, "plates welded elsewhere before a breach left alone widens by a cell", "tempo", "plates"),
  ],
  terrain: [{ id: "breach" }],
  pieces: [{ id: "plate" }],
  moves: [{ id: "place", description: "weld the plate in a slot of the tray, turned and flipped, with the corner of its box at x, y", gesture: "drag", fields: { slot: "number", rot: "number", flip: "flag", x: "number", y: "number" } }],
  events: [
    { id: "breach", description: "a breach opened in the hull", fields: { cells: "places" }, changes: ["change"] },
    { id: "weld", description: "a plate was welded over a breach", fields: { cells: "places", waste: "places", breach: "number" }, changes: ["arrive", "change"] },
    { id: "widen", description: "a breach left alone widened by a cell", fields: { at: "place", breach: "number" }, changes: ["change"] },
    { id: "flawless", description: "a breach was sealed with the fewest plates it could take, and nothing wasted", fields: { cells: "places", across: "flag", points: "points" }, changes: ["leave", "change"] },
    { id: "seal", description: "a breach was sealed with plates to spare", fields: { cells: "places", rating: "number", across: "flag", points: "points" }, changes: ["leave", "change"] },
  ],
  draws: [{ id: "hull", description: "each plate dealt to the tray, where each breach opens and the cell a breach widens into", gives: "piece", by: "even", when: "refill", reads: ["metals", "breachLeast", "breachMost"] }],
  stats: [{ id: "sealed", description: "breaches sealed" }, { id: "plates", description: "plates welded" }],
  texts: ["reason.no_slot", "reason.no_breach"],
  hooks: {
    onStart(ctx) {
      const tray = [0, 1, 2].map(() => deal(ctx));
      return open(ctx, { tray, breaches: [], nextId: 1, used: -1 });
    },
    canMove: {
      place(view, move: PlaceMove) {
        if (!Number.isInteger(move.slot) || !view.state.tray[move.slot] || !Number.isInteger(move.rot) || move.rot < 0 || move.rot > 3) return "reason.no_slot";
        return weldOf(view, move) ? null : "reason.no_breach";
      },
    },
    onMove: {
      place(ctx, _seat, move: PlaceMove) {
        const { board, state } = ctx;
        const plate = state.tray[move.slot]!;
        const weld = weldOf(ctx, move)!;
        const brush = brushOf(plate, move.rot);
        ctx.emit("weld", { cells: weld.laid.map((c) => cell(board, c)), waste: weld.waste.map((c) => cell(board, c)), breach: weld.breach }, (e) => {
          for (const c of weld.laid) {
            const p = cell(board, c);
            if (board.at(p)) e.change(p, { piece: "plate", kind: plate.kind + 1, state: weld.breach });
            else e.arrive(p, { piece: "plate", kind: plate.kind + 1, state: weld.breach }, "tray");
          }
          e.set("plates", ctx.value("plates") + 1);
        });
        // The breach worked is reset. Every other breach idles, and the first to idle long enough widens.
        const n = numbers(ctx);
        let widened = false;
        const breaches = state.breaches.map((b): Breach => {
          if (b.id === weld.breach) return { ...b, plates: b.plates + 1, waste: b.waste + weld.waste.length + weld.overhang, idle: 0, across: b.across && brush === "across" };
          const idle = b.idle + 1;
          if (idle < n.widenAfter! || widened) return { ...b, idle };
          const own = new Set(b.cells);
          const near = nearBreaches(board, state.breaches, b.id);
          const room = [...new Set(b.cells.flatMap((c) => beside(board, c)))].filter((c) => !own.has(c) && !board.at(cell(board, c)) && !near.has(c)).sort((p, q) => p - q);
          if (room.length === 0) return { ...b, idle: 0 };
          const at = room[ctx.draw("hull").even(room.length)]!;
          widened = true;
          ctx.emit("widen", { at: cell(board, at), breach: b.id }, (e) => e.change(cell(board, at), { terrain: "breach" }));
          return { ...b, cells: [...b.cells, at].sort((p, q) => p - q), idle: 0, widened: true };
        });
        const worked = breaches.find((b) => b.id === weld.breach)!;
        if (!worked.cells.every((c) => ctx.board.at(cell(board, c)))) return { ...state, breaches, used: move.slot };
        // Sealed: rated by the plates beyond the fewest. Its plates come off, wherever they lie, and the hull is sound.
        const extra = Math.max(0, worked.plates - Math.ceil(worked.cells.length / 5));
        const rating = extra === 0 && worked.waste > 0 ? 1 : Math.min(RATINGS.length - 1, extra);
        const cells = worked.cells.map((c) => cell(board, c));
        const plates = ctx.board.places().filter((p) => ctx.board.at(p)?.piece === "plate" && ctx.board.at(p)!.state === worked.id);
        const sealed = (e: Changes): void => {
          for (const p of plates) e.leave(p);
          for (const p of cells) e.change(p, { terrain: "plain" });
          e.set("sealed", ctx.value("sealed") + 1);
        };
        if (rating === 0) ctx.emit("flawless", { cells, across: worked.across }, sealed);
        else ctx.emit("seal", { cells, rating, across: worked.across }, sealed);
        return { ...state, breaches: breaches.filter((b) => b.id !== worked.id), used: move.slot };
      },
    },
    // New breaches open while there is room for them, then the slot that was used is dealt a new plate.
    onMoveEnd(ctx) {
      const opened = open(ctx, ctx.state);
      return { ...opened, tray: opened.tray.map((p, i) => (i === opened.used ? deal(ctx) : p)), used: -1 };
    },
  },
});

/** A plate for the tray: its pentomino, its brushing and its metal, in that order. */
function deal(ctx: Ctx<Hull>): Offered {
  const draw = ctx.draw("hull");
  const shape = draw.even(PENTOMINOES.length);
  const brush = draw.even(2) === 0 ? "across" : "down";
  return { shape, brush, kind: draw.even(numbers(ctx).metals!) };
}

/**
 * Breaches open until as many are open as the settings say. Each is a size rolled from the least to the most, and
 * a crowded hull tries smaller sizes in turn, a few times each, from a first pentomino grown by others laid edge to
 * edge with it. Where nothing fits, fewer are open, and the next weld tries again.
 */
function open(ctx: Ctx<Hull>, state: Hull): Hull {
  const { board } = ctx;
  const n = numbers(ctx);
  const breaches = [...state.breaches];
  let nextId = state.nextId;
  while (breaches.length < n.breachesAtOnce!) {
    const roll = ctx.draw("hull").even(n.breachMost! - n.breachLeast! + 1);
    const near = nearBreaches(board, breaches, null);
    const free = (c: number): boolean => !near.has(c) && !board.at(cell(board, c));
    let region: number[] | null = null;
    for (let size = n.breachLeast! + roll; size >= 1 && region === null; size--) {
      for (let attempt = 0; attempt < 4 && region === null; attempt++) {
        const first = anyPentomino(ctx, (cells) => cells.every(free));
        if (!first) break;
        let cells = [...first];
        let whole = true;
        for (let k = 1; k < size; k++) {
          const taken = new Set(cells);
          const more = anyPentomino(ctx, (cs) => cs.every((c) => free(c) && !taken.has(c)) && cs.some((c) => beside(board, c).some((b) => taken.has(b))));
          if (!more) {
            whole = false;
            break;
          }
          cells = cells.concat(more);
        }
        if (whole) region = cells.sort((p, q) => p - q);
      }
    }
    if (!region) break;
    const cells = region;
    ctx.emit("breach", { cells: cells.map((c) => cell(board, c)) }, (e) => cells.forEach((c) => e.change(cell(board, c), { terrain: "breach" })));
    breaches.push({ id: nextId++, cells, plates: 0, waste: 0, idle: 0, widened: false, across: true });
  }
  return { ...state, breaches, nextId };
}

export default puzzle("plating", {
  board: grid("width", "height"),
  parts: [hull],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 9,
    height: 12,
    roundSeconds: 150,
    maxMoves: 10_000,
    basePerCell: { default: 4, min: 0, max: 1000, description: "points for each cell of a sealed breach, before its rating" },
    flawlessPercent: { default: 300, min: 0, max: 1000, description: "what a flawless seal multiplies by" },
    solidPercent: { default: 200, min: 0, max: 1000, description: "what a seal one plate over the fewest, or with waste, multiplies by" },
    holdsPercent: { default: 150, min: 0, max: 1000, description: "what a seal two plates over multiplies by" },
    tapePercent: { default: 100, min: 0, max: 1000, description: "what a seal three plates over multiplies by" },
    gumPercent: { default: 50, min: 0, max: 1000, description: "what a seal four or more plates over multiplies by" },
    acrossPercent: { default: 125, min: 100, max: 1000, description: "what a seal multiplies by when every plate's brushing runs across" },
    streakPercent: { default: [100, 125, 150, 175, 200], min: 100, max: 1000, description: "what a flawless seal multiplies by, an entry for each in a row" },
  },
  // Every seal pays its cells, and its rating multiplies that.
  payouts: {
    flawless: { on: "flawless", counts: "cells", reads: "basePerCell" },
    seal: { on: "seal", counts: "cells", reads: "basePerCell" },
  },
  multipliers: {
    flawless: { scales: "flawless", by: "flawlessPercent" },
    solid: { scales: "seal", on: "seal when rating == 1", by: "solidPercent" },
    holds: { scales: "seal", on: "seal when rating == 2", by: "holdsPercent" },
    tape: { scales: "seal", on: "seal when rating == 3", by: "tapePercent" },
    gum: { scales: "seal", on: "seal when rating == 4", by: "gumPercent" },
    across: { scales: ["flawless", "seal"], on: "flawless or seal when across == 1", by: "acrossPercent" },
    streak: { scales: "flawless", by: "streakPercent", index: "streak" },
  },
  // Flawless seals in a row. A weld that seals nothing leaves the run as it was; a lesser seal ends it.
  streak: { builds: "flawless", counts: "events", breaksOn: ["seal"] },
});
