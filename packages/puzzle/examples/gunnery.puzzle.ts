// Gunnery, written on rung 4 with a ticking tempo: five parts on a deck drawn by hand. A feeder drops cell,
// sabot, slug and coolant onto the deck, and each rolls a cell a tick until something turns it. The gunner lays
// arrows that steer them into turrets, which load in that order and fire themselves when full. A wrong piece
// jams a turret, and coolant cleans it.
//
// The tests play it beside the engine the game ships, tick for tick.
//
// Left out: the queue of pieces to come is the feed's own state. A zone would hold it, and zones come with seats.
import { budget, clock, DIRECTIONS, grid, layMap, mapOf, part, puzzle, stepFrom, ticking, type Board, type Cell, type Direction, type MapRows, type Piece, type SettingNeed, type View } from "../src/index.js";

export type ArrowMove = { readonly move: "arrow"; readonly at: Cell; readonly heading: Direction };
export type RemoveMove = { readonly move: "remove"; readonly at: Cell };

/** A deck drawn as text: # wall, . plank, X crate, B feeder, C turret, H hatch. */
export const deckOf = (rows: readonly string[]): string[][] => mapOf(rows, { "#": "wall", ".": "plain", X: "crate", B: "feeder", C: "turret", H: "hatch" });
const DECKS = [
  ["####B####", "#.......#", "C.......C", "#.......#", "#..X.X..#", "#.X...X.#", "H.......H", "#.X...X.#", "#.......#", "#.XX.XX.#", "#.......#", "C.......C", "#.......#", "#.......#", "####H##H#"],
  ["#H##B#H##", "#.......#", "#.......#", "#.......#", "C..XXX..C", "#.......#", "#.X...X.#", "#...X...#", "#..X.X..#", "#.......#", "#..X.X..#", "#.......#", "C.......C", "#.......#", "#########"],
].map(deckOf);

/** What a turret takes, in order, and then the one piece that is never loaded. */
const PIECES = ["cell", "sabot", "slug", "coolant"] as const;
/** A turret's states: what it holds, in the order it loads, then full and waiting to fire, then jammed. */
const TURRET = ["empty", "one", "two", "full", "jammed"] as const;

const key = (p: Cell): string => `${p.x},${p.y}`;
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const whole = (id: string, value: number, min: number, max: number, description: string, group: SettingNeed["group"], unit?: string): SettingNeed => ({ id, type: "whole", default: value, min, max, description, group, ...(unit ? { unit } : {}) });
const turned = (heading: Direction, quarters: number): Direction => DIRECTIONS[(DIRECTIONS.indexOf(heading) + quarters) % 4]!;
/** A plank: a cell a piece can stand on and an arrow can be laid on. */
const plank = (board: Board, at: Cell): boolean => board.terrain(at) === "plain" || board.terrain(at) === "arrow";
const count = (ctx: { value(id: string): number }, id: string): number => ctx.value(id) + 1;

/** What a piece does to a turret it rolls into. `blocked` means the turret turns it away, as a wall does. */
function outcome(turret: string | null, piece: string): "load" | "loaded" | "jam" | "clean" | "splash" | "blocked" {
  if (turret === "full") return "blocked";
  if (piece === "coolant") return turret === "jammed" ? "clean" : "splash";
  if (turret === "jammed") return "blocked";
  if (piece !== PIECES[TURRET.indexOf(turret as "empty")]) return "jam";
  return turret === "two" ? "loaded" : "load";
}
/** Whether a cell turns a piece away. Other pieces never count here. */
function shut(board: Board, at: Cell, piece: string): boolean {
  const terrain = board.terrain(at);
  if (terrain === "plain" || terrain === "arrow" || terrain === "hatch") return false;
  return terrain !== "turret" || outcome(board.terrainState(at), piece) === "blocked";
}
/** The way a piece rolls next: the arrow under it, else its heading. Where that is shut it turns right, else left, else back. */
function headingOf(board: Board, at: Cell, piece: Piece): Direction | null {
  const first = (board.terrain(at) === "arrow" ? board.terrainState(at) : piece.state) as Direction;
  return [0, 1, 3, 2].map((quarters) => turned(first, quarters)).find((d) => !shut(board, stepFrom(at, d), piece.piece)) ?? null;
}

