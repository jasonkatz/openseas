// Rung 3, tried early to see where parts stop being independent: Swap plus an author's own part.
import { around, budget, grid, lines, part, puzzle, refill, swap, type SwapMove } from "../src/index.js";

/** A spark: swap it to clear the three by three around it. After each rise, a new piece may turn into one. */
const sparks = part({
  name: "sparks",
  rule: "swapping a spark clears everything around it",
  pieces: [{ id: "spark" }],
  settings: [{ id: "sparkPermille", type: "whole", default: 60, min: 0, max: 1000, description: "chance in a thousand that a rise brings a spark", group: "deal" }],
  draws: [
    { id: "spark", description: "whether a rise brings a spark", gives: "number", by: "even", when: "refill", reads: ["sparkPermille"] },
    { id: "sparkAt", description: "where the spark turns up", gives: "number", by: "even", when: "refill", reads: [] },
  ],
  events: [
    { id: "burst", description: "a spark cleared everything around it", fields: { at: "place", pieces: "places", points: "points" }, changes: ["leave"], step: true },
    { id: "charge", description: "a piece on the bottom row became a spark", fields: { at: "place" }, changes: ["leave", "arrive"] },
  ],
  hooks: {
    onMove: {
      swap(ctx, _seat, { a, b }: SwapMove) {
        // swap() has already traded the two, so the spark is where the other piece was.
        const at = [a, b].find((p) => ctx.board.at(p)?.piece === "spark");
        if (!at) return;
        const pieces = around(ctx.board, at, 1);
        ctx.emit("burst", { at, pieces }, (e) => pieces.forEach((p) => e.leave(p)));
      },
    },
    onMoveEnd(ctx) {
      if (ctx.step === 0 || !ctx.draw("spark").chance(ctx.settings.sparkPermille as number)) return;
      const at = { x: ctx.draw("sparkAt").even(ctx.board.width), y: ctx.board.height - 1 };
      if (ctx.board.at(at)?.piece !== "kind") return;
      ctx.emit("charge", { at }, (e) => e.leave(at).arrive(at, { piece: "spark" }, "in place"));
    },
  },
});

export default puzzle("sparks", {
  board: grid(6, 7),
  pieces: 5,
  parts: [swap(), lines(3), refill(), sparks],
  ends: budget(20),
});
