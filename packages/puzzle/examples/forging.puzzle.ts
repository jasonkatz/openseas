// Forging, a prototype puzzle, written on rungs 2 and 3: a hot billet on the anvil as a grid of spots, and a strike as
// the verb. Every spot takes so many blows before it is set, and shows a mark that says where the press may land next:
// a step of one to four, a rail or a slant to the plate's edge, a star, a hook, or an earned spark that goes anywhere.
// The n-th strike of the round pays n times, a chain of one mark pays for each link, a count (one, two, three, four) or
// a span (rail, slant, star, hook) is a set, and a set of the other kind begun the strike after links into a weave.
// Each of these is a payout read at a count the event carries. One part of its own holds the marks, the chain, the set
// in the making and the weave.
//
// A strike that leaves the press nowhere to land is a stall: no strike is left to make, and the blows left are lost.
// The round stands there, as it does once every spot is set.
//
// The tests play it beside the engine the studio deals, strike for strike, and hold the two to the same plate, chain,
// weave and score.
import { budget, grid, part, puzzle, type Board, type Cell, type Ctx, type View } from "../src/index.js";

export type StrikeMove = { readonly move: "strike"; readonly at: Cell };
/** Every mark, in the order they are drawn. A spark is never drawn: it is earned. */
export const MARKS = ["one", "two", "three", "four", "rail", "slant", "star", "hook", "spark"] as const;
export type Mark = (typeof MARKS)[number];
type Family = "count" | "span";
/**
 * The spot last struck and its mark (where the next strike may land), the chain running and its mark (null while it
 * holds only sparks), the marks struck towards a set, and the weave running with the family of its last set.
 */
export interface Anvil {
  readonly at: number | null;
  readonly lead: Mark | null;
  readonly chain: number;
  readonly chainMark: Mark | null;
  readonly run: readonly Mark[];
  readonly weave: number;
  readonly weaveFamily: Family | null;
}