/** The deck itself: one of the maps, picked by the seed. */
const deck = part({
  name: "deck",
  rule: "pieces roll across a deck drawn by hand",
  settings: [{ id: "decks", type: "maps", description: "the decks a round may be played on", group: "board" }],
  terrain: [{ id: "wall" }, { id: "crate" }, { id: "feeder" }, { id: "hatch" }],
  draws: [{ id: "deck", description: "which deck the round is played on", gives: "map", by: "pick", when: "start", reads: ["decks"] }],
  events: [{ id: "deck", description: "the deck was laid out", fields: { map: "number" }, changes: ["change"] }],
  hooks: {
    onStart(ctx) {
      const decks = ctx.settings.decks as readonly MapRows[];
      const map = ctx.draw("deck").even(decks.length);
      ctx.emit("deck", { map }, (e) => layMap(e, decks[map]!));
    },
  },
});

/** The verb: lay an arrow on a plank, and whatever rolls over it turns that way. */
const arrows = part<ArrowMove | RemoveMove>({
  name: "arrows",
  rule: "lay arrows on the deck to steer what rolls over them",
  terrain: [{ id: "arrow", states: [...DIRECTIONS] }],
  moves: [
    { id: "arrow", description: "lay an arrow on a plank", gesture: "drag", fields: { at: "place", heading: "direction" } },
    { id: "remove", description: "take an arrow off a plank", gesture: "tap", fields: { at: "place" } },
  ],
  events: [
    { id: "arrow", description: "an arrow was laid", fields: { at: "place", heading: "direction" }, changes: ["change"] },
    { id: "remove", description: "an arrow was taken off", fields: { at: "place" }, changes: ["change"] },
  ],
  stats: [{ id: "arrows", description: "arrows laid" }],
  texts: ["reason.not_a_plank"],
  hooks: {
    canMove: {
      arrow: (view, { at }: ArrowMove) => (plank(view.board, at) ? null : "reason.not_a_plank"),
      remove: (view, { at }: RemoveMove) => (plank(view.board, at) ? null : "reason.not_a_plank"),
    },
    onMove: {
      arrow: (ctx, _seat, { at, heading }: ArrowMove) => ctx.emit("arrow", { at, heading }, (e) => e.change(at, { terrain: "arrow", state: heading }).set("arrows", count(ctx, "arrows"))),
      remove(ctx, _seat, { at }: RemoveMove) {
        if (ctx.board.terrain(at) === "arrow") ctx.emit("remove", { at }, (e) => e.change(at, { terrain: "plain" }));
      },
    },
  },
});

/** A full turret fires itself a few ticks after it loads. Once every turret has fired, that is a broadside. */
const turrets = part<never, { fires: Readonly<Record<string, number>>; fired: readonly string[] }>({
  name: "turrets",
  rule: "a full turret fires by itself, and every turret firing is a broadside",
  terrain: [{ id: "turret", states: [...TURRET] }],
  settings: [whole("fireAfter", 3, 1, 100, "ticks between a turret filling and firing", "tempo", "ticks"), whole("broadsidePoints", 300, 0, 100_000, "points for a broadside", "scoring", "points")],
  events: [
    { id: "fire", description: "a full turret fired", fields: { at: "place" }, changes: ["change"] },
    { id: "broadside", description: "every turret has fired since the last broadside", fields: { points: "points" } },
  ],
  payouts: [{ id: "broadside", description: "a broadside", on: ["broadside"], growth: "flat", reads: ["broadsidePoints"] }],
  stats: [{ id: "broadsides", description: "broadsides fired" }],
  hooks: {
    onTick(ctx, tick) {
      const { board } = ctx;
      const all = board.places().filter((p) => board.terrain(p) === "turret");
      const fires = { ...ctx.state?.fires };
      let fired = [...(ctx.state?.fired ?? [])];
      // A turret seen full for the first time filled on the tick before.
      for (const p of all) if (board.terrainState(p) === "full" && !(key(p) in fires)) fires[key(p)] = tick.n - 1 + numbers(ctx).fireAfter!;
      for (const at of all) {
        if (!(key(at) in fires) || fires[key(at)]! > tick.n) continue;
        ctx.emit("fire", { at }, (e) => e.change(at, { terrain: "turret", state: "empty" }));
        delete fires[key(at)];
        if (!fired.includes(key(at))) fired.push(key(at));
      }
      if (all.length > 0 && fired.length === all.length) {
        ctx.emit("broadside", {}, (e) => e.set("broadsides", count(ctx, "broadsides")));
        fired = [];
      }
      return { fires, fired };
    },
  },
});

/**
 * One tick of rolling, every piece at once. Two pieces that meet head on both turn back. A piece waits a tick
 * when the cell ahead holds a piece that is not leaving, or when an older piece is rolling into the same cell.
 */
