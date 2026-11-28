// Cooling, one of the game's own puzzles, written on rungs 2 and 3: its numbers as data, and two parts
// of its own for the rules no stock part gives. The tests play it beside the engine the game ships,
// move for move, and hold the two to the same board and the same score.
//
// Left out: the heat a ship injects. The board keeps its own here.
import { around, budget, clock, grid, groupsOf, lines, part, puzzle, refill, swap, type Cell, type Ctx, type SwapMove } from "../src/index.js";

/**
 * The special pieces. A charge clears the three by three around where it is swapped to, and a magnet
 * clears every piece of the kind it is swapped with. A special takes its cells first, so a line it cut
 * into clears as what is left of it: `clear` when that is still a line, `scrap` when it is not.
 */
const specials = part({
  name: "specials",
  rule: "a charge swapped clears everything around it, and a magnet swapped clears every piece of the kind it met",
  pieces: [{ id: "charge" }, { id: "magnet" }],
  events: [
    { id: "burst", description: "a charge cleared everything around it", fields: { at: "place", pieces: "places", together: "number", points: "points" }, changes: ["leave"], step: true },
    { id: "wipe", description: "a magnet cleared every piece of a kind", fields: { at: "place", pieces: "places", together: "number", points: "points" }, changes: ["leave"], step: true },
    { id: "scrap", description: "what a special left of a line cleared", fields: { pieces: "places", together: "number", points: "points" }, changes: ["leave"], step: true },
  ],
  hooks: {
    onMove: {
      // swap() has already traded the two. Everything the swap clears is one step, so it is found whole before any of it is reported.
      swap(ctx: Ctx, _seat, move: SwapMove) {
        const { board } = ctx;
        const key = (p: Cell): string => `${p.x},${p.y}`;
        const taken = new Set<string>();
        const take = (cells: readonly Cell[]): Cell[] => cells.filter((p) => !taken.has(key(p)) && Boolean(taken.add(key(p))));
        const ends = [move.a, move.b].sort((p, q) => p.x - q.x || p.y - q.y);
        const met = ends.map((at, i) => ({ at, piece: board.at(at)!, other: board.at(ends[1 - i]!)! }));
        const found: { event: string; at?: Cell; pieces: Cell[] }[] = [];
        for (const { at, piece } of met) if (piece.piece === "charge") found.push({ event: "burst", at, pieces: take(around(board, at, 1)) });
        for (const { at, piece, other } of met) {
          if (piece.piece !== "magnet") continue;
          const kind = other.piece === "kind" ? other.kind : undefined;
          found.push({ event: "wipe", at, pieces: take([at, ...board.places().filter((p) => kind !== undefined && board.at(p)?.piece === "kind" && board.at(p)!.kind === kind)]) });
        }
        const min = ctx.settings.lineMin as number;
        for (const group of groupsOf(board, min)) {
          const pieces = take(group);
          found.push({ event: pieces.length >= min ? "clear" : "scrap", pieces });
        }
        const reported = found.filter((f) => f.pieces.length > 0);
        for (const { event, at, pieces } of reported) {
          const fields = event === "clear" ? { pieces, size: pieces.length } : at ? { at, pieces } : { pieces };
          ctx.emit(event, { ...fields, together: reported.length }, (e) => pieces.forEach((p) => e.leave(p)));
        }
      },
    },
  },
});

/**
 * Heat, and slag. The heat is a line across the board that rises a little with every move and falls with
 * the points a move banks. Slag never lines up: it rides upward as the pieces above it clear, and comes
 * off, for a bonus, once it is above the line. Heat is kept in parts of a row small enough that a move's
 * rise and a point's fall are both whole numbers.
 */
