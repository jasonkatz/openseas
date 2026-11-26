// Made from swap.puzzle.json. Never edited by hand.
import type { GridCell, Points, Puzzle } from "@openseas/engine";

export interface Swap extends Puzzle {
  cell: GridCell;
  settings: { width: number; height: number; kinds: number; moves: number; groupPoints: number; cascadePercent: readonly number[]; streakPercent: readonly number[] };
  moves: { swap: { a: GridCell; b: GridCell } };
  events: {
    fill: {};
    swap: { a: GridCell; b: GridCell };
    clear: { pieces: readonly GridCell[]; size: number; points: Points };
    rise: {};
    reshuffle: {};
  };
  signals: {};
  pieces: "kind";
  states: never;
  terrain: never;
  phases: never;
  zones: never;
  draws: "fill" | "rise";
  payouts: "group";
  endings: "moves";
  standIns: never;
}
