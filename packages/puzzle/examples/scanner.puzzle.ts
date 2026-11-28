// Scanner, a prototype puzzle, written on rungs 2 and 3: a fogged sector hiding a handful of contacts. A ping answers
// how many steps away the nearest hidden contact is, and a lock on a cell says a contact is there. A lock on empty space
// and a ping that lands on a contact are the two mistakes. When every contact is known the sector is cleared and the
// next is dealt, one contact richer every few sectors. What a contact pays, the pings a clean sector saved, the costs
// and the streak of clean sectors are payouts, a multiplier and the streak. One part of its own holds the hidden
// contacts, the numbers and the plain arguments a sector must be clearable by.
//
// The tests play it beside the engine the studio deals, move for move, and hold the two to the same sector, numbers,
// score and streak.
import { budget, clock, grid, part, puzzle, type Board, type Cell, type Changes, type Ctx, type View } from "../src/index.js";

export type PingMove = { readonly move: "ping"; readonly at: Cell };
export type LockMove = { readonly move: "lock"; readonly at: Cell };
type Move = PingMove | LockMove;

/** A ping made this sector on empty space, and the steps to the nearest contact still hidden. */
export interface Ping { readonly cell: number; readonly distance: number; readonly opening: boolean }
/**
 * The sector: its hidden contacts, those found by a lock and those a ping spooked, the pings on empty space, the cells
 * wrongly locked, the pings spent against par, and the sectors cleared so far.
 */
export interface Sector {
  readonly contacts: readonly number[];
  readonly found: readonly number[];
  readonly spooked: readonly number[];
  readonly pings: readonly Ping[];
  readonly misses: readonly number[];
  readonly spent: number;
  readonly par: number;
  readonly cleared: number;
}

const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const index = (board: Board, p: Cell): number => p.y * board.width + p.x;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
const steps = (w: number, a: number, b: number): number => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
const nearest = (w: number, contacts: readonly number[], c: number): number => Math.min(...contacts.map((k) => steps(w, c, k)));

// ---- what the numbers say. Every argument is made from what the player can see, never from the hidden contacts.

interface Sight { readonly pings: readonly { cell: number; distance: number }[]; readonly known: readonly number[]; readonly misses: readonly number[]; readonly left: number }
/** Cells the numbers prove empty: a pinged cell, a wrong lock, and every cell nearer a ping than its number. */
function clearOf(board: Board, s: Sight): boolean[] {
  const w = board.width;
  const clear = new Array<boolean>(w * board.height).fill(false);
  for (const m of s.misses) clear[m] = true;
  for (const p of s.pings) for (let c = 0; c < clear.length; c++) if (steps(w, p.cell, c) < p.distance) clear[c] = true;
  for (const k of s.known) clear[k] = false;
  return clear;
}
/** Cells that must hold a contact: a ping with one cell left on its ring, or as many cells left in fog as contacts left. */
function provenOf(board: Board, s: Sight): number[] {
  if (s.left === 0) return [];
  const w = board.width;
  const clear = clearOf(board, s);
  const known = new Set(s.known);
  const out = new Set<number>();
  for (const p of s.pings) {
    const ring = clear.flatMap((_, c) => (steps(w, p.cell, c) === p.distance && !clear[c] && !known.has(c) ? [c] : []));
    if (ring.length === 1) out.add(ring[0]!);
  }
  const fog = clear.flatMap((cl, c) => (!cl && !known.has(c) ? [c] : []));
  if (fog.length === s.left) for (const c of fog) out.add(c);
  return [...out].sort((a, b) => a - b);
}
/** True when the plain arguments alone clear the sector from pings on these cells: ping every cell proven empty, lock every cell proven taken, again. */
function solvable(board: Board, contacts: readonly number[], pinged0: readonly number[]): boolean {
  const known: number[] = [];
  const pinged = [...pinged0];
  let hidden = [...contacts];
  for (;;) {
    if (hidden.length === 0) return true;
    const sight: Sight = { pings: pinged.map((c) => ({ cell: c, distance: nearest(board.width, hidden, c) })), known, misses: [], left: hidden.length };
    const proven = provenOf(board, sight);
    if (proven.length > 0) {
      known.push(...proven);
      hidden = hidden.filter((c) => !proven.includes(c));
      continue;
    }
    const clear = clearOf(board, sight);
    const more = clear.flatMap((cl, c) => (cl && !pinged.includes(c) ? [c] : []));
    if (more.length === 0) return false;
    pinged.push(...more);
  }
}
const sightOf = (s: Sector): Sight => ({ pings: s.pings, known: [...s.found, ...s.spooked], misses: s.misses, left: s.contacts.length - s.found.length - s.spooked.length });
/** The cells the numbers prove empty, as the player sees them now. */
export const clearCells = (view: View<Sector>): boolean[] => clearOf(view.board, sightOf(view.state));
/** The cells the plain arguments prove taken, as the player sees them now. */
export const provenCells = (view: View<Sector>): number[] => provenOf(view.board, sightOf(view.state));