const heat = part<never, { heat: number }>({
  name: "heat",
  rule: "the heat rises with every move and falls with the points banked, and slag lifted above it comes off",
  pieces: [{ id: "slag" }],
  settings: [
    { id: "heatStartRow", type: "whole", default: 3, min: 0, max: 12, description: "rows under heat when a round starts", group: "tempo", unit: "rows" },
    { id: "heatLeastRow", type: "whole", default: 3, min: 0, max: 12, description: "rows the heat never falls below", group: "tempo", unit: "rows" },
    { id: "heatRiseMoves", type: "whole", default: 6, min: 1, max: 100, description: "moves in which the heat rises one row", group: "tempo", unit: "moves" },
    { id: "heatFallPoints", type: "whole", default: 40, min: 1, max: 1000, description: "points that bring the heat down one row", group: "tempo", unit: "points" },
  ],
  events: [{ id: "lift", description: "slag above the heat came off", fields: { at: "place", together: "number", points: "points" }, changes: ["leave"], step: true }],
  hooks: {
    onStart: (ctx) => ({ heat: (ctx.settings.heatStartRow as number) * (ctx.settings.heatRiseMoves as number) * (ctx.settings.heatFallPoints as number) }),
    onMoveEnd(ctx) {
      const s = ctx.settings as Record<string, number>;
      const row = s.heatRiseMoves! * s.heatFallPoints!;
      // Where the heat will stand if the move closes now, on what it has earned so far.
      const next = Math.max(s.heatLeastRow! * row, Math.min(ctx.board.height * row, ctx.state.heat + s.heatFallPoints! - ctx.pending * s.heatRiseMoves!));
      const line = ctx.board.height - Math.floor(next / row);
      const lifted = ctx.board.places().filter((p) => p.y < line && ctx.board.at(p)?.piece === "slag");
      for (const at of lifted) ctx.emit("lift", { at, together: lifted.length }, (e) => e.leave(at));
      // Slag coming off sets the cascade going, and this is asked again. The heat moves only once nothing more comes off.
      return lifted.length > 0 ? undefined : { heat: next };
    },
  },
});

export default puzzle("cooling", {
  board: grid("width", "height"),
  pieces: "kinds",
  parts: [
    swap({ along: "row", alike: true }),
    specials,
    lines(3),
    // A swap that clears nothing is still a move here, a setup for the next, so the deal asks only for a settled board.
    refill({ check: "settled", mix: [{ piece: "charge", permille: "chargePermille" }, { piece: "magnet", permille: "magnetPermille" }, { piece: "slag", permille: "slagPermille" }] }),
    heat,
  ],
  ends: [clock("roundSeconds"), budget("maxMoves")],

  settings: {
    width: 6,
    height: 12,
    kinds: 7,
    roundSeconds: 150,
    maxMoves: 10_000,
    chargePermille: { default: 12, min: 0, max: 1000, group: "deal", description: "chance in a thousand that a new piece is a charge" },
    magnetPermille: { default: 8, min: 0, max: 1000, group: "deal", description: "chance in a thousand that a new piece is a magnet" },
    slagPermille: { default: 10, min: 0, max: 1000, group: "deal", description: "chance in a thousand that a new piece is slag" },
    trimPoints: { default: -2, description: "what each piece of a group takes back from its size squared" },
    wipePoints: { default: 2, description: "points for each piece a magnet clears" },
    liftPoints: { default: 15, description: "points for a piece of slag that comes off" },
    streakGrace: { default: 1, min: 0, max: 10, description: "moves in a row that clear nothing before the streak breaks" },
    cascadePercent: [100, 200, 300],
    streakPercent: [100, 110, 120, 130, 140, 150],
  },
  // A group of n pays n × n − 2n: three pay 3, four pay 8, five pay 15.
  payouts: {
    group: { on: "clear", counts: "pieces", growth: "superlinear" },
    trim: { on: "clear", counts: "pieces", reads: "trimPoints" },
    scrap: { on: "scrap", counts: "pieces" },
    burst: { on: "burst", counts: "pieces" },
    wipe: { on: "wipe", counts: "pieces", reads: "wipePoints" },
    lift: { on: "lift", reads: "liftPoints" },
  },
  multipliers: {
    // Later steps of a cascade pay more. Slag is worth what lifting several together set up, not the cascade's luck.
    cascade: { scales: ["group", "trim", "scrap", "burst", "wipe"], by: "cascadePercent", index: "step" },
    streak: { scales: ["group", "trim", "scrap", "burst", "wipe", "lift"], by: "streakPercent", index: "streak" },
  },
  streak: { builds: ["clear", "scrap", "burst", "wipe", "lift"], grace: "streakGrace" },
  // Whatever clears together in one step multiplies by how many did: the planned double is the skill.
  pointsFor: (event, paid) => paid * ((event.fields.together as number | undefined) ?? 1),
});
