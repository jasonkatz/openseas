// The stock library: plain board helpers, and the stock parts built from them.
// A stock part uses the public hooks and nothing else, so an author could have written any of them.
import { part, type BoardSpec, type EndSpec, type Part } from "./puzzle.js";
import type { Board, Cell } from "./types.js";

// ---- plain helpers on a board. None of them touches the loop.

const key = (p: Cell): string => `${p.x},${p.y}`;
/** Every run of `min` or more of a kind in a row or a column, with runs that share a cell joined. Top to bottom, left to right. */
export function groupsOf(board: Board, min: number): Cell[][] {
  const kindAt = (p: Cell): number | undefined => {
    const piece = board.at(p);
    return piece?.piece === "kind" ? piece.kind : undefined;
  };
  const runs: Cell[][] = [];
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    for (const p of board.places()) {
      const kind = kindAt(p);
      if (kind === undefined || kindAt({ x: p.x - dx, y: p.y - dy }) === kind) continue;
      const run: Cell[] = [];
      for (let q = p; board.has(q) && kindAt(q) === kind; q = { x: q.x + dx, y: q.y + dy }) run.push(q);
      if (run.length >= min) runs.push(run);
    }
  }
  const group = new Map<string, number>();
  const groups: Cell[][] = [];
  for (const run of runs) {
    const hit = [...new Set(run.flatMap((p) => (group.has(key(p)) ? [group.get(key(p))!] : [])))];
    const into = hit[0] ?? groups.push([]) - 1;
    for (const other of hit.slice(1)) {
      for (const p of groups[other]!) group.set(key(p), into);
      groups[into]!.push(...groups[other]!);
      groups[other] = [];
    }
    for (const p of run) if (!group.has(key(p))) (group.set(key(p), into), groups[into]!.push(p));
  }
  return groups.filter((g) => g.length > 0).map((g) => g.sort((a, b) => a.y - b.y || a.x - b.x));
}
/** The places within `reach` of a place, itself included, that hold a piece. */
export const around = (board: Board, at: Cell, reach: number): Cell[] => board.places().filter((p) => Math.abs(p.x - at.x) <= reach && Math.abs(p.y - at.y) <= reach && board.at(p));
export const touching = (a: Cell, b: Cell): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// ---- what a puzzle is given besides its parts

export const grid = (width: number, height: number): BoardSpec => ({
  board: { shape: "grid", width: "width", height: "height", touch: 4, rim: false },
  settings: [
    { id: "width", type: "whole", default: width, min: 3, max: 12, description: "columns on the board", group: "board", unit: "cells" },
    { id: "height", type: "whole", default: height, min: 3, max: 12, description: "rows on the board", group: "board", unit: "cells" },
  ],
});
export const budget = (moves: number): EndSpec => ({
  end: { id: "moves", by: "budget", setting: "moves" },
  settings: [{ id: "moves", type: "whole", default: moves, min: 1, max: 200, description: "moves in a round", group: "tempo", unit: "moves" }],
});

// ---- the stock parts

export type SwapMove = { readonly move: "swap"; readonly a: Cell; readonly b: Cell };
/** Swap two touching pieces. */
export const swap = (): Part<SwapMove> => {
  const canSwap = (view: { board: Board }, { a, b }: SwapMove): string | null => {
    if (!touching(a, b)) return "reason.side_by_side";
    const pa = view.board.at(a), pb = view.board.at(b);
    if (!pa || !pb) return "reason.no_piece";
    if (pa.piece === pb.piece && pa.kind === pb.kind) return "reason.same_kind";
    return null;
  };
  return part<SwapMove>({
    name: "swap",
    rule: "swap two touching pieces",
    texts: ["reason.side_by_side", "reason.no_piece", "reason.same_kind"],
    moves: [{ id: "swap", description: "swap two pieces side by side", gesture: "drag", fields: { a: "place", b: "place" } }],
    events: [{ id: "swap", description: "two pieces traded places", fields: { a: "place", b: "place" }, changes: ["travel"] }],
    hooks: {
      canMove: { swap: canSwap },
      onMove: { swap: (ctx, _seat, { a, b }: SwapMove) => ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a)) },
      listMoves: (view) =>
        view.board.places().flatMap((a) => [{ x: a.x + 1, y: a.y }, { x: a.x, y: a.y + 1 }].filter((b) => view.board.has(b)).map((b): SwapMove => ({ move: "swap", a, b })).filter((m) => canSwap(view, m) === null)),
    },
  });
};

