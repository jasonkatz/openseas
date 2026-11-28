// Pouring, a prototype puzzle, written on rungs 2 and 3: a few pirates share one bar top and take turns setting drinks
// down on it. A drink has a glass and a brew, and goes down only where it suits every drink beside it: each shares its
// glass or its brew. A row or column that fills is served and cleared, k lines at once paying k times k, more on a
// clean square, and a square's first ring pays too. Every drink pays its value as it goes, more the longer it waited in
// the hand; ice goes anywhere, a rag wipes a drink off, and a drink downed pays at once but too many in a row put the
// pirate out cold for a turn. The rivals play inside the move from the round's own luck, so a round replays from the
// player's moves alone, and only the player's acts are paid. Each of these is a payout or a multiplier; one part of its
// own holds the hands, the bag, the rings and the rivals' careful rating.
//
// The tests play it beside the engine the studio deals, move for move, and hold the two to the same bar, rings, hands,
// seats and score.
import { budget, grid, part, puzzle, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type PourMove = { readonly move: "pour"; readonly slot: number; readonly at: Cell };
export type DrinkMove = { readonly move: "drink"; readonly slot: number };
type Move = PourMove | DrinkMove;
/** A drink of a glass and a brew, ice, or a rag. */
export interface Piece { readonly kind: "drink" | "ice" | "rag"; readonly glass: number; readonly brew: number }
export interface Slot { readonly piece: Piece; readonly age: number }
/** A pirate: their hand, their points, drinks downed and pours since, out cold or not, turns taken and lines served. */
export interface Seat { readonly hand: readonly Slot[]; readonly score: number; readonly drunk: number; readonly sober: number; readonly asleep: boolean; readonly turns: number; readonly lines: number }
/** Every pirate, the player first; what is left in the bag; and whose ring is on each square, -1 for a clean one. */
export interface Tavern { readonly seats: readonly Seat[]; readonly bag: readonly Piece[]; readonly rings: readonly number[] }

type Bar = readonly (Piece | null)[];
/** A rival rates each line it would leave one drink short, for the next pirate to serve, at this share of a line, in percent. */
const GIFT_PERCENT = 60;
/** A drink's look on the bar: its glass and brew in one state. */
const BREWS_MAX = 6;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const cell = (n: number, i: number): Cell => ({ x: i % n, y: Math.floor(i / n) });
const look = (p: Piece): { piece: string; state?: number } => (p.kind === "ice" ? { piece: "ice" } : { piece: "drink", state: p.glass * BREWS_MAX + p.brew });
export const barOf = (board: Board): (Piece | null)[] =>
  board.places().map((p) => {
    const at = board.at(p);
    if (!at) return null;
    if (at.piece === "ice") return { kind: "ice", glass: -1, brew: -1 };
    const s = at.state as number;
    return { kind: "drink", glass: Math.floor(s / BREWS_MAX), brew: s % BREWS_MAX };
  });

interface Rules { size: number; pourPoints: number; agePoints: number; ageMax: number; ringPoints: number; linePoints: number; cleanPercent: number; tolerance: number; soberAfter: number; lastCall: number; rivalSkill: number }
const neighbours = (n: number, c: number): number[] => {
  const [col, row] = [c % n, Math.floor(c / n)];
  return [row > 0 ? c - n : -1, col < n - 1 ? c + 1 : -1, row < n - 1 ? c + n : -1, col > 0 ? c - 1 : -1].filter((x) => x >= 0);
};
const rowCells = (n: number, row: number): number[] => Array.from({ length: n }, (_, c) => row * n + c);
const colCells = (n: number, col: number): number[] => Array.from({ length: n }, (_, r) => r * n + col);
/** True when a piece may go on an empty square: every drink beside it shares its glass or its brew, or one of them is ice. */
function fits(n: number, bar: Bar, piece: Piece, c: number): boolean {
  if (piece.kind === "rag" || bar[c] !== null) return false;
  if (piece.kind === "ice") return true;
  return neighbours(n, c).every((nb) => {
    const o = bar[nb];
    return !o || o.kind === "ice" || o.glass === piece.glass || o.brew === piece.brew;
  });
}
/** The lines through a square that a drink there would fill. */
const linesFilledBy = (n: number, bar: Bar, c: number): number[][] =>
  [rowCells(n, Math.floor(c / n)), colCells(n, c % n)].filter((line) => line.every((x) => x === c || bar[x] !== null));
const slotValue = (r: Rules, s: Slot): number => (s.piece.kind === "rag" ? 0 : r.pourPoints + r.agePoints * Math.min(s.age, r.ageMax));
/** Every square a slot of a seat's hand may go on. */
function legalCells(n: number, bar: Bar, hand: readonly Slot[], slot: number): number[] {
  const s = hand[slot];
  if (!s) return [];
  return bar.flatMap((_, c) => ((s.piece.kind === "rag" ? bar[c] !== null : fits(n, bar, s.piece, c)) ? [c] : []));
}
/** What a pour would bring: the drink's value, the ring, and the lines. A rag on a drink brings nothing. */
function pourValue(r: Rules, bar: Bar, rings: readonly number[], s: Slot, c: number): { legal: boolean; lines: number[][]; points: number } {
  if (s.piece.kind === "rag") return { legal: bar[c] !== null, lines: [], points: 0 };
  if (!fits(r.size, bar, s.piece, c)) return { legal: false, lines: [], points: 0 };
  const clean = rings[c] === -1;
  const lines = linesFilledBy(r.size, bar, c);
  const base = r.linePoints * lines.length * lines.length;
  return { legal: true, lines, points: slotValue(r, s) + (clean ? r.ringPoints : 0) + (clean ? Math.floor((base * r.cleanPercent) / 100) : base) };
}
/** Gaps the next pirate's hand could fill, among the lines through a square's row and column and the ones beside them; every line for -1. */
function gifts(n: number, bar: Bar, hand: readonly Slot[], around: number): number {
  const near = (i: number, at: number): boolean => around < 0 || Math.abs(i - at) <= 1;
  const lines: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (near(i, around < 0 ? 0 : Math.floor(around / n))) lines.push(rowCells(n, i));
    if (near(i, around < 0 ? 0 : around % n)) lines.push(colCells(n, i));
  }
  const gaps = new Set<number>();
  for (const line of lines) {
    const empty = line.filter((c) => bar[c] === null);
    if (empty.length === 1) gaps.add(empty[0]!);
  }
  return [...gaps].filter((g) => hand.some((s) => fits(n, bar, s.piece, g))).length;
}
/** The next seat after one that will act, or -1 with nobody else at the bar. */
function nextAwake(seats: readonly Seat[], seat: number): number {
  for (let i = 1; i < seats.length; i++) if (!seats[(seat + i) % seats.length]!.asleep) return (seat + i) % seats.length;
  return seats.length > 1 ? (seat + 1) % seats.length : -1;
}
/** How a careful pirate rates a pour: its points now, less a share of a line for every gap it leaves the next pirate. */
export function rate(r: Rules, bar: Bar, rings: readonly number[], seats: readonly Seat[], seat: number, slot: number, c: number): number {
  const s = seats[seat]!.hand[slot]!;
  const v = pourValue(r, bar, rings, s, c);
  if (!v.legal) return -Infinity;
  const next = nextAwake(seats, seat);
  if (next === seat || next < 0) return v.points;
  const after = bar.slice();
  if (s.piece.kind === "rag") after[c] = null;
  else {
    after[c] = s.piece;
    for (const line of v.lines) for (const x of line) after[x] = null;
  }
  const around = v.lines.length > 0 ? -1 : c;
  const hand = seats[next]!.hand;
  return v.points - Math.floor(((gifts(r.size, after, hand, around) - gifts(r.size, bar, hand, around)) * r.linePoints * GIFT_PERCENT) / 100);
}