const rolling = part({
  name: "rolling",
  rule: "every piece rolls a cell a tick, and one that rolls into a turret loads it, jams it or cleans it",
  pieces: PIECES.map((id) => ({ id, states: [...DIRECTIONS] })),
  settings: [whole("stepPoints", 10, 0, 100_000, "points for a piece a turret wants", "scoring", "points"), whole("loadPoints", 100, 0, 100_000, "points for a full load", "scoring", "points")],
  events: [
    { id: "roll", description: "the pieces on deck rolled", fields: {}, changes: ["travel", "change"] },
    { id: "load", description: "a turret took the piece it wanted", fields: { at: "place", from: "place", points: "points" }, changes: ["leave", "change"] },
    { id: "loaded", description: "a turret took its last piece and is full", fields: { at: "place", from: "place", points: "points" }, changes: ["leave", "change"] },
    { id: "jam", description: "a turret took the wrong piece and jammed", fields: { at: "place", from: "place" }, changes: ["leave", "change"], mistake: true },
    { id: "clean", description: "coolant cleaned a jammed turret", fields: { at: "place", from: "place" }, changes: ["leave", "change"] },
    { id: "splash", description: "coolant went into a turret that was not jammed", fields: { at: "place", from: "place" }, changes: ["leave"] },
    { id: "exit", description: "a piece rolled out through a hatch", fields: { at: "place", from: "place" }, changes: ["leave"] },
  ],
  payouts: [
    { id: "step", description: "a piece a turret wants", on: ["load"], growth: "flat", reads: ["stepPoints"] },
    { id: "load", description: "a full load", on: ["loaded"], growth: "flat", reads: ["loadPoints"] },
  ],
  gauges: [{ id: "streak", description: "full loads in a row without a jam" }],
  stats: [{ id: "loads", description: "full loads" }, { id: "jams", description: "turrets jammed" }, { id: "best_streak", description: "the most full loads in a row" }],
  hooks: {
    onTick(ctx) {
      const { board } = ctx;
      // Oldest first: where two would take one cell, the older piece has it.
      const pieces = board.places().filter((p) => board.at(p)).map((at) => ({ at, piece: board.at(at)! })).sort((a, b) => a.piece.id - b.piece.id);
      const here = new Map(pieces.map((p, i) => [key(p.at), i]));
      const targets = pieces.map(({ at, piece }) => {
        const heading = headingOf(board, at, piece);
        if (!heading) return null;
        const to = stepFrom(at, heading);
        return { heading, to, onto: board.terrain(to) === "turret" ? "turret" : board.terrain(to) === "hatch" ? "hatch" : "plank" };
      });
      const headings = pieces.map(({ piece }, i) => targets[i]?.heading ?? turned(piece.state as Direction, 2));
      const moving = targets.map((t) => t !== null);
      pieces.forEach(({ at }, i) => {
        const t = targets[i];
        if (!t || t.onto !== "plank" || !moving[i]) return;
        const j = here.get(key(t.to));
        const u = j === undefined || j === i ? null : targets[j];
        if (!u || u.onto !== "plank" || key(u.to) !== key(at)) return;
        moving[i] = moving[j!] = false;
        headings[i] = turned(t.heading, 2);
        headings[j!] = turned(u.heading, 2);
      });
      // Who waits. It only ever stops a piece, so it ends.
      for (let changed = true; changed; ) {
        changed = false;
        const claimed = new Set<string>();
        targets.forEach((t, i) => {
          if (!moving[i]) return;
          const ahead = t!.onto === "plank" ? here.get(key(t!.to)) : undefined;
          if ((ahead !== undefined && ahead !== i && !moving[ahead]) || claimed.has(key(t!.to))) return void ((moving[i] = false), (changed = true));
          claimed.add(key(t!.to));
        });
      }
      const leaves = (i: number): boolean => moving[i]! && targets[i]!.onto !== "plank";
      // What leaves the deck goes first, so the cell it stood on is free for the piece behind it.
      pieces.forEach(({ at: from, piece }, i) => {
        if (!leaves(i)) return;
        const at = targets[i]!.to;
        if (targets[i]!.onto === "hatch") return ctx.emit("exit", { at, from }, (e) => e.leave(from));
        const turret = board.terrainState(at) as (typeof TURRET)[number];
        const what = outcome(turret, piece.piece);
        if (what === "blocked") return;
        const next = what === "load" ? TURRET[TURRET.indexOf(turret) + 1]! : what === "loaded" ? "full" : what === "clean" ? "empty" : what === "jam" ? "jammed" : null;
        ctx.emit(what, { at, from }, (e) => {
          e.leave(from);
          if (next) e.change(at, { terrain: "turret", state: next });
          if (what === "loaded") e.set("loads", count(ctx, "loads"));
          if (what === "jam") e.set("jams", count(ctx, "jams"));
        });
      });
      const rolls = pieces.map((p, i) => ({ ...p, i })).filter(({ piece, i }) => !leaves(i) && (moving[i] || headings[i] !== piece.state));
      if (rolls.length === 0) return;
      ctx.emit("roll", {}, (e) => {
        for (const { at, piece, i } of rolls) {
          if (moving[i]) e.travel(at, targets[i]!.to);
          if (headings[i] !== piece.state) e.change(moving[i] ? targets[i]!.to : at, { state: headings[i]! });
        }
      });
    },
  },
});

