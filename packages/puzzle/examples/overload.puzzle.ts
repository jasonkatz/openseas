// Overload, a prototype puzzle, written on rungs 2 and 3 with a ticking tempo: a bank of capacitors, each holding
// a charge of 0 to 3, and a tap as the verb. A capacitor that reaches four bursts and passes a charge to each
// neighbour; the bursts it sets off are one chain, and a chain of n bursts pays n times n. Taps are scarce: a few are
// held, one comes back every so many ticks, and a long chain gives some back. What a chain pays and the streak of long
// chains are a payout and a multiplier. One part of its own holds the taps and how a chain runs.
//
// The tests play it beside the engine the studio deals, tick for tick, and hold the two to the same bank, taps,
// score and streak.
import { budget, clock, grid, part, puzzle, ticking, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type TapMove = { readonly move: "tap"; readonly at: Cell };
/** The tick the round has reached, and the tick the tap now coming back started from: the tick itself while every tap is held. */
export interface Hand { readonly now: number; readonly regenFrom: number }

/** A capacitor bursts when its charge reaches this: one for each neighbour it passes to. */
const FULL = 4;
/** A tick is a tenth of a second, and it is the puzzle's own: no setting changes it. */
const TICK_MS = 100;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const index = (board: Board, p: Cell): number => p.y * board.width + p.x;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
/** The cells above, right of, below and left of a cell, in that order. */
const neighbours = (board: Board, i: number): number[] => {
  const [x, y] = [i % board.width, Math.floor(i / board.width)];
  return [y > 0 ? i - board.width : -1, x < board.width - 1 ? i + 1 : -1, y < board.height - 1 ? i + board.width : -1, x > 0 ? i - 1 : -1].filter((c) => c >= 0);
};

/** A fresh capacitor: its charge by the refill weights, and a booster by the booster chance. */
function fresh(ctx: Ctx<Hand>): { piece: string; state: number } {
  const n = numbers(ctx);
  const weights = ctx.settings.refill as readonly number[];
  const draw = ctx.draw("bank");
  let left = draw.even(weights.reduce((a, w) => a + w, 0));
  let charge = 0;
  while (left >= weights[charge]!) left -= weights[charge++]!;
  return { piece: draw.chance(n.boosterPermille!) ? "booster" : "capacitor", state: charge };
}

/**
 * A chain run to its end on charges that already hold the tap. Every live capacitor at four or more bursts together:
 * it is spent, and passes one charge (two from a booster) to each live neighbour, wave after wave. A capacitor bursts
 * once, so charge passed to a spent one is lost.
 */
export function chainOf(board: Board, charges: readonly number[]): { size: number; spent: boolean[]; settled: number[] } {
  const settled = charges.slice();
  const spent = settled.map(() => false);
  let size = 0;
  for (;;) {
    const bursts = settled.flatMap((c, i) => (!spent[i] && c >= FULL ? [i] : []));
    if (bursts.length === 0) return { size, spent, settled };
    for (const i of bursts) (spent[i] = true), (settled[i] = 0);
    for (const i of bursts) for (const nb of neighbours(board, i)) if (!spent[nb]) settled[nb] = settled[nb]! + (board.at(cell(board, i))!.piece === "booster" ? 2 : 1);
    size += bursts.length;
  }
}
const chargesOf = (board: Board): number[] => board.places().map((p) => board.at(p)!.state as number);

/**
 * The bank. A tap adds a charge, and one that reaches four sets a chain off. When the chain ends every spent
 * capacitor is swapped for a fresh one, so the bank never drains. A chain gives a tap back for every few bursts.
 */
const bank = part<TapMove, Hand>({
  name: "bank",
  rule: "tap a capacitor to charge it; one that reaches four bursts into its neighbours, and everything one tap sets off is one chain",
  pieces: [{ id: "capacitor", states: { count: 4 } }, { id: "booster", states: { count: 4 } }],
  moves: [{ id: "tap", description: "add a charge to the capacitor at a place, for a tap", gesture: "tap", fields: { at: "place" } }],
  events: [
    { id: "fresh", description: "a fresh capacitor was swapped in", fields: { at: "place", charge: "number" }, changes: ["arrive"] },
    { id: "tap", description: "a tap charged a capacitor", fields: { at: "place", charge: "number" }, changes: ["change"] },
    { id: "chain", description: "a tap set off a chain long enough to build the streak", fields: { at: "place", size: "number", reach: "number", points: "points" }, changes: ["leave", "change"] },
    { id: "short", description: "a tap set off a chain too short to build the streak", fields: { at: "place", size: "number", reach: "number", points: "points" }, changes: ["leave", "change"] },
    { id: "back", description: "a tap came back, with time or from a long chain", fields: { taps: "number" } },
  ],
  draws: [{ id: "bank", description: "each fresh capacitor's charge, by the refill weights, and whether it is a booster", gives: "piece", by: "weighted", when: "refill", reads: ["refill", "boosterPermille"] }],
  gauges: [{ id: "taps", description: "taps held", most: "tapCap" }],
  stats: [{ id: "chains", description: "chains set off" }, { id: "bursts", description: "bursts in all" }, { id: "refunds", description: "taps a chain gave back" }],
  texts: ["reason.no_taps"],
  hooks: {
    onStart(ctx) {
      for (const at of ctx.board.places()) {
        const f = fresh(ctx);
        ctx.emit("fresh", { at, charge: f.state }, (e) => e.arrive(at, f));
      }
      ctx.emit("back", { taps: numbers(ctx).startTaps! }, (e) => e.set("taps", numbers(ctx).startTaps!));
      return { now: 0, regenFrom: 0 };
    },
    // A tap comes back every so many ticks while the hand is short. While it is full the wait starts afresh.
    onTick(ctx, tick) {
      const n = numbers(ctx);
      const taps = ctx.value("taps");
      if (taps >= n.tapCap!) return { now: tick.n, regenFrom: tick.n };
      if (tick.n - ctx.state.regenFrom < n.tapRegenTicks!) return { ...ctx.state, now: tick.n };
      ctx.emit("back", { taps: taps + 1 }, (e) => e.set("taps", taps + 1));
      return { now: tick.n, regenFrom: taps + 1 >= n.tapCap! ? tick.n : ctx.state.regenFrom + n.tapRegenTicks! };
    },
    canMove: {
      tap(view, move: TapMove) {
        return view.value("taps") < 1 ? "reason.no_taps" : null;
      },
    },
    onMove: {
      tap(ctx, _seat, move: TapMove) {
        const { board } = ctx;
        const n = numbers(ctx);
        const held = ctx.value("taps");
        // Spending a tap from a full hand starts the next one coming back now.
        const regenFrom = held >= n.tapCap! ? ctx.state.now : ctx.state.regenFrom;
        const charges = chargesOf(board);
        const i = index(board, move.at);
        charges[i] = charges[i]! + 1;
        ctx.emit("tap", { at: move.at, charge: charges[i]! }, (e) => e.change(move.at, { state: charges[i]! }).set("taps", held - 1));
        if (charges[i]! < FULL) return { ...ctx.state, regenFrom };
        const chain = chainOf(board, charges);
        const reach = chain.size * Math.min(chain.size, n.chainCap!);
        const refund = Math.min(n.refundEvery! > 0 ? Math.floor(chain.size / n.refundEvery!) : 0, n.tapCap! - (held - 1));
        ctx.emit(chain.size >= n.streakMin! ? "chain" : "short", { at: move.at, size: chain.size, reach }, (e) => {
          chain.settled.forEach((c, k) => (chain.spent[k] ? e.leave(cell(board, k)) : e.change(cell(board, k), { state: Math.min(FULL - 1, c) })));
          e.set("chains", ctx.value("chains") + 1).set("bursts", ctx.value("bursts") + chain.size);
          if (refund > 0) e.set("refunds", ctx.value("refunds") + refund);
        });
        if (refund > 0) ctx.emit("back", { taps: held - 1 + refund }, (e) => e.set("taps", held - 1 + refund));
        chain.spent.forEach((spent, k) => {
          if (!spent) return;
          const f = fresh(ctx);
          ctx.emit("fresh", { at: cell(board, k), charge: f.state }, (e) => e.arrive(cell(board, k), f));
        });
        return { ...ctx.state, regenFrom };
      },
    },
    listMoves: (view) => (view.value("taps") < 1 ? [] : view.board.places().map((at) => ({ move: "tap", at }))),
  },
});

export default puzzle("overload", {
  board: grid("width", "height"),
  // A tick is a tenth of a second: taps come back on it.
  tempo: ticking(TICK_MS),
  parts: [bank],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 6,
    height: 7,
    roundSeconds: 120,
    maxMoves: 1000,
    refill: { default: [30, 35, 25, 10], min: 0, max: 1000, description: "how likely a fresh capacitor is to hold 0, 1, 2 or 3 charges, as weights" },
    boosterPermille: { default: 40, min: 0, max: 500, description: "chance in a thousand that a fresh capacitor is a booster, passing two charges a neighbour" },
    tapCap: { default: 5, min: 1, max: 12, description: "the most taps held at once" },
    startTaps: { default: 5, min: 0, max: 12, description: "taps the round opens with" },
    tapRegenTicks: { default: 25, min: 1, max: 10_000, description: "ticks for a tap to come back" },
    refundEvery: { default: 4, min: 0, max: 1000, description: "bursts in a chain for each tap it gives back; 0 gives none" },
    chainCap: { default: 20, min: 1, max: 1000, description: "the bursts past which a chain grows by its size alone" },
    streakMin: { default: 4, min: 1, max: 100, description: "bursts a chain needs to build the streak; a shorter one breaks it" },
    burstPoints: { default: 1, min: 0, max: 1000, description: "points for each burst, times the chain's bursts up to the cap" },
    streakPercent: { default: [100, 125, 150, 175, 200, 225, 250, 275, 300], min: 100, max: 1000, description: "what a long chain multiplies by, an entry for each in a row" },
  },
  // A chain of n bursts reaches n × n, and n × the cap past it.
  payouts: { chain: { on: ["chain", "short"], counts: "reach", reads: "burstPoints" } },
  multipliers: { streak: { scales: "chain", on: "chain", by: "streakPercent", index: "streak" } },
  // Long chains in a row. A tap that sets nothing off leaves it; a short chain ends it.
  streak: { builds: "chain", counts: "events", breaksOn: ["short"] },
});
