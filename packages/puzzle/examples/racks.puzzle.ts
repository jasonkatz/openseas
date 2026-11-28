// Racks, a prototype puzzle, written on rungs 2 and 3: a row of fuel racks, each a stack of cells. A move lifts the
// top of one rack, every cell of one kind sitting together there, onto another with room, as many as fit. A rack full
// of one kind ships. A crate always hangs over one rack and lands there when its count of moves runs out, smashing a
// rack it does not fit. What a shipment pays, the chain of shipments on actions in a row and the spill are payouts,
// a multiplier and the streak. One part of its own holds the crate, the bag it is drawn from and how cells stack.
//
// The tests play it beside the engine the studio deals, move for move, and hold the two to the same racks, crate,
// score and chain.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Changes, type Ctx, type View } from "../src/index.js";

export type ShiftMove = { readonly move: "shift"; readonly from: number; readonly to: number };
export type CallMove = { readonly move: "call" };
type Move = ShiftMove | CallMove;

/** The crate waiting to land: its kinds, the first lowest, the rack it hangs over, and the moves before it lands. */
export interface Crate { readonly kinds: readonly number[]; readonly rack: number; readonly lands: number }
/** The crate, the kinds left in the bag (drawn from the end), the actions taken, and the action of the last shipment. */
export interface Yard { readonly crate: Crate; readonly bag: readonly number[]; readonly actions: number; readonly lastShipAt: number }

const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
/** A rack is a column of the board, filled from the bottom. Its cells' kinds, bottom first. */
export function rackOf(board: Board, r: number): number[] {
  const out: number[] = [];
  for (let y = board.height - 1; y >= 0 && board.at({ x: r, y }); y--) out.push(board.at({ x: r, y })!.kind!);
  return out;
}
/** The cell a rack's nth cell from the bottom sits on. */
const slot = (board: Board, r: number, n: number): Cell => ({ x: r, y: board.height - 1 - n });
/** How many of one kind sit together at the top of a rack. */
const topRun = (rack: readonly number[]): number => {
  let n = 0;
  while (n < rack.length && rack[rack.length - 1 - n] === rack[rack.length - 1]) n++;
  return n;
};
const full = (board: Board, rack: readonly number[]): boolean => rack.length === board.height && rack.every((k) => k === rack[0]);

/** One kind from the bag, which is refilled with copies of every kind and shuffled when it runs out. */
function fromBag(ctx: Ctx<Yard>, bag: number[]): number {
  if (bag.length === 0) {
    const n = numbers(ctx);
    for (let k = 1; k <= n.kinds!; k++) for (let c = 0; c < n.bagCopies!; c++) bag.push(k);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = ctx.draw("racks").even(i + 1);
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
  }
  return bag.pop()!;
}

/** The next crate: its size, its cells (each after the first drawn afresh or repeating the one under it), and its mark. */
function hang(ctx: Ctx<Yard>, bag: number[]): Crate {
  const n = numbers(ctx);
  const draw = ctx.draw("racks");
  const size = n.crateLeast! + draw.even(n.crateMost! - n.crateLeast! + 1);
  const kinds: number[] = [];
  for (let i = 0; i < size; i++) {
    const fresh = i === 0 || n.mixPercent! >= 100 || draw.even(100) < n.mixPercent!;
    kinds.push(fresh ? fromBag(ctx, bag) : kinds[i - 1]!);
  }
  const racks = Array.from({ length: ctx.board.width }, (_, r) => r);
  let open = racks.filter((r) => !n.markRoom || rackOf(ctx.board, r).length + size <= ctx.board.height);
  if (open.length === 0) open = racks;
  const crate = { kinds, rack: open[draw.even(open.length)]!, lands: n.landEvery! };
  ctx.emit("crate", { rack: crate.rack, size: crate.kinds.length, lands: crate.lands });
  return crate;
}

/** A rack full of one kind ships: its cells leave, and the action is remembered for the chain. */
function shipIfFull(ctx: Ctx<Yard>, r: number, byCrate: boolean): boolean {
  const rack = rackOf(ctx.board, r);
  if (!full(ctx.board, rack)) return false;
  ctx.emit("ship", { rack: r, kind: rack[0]!, byCrate }, (e) => {
    rack.forEach((_, n) => e.leave(slot(ctx.board, r, n)));
    e.set("shipped", ctx.value("shipped") + 1);
  });
  return true;
}