/** Lines of `min` or more of a kind clear. */
export const lines = (min: number): Part =>
  part({
    name: "lines",
    args: [min],
    rule: `${min} or more of a kind in a line clear`,
    settings: [{ id: "lineMin", type: "whole", default: min, min: 3, max: 6, description: "pieces of a kind in a line that clear", group: "scoring", unit: "pieces" }],
    events: [{ id: "clear", description: "a line of a kind cleared", fields: { pieces: "places", size: "number", points: "points" }, changes: ["leave"], step: true }],
    hooks: {
      onCascade(ctx) {
        for (const g of groupsOf(ctx.board, ctx.settings.lineMin as number)) ctx.emit("clear", { pieces: g, size: g.length }, (e) => g.forEach((p) => e.leave(p)));
      },
    },
  });

/** Deal a full board, and after every clear let the pieces rise and new ones come in from below. */
export const refill = (): Part =>
  part({
    name: "refill",
    rule: "the pieces below rise and new ones come in",
    draws: [
      { id: "fill", description: "the kind of every piece on a fresh board", gives: "kind", by: "even", when: "start", reads: ["kinds"] },
      { id: "rise", description: "the kind of each piece that rises in", gives: "kind", by: "even", when: "refill", reads: ["kinds"] },
    ],
    checks: [{ id: "playable", description: "nothing is left to clear and at least one move sets off a step", draws: ["fill"], tries: 50, fallback: "lays one kind in lines a piece short of clearing, each broken by a piece of another kind, so one swap always completes a line", during: "reshuffle" }],
    events: [
      { id: "fill", description: "a fresh board was dealt", fields: {}, changes: ["arrive"] },
      { id: "rise", description: "pieces rose and new ones came in from below", fields: {}, changes: ["travel", "arrive"] },
      { id: "reshuffle", description: "no move was left, so the board was dealt again", fields: {}, changes: ["leave", "arrive"] },
    ],
    hooks: {
      onStart(ctx) {
        ctx.emit("fill", {}, (e) => {
          for (const p of ctx.board.places()) e.arrive(p, { piece: "kind", kind: 1 + ctx.draw("fill").even(ctx.settings.kinds as number) });
        });
      },
      // Kind 2 on every diagonal `lineMin` apart, kind 1 between: no run is long enough to clear, and
      // swapping the first 2 with the 1 beside it completes a line. It draws nothing, so it cannot fail.
      onFallback(ctx) {
        const min = ctx.settings.lineMin as number;
        const { width, height } = ctx.board;
        if (!((width >= min && height >= 2) || (height >= min && width >= 2))) throw new Error(`refill: no board ${width} by ${height} can hold a line of ${min}`);
        ctx.emit("fill", {}, (e) => {
          for (const p of ctx.board.places()) e.arrive(p, { piece: "kind", kind: (p.x + p.y) % min === min - 1 ? 2 : 1 });
        });
      },
      onCascade(ctx) {
        const { board } = ctx;
        if (board.places().every((p) => board.at(p))) return;
        ctx.emit("rise", {}, (e) => {
          for (let x = 0; x < board.width; x++) {
            let top = 0; // pieces rise to the top of their column...
            for (let y = 0; y < board.height; y++) {
              if (!board.at({ x, y })) continue;
              if (y !== top) e.travel({ x, y }, { x, y: top });
              top++;
            }
            for (let y = top; y < board.height; y++) e.arrive({ x, y }, { piece: "kind", kind: 1 + ctx.draw("rise").even(ctx.settings.kinds as number) }, "below"); // ...and new ones come in from below
          }
        });
      },
    },
  });
