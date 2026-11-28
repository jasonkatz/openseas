// The stock library: plain board helpers, and the stock parts built from them.
// A stock part uses the public hooks and nothing else, so an author could have written any of them.
import { part, type BoardSpec, type EndSpec, type Part, type SettingNeed } from "./puzzle.js";
import type { Board, Cell, Changes, Ctx, Direction, EventDecl, MapRows, NewPiece } from "./types.js";

// ---- plain helpers on a board. None of them touches the loop.

const key = (p: Cell): string => `${p.x},${p.y}`;
/**
 * Every group that clears: the pieces in a run of `min` or more of a kind in a row or a column, with runs of
 * one kind that touch taken as one group. Top to bottom, left to right.
 */
export function groupsOf(board: Board, min: number): Cell[][] {
  const kindAt = (p: Cell): number | undefined => {
    const piece = board.at(p);
    return piece?.piece === "kind" ? piece.kind : undefined;
  };
  const inRun = new Set<string>();
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    for (const p of board.places()) {
      const kind = kindAt(p);
      if (kind === undefined || kindAt({ x: p.x - dx, y: p.y - dy }) === kind) continue;
      const run: Cell[] = [];
      for (let q = p; board.has(q) && kindAt(q) === kind; q = { x: q.x + dx, y: q.y + dy }) run.push(q);
      if (run.length >= min) for (const q of run) inRun.add(key(q));
    }
  }
  const groups: Cell[][] = [];
  const seen = new Set<string>();
  for (const first of board.places()) {
    if (!inRun.has(key(first)) || seen.has(key(first))) continue;
    const kind = kindAt(first);
    const group: Cell[] = [];
    const todo = [first];
    seen.add(key(first));
    while (todo.length > 0) {
      const p = todo.pop()!;
      group.push(p);
      for (const q of [{ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }]) {
        if (!inRun.has(key(q)) || seen.has(key(q)) || kindAt(q) !== kind) continue;
        seen.add(key(q));
        todo.push(q);
      }
    }
    groups.push(group.sort((a, b) => a.y - b.y || a.x - b.x));
  }
  return groups;
}
/** The places within `reach` of a place, itself included, that hold a piece. */
export const around = (board: Board, at: Cell, reach: number): Cell[] => board.places().filter((p) => Math.abs(p.x - at.x) <= reach && Math.abs(p.y - at.y) <= reach && board.at(p));
export const touching = (a: Cell, b: Cell): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// ---- what a puzzle is given besides its parts

/** A number written in place, or the name of the setting that holds it. A name is given its value among the puzzle's settings. */
const held = (value: number | string, id: string, rest: Omit<SettingNeed, "id" | "default">): SettingNeed => (typeof value === "number" ? { id, default: value, ...rest } : { id: value, ...rest });

/** A grid. `touch` says which cells touch a cell: the four beside it, or with 8 the corners too. */
export const grid = (width: number | string, height: number | string, opts: { touch?: 4 | 8 } = {}): BoardSpec => {
  const w = held(width, "width", { type: "whole", min: 3, max: 12, description: "columns on the board", group: "board", unit: "cells" });
  const h = held(height, "height", { type: "whole", min: 3, max: 12, description: "rows on the board", group: "board", unit: "cells" });
  return { board: { shape: "grid", width: w.id, height: h.id, touch: opts.touch ?? 4, rim: false }, settings: [w, h] };
};
/** A ticking tempo: the rules move on by themselves, a tick every so many milliseconds. A tick's length is the puzzle's, never a setting. */
export const ticking = (tickMs: number): { kind: "ticking"; tickMs: number } => ({ kind: "ticking", tickMs });

/** A map drawn as text, a character a cell, with what each character stands for. */
export const mapOf = (rows: readonly string[], legend: Readonly<Record<string, string>>): string[][] =>
  rows.map((row, y) =>
    [...row].map((ch, x) => {
      const terrain = legend[ch];
      if (terrain === undefined) throw new Error(`mapOf: no terrain for "${ch}" at ${x},${y}`);
      return terrain;
    }),
  );
/** Lays a map on the board: every cell that is not plain becomes its terrain. Call it on the event the deal is reported as. */
export const layMap = (e: Changes, map: MapRows): void => map.forEach((row, y) => row.forEach((terrain, x) => terrain !== "plain" && e.change({ x, y }, { terrain })));
const DX = { right: 1, down: 0, left: -1, up: 0 } as const;
const DY = { right: 0, down: 1, left: 0, up: -1 } as const;
/** The cell one step from a cell, in a direction. It may be off the board. */
export const stepFrom = (at: Cell, direction: Direction): Cell => ({ x: at.x + DX[direction], y: at.y + DY[direction] });

/** The round ends when this many moves have been made. */
export const budget = (moves: number | string): EndSpec => {
  const setting = held(moves, "moves", { type: "whole", min: 1, max: 100_000, description: "moves in a round", group: "tempo", unit: "moves" });
  return { end: { id: "moves", by: "budget", setting: setting.id }, settings: [setting] };
};
/** The round ends when this many seconds have passed. A round with a clock is told when each move was made. */
export const clock = (seconds: number | string): EndSpec => {
  const setting = held(seconds, "seconds", { type: "whole", min: 1, max: 3600, description: "seconds in a round", group: "tempo", unit: "seconds" });
  return { end: { id: "clock", by: "clock", setting: setting.id }, settings: [setting] };
};