/**
 * The yard. Cells are dealt low and even before the first move. A shift lifts a rack's top run onto another rack
 * with room, as many as fit. Every move brings the crate a step nearer, and a call brings it down at once; one that
 * does not fit dumps the rack first. A chain is over once the next action would come too late to carry it on.
 */
const yard = part<Move, Yard>({
  name: "yard",
  rule: "lift the top run of one rack onto another with room; a rack full of one kind ships, and a crate lands on its marked rack as its count runs out",
  pieces: [{ id: "cell" }],
  moves: [
    { id: "shift", description: "lift the top run of rack `from` onto rack `to`, as many cells as fit", gesture: "drag", fields: { from: "number", to: "number" } },
    { id: "call", description: "bring the waiting crate down now", gesture: "tap", fields: {} },
  ],
  events: [
    { id: "stack", description: "cells were dealt onto a rack before the first move", fields: { at: "place", kind: "number" }, changes: ["arrive"] },
    { id: "shift", description: "cells went from the top of one rack to the top of another", fields: { from: "number", to: "number", count: "number" }, changes: ["travel"] },
    { id: "ship", description: "a rack held a full stack of one kind and shipped", fields: { rack: "number", kind: "number", byCrate: "flag", points: "points" }, changes: ["leave"] },
    { id: "spill", description: "the crate found too little room: the rack was dumped", fields: { rack: "number", lost: "number", points: "points" }, changes: ["leave"] },
    { id: "land", description: "the crate landed on its rack", fields: { rack: "number", called: "flag" }, changes: ["arrive"] },
    { id: "crate", description: "the next crate was hung over its rack", fields: { rack: "number", size: "number", lands: "number" } },
    { id: "call", description: "the player called the crate down", fields: {} },
    { id: "lapse", description: "an action passed with no shipment, and the chain lapsed", fields: {} },
  ],
  draws: [{ id: "racks", description: "where each opening cell goes, the shuffle of the bag of kinds, each crate's size, mix and mark", gives: "piece", by: "even", when: "refill", reads: ["kinds", "bagCopies", "crateLeast", "crateMost", "mixPercent"] }],
  stats: [{ id: "shipped", description: "racks shipped" }, { id: "spills", description: "racks a crate smashed" }, { id: "calls", description: "crates called down" }],
  texts: ["reason.no_rack", "reason.empty", "reason.no_room"],
  hooks: {
    onStart(ctx) {
      const { board } = ctx;
      const n = numbers(ctx);
      const bag: number[] = [];
      const cap = Math.max(1, Math.ceil(n.startCells! / board.width));
      for (let c = 0; c < n.startCells!; c++) {
        const open = Array.from({ length: board.width }, (_, r) => r).filter((r) => rackOf(board, r).length < cap);
        if (open.length === 0) break;
        const r = open[ctx.draw("racks").even(open.length)]!;
        const kind = fromBag(ctx, bag);
        const at = slot(board, r, rackOf(board, r).length);
        ctx.emit("stack", { at, kind }, (e) => e.arrive(at, { piece: "cell", kind }));
      }
      return { crate: hang(ctx, bag), bag, actions: 0, lastShipAt: -1 };
    },
    canMove: {
      shift(view, move: ShiftMove) {
        const w = view.board.width;
        if (![move.from, move.to].every((r) => Number.isInteger(r) && r >= 0 && r < w) || move.from === move.to) return "reason.no_rack";
        if (rackOf(view.board, move.from).length === 0) return "reason.empty";
        return rackOf(view.board, move.to).length >= view.board.height ? "reason.no_room" : null;
      },
    },
    onMove: {
      shift(ctx, _seat, move: ShiftMove) {
        const { board } = ctx;
        const from = rackOf(board, move.from);
        const to = rackOf(board, move.to);
        const count = Math.min(topRun(from), board.height - to.length);
        ctx.emit("shift", { from: move.from, to: move.to, count }, (e) => {
          for (let i = 0; i < count; i++) e.travel(slot(board, move.from, from.length - count + i), slot(board, move.to, to.length + i));
        });
        const shipped = shipIfFull(ctx, move.to, false);
        return step(ctx, false, shipped);
      },
      call(ctx) {
        ctx.emit("call", {}, (e) => e.set("calls", ctx.value("calls") + 1));
        return step(ctx, true, false);
      },
    },
    // A chain still running lapses once the next action would come too late to carry it on.
    onMoveEnd(ctx) {
      const { state } = ctx;
      if (ctx.streak > 0 && state.actions - state.lastShipAt >= numbers(ctx).chainWindow!) ctx.emit("lapse", {});
    },
    pointsFor: (event, paid) => (event.event === "spill" ? -(event.fields.lost as number) : paid),
  },
});

