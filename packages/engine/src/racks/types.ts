/**
 * Racks (prototype, ADR 0036): a row of fuel racks, each a stack of cells. A move lifts the top of
 * one rack (every cell of one kind sitting together there) and sets it on another rack that has
 * room, as many as fit; any cell may sit on any other. A rack filled to the top with one kind ships
 * out for points and comes back empty.
 *
 * Cells keep arriving. A crate of a few cells always hangs over one rack, the marked one, and
 * every move brings it one step nearer: when its count of moves runs out it lands there, burying
 * whatever is on top. Any rack may be marked, a full one too. A crate that finds too little room
 * smashes the rack: everything in it is dumped, for a penalty, and the crate sits in the empty
 * rack. The player may call the crate down at once instead of waiting for it.
 *
 * A shipment on the action straight after another builds a chain that multiplies it: the second
 * ships double, the third triple. A crate that lands to complete its rack ships it and counts in
 * the chain like any other, so a call can be a link.
 *
 * A rack is listed bottom first. Nothing here reads a clock: the crate's count runs on moves, and
 * the round's length is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

export interface RacksConfig {
  /** Racks in the row. */
  readonly racks: number;
  /** Cells a rack holds. A rack ships when it holds this many of one kind. */
  readonly height: number;
  /** Kinds of cell: 0 to kinds - 1. */
  readonly kinds: number;
  /** Cells dealt onto the racks before the first move. */
  readonly startCells: number;
  /** A crate holds between crateMin and crateMax cells. */
  readonly crateMin: number;
  readonly crateMax: number;
  /** Chance in a hundred that each cell of a crate after its first is drawn afresh from the bag; otherwise it repeats the one under it. 0 makes every crate one kind. */
  readonly crateMixPercent: number;
  /** Moves a crate hangs before it lands by itself. */
  readonly landEvery: number;
  /** Copies of each kind in the bag crates are drawn from; it is refilled and shuffled when it runs out. */
  readonly bagCopies: number;
  /** A shipment scores this, times the chain. */
  readonly shipPoints: number;
  /** A shipment this many actions or fewer after the last one carries the chain on: 1 means the very next action. */
  readonly chainWindow: number;
  /** What the chain multiplies a shipment by, in percent: the first takes the first entry, a chain past the end takes the last. */
  readonly chainPercent: readonly number[];
  /** Lost when a crate smashes a rack. Score never goes below zero. */
  readonly spillPenalty: number;
  /**
   * False marks any rack for a new crate, a full one too: the mark is then a deadline. True draws the
   * mark from the racks that have room for the crate when it is hung, while any has.
   */
  readonly markRoom: boolean;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_RACKS_CONFIG: RacksConfig = {
  racks: 5,
  height: 5,
  kinds: 4,
  startCells: 12,
  crateMin: 2,
  crateMax: 3,
  crateMixPercent: 50,
  landEvery: 4,
  bagCopies: 3,
  shipPoints: 100,
  chainWindow: 1,
  chainPercent: [100, 200, 300, 400, 500],
  spillPenalty: 50,
  markRoom: false,
  maxMoves: 600,
};

export interface RacksCell {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  readonly kind: number;
}

/** The crate waiting to land. */
export interface RacksCrate {
  /** Its cells in the order they will sit: the first goes lowest. */
  readonly cells: readonly RacksCell[];
  /** The marked rack: the one it hangs over and will land on. */
  readonly rack: number;
  /** Moves left before it lands by itself: it comes down with the move that takes this to zero. */
  readonly lands: number;
}

export type RacksMove =
  /** Lift the top group of `from` and set it on `to`, as many cells as fit. */
  | { readonly type: "move"; readonly from: number; readonly to: number }
  /** Bring the waiting crate down now. */
  | { readonly type: "call" }
  | { readonly type: "end" };

export type RacksEvent =
  /** Cells went from the top of one rack to the top of another, in the order they now sit. */
  | { readonly type: "move"; readonly from: number; readonly to: number; readonly ids: readonly number[] }
  /** A rack held `height` of one kind and shipped. `byCrate` when a landing crate completed it. */
  | {
      readonly type: "ship";
      readonly rack: number;
      readonly kind: number;
      readonly ids: readonly number[];
      readonly chain: number;
      readonly chainPercent: number;
      readonly points: number;
      readonly byCrate: boolean;
    }
  /** The crate found too little room: the rack's cells were dumped before it landed. */
  | { readonly type: "spill"; readonly rack: number; readonly ids: readonly number[]; readonly penalty: number }
  /** The crate landed on its rack. `called` when the player brought it down. */
  | { readonly type: "land"; readonly rack: number; readonly ids: readonly number[]; readonly called: boolean }
  /** The next crate was hung over its rack. */
  | { readonly type: "deal"; readonly crate: RacksCrate };

export interface RacksMoveReport {
  readonly move: RacksMove;
  /** What happened, in order, for the board to play. */
  readonly events: readonly RacksEvent[];
  /** Net points: shipments less any spill. */
  readonly points: number;
}

export interface RacksState {
  readonly config: RacksConfig;
  /** Each rack bottom first. */
  readonly racks: ReadonlyArray<readonly RacksCell[]>;
  readonly crate: RacksCrate;
  /** Kinds left in the bag, drawn from the end. */
  readonly bag: readonly number[];
  readonly rng: PrngState;
  readonly nextId: number;
  readonly score: number;
  /** Actions taken: moves and calls. */
  readonly moveCount: number;
  /** Shipments in the chain still running; 0 once the chain has lapsed. */
  readonly combo: number;
  readonly bestCombo: number;
  /** The action count at the last shipment, or -1 before the first. */
  readonly lastShipAt: number;
  readonly shipped: number;
  /** Shipments a landing crate completed. */
  readonly shippedByCrate: number;
  readonly spills: number;
  readonly calls: number;
  readonly lastMove: RacksMoveReport | null;
  readonly finished: boolean;
}