/** The feeder drops the next piece when its rhythm says so, the deck has room and the cell it drops onto is clear. */
const feed = part<never, { queue: readonly number[]; last: number; at: Cell; heading: Direction }>({
  name: "feed",
  rule: "a feeder drops pieces onto the deck from a shuffled bag, quicker as the round goes on",
  settings: [
    whole("maxOnDeck", 8, 1, 144, "pieces on deck at which the feeder holds back", "deal", "pieces"),
    whole("dropEvery", 8, 1, 1000, "ticks between drops when a round starts", "tempo", "ticks"),
    whole("dropEveryLeast", 4, 1, 1000, "ticks between drops by the end of a round", "tempo", "ticks"),
    whole("queueLength", 3, 0, 8, "pieces to come that the feeder shows", "deal", "pieces"),
    { id: "bag", type: "list", default: [2, 2, 2, 1], min: 0, max: 20, description: "pieces in each fill of the bag: cell, sabot, slug, coolant", group: "deal", entries: { least: 4, most: 4 } },
  ],
  draws: [{ id: "feed", description: "the next piece out of the bag", gives: "piece", by: "bag", when: "tick", reads: ["bag"] }],
  events: [{ id: "drop", description: "the feeder dropped a piece onto the deck", fields: { at: "place" }, changes: ["arrive"] }],
  hooks: {
    onStart(ctx) {
      const { board } = ctx;
      // The feeder touches one plank. Pieces drop onto it, heading away from the feeder.
      const feeder = board.places().find((p) => board.terrain(p) === "feeder")!;
      const heading = DIRECTIONS.find((d) => plank(board, stepFrom(feeder, d)))!;
      const queue = Array.from({ length: numbers(ctx).queueLength! }, () => ctx.draw("feed").next());
      // The first piece drops two ticks in, so a round opens with something already moving.
      return { queue, last: 2 - numbers(ctx).dropEvery!, at: stepFrom(feeder, heading), heading };
    },
    onTick(ctx, tick) {
      const { board, state } = ctx;
      const n = numbers(ctx);
      const span = n.dropEvery! - n.dropEveryLeast!;
      const every = span <= 0 ? n.dropEvery! : Math.max(n.dropEveryLeast!, n.dropEvery! - Math.floor(((span + 1) * tick.ms) / (n.roundSeconds! * 1000)));
      if (tick.n - state.last < every || board.at(state.at) || board.places().filter((p) => board.at(p)).length >= n.maxOnDeck!) return;
      const queue = [...state.queue, ctx.draw("feed").next()];
      const piece = PIECES[queue.shift()!]!;
      ctx.emit("drop", { at: state.at }, (e) => e.arrive(state.at, { piece, state: state.heading }, "feeder"));
      return { ...state, queue, last: tick.n };
    },
  },
});

export default puzzle("gunnery", {
  board: grid("width", "height"),
  // A tick is a fifth of a second, and it is the puzzle's own: no setting changes it.
  tempo: ticking(200),
  parts: [deck, arrows, turrets, rolling, feed],
  ends: [clock("roundSeconds"), budget("maxMoves")],
  settings: {
    width: 9,
    height: { default: 15, max: 16 },
    roundSeconds: 152,
    maxMoves: 1000,
    decks: DECKS,
    streakPercent: { default: [100, 125, 150, 175, 200, 225, 250, 275, 300], min: 100, max: 1000, description: "what a full load multiplies by, an entry for each in a row without a jam" },
  },
  multipliers: { streak: { scales: "load", by: "streakPercent", index: "streak" } },
  // A success here is no move: every full load counts, nothing is a miss, and a jam breaks the run.
  streak: { builds: "loaded", counts: "events", breaksOn: ["jam"] },
});
