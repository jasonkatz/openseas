/**
 * Gunnery: pieces roll about a deck in discrete ticks. The gunner places arrows that steer them
 * into cannons, which load in the order powder, wad, shot. Water washes a cannon out, a wrong piece
 * fouls it, a full load fires after a while and leaves the cannon fouled.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 TOP to bottom, the same
 * order as the deck rows in content. Directions: 0 right, 1 down, 2 left, 3 up.
 *
 * Time is data: every move carries the integer `tick` it happens at, the reducer advances the
 * simulation to that tick first. Nothing here reads a clock (ADR 0003).
 */

import type { PrngState } from "../prng.js";

export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

export const GunneryKind = { Powder: 0, Wad: 1, Shot: 2, Water: 3 } as const;
export const GUNNERY_KINDS = 4;

export type DeckCell = "wall" | "deck" | "crate" | "barrel" | "cannon" | "hatch";

export interface GunneryConfig {
  /** The deck, one string per row: # wall, . deck, X crate, B barrel, C cannon, H hatch. */
  readonly deck: readonly string[];
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** The round ends after this many logged moves (arrows and waits). */
  readonly maxMoves: number;
  readonly maxArrows: number;
  /** The barrel keeps this many of each kind on deck. */
  readonly perKindOnDeck: number;
  readonly spawnEveryTicks: number;
  /** A loaded cannon fires itself this many ticks after loading (practice stand-in for the captain). */
  readonly fireAfterTicks: number;
  readonly loadPoints: number;
}

export const DEFAULT_GUNNERY_DECK: readonly string[] = [
  "#########",
  "#.......#",
  "C.......C",
  "#...X...#",
  "H.......H",
  "#...B...#",
  "H.......H",
  "#...X...#",
  "C.......C",
  "#.......#",
  "#########",
];

export const DEFAULT_GUNNERY_CONFIG: GunneryConfig = {
  deck: DEFAULT_GUNNERY_DECK,
  tickMs: 220,
  maxTick: 720,
  maxMoves: 400,
  maxArrows: 3,
  perKindOnDeck: 2,
  spawnEveryTicks: 4,
  fireAfterTicks: 20,
  loadPoints: 100,
};

export interface GunneryPiece {
  readonly id: number;
  readonly kind: number;
  readonly col: number;
  readonly row: number;
  readonly dir: Dir;
}

export interface Arrow {
  readonly col: number;
  readonly row: number;
  readonly dir: Dir;
  /** Placement order, for evicting the oldest. */
  readonly seq: number;
}

export interface Cannon {
  readonly col: number;
  readonly row: number;
  /** Pieces loaded so far in order: 0 empty, 1 powder, 2 powder+wad, 3 ready. */
  readonly loaded: number;
  readonly fouled: boolean;
  /** Tick the cannon fires itself, while loaded. */
  readonly firesAt: number | null;
}

export type GunneryMove =
  | { readonly type: "arrow"; readonly col: number; readonly row: number; readonly dir: Dir; readonly tick: number }
  | { readonly type: "remove"; readonly col: number; readonly row: number; readonly tick: number }
  | { readonly type: "wait"; readonly tick: number }
  | { readonly type: "end"; readonly tick: number };

export interface GunneryEvent {
  readonly tick: number;
  readonly type: "load" | "loaded" | "foul" | "clean" | "fire" | "spawn" | "exit" | "waste";
  /** Index into `cannons` for cannon events. */
  readonly cannon?: number;
  readonly pieceId?: number;
  readonly kind?: number;
}

export interface GunneryMoveReport {
  readonly move: GunneryMove;
  /** Everything that happened from the previous state's tick up to and including this move's tick. */
  readonly events: readonly GunneryEvent[];
  readonly points: number;
}

export interface ParsedDeck {
  readonly width: number;
  readonly height: number;
  /** Row-major, index = row * width + col. */
  readonly cells: readonly DeckCell[];
  readonly barrel: { readonly col: number; readonly row: number };
  readonly cannons: ReadonlyArray<{ readonly col: number; readonly row: number }>;
}

export interface GunneryState {
  readonly config: GunneryConfig;
  readonly deck: ParsedDeck;
  readonly tick: number;
  readonly pieces: readonly GunneryPiece[];
  readonly arrows: readonly Arrow[];
  readonly cannons: readonly Cannon[];
  readonly arrowSeq: number;
  readonly nextId: number;
  readonly rng: PrngState;
  readonly moveCount: number;
  readonly score: number;
  /** Consecutive loads without a foul. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly loads: number;
  readonly fouls: number;
  readonly arrowsPlaced: number;
  readonly lastMove: GunneryMoveReport | null;
  readonly finished: boolean;
}