/**
 * Deal a sector: its contacts, then its opening ping, on empty space at least openingMin from every contact, or as far
 * as there is. A deal the plain arguments cannot clear from the opening ping is dealt again, up to dealTries deals.
 */
function deal(ctx: Ctx<Sector>, cleared: number): Sector {
  const { board } = ctx;
  const n = numbers(ctx);
  const w = board.width;
  const count = Math.min(n.maxContacts!, n.startContacts! + Math.floor(cleared / n.growEvery!));
  const draw = ctx.draw("sector");
  for (let attempt = 1; ; attempt++) {
    const free = Array.from({ length: w * board.height }, (_, c) => c);
    const contacts = Array.from({ length: count }, () => free.splice(draw.even(free.length), 1)[0]!).sort((a, b) => a - b);
    const pings: Ping[] = [];
    if (n.openingMin! > 0) {
      const far = free.map((c) => nearest(w, contacts, c));
      const want = Math.min(n.openingMin!, Math.max(...far));
      const spots = free.filter((_, i) => far[i]! >= want);
      const at = spots[draw.even(spots.length)]!;
      pings.push({ cell: at, distance: nearest(w, contacts, at), opening: true });
    }
    if (n.openingMin === 0 || attempt >= n.dealTries! || solvable(board, contacts, [pings[0]!.cell])) {
      ctx.emit("sector", { contacts: count }, (e) => pings.forEach((p) => e.arrive(cell(board, p.cell), { piece: "ping", state: p.distance })));
      return { contacts, found: [], spooked: [], pings, misses: [], spent: 0, par: n.parBase! + n.parPerContact! * count, cleared };
    }
  }
}

/** The score never goes below zero: a cost takes what the score holds, with what this move has paid so far, up to its size. */
function cost(ctx: Ctx<Sector>, event: string, fields: Record<string, unknown>, size: number, also?: (e: Changes) => void): void {
  ctx.emit(event, { ...fields, lost: Math.min(Math.max(0, ctx.score + ctx.pending), size) }, also);
}

/**
 * The sector. A ping on empty space shows its number; one on a contact spooks it, given away for no bounty. A lock on
 * a contact finds it; one on empty space is a miss. When a contact becomes known every ping sounds again, so a number
 * on the board is always true of what is left. A sector cleared within par with no mistake is clean, and pays for
 * every ping it left.
 */
