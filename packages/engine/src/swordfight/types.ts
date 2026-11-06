/**
 * Swordfighting: the boarding fight (DESIGN.md 3.3). Every pirate in the fight has a board of
 * `width` by `height` cells. Pairs of colored blocks fall; the player steers and turns them. Blocks
 * of one color that form a rectangle fuse into a slab, and a slab grows by a full row or column at
 * a time. A breaker is a block of a color that shatters: when it comes to rest touching its color,
 * everything of that color connected to it goes, slabs and all, and whatever falls into place may
 * set off the next breaker (a chain). Breaking sends wrack to the other side: grey blocks that
 * land in the pattern of the sender's blade, each dealt the color it ripens into after a few
 * drops. A
 * board whose entry (the top cell of the column pairs come in down) is covered, or whose pair has
 * nowhere left to rest, is out; a side with no board standing has lost.
 *
 * Time is ticks carried in moves (ADR 0015). AI boards act on their own cadence inside the
 * reducer, from the fight's PRNG, so a fight against brigands replays from one log. Aboard a ship
 * every pirate's board is its own fight whose foes are outside it: attacks leave as `outgoing`
 * events and arrive as `incoming` moves the server vouches for (ADR 0022).
 *
 * Coordinates: `col` 0..width-1 left to right, `row` 0..height-1 BOTTOM to top. Index = row * width + col.
 */

import type { PrngState } from "../prng.js";

export const SWORDFIGHT_WIDTH = 6;
export const SWORDFIGHT_HEIGHT = 12;

/** Where a blade's wrack lands: the columns, taken in turn, cursor carried across attacks. */
export interface Blade {
  readonly id: string;
  readonly columns: readonly number[];
}

/** An AI pirate: how often it drops a pair, and how often it picks the best drop it can see. */
export interface SwordAiSpec {
  /** Ticks between the pirate's drops. */
  readonly thinkTicks: number;
  /** Percent of drops that are the best the policy found; the rest are one of the next best. */
  readonly skill: number;
  /** Index into `blades`. */
  readonly blade: number;
}

export interface SwordfightConfig {
  readonly width: number;
  readonly height: number;
  /** Block colors. Each must be distinguishable without color (rule 6). */
  readonly colors: number;
  /** Chance per block of a falling pair of being a breaker, per mille. */
  readonly breakerPermille: number;
  /** Drops on a board before wrack that landed there ripens into colored blocks. */
  readonly ripenMoves: number;
  /** Points per block broken. */
  readonly cellPoints: number;
  /** A slab of n blocks scores cellPoints * n plus slabBonus * n * (n - 1) / 2 on top. */
  readonly slabBonus: number;
  /** Points of attack per block of wrack sent; the remainder carries over. */
  readonly attackPoints: number;
  /** Whether wrack sent first cancels wrack waiting to land on the sender's own board. */
  readonly offset: boolean;
  /** Wrack waiting on a board lands at the board's next drop, or after this many ticks, whichever first. */
  readonly landAfterTicks: number;
  /** At most this many rows of wrack land at once; the rest waits. */
  readonly incomingCapRows: number;
  /** Blades the fight knows. */
  readonly blades: readonly Blade[];
  /** Whether board 0 is the player's. False for a fight the server runs for a brigand crew alone. */
  readonly player: boolean;
  /** The player's blade, as an index into `blades`. */
  readonly blade: number;
  /** AI pirates on the player's side (side 0), then on the other side (side 1). */
  readonly allies: readonly SwordAiSpec[];
  readonly foes: readonly SwordAiSpec[];
  /** Points for a side's win. */
  readonly winPoints: number;
  /** Wall-clock ms per tick on the client; the server bounds claimed ticks with it. The reducer never reads it. */
  readonly tickMs: number;
  /** A pair cannot come to rest sooner than this many ticks after it appeared. */
  readonly dropTicks: number;
  /** Ticks per row of free fall on the client; presentation only, listed so the lab can slow it. */
  readonly fallTicks: number;
  readonly maxTick: number;
  readonly maxMoves: number;
}

export const DEFAULT_BLADES: readonly Blade[] = [
  { id: "cutlass", columns: [0, 1, 2, 3, 4, 5] },
  { id: "sabre", columns: [2, 3, 1, 4, 2, 3, 0, 5] },
  { id: "dirk", columns: [0, 5, 1, 4, 0, 5, 2, 3] },
];

export const DEFAULT_SWORDFIGHT_CONFIG: SwordfightConfig = {
  width: SWORDFIGHT_WIDTH,
  height: SWORDFIGHT_HEIGHT,
  colors: 4,
  breakerPermille: 170,
  ripenMoves: 2,
  cellPoints: 10,
  slabBonus: 4,
  attackPoints: 24,
  offset: true,
  landAfterTicks: 15,
  incomingCapRows: 3,
  blades: DEFAULT_BLADES,
  player: true,
  blade: 0,
  allies: [],
  foes: [{ thinkTicks: 14, skill: 60, blade: 1 }],
  winPoints: 400,
  tickMs: 200,
  dropTicks: 2,
  fallTicks: 4,
  maxTick: 1500,
  maxMoves: 2000,
};

export interface SwordPiece {
  readonly color: number;
  readonly breaker: boolean;
}

export interface SwordPair {
  readonly a: SwordPiece;
  readonly b: SwordPiece;
}

export type CellKind = "block" | "breaker" | "wrack";

export interface SwordCell {
  /** Stable identity for animation. Never reused within a fight. */
  readonly id: number;
  /** For wrack, the color it ripens into: dealt as it lands, and shown through as it ripens. */
  readonly color: number;
  readonly kind: CellKind;
  /** Wrack only: drops left before it ripens. */
  readonly ripen: number;
  /** The slab this block belongs to, or 0. */
  readonly slab: number;
}