// ---- the stock parts

export type SwapMove = { readonly move: "swap"; readonly a: Cell; readonly b: Cell };
/** Swap two touching pieces. `along` holds a swap to a row or a column, and `alike` lets two of a kind trade places. */
export const swap = (opts: { along?: "row" | "column"; alike?: boolean } = {}): Part<SwapMove> => {
  const { along, alike = false } = opts;
  const canSwap = (view: { board: Board }, { a, b }: SwapMove): string | null => {
    if (!touching(a, b)) return "reason.side_by_side";
    if (along && (along === "row" ? a.y !== b.y : a.x !== b.x)) return `reason.along_${along}`;
    const pa = view.board.at(a), pb = view.board.at(b);
    if (!pa || !pb) return "reason.no_piece";
    if (!alike && pa.piece === pb.piece && pa.kind === pb.kind) return "reason.same_kind";
    return null;
  };
  const said = Object.keys(opts).length > 0;
  return part<SwapMove>({
    name: "swap",
    ...(said ? { args: [opts] } : {}),
    rule: along ? `swap two pieces side by side in a ${along}` : "swap two touching pieces",
    texts: ["reason.side_by_side", "reason.no_piece", ...(alike ? [] : ["reason.same_kind"]), ...(along ? [`reason.along_${along}`] : [])],
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

/** Lines of `min` or more of a kind clear. Each clear says how many cleared together, in the one step. */
export const lines = (min?: number): Part => {
  const args = min === undefined ? {} : { args: [min] };
  min ??= 3;
  return part({
    name: "lines",
    ...args,
    rule: `${min} or more of a kind in a line clear`,
    settings: [{ id: "lineMin", type: "whole", default: min, min: 3, max: 6, description: "pieces of a kind in a line that clear", group: "scoring", unit: "pieces" }],
    events: [{ id: "clear", description: "a line of a kind cleared", fields: { pieces: "places", size: "number", together: "number", points: "points" }, changes: ["leave"], step: true }],
    hooks: {
      onCascade(ctx) {
        const groups = groupsOf(ctx.board, ctx.settings.lineMin as number);
        for (const g of groups) ctx.emit("clear", { pieces: g, size: g.length, together: groups.length }, (e) => g.forEach((p) => e.leave(p)));
      },
    },
  });
};

/** A piece of its own that rises in among the kinds: which piece, and its chance in a thousand, as a number or a setting. */
export interface Mixed { readonly piece: string; readonly permille: number | string }
/**
 * Deal a full board, and after every clear let the pieces rise and new ones come in from below.
 * `mix` lets other pieces rise in among the kinds: one roll in a thousand for each new piece, taken in the order listed.
 * Every board is dealt with nothing left to clear and a move that clears something. `check: "settled"` asks only
 * for the first, for a puzzle where a move that clears nothing is still a move.
 */
export const refill = (opts: { mix?: readonly Mixed[]; check?: "playable" | "settled" } = {}): Part => {
  const mix = opts.mix ?? [];
  const settled = opts.check === "settled";
  const risen = (ctx: Ctx): NewPiece => {
    const draw = ctx.draw("rise");
    if (mix.length > 0) {
      let roll = draw.even(1000);
      for (const m of mix) {
        const chance = typeof m.permille === "number" ? m.permille : (ctx.settings[m.permille] as number);
        if (roll < chance) return { piece: m.piece };
        roll -= chance;
      }
    }
    return { piece: "kind", kind: 1 + draw.even(ctx.settings.kinds as number) };
  };
  return part({
    name: "refill",
    ...(mix.length > 0 || settled ? { args: [opts] } : {}),
    rule: "the pieces below rise and new ones come in",
    draws: [
      { id: "fill", description: "the kind of every piece on a fresh board", gives: "kind", by: "even", when: "start", reads: ["kinds"] },
      { id: "rise", description: mix.length > 0 ? "each piece that rises in: one of the mix, or else a kind" : "the kind of each piece that rises in", gives: mix.length > 0 ? "piece" : "kind", by: mix.length > 0 ? "weighted" : "even", when: "refill", reads: ["kinds", ...mix.flatMap((m) => (typeof m.permille === "string" ? [m.permille] : []))] },
    ],
    checks: [
      settled
        ? { id: "settled", description: "nothing is left to clear", draws: ["fill"], tries: 1, needs: "settled", fallback: "none is needed: a board that has settled passes" }
        : { id: "playable", description: "nothing is left to clear and at least one move sets off a step", draws: ["fill"], tries: 50, fallback: "lays one kind in lines a piece short of clearing, each broken by a piece of another kind, so one swap always completes a line", during: "reshuffle" },
    ],
    events: [
      { id: "fill", description: "a fresh board was dealt", fields: {}, changes: ["arrive"] },
      { id: "rise", description: "pieces rose and new ones came in from below", fields: {}, changes: ["travel", "arrive"] },
      ...(settled ? [] : [{ id: "reshuffle", description: "no move was left, so the board was dealt again", fields: {}, changes: ["leave", "arrive"] } satisfies EventDecl]),
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
            for (let y = top; y < board.height; y++) e.arrive({ x, y }, risen(ctx), "below"); // ...and new ones come in from below
          }
        });
      },
    },
  });
};