/** The next piece from the bag; an empty bag is filled with every glass and brew, the ice and the rags, shuffled. */
function deal(ctx: Ctx<Tavern>, bag: Piece[]): Piece {
  if (bag.length === 0) {
    const n = numbers(ctx);
    for (let g = 0; g < n.glasses!; g++) for (let b = 0; b < n.brews!; b++) bag.push({ kind: "drink", glass: g, brew: b });
    for (let i = 0; i < n.icePerBag!; i++) bag.push({ kind: "ice", glass: -1, brew: -1 });
    for (let i = 0; i < n.ragsPerBag!; i++) bag.push({ kind: "rag", glass: -1, brew: -1 });
    for (let i = bag.length - 1; i > 0; i--) {
      const j = ctx.draw("bag").even(i + 1);
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
  }
  return bag.shift()!;
}

/** The table a move works on, changed in place as each pirate acts. */
interface Table { bar: (Piece | null)[]; rings: number[]; seats: Seat[]; bag: Piece[] }

/** One act for a seat: a slot onto a square, or with -1 downed (or a rag tossed). Its events pay only the player. */
function act(ctx: Ctx<Tavern>, r: Rules, t: Table, seat: number, slot: number, c: number): void {
  const st = t.seats[seat]!;
  const used = st.hand[slot]!;
  const { piece } = used;
  const n = r.size;
  let [drunk, sober, asleep, points, served] = [st.drunk, st.sober, false, 0, 0];
  if (c < 0 && piece.kind === "rag") ctx.emit("toss", { seat });
  else if (c < 0) {
    points = slotValue(r, used);
    drunk += 1;
    sober = 0;
    if (drunk >= r.tolerance) [asleep, drunk] = [true, r.tolerance - 1];
    ctx.emit("drink", { seat, age: used.age, out: asleep });
  } else if (piece.kind === "rag") {
    t.bar[c] = null;
    ctx.emit("wipe", { seat, at: cell(n, c) }, (e) => e.leave(cell(n, c)));
  } else {
    const clean = t.rings[c] === -1;
    const lines = linesFilledBy(n, t.bar, c);
    const base = r.linePoints * lines.length * lines.length;
    points = slotValue(r, used) + (clean ? r.ringPoints : 0) + (clean ? Math.floor((base * r.cleanPercent) / 100) : base);
    t.bar[c] = piece;
    ctx.emit("pour", { seat, at: cell(n, c), age: used.age }, (e) => e.arrive(cell(n, c), look(piece)));
    if (clean) (t.rings[c] = seat), ctx.emit("ring", { seat, at: cell(n, c) });
    if (lines.length > 0) {
      const taken = [...new Set(lines.flat())].sort((a, b) => a - b);
      for (const x of taken) t.bar[x] = null;
      served = lines.length;
      ctx.emit("serve", { seat, lines: lines.length, clean }, (e) => {
        for (const x of taken) e.leave(cell(n, x));
        if (seat === 0 && lines.length > ctx.value("bestCombo")) e.set("bestCombo", lines.length);
      });
    }
    sober += 1;
    if (sober >= r.soberAfter && drunk > 0) [drunk, sober] = [drunk - 1, 0];
  }
  // The others in the hand age a turn, and the slot is dealt again.
  const hand = st.hand.map((s, i) => (i === slot ? { piece: deal(ctx, t.bag), age: 0 } : { piece: s.piece, age: s.age + 1 }));
  t.seats[seat] = { hand, score: st.score + points, drunk, sober, asleep, turns: st.turns + 1, lines: st.lines + served };
}

/** A rival's turn: the careful rating's best pour on rivalSkill percent of turns, anything that fits on the rest, a drink only when nothing fits. */
function rivalAct(ctx: Ctx<Tavern>, r: Rules, t: Table, seat: number): void {
  const draw = ctx.draw("bag");
  const careful = draw.even(100) < r.rivalSkill;
  const hand = t.seats[seat]!.hand;
  const options: { slot: number; c: number; rating: number }[] = [];
  hand.forEach((s, slot) => {
    for (const c of legalCells(r.size, t.bar, hand, slot)) {
      if (s.piece.kind === "rag") {
        if (!careful) continue;
        const rating = rate(r, t.bar, t.rings, t.seats, seat, slot, c);
        if (rating > 0) options.push({ slot, c, rating });
      } else options.push({ slot, c, rating: careful ? rate(r, t.bar, t.rings, t.seats, seat, slot, c) : 0 });
    }
  });
  if (options.length === 0) {
    // Nothing to pour: down the drink worth most, or toss a rag when that is all there is.
    let [slot, top] = [0, -1];
    hand.forEach((s, i) => {
      const v = s.piece.kind === "rag" ? -1 : slotValue(r, s);
      if (v > top) [top, slot] = [v, i];
    });
    return act(ctx, r, t, seat, slot, -1);
  }
  let pick = options[0]!;
  if (careful) for (const o of options) pick = o.rating > pick.rating ? o : pick;
  else pick = options[draw.even(options.length)]!;
  act(ctx, r, t, seat, pick.slot, pick.c);
}

const rulesOf = (view: View): Rules => ({ ...(numbers(view) as unknown as Rules), size: view.board.width });

/** The tavern. After the player's act the rivals take their turns, and any turn lost out cold passes, until the player is to pour again. */
const tavern = part<Move, Tavern>({
  name: "tavern",
  rule: "set a drink down where it suits every drink beside it, or down it; a row or column that fills is served",
  pieces: [{ id: "drink", states: { count: BREWS_MAX * BREWS_MAX } }, { id: "ice" }],
  moves: [
    { id: "pour", description: "set the piece in a hand slot down on a square: a drink or ice on an empty one, a rag on a drink to wipe it", gesture: "drag", fields: { slot: "number", at: "place" } },
    { id: "drink", description: "down the drink in a hand slot, or toss a rag", gesture: "tap", fields: { slot: "number" } },
  ],
  events: [
    { id: "deal", description: "every pirate was dealt a hand", fields: { seats: "number" } },
    { id: "pour", description: "a pirate set a drink or ice down; its value grows with the turns it waited", fields: { seat: "number", at: "place", age: "number", points: "points" }, changes: ["arrive"] },
    { id: "ring", description: "a drink rang a clean square for the first time", fields: { seat: "number", at: "place", points: "points" } },
    { id: "serve", description: "lines filled and were served, the drinks in them taken away", fields: { seat: "number", lines: "number", clean: "flag", points: "points" }, changes: ["leave"] },
    { id: "wipe", description: "a rag wiped a drink off the bar; its ring stays", fields: { seat: "number", at: "place" }, changes: ["leave"] },
    { id: "drink", description: "a pirate downed a drink, maybe passing out", fields: { seat: "number", age: "number", out: "flag", points: "points" } },
    { id: "toss", description: "a rag was tossed away", fields: { seat: "number" } },
    { id: "sleep", description: "a turn was lost out cold", fields: { seat: "number" } },
  ],
  draws: [{ id: "bag", description: "the order of every bag, then each rival's careful or careless turn and its careless pick", gives: "piece", by: "bag", when: "refill", reads: ["glasses", "brews", "icePerBag", "ragsPerBag", "rivalSkill"] }],
  stats: [{ id: "bestCombo", description: "the most lines one of the player's pours served" }],
  texts: ["reason.no_slot", "reason.no_suit", "reason.rag_wipes", "reason.last_call"],
  hooks: {
    onStart(ctx) {
      const n = numbers(ctx);
      const bag: Piece[] = [];
      const seats: Seat[] = Array.from({ length: n.rivals! + 1 }, () => ({ hand: Array.from({ length: n.offer! }, () => ({ piece: deal(ctx, bag), age: 0 })), score: 0, drunk: 0, sober: 0, asleep: false, turns: 0, lines: 0 }));
      ctx.emit("deal", { seats: seats.length });
      return { seats, bag, rings: new Array<number>(ctx.board.width * ctx.board.height).fill(-1) };
    },
    canMove: {
      drink: (view, move: DrinkMove) => (view.state.seats[0]!.turns >= numbers(view).lastCall! ? "reason.last_call" : view.state.seats[0]!.hand[move.slot] ? null : "reason.no_slot"),
      pour(view, move: PourMove) {
        const { seats, rings } = view.state;
        if (seats[0]!.turns >= numbers(view).lastCall!) return "reason.last_call";
        const s = seats[0]!.hand[move.slot];
        if (!s) return "reason.no_slot";
        const n = view.board.width;
        return pourValue(rulesOf(view), barOf(view.board), rings, s, move.at.y * n + move.at.x).legal ? null : s.piece.kind === "rag" ? "reason.rag_wipes" : "reason.no_suit";
      },
    },
    onMove: {
      pour: (ctx, _seat, move: PourMove) => turn(ctx, move.slot, move.at.y * ctx.board.width + move.at.x),
      drink: (ctx, _seat, move: DrinkMove) => turn(ctx, move.slot, -1),
    },
    listMoves(view) {
      const { seats } = view.state;
      if (seats[0]!.turns >= numbers(view).lastCall!) return [];
      const n = view.board.width;
      const bar = barOf(view.board);
      return seats[0]!.hand.flatMap((_, slot) => [...legalCells(n, bar, seats[0]!.hand, slot).map((c) => ({ move: "pour", slot, at: cell(n, c) })), { move: "drink", slot }]);
    },
    // Only the player's acts are paid: the rivals' points are theirs.
    pointsFor: (event, paid) => ((event.fields.seat ?? 0) === 0 ? paid : 0),
  },
});

/** The player's act, then the rivals' turns and the turns lost out cold, until the player is awake to pour again or last call. */
function turn(ctx: Ctx<Tavern>, slot: number, c: number): Tavern {
  const r = rulesOf(ctx);
  const t: Table = { bar: barOf(ctx.board), rings: ctx.state.rings.slice(), seats: ctx.state.seats.slice(), bag: ctx.state.bag.slice() };
  act(ctx, r, t, 0, slot, c);
  for (let seat = 0; ; ) {
    if (t.seats.every((s) => s.turns >= r.lastCall)) break;
    seat = (seat + 1) % t.seats.length;
    const st = t.seats[seat]!;
    if (st.turns >= r.lastCall) continue;
    if (st.asleep) {
      t.seats[seat] = { ...st, asleep: false, turns: st.turns + 1, sober: 0 };
      ctx.emit("sleep", { seat });
      continue;
    }
    if (seat === 0) break;
    rivalAct(ctx, r, t, seat);
  }
  return { seats: t.seats, bag: t.bag, rings: t.rings };
}

export default puzzle("pouring", {
  board: grid("size", "size"),
  parts: [tavern],
  ends: budget("maxMoves"),
  settings: {
    size: 6,
    maxMoves: 100,
    glasses: { default: 4, min: 2, max: 6, description: "kinds of glass" },
    brews: { default: 4, min: 2, max: 6, description: "kinds of brew" },
    offer: { default: 2, min: 1, max: 3, description: "drinks in each pirate's hand" },
    rivals: { default: 2, min: 0, max: 3, description: "rival pirates at the bar; 0, the player pours alone" },
    rivalSkill: { default: 70, min: 0, max: 100, description: "percent of a rival's turns on which it takes the pour it rates best" },
    pourPoints: { default: 5, min: 0, max: 1000, description: "points for every drink, poured or drunk" },
    agePoints: { default: 5, min: 0, max: 1000, description: "points a drink gains for each turn it waits in a hand" },
    ageMax: { default: 4, min: 0, max: 20, description: "the most turns of waiting that count" },
    ringPoints: { default: 20, min: 0, max: 1000, description: "points for a clean square's first ring" },
    linePoints: { default: 100, min: 0, max: 10_000, description: "points for lines served by one pour, times their count squared" },
    cleanPercent: { default: 200, min: 100, max: 400, description: "what lines served by a pour onto a clean square multiply by" },
    tolerance: { default: 3, min: 1, max: 6, description: "drinks in a row, without enough pours between, that put a pirate out cold for a turn" },
    soberAfter: { default: 3, min: 1, max: 10, description: "pours that take one drink off a pirate's count" },
    icePerBag: { default: 2, min: 0, max: 6, description: "ice in each bag: it goes on any empty square, and anything stands beside it" },
    ragsPerBag: { default: 2, min: 0, max: 6, description: "rags in each bag: each wipes one drink off the bar" },
    lastCall: { default: 20, min: 4, max: 60, description: "turns each pirate takes before the round ends" },
  },
  // A drink pays its value, more for each turn it waited, up to the most; a clean square its ring; k lines k times k,
  // multiplied on a clean square.
  payouts: {
    drink: { on: ["pour", "drink"], reads: "pourPoints" },
    age: { on: ["pour", "drink"], counts: "age", cap: "ageMax", reads: "agePoints" },
    ring: { on: "ring", reads: "ringPoints" },
    lines: { on: "serve", counts: "lines", growth: "superlinear", reads: "linePoints" },
  },
  multipliers: { clean: { scales: "lines", on: "serve when clean == 1", by: "cleanPercent" } },
});