const sector = part<Move, Sector>({
  name: "sector",
  rule: "ping for how far the nearest hidden contact is, and lock where one must be; a lock on empty space or a ping on a contact is a mistake",
  terrain: [{ id: "miss" }],
  pieces: [{ id: "ping", states: { count: 20 } }, { id: "contact", states: ["found", "spooked"] }],
  moves: [
    { id: "ping", description: "ask how far the nearest hidden contact is from a place", gesture: "tap", fields: { at: "place" } },
    { id: "lock", description: "say a contact is at a place", gesture: "press", fields: { at: "place" } },
  ],
  events: [
    { id: "sector", description: "a sector was dealt, with the ping it opens with", fields: { contacts: "number" }, changes: ["arrive"] },
    { id: "ping", description: "a ping on empty space answered", fields: { at: "place", distance: "number" }, changes: ["arrive"] },
    { id: "resound", description: "a ping sounded again: the contact it heard became known", fields: { at: "place", distance: "number" }, changes: ["change"] },
    { id: "find", description: "a lock found a contact", fields: { at: "place", points: "points" }, changes: ["arrive"] },
    { id: "spook", description: "a ping landed on a contact and gave it away", fields: { at: "place", lost: "number", points: "points" }, changes: ["arrive"], mistake: true },
    { id: "wrong", description: "a lock on empty space", fields: { at: "place", lost: "number", points: "points" }, changes: ["change"], mistake: true },
    { id: "over", description: "a ping past the sector's allowance", fields: { at: "place", lost: "number", points: "points" } },
    { id: "saved", description: "a clean sector paid for the pings it left", fields: { saved: "number", points: "points" } },
    { id: "clean", description: "a sector was cleared within par with no mistake", fields: { pings: "number", par: "number" }, changes: ["leave", "change"] },
    { id: "cleared", description: "a sector was cleared, over par or with a mistake", fields: { pings: "number", par: "number" }, changes: ["leave", "change"] },
  ],
  draws: [{ id: "sector", description: "where each contact hides, and where the opening ping is made", gives: "place", by: "even", when: "task", reads: ["startContacts", "openingMin", "dealTries"] }],
  stats: [{ id: "sectors", description: "sectors cleared" }, { id: "found", description: "contacts found" }, { id: "pings", description: "pings made" }],
  texts: ["reason.known", "reason.pinged", "reason.proven_empty"],
  hooks: {
    onStart: (ctx) => deal(ctx, 0),
    canMove: {
      ping(view, move: PingMove) {
        const i = index(view.board, move.at);
        if (view.state.found.includes(i) || view.state.spooked.includes(i)) return "reason.known";
        return view.state.pings.some((p) => p.cell === i) ? "reason.pinged" : null;
      },
      lock(view, move: LockMove) {
        const i = index(view.board, move.at);
        if (view.state.found.includes(i) || view.state.spooked.includes(i)) return "reason.known";
        // A cell the numbers prove empty takes no lock: a slip of the finger should not cost the streak.
        return clearCells(view)[i] ? "reason.proven_empty" : null;
      },
    },
    onMove: {
      ping(ctx, _seat, move: PingMove) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        const i = index(board, move.at);
        const spent = state.spent + 1;
        const counted = (e: Changes) => e.set("pings", ctx.value("pings") + 1);
        if (!state.contacts.includes(i)) {
          const hidden = state.contacts.filter((c) => !state.found.includes(c) && !state.spooked.includes(c));
          const distance = nearest(board.width, hidden, i);
          ctx.emit("ping", { at: move.at, distance }, (e) => counted(e.arrive(move.at, { piece: "ping", state: distance })));
          if (spent > state.par) cost(ctx, "over", { at: move.at }, -n.overPoints!);
          return { ...state, spent, pings: [...state.pings, { cell: i, distance, opening: false }] };
        }
        cost(ctx, "spook", { at: move.at }, -n.spookPoints!, (e) => counted(e.arrive(move.at, { piece: "contact", state: "spooked" })));
        if (spent > state.par) cost(ctx, "over", { at: move.at }, -n.overPoints!);
        return known(ctx, { ...state, spent, spooked: [...state.spooked, i] });
      },
      lock(ctx, _seat, move: LockMove) {
        const { board, state } = ctx;
        const i = index(board, move.at);
        if (!state.contacts.includes(i)) {
          cost(ctx, "wrong", { at: move.at }, -numbers(ctx).wrongPoints!, (e) => e.change(move.at, { terrain: "miss" }));
          return { ...state, misses: [...state.misses, i] };
        }
        ctx.emit("find", { at: move.at }, (e) => e.arrive(move.at, { piece: "contact", state: "found" }).set("found", ctx.value("found") + 1));
        return known(ctx, { ...state, found: [...state.found, i] });
      },
    },
    listMoves(view) {
      const out: Move[] = [];
      const clear = clearCells(view);
      for (const at of view.board.places()) {
        const i = index(view.board, at);
        if (view.state.found.includes(i) || view.state.spooked.includes(i)) continue;
        if (!view.state.pings.some((p) => p.cell === i)) out.push({ move: "ping", at });
        if (!clear[i]) out.push({ move: "lock", at });
      }
      return out;
    },
    pointsFor: (event, paid) => (["spook", "wrong", "over"].includes(event.event) ? -(event.fields.lost as number) : paid),
  },
});