/** How many marks make a set. */
const SET_SIZE = 4;
const DRAWN = MARKS.slice(0, 8);
const STEP: Partial<Record<Mark, number>> = { one: 1, two: 2, three: 3, four: 4 };
const ALL8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
const ORTHO = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const DIAG = [[1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
const HOOK = [[1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2]] as const;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const flag = (view: View, id: string): boolean => view.settings[id] === true;
const cell = (board: Board, i: number): Cell => ({ x: i % board.width, y: Math.floor(i / board.width) });
const index = (board: Board, p: Cell): number => p.y * board.width + p.x;
/** A spot's blows left, 0 once it is set (gone from the plate). */
const heatOf = (board: Board, i: number): number => (board.at(cell(board, i))?.state as number | undefined) ?? 0;
const markOf = (board: Board, i: number): Mark => board.at(cell(board, i))!.piece as Mark;

/** The kind of set a mark belongs to; a spark belongs to none and stands in for either. */
const family = (mark: Mark): Family | null => (mark === "spark" ? null : STEP[mark] !== undefined ? "count" : "span");

/** True when the settings deal this mark: its layer is on and its weight is above zero. */
function dealt(view: View, mark: Mark): boolean {
  const i = DRAWN.indexOf(mark as (typeof DRAWN)[number]);
  if (i < 0 || (view.settings.weights as readonly number[])[i]! <= 0) return false;
  if (mark === "four") return flag(view, "far");
  if (mark === "star") return flag(view, "far") && flag(view, "jumps");
  if (mark === "rail" || mark === "slant" || mark === "hook") return flag(view, "jumps");
  return true;
}

/** Every spot a mark reaches from a spot on an empty plate, in a fixed order. */
export function reach(w: number, h: number, from: number, mark: Mark): number[] {
  const [col, row] = [from % w, Math.floor(from / w)];
  const out: number[] = [];
  const add = (c: number, r: number): void => {
    const i = r * w + c;
    if (c >= 0 && c < w && r >= 0 && r < h && i !== from && !out.includes(i)) out.push(i);
  };
  const n = STEP[mark];
  if (n !== undefined) for (const [dc, dr] of ALL8) add(col + dc * n, row + dr * n);
  else if (mark === "hook") for (const [dc, dr] of HOOK) add(col + dc, row + dr);
  else if (mark === "spark") for (let i = 0; i < w * h; i++) i !== from && out.push(i);
  else
    for (const [dc, dr] of mark === "rail" ? ORTHO : mark === "slant" ? DIAG : ALL8) {
      let [c, r] = [col, row];
      while (c + dc >= 0 && c + dc < w && r + dr >= 0 && r + dr < h) (c += dc), (r += dr);
      if (c !== col || r !== row) add(c, r);
    }
  return out;
}

/** A step too long to land anywhere from its spot, even on an empty plate, is cut to the longest step that lands. */
function fit(board: Board, at: number, mark: Mark): Mark {
  let n = STEP[mark];
  if (n === undefined) return mark;
  while (n > 1 && reach(board.width, board.height, at, DRAWN[n - 1]!).length === 0) n--;
  return DRAWN[n - 1]!;
}

/** One mark from the deal stream, by weight among the marks the settings deal, fitted to its spot. */
function drawMark(ctx: Ctx<Anvil>, at: number): Mark {
  const weights = ctx.settings.weights as readonly number[];
  const marks = DRAWN.filter((m) => dealt(ctx, m));
  let left = ctx.draw("marks").even(marks.reduce((a, m) => a + weights[DRAWN.indexOf(m)]!, 0));
  for (const m of marks) if ((left -= weights[DRAWN.indexOf(m)]!) < 0) return fit(ctx.board, at, m);
  return "one";
}

/** Where the next strike may land: every live spot before the first strike, else the live spots the lead reaches. */
export function targets(board: Board, anvil: Pick<Anvil, "at" | "lead">): number[] {
  const all = board.places().map((p) => index(board, p));
  if (anvil.at === null || anvil.lead === null) return all.filter((i) => heatOf(board, i) > 0);
  return reach(board.width, board.height, anvil.at, anvil.lead).filter((i) => heatOf(board, i) > 0).sort((a, b) => a - b);
}

/** True when a run of marks, with `mark` added, could still be one set. */
function extendsRun(run: readonly Mark[], mark: Mark): boolean {
  if (run.length === 0 || run.length >= SET_SIZE) return run.length === 0;
  if (mark === "spark") return true;
  return run.every((r) => r === "spark" || (r !== mark && family(r) === family(mark)));
}
const runFamily = (run: readonly Mark[]): Family | null => run.map(family).find((f) => f !== null) ?? null;

/**
 * The anvil. A strike loses the spot one blow; unless that set it, it shows a new mark at once, or a spark when it was
 * the last spot at the plate's highest heat. The chain, the set in the making and the weave follow the mark struck.
 */
const anvil = part<StrikeMove, Anvil>({
  name: "anvil",
  rule: "strike a spot the press can reach; the mark it showed says where the press may land next",
  pieces: MARKS.map((id) => ({ id, states: { count: 6 } })),
  moves: [{ id: "strike", description: "strike the spot at a place, one the last mark struck reaches", gesture: "tap", fields: { at: "place" } }],
  events: [
    { id: "deal", description: "the plate was dealt", fields: { count: "number" }, changes: ["arrive"] },
    { id: "strike", description: "a strike, the n-th of the round, and the links of the chain it is part of", fields: { at: "place", n: "number", links: "number", heat: "number", sparked: "flag", points: "points" }, changes: ["change", "leave"] },
    { id: "count", description: "four strikes held each step once: a set, at its place in the weave", fields: { weave: "number", points: "points" } },
    { id: "span", description: "four strikes held rail, slant, star and hook once each: a set, at its place in the weave", fields: { weave: "number", points: "points" } },
    { id: "broke", description: "a set in the making, two or more strikes long, or a weave of two or more, was broken", fields: {} },
    { id: "plate", description: "every spot is set", fields: { points: "points" } },
    { id: "stall", description: "the press has nowhere to land, and the blows left on the plate are lost", fields: { left: "number" }, mistake: true },
  ],
  draws: [{ id: "marks", description: "each mark dealt, by the weights among the marks the layers deal", gives: "piece", by: "weighted", when: "start", reads: ["weights", "jumps", "far"] }],
  stats: [{ id: "strikes", description: "strikes made" }, { id: "sets", description: "sets struck" }, { id: "sparks", description: "sparks earned" }, { id: "bestChain", description: "the longest chain" }, { id: "bestWeave", description: "the longest weave" }],
  texts: ["reason.out_of_reach"],
  hooks: {
    onStart(ctx) {
      const places = ctx.board.places();
      const marks = places.map((_, i) => drawMark(ctx, i));
      ctx.emit("deal", { count: places.length }, (e) => places.forEach((p, i) => e.arrive(p, { piece: marks[i]!, state: numbers(ctx).blows! })));
      return { at: null, lead: null, chain: 0, chainMark: null, run: [], weave: 0, weaveFamily: null };
    },
    canMove: { strike: (view, move: StrikeMove) => (targets(view.board, view.state).includes(index(view.board, move.at)) ? null : "reason.out_of_reach") },
    onMove: {
      strike(ctx, _seat, move: StrikeMove) {
        const { board, state } = ctx;
        const n = numbers(ctx);
        const at = index(board, move.at);
        const was = heatOf(board, at);
        const mark = markOf(board, at);
        const heat = was - 1;
        // The last spot at the plate's highest heat, still live once struck, earns a spark.
        const heats = board.places().map((p) => heatOf(board, index(board, p)));
        const top = Math.max(...heats);
        const sparked = flag(ctx, "sparks") && heat > 0 && was === top && heats.filter((x) => x === top).length === 1;
        const next = heat > 0 ? (sparked ? "spark" : drawMark(ctx, at)) : null;

        // The chain: the same mark as the strike before, a spark standing in for it.
        const chains = state.chain > 0 && (mark === "spark" || state.chainMark === null || mark === state.chainMark);
        const chain = chains ? state.chain + 1 : 1;
        const chainMark = mark === "spark" ? (chains ? state.chainMark : null) : mark;

        // The set in the making, and the weave it may link to.
        let [run, weave, weaveFamily, broke] = [state.run, state.weave, state.weaveFamily, false];
        if (extendsRun(run, mark)) run = [...run, mark];
        else [broke, run, weave, weaveFamily] = [run.length >= 2 || weave >= 2, [mark], 0, null];
        const heading = runFamily(run);
        // A set of the same kind cannot link: the weave is over, and this run may start a new one.
        if (weave > 0 && heading !== null && heading === weaveFamily) [broke, weave, weaveFamily] = [broke || weave >= 2, 0, null];
        let set: { family: Family; weave: number } | null = null;
        if (n.setPoints! > 0 && run.length === SET_SIZE) {
          const fam = heading ?? "count";
          set = { family: fam, weave: weave > 0 && weaveFamily !== fam ? weave + 1 : 1 };
          [weave, weaveFamily, run] = [set.weave, fam, []];
        } else if (n.setPoints! <= 0) run = [];

        const strikes = ctx.value("strikes") + 1;
        ctx.emit("strike", { at: move.at, n: strikes, links: chain - 1, heat, sparked: next === "spark" }, (e) => {
          (heat > 0 ? e.change(move.at, { piece: next!, state: heat }) : e.leave(move.at)).set("strikes", strikes);
          if (next === "spark") e.set("sparks", ctx.value("sparks") + 1);
          if (chain > ctx.value("bestChain")) e.set("bestChain", chain);
        });
        if (broke) ctx.emit("broke", {});
        if (set) ctx.emit(set.family, { weave: set.weave }, (e) => e.set("sets", ctx.value("sets") + 1).set("bestWeave", Math.max(ctx.value("bestWeave"), set.weave)));
        const left = board.places().reduce((a, p) => a + heatOf(board, index(board, p)), 0);
        if (left === 0) ctx.emit("plate", {});
        else if (targets(board, { at, lead: mark }).length === 0) ctx.emit("stall", { left });
        return { at, lead: mark, chain, chainMark, run, weave, weaveFamily };
      },
    },
    listMoves: (view) => targets(view.board, view.state).map((i) => ({ move: "strike", at: cell(view.board, i) })),
  },
});

export default puzzle("forging", {
  board: grid("width", "height"),
  parts: [anvil],
  ends: budget("maxMoves"),
  settings: {
    width: 6,
    height: 6,
    maxMoves: 400,
    blows: { default: 3, min: 1, max: 5, description: "strikes a spot takes before it is set" },
    jumps: { default: true, description: "rails, slants and hooks are dealt; off, steps only" },
    far: { default: true, description: "steps of four, and stars where jumps are dealt; off, steps of one to three" },
    sparks: { default: true, description: "the last spot at the plate's highest heat shows a spark" },
    weights: { default: [10, 10, 10, 8, 8, 8, 6, 8], min: 0, max: 100, description: "how likely each mark is: one, two, three, four, rail, slant, star, hook" },
    strikePoints: { default: 1, min: 0, max: 1000, description: "points for a strike, times its place in the round" },
    platePoints: { default: 500, min: 0, max: 100_000, description: "points for setting the whole plate" },
    chainPoints: { default: 10, min: 0, max: 1000, description: "points for each link of a chain of one mark, up to the cap" },
    chainCap: { default: 3, min: 1, max: 20, description: "the links past which a chain pays no more" },
    setPoints: { default: 50, min: 0, max: 10_000, description: "points for a set, times its place in the weave; 0 deals no sets" },
    weaveCap: { default: 5, min: 1, max: 20, description: "the place in a weave past which a set pays no more; 1 never links them" },
  },
  // The n-th strike pays n times; each link of a chain pays, up to the cap; the k-th set of a weave pays k times.
  payouts: {
    strike: { on: "strike", counts: "n", reads: "strikePoints" },
    chain: { on: "strike", counts: "links", cap: "chainCap", reads: "chainPoints" },
    set: { on: ["count", "span"], counts: "weave", cap: "weaveCap", reads: "setPoints" },
    plate: { on: "plate", reads: "platePoints" },
  },
});