/** A rectangle of one color that fused: bottom-left origin, `w` by `h` cells. */
export interface Slab {
  readonly id: number;
  readonly color: number;
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Rotation of a pair anchored at `col`:
 * 0: a at col, b at col+1, side by side. 1: a below b, in column col.
 * 2: b at col, a at col+1. 3: b below a, in column col.
 * Pairs appear in rotation 1 at the middle of the top row.
 */
export type SwordRotation = 0 | 1 | 2 | 3;

/** Wrack waiting to land on a board: how much, and whose blade shapes it. */
export interface PendingAttack {
  readonly wrack: number;
  readonly blade: number;
}

export interface SwordBoard {
  readonly mind: "player" | "ai";
  readonly side: 0 | 1;
  readonly ai: SwordAiSpec | null;
  readonly blade: number;
  readonly cells: ReadonlyArray<SwordCell | null>;
  readonly slabs: readonly Slab[];
  readonly current: SwordPair;
  readonly next: SwordPair;
  /** The tick the current pair appeared. */
  readonly spawnedAt: number;
  readonly pending: readonly PendingAttack[];
  /** The tick the oldest waiting attack arrived, or -1. */
  readonly pendingSince: number;
  /** Where the next block of wrack lands in a blade's column list. */
  readonly cursor: number;
  readonly drops: number;
  readonly points: number;
  /** Attack points not yet worth a block of wrack. */
  readonly pool: number;
  /** Wrack sent over the fight. */
  readonly sent: number;
  readonly bestChain: number;
  readonly out: boolean;
  /** AI only: the tick of its next drop. */
  readonly nextActTick: number;
}

export type SwordfightMove =
  /** The player's pair comes to rest with its anchor in `col` in rotation `rot`. The engine drops it. */
  | { readonly type: "place"; readonly col: number; readonly rot: SwordRotation; readonly tick: number }
  /** Time passed: AI pirates drop, waiting wrack lands. */
  | { readonly type: "wait"; readonly tick: number }
  /** Aboard only: wrack from a board outside this fight, as the server announced it. */
  | { readonly type: "incoming"; readonly board: number; readonly wrack: number; readonly blade: number; readonly tick: number }
  /** The fight is over for this board: the player yields (`won` false or absent), or the server says the side outside this fight is beaten. */
  | { readonly type: "end"; readonly won?: boolean; readonly tick: number };

export type SwordfightOutcome = "won" | "lost";

export type SwordfightEvent =
  /** A pair came to rest: the two cells and ids, a then b. A cell of -1 is a half that fell away over the top. */
  | { readonly tick: number; readonly board: number; readonly type: "placed"; readonly cells: readonly [number, number]; readonly ids: readonly [number, number] }
  /** Blocks fused into slabs (new or grown). */
  | { readonly tick: number; readonly board: number; readonly type: "fused"; readonly slabs: readonly Slab[] }
  /** Breakers shattered everything of their color they touched. `groups` is one connected set per breaker that fired. */
  | {
      readonly tick: number;
      readonly board: number;
      readonly type: "broke";
      readonly chain: number;
      readonly groups: ReadonlyArray<{ readonly color: number; readonly cells: readonly number[]; readonly ids: readonly number[]; readonly points: number }>;
      readonly points: number;
    }
  /** The board settled after a break: where everything is now. */
  | { readonly tick: number; readonly board: number; readonly type: "settled"; readonly cells: ReadonlyArray<SwordCell | null>; readonly slabs: readonly Slab[] }
  /** Wrack ripened into blocks. */
  | { readonly tick: number; readonly board: number; readonly type: "ripened"; readonly ids: readonly number[]; readonly colors: readonly number[] }
  /** Wrack sent: `to` is the board it goes to, or -1 when it leaves the fight. `offset` was cancelled against the sender's own waiting wrack. */
  | { readonly tick: number; readonly board: number; readonly type: "attack"; readonly to: number; readonly wrack: number; readonly offset: number; readonly blade: number }
  /** Wrack arrived from outside and waits on `board`. */
  | { readonly tick: number; readonly board: number; readonly type: "incoming"; readonly wrack: number; readonly blade: number }
  /** Wrack landed: the cells, ids and the colors each will ripen into, in landing order. */
  | { readonly tick: number; readonly board: number; readonly type: "landed"; readonly cells: readonly number[]; readonly ids: readonly number[]; readonly colors: readonly number[]; readonly blade: number }
  /** A board's entry is covered: its pirate is out of the fight. */
  | { readonly tick: number; readonly board: number; readonly type: "out" }
  | { readonly tick: number; readonly board: number; readonly type: "ended"; readonly outcome: SwordfightOutcome };

export interface SwordfightMoveReport {
  readonly move: SwordfightMove;
  /** Everything that happened from the previous state's tick up to and including this move's tick. */
  readonly events: readonly SwordfightEvent[];
  /** Points the player's board earned in those events. */
  readonly points: number;
}

export interface SwordfightState {
  readonly config: SwordfightConfig;
  /** Board 0 is the player's when `config.player`; allies follow, then foes. */
  readonly boards: readonly SwordBoard[];
  readonly tick: number;
  readonly rng: PrngState;
  readonly nextId: number;
  readonly nextSlabId: number;
  /** The player's points, plus the win. */
  readonly score: number;
  readonly moveCount: number;
  readonly lastMove: SwordfightMoveReport | null;
  readonly finished: boolean;
  readonly outcome: SwordfightOutcome | null;
}