/** A contact became known. Every ping says again how far the nearest hidden one is; with none left the sector is cleared. */
function known(ctx: Ctx<Sector>, s: Sector): Sector {
  const { board } = ctx;
  const hidden = s.contacts.filter((c) => !s.found.includes(c) && !s.spooked.includes(c));
  if (hidden.length > 0) {
    const pings = s.pings.map((p) => {
      const d = nearest(board.width, hidden, p.cell);
      if (d !== p.distance) ctx.emit("resound", { at: cell(board, p.cell), distance: d }, (e) => e.change(cell(board, p.cell), { state: d }));
      return d === p.distance ? p : { ...p, distance: d };
    });
    return { ...s, pings };
  }
  // Cleared. Only a clean sector pays for the pings it left, at the streak it was played on; then the streak moves.
  const clean = s.spent <= s.par && s.misses.length === 0 && s.spooked.length === 0;
  if (clean && s.par > s.spent) ctx.emit("saved", { saved: s.par - s.spent });
  ctx.emit(clean ? "clean" : "cleared", { pings: s.spent, par: s.par }, (e) => {
    for (const p of board.places()) {
      if (board.at(p)) e.leave(p);
      if (board.terrain(p) !== "plain") e.change(p, { terrain: "plain" });
    }
    e.set("sectors", ctx.value("sectors") + 1);
  });
  return deal(ctx, s.cleared + 1);
}

export default puzzle("scanner", {
  board: grid("width", "height"),
  parts: [sector],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 6,
    height: 6,
    roundSeconds: 150,
    maxMoves: 2000,
    startContacts: { default: 3, min: 1, max: 12, description: "contacts in the first sector" },
    growEvery: { default: 2, min: 1, max: 100, description: "sectors cleared for each contact more, up to the most" },
    maxContacts: { default: 5, min: 1, max: 12, description: "the most contacts a sector holds" },
    parBase: { default: 0, min: 0, max: 100, description: "pings a sector allows, besides its share for each contact" },
    parPerContact: { default: 2, min: 0, max: 20, description: "pings a sector allows for each contact in it" },
    openingMin: { default: 3, min: 0, max: 6, description: "how far from every contact the opening ping is made, at least; 0 makes none" },
    dealTries: { default: 12, min: 1, max: 50, description: "deals tried until the plain arguments can clear one from its opening ping" },
    contactPoints: { default: 40, min: 0, max: 100_000, description: "points for each contact found by a lock" },
    savePoints: { default: 20, min: 0, max: 100_000, description: "points for each ping of the allowance a clean sector left" },
    overPoints: { default: -10, min: -100_000, max: 0, description: "points each ping past the allowance takes away" },
    wrongPoints: { default: -60, min: -100_000, max: 0, description: "points a lock on empty space takes away" },
    spookPoints: { default: -60, min: -100_000, max: 0, description: "points a ping on a contact takes away" },
    streakPercent: { default: [120, 140, 160, 180, 200], min: 100, max: 1000, description: "what a contact and a sector's savings multiply by, an entry for each clean sector behind them" },
  },
  payouts: {
    find: { on: "find", reads: "contactPoints" },
    saved: { on: "saved", counts: "saved", reads: "savePoints" },
    spook: { on: "spook", reads: "spookPoints" },
    wrong: { on: "wrong", reads: "wrongPoints" },
    over: { on: "over", reads: "overPoints" },
  },
  multipliers: { streak: { scales: ["find", "saved"], by: "streakPercent", index: "streak" } },
  // Clean sectors in a row. Either mistake ends it at once, and so does a sector cleared over par.
  streak: { builds: "clean", counts: "events", breaksOn: ["spook", "wrong", "cleared"] },
});