/** The crate comes a step nearer, or down at once when called. Where it does not fit, the rack is dumped first. */
function step(ctx: Ctx<Yard>, called: boolean, shippedAlready: boolean): Yard {
  const { board, state } = ctx;
  const n = numbers(ctx);
  const actions = state.actions + 1;
  let lastShipAt = shippedAlready ? actions : state.lastShipAt;
  const left = called ? 0 : state.crate.lands - 1;
  if (left > 0) return { ...state, crate: { ...state.crate, lands: left }, actions, lastShipAt };
  const { rack: r, kinds } = state.crate;
  let rack = rackOf(board, r);
  if (rack.length + kinds.length > board.height) {
    // The score never goes below zero: the spill takes what the score holds, this move's shipments too, up to the penalty.
    const lost = Math.min(ctx.score + ctx.pending, -n.spillPoints!);
    const dumped = rack;
    ctx.emit("spill", { rack: r, lost }, (e: Changes) => {
      dumped.forEach((_, i) => e.leave(slot(board, r, i)));
      e.set("spills", ctx.value("spills") + 1);
    });
    rack = [];
  }
  const base = rack.length;
  ctx.emit("land", { rack: r, called }, (e) => kinds.forEach((kind, i) => e.arrive(slot(board, r, base + i), { piece: "cell", kind }, "crate")));
  if (shipIfFull(ctx, r, true)) lastShipAt = actions;
  const bag = state.bag.slice();
  return { ...state, crate: hang(ctx, bag), bag, actions, lastShipAt };
}

export default puzzle("racks", {
  board: grid("racks", "height"),
  parts: [yard],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    racks: { default: 5, min: 3, max: 8, description: "racks in the row" },
    height: { default: 5, min: 3, max: 8, description: "cells a rack holds; it ships when it holds this many of one kind" },
    roundSeconds: 120,
    maxMoves: 600,
    kinds: { default: 4, min: 2, max: 8, description: "kinds of cell" },
    startCells: { default: 12, min: 0, max: 56, description: "cells dealt onto the racks before the first move" },
    crateLeast: { default: 2, min: 1, max: 8, description: "the fewest cells a crate holds" },
    crateMost: { default: 3, min: 1, max: 8, description: "the most cells a crate holds" },
    mixPercent: { default: 50, min: 0, max: 100, description: "chance in a hundred that each cell of a crate after its first is drawn afresh; else it repeats the one under it" },
    landEvery: { default: 4, min: 1, max: 20, description: "moves a crate hangs before it lands by itself" },
    bagCopies: { default: 3, min: 1, max: 8, description: "copies of each kind in the bag crates are drawn from" },
    markRoom: { default: false, description: "draw the crate's mark from the racks with room for it, while any has" },
    chainWindow: { default: 1, min: 1, max: 20, description: "actions after a shipment within which the next one carries the chain on" },
    shipPoints: { default: 100, min: 0, max: 100_000, description: "points a shipment earns, before the chain" },
    chainPercent: { default: [100, 200, 300, 400, 500], min: 100, max: 2000, description: "what a shipment multiplies by, an entry for each in the chain" },
    spillPoints: { default: -50, min: -100_000, max: 0, description: "points a smashed rack takes away, never more than the score holds" },
  },
  payouts: {
    ship: { on: "ship", reads: "shipPoints" },
    spill: { on: "spill", reads: "spillPoints" },
  },
  multipliers: { chain: { scales: "ship", by: "chainPercent", index: "streak" } },
  // Shipments on actions in a row, a crate's among them. A spill or an action that ships nothing ends the chain.
  streak: { builds: "ship", counts: "events", breaksOn: ["spill", "lapse"] },
});
